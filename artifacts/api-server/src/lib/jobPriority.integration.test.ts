/**
 * Concurrency proof for "move to the top of the priority list".
 *
 * The review defect: row-locking only the target job does NOT protect the
 * min(priority) read, because two approvals for DIFFERENT jobs lock different
 * rows. Both would read the same minimum and write the same value, so neither
 * ends up on top. The executor takes a transaction-scoped advisory lock over
 * the whole ordering set; this test fires concurrent approvals and asserts
 * every job landed on its own distinct slot.
 *
 * Seeds throwaway rows in the dev database and cleans up after itself.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, asc } from "drizzle-orm";
import {
  db,
  propertiesTable,
  jobsTable,
  activitiesTable,
  autopilotActionsTable,
} from "@workspace/db";
import { ensureJobsSchema } from "./ensureJobsSchema";

// No external I/O from this test.
vi.mock("./sms", () => ({
  smsEnabled: async () => false,
  sendSms: async () => ({ ok: true }),
  getTwilioSettings: async () => null,
}));

const TAG = "T436-PRIO";
const propertyId = randomUUID();
const jobIds: string[] = [];

describe("job priority — concurrent top-slot allocation", () => {
  beforeAll(async () => {
    await ensureJobsSchema();
    await db.insert(propertiesTable).values({
      id: propertyId,
      name: `${TAG} Property`,
    });
    for (let i = 0; i < 4; i++) {
      const id = randomUUID();
      jobIds.push(id);
      await db.insert(jobsTable).values({
        id,
        jobNo: `${TAG}-${i}`,
        propertyId,
        unitNo: `${100 + i}`,
        description: `${TAG} concurrency fixture`,
      });
    }
  });

  afterAll(async () => {
    await db.delete(autopilotActionsTable).where(inArray(autopilotActionsTable.entityId, jobIds));
    await db.delete(activitiesTable).where(inArray(activitiesTable.entityId, jobIds));
    await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
    await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
  });

  it("gives every concurrently-prioritised job its own distinct slot", async () => {
    const { propose, executeAutopilotAction } = await import("./autopilot");

    const actions = [];
    for (const jobId of jobIds) {
      const a = await propose({
        kind: "prioritize_job",
        entityType: "job",
        entityId: jobId,
        title: "Move to the top",
        body: `${TAG} concurrency fixture`,
      });
      expect(a).not.toBeNull();
      actions.push(a!);
    }

    // All four approvals land at once. Without a lock over the ordering set
    // they all read the same min(priority) and collide on one value.
    const results = await Promise.all(
      actions.map((a) => executeAutopilotAction(a, "http")),
    );
    for (const r of results) {
      expect(r?.status).toBe("executed");
    }

    const rows = await db
      .select({ id: jobsTable.id, priority: jobsTable.priority })
      .from(jobsTable)
      .where(inArray(jobsTable.id, jobIds))
      .orderBy(asc(jobsTable.priority));

    const priorities = rows.map((r) => Number(r.priority));
    // Distinct slots, all above the untouched default of 0.
    expect(new Set(priorities).size).toBe(jobIds.length);
    for (const p of priorities) expect(p).toBeLessThan(0);
    // Serialized allocation means consecutive slots, not arbitrary gaps.
    expect(priorities).toEqual([-4, -3, -2, -1]);
  });

  it("cannot apply the same approval twice", async () => {
    const { propose, executeAutopilotAction } = await import("./autopilot");
    const jobId = jobIds[0]!;
    // The pending row for this job was consumed by the first test; a fresh
    // approval is a new row, and re-executing an already-executed row is the
    // case that must not re-apply.
    await db.delete(autopilotActionsTable).where(eq(autopilotActionsTable.entityId, jobId));
    const action = await propose({
      kind: "prioritize_job",
      entityType: "job",
      entityId: jobId,
      title: "Move to the top",
      body: `${TAG} double-apply fixture`,
    });
    expect(action).not.toBeNull();

    const first = await executeAutopilotAction(action!, "http");
    expect(first?.status).toBe("executed");
    const [afterFirst] = await db
      .select({ priority: jobsTable.priority })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId));

    // Second approval of the SAME action: the pending→executing claim already
    // moved the row, so this is a no-op and the priority must not shift again.
    const second = await executeAutopilotAction(action!, "http");
    expect(second).toBeNull();
    const [afterSecond] = await db
      .select({ priority: jobsTable.priority })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId));
    expect(Number(afterSecond!.priority)).toBe(Number(afterFirst!.priority));
  });
});
