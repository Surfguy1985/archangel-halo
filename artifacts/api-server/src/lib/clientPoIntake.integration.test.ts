/**
 * End-to-end client-PO-intake test through the AUTHORIZED command-execution
 * path — not just the pure resolver.
 *
 * Covers the review defects:
 *   1. Reachability: authorizeAction must MAP "client_po.receive" to a write
 *      capability so the command isn't rejected 403 before dispatch.
 *   2. Guarded stamp: the PO lands on exactly the resolved job; a concurrent
 *      close/reassign is reported, never silently stamped.
 *   3. Idempotency: re-submitting the SAME PO number is a no-op — it must NOT
 *      clear the acknowledgement or re-arm the alert. Only a NEW PO re-arms.
 *   4. Scope: a property-scoped identity can't reach another property's jobs.
 *
 * Seeds throwaway rows in the dev database and calls executeClientPoReceive
 * directly (SMS/push are mocked so the test does no external I/O), then asserts
 * on the persisted job state.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, propertiesTable, jobsTable, activitiesTable, notificationsTable } from "@workspace/db";
import { authorizeAction, capabilityForAction, type HaloIdentity } from "./enforcerCore";
import { ensureClientPoSchema } from "./ensureClientPoSchema";

// No external I/O from this test.
vi.mock("./sms", () => ({
  smsEnabled: async () => false,
  sendSms: async () => ({ ok: true }),
  getTwilioSettings: async () => null,
}));
vi.mock("./pushNotification", () => ({
  pushToCrewId: async () => undefined,
}));
vi.mock("./base44Write", () => ({
  pushPoToBase44: async () => ({ ok: true, error: null }),
}));

// Import AFTER the mocks are registered so the executor picks them up.
const { executeClientPoReceive } = await import("./jarvisDispatch");

const admin: HaloIdentity = { subject: "office-1", tenantId: "t", roles: ["admin"], source: "enforcer" };

describe("client PO intake — authorized command-execution path", () => {
  const propId = randomUUID();
  const otherPropId = randomUUID();
  let liveJobId = "";
  let closedJobId = "";
  let otherJobId = "";
  const tag = Date.now();
  const propName = `PO Test Ridge ${tag}`;
  const otherName = `PO Other Place ${tag}`;

  beforeAll(async () => {
    await ensureClientPoSchema();
    await db.insert(propertiesTable).values([
      { id: propId, name: propName },
      { id: otherPropId, name: otherName },
    ]);
    const [live] = await db
      .insert(jobsTable)
      .values({ jobNo: `POJ-${tag}-A`, propertyId: propId, unitNo: "204", status: "in_progress" })
      .returning({ id: jobsTable.id });
    const [closed] = await db
      .insert(jobsTable)
      .values({ jobNo: `POJ-${tag}-B`, propertyId: propId, unitNo: "999", status: "complete" })
      .returning({ id: jobsTable.id });
    const [other] = await db
      .insert(jobsTable)
      .values({ jobNo: `POJ-${tag}-C`, propertyId: otherPropId, unitNo: "204", status: "in_progress" })
      .returning({ id: jobsTable.id });
    liveJobId = live!.id;
    closedJobId = closed!.id;
    otherJobId = other!.id;
  });

  afterAll(async () => {
    for (const id of [liveJobId, closedJobId, otherJobId]) {
      if (!id) continue;
      await db.delete(activitiesTable).where(eq(activitiesTable.entityId, id));
      await db.delete(notificationsTable).where(eq(notificationsTable.entityId, id));
    }
    await db.delete(jobsTable).where(eq(jobsTable.propertyId, propId));
    await db.delete(jobsTable).where(eq(jobsTable.propertyId, otherPropId));
    await db.delete(propertiesTable).where(eq(propertiesTable.id, propId));
    await db.delete(propertiesTable).where(eq(propertiesTable.id, otherPropId));
  });

  it("maps the capability so the command is reachable (not 403 before dispatch)", () => {
    expect(capabilityForAction("client_po.receive")).toBe("jobs.write");
    expect(authorizeAction(admin, "client_po.receive").ok).toBe(true);
    // An identity without jobs.write is rejected — proving the gate is real.
    const crew: HaloIdentity = { subject: "c", tenantId: "t", roles: ["crew"], source: "enforcer" };
    expect(authorizeAction(crew, "client_po.receive")).toMatchObject({ ok: false, status: 403 });
    // PM-live sessions can never write.
    const pm: HaloIdentity = { subject: "p", tenantId: "t", roles: ["property_manager"], source: "pm_live", propertyId: propId };
    expect(authorizeAction(pm, "client_po.receive").ok).toBe(false);
  });

  it("stamps the PO onto exactly the resolved live job", async () => {
    const msg = await executeClientPoReceive(
      { body: `here's PO 55501 for unit 204 at ${propName}, send to vendor`, poSource: "office chat" },
      "",
      admin,
    );
    expect(msg).toContain("PO 55501");
    expect(msg.toLowerCase()).toContain("attached");

    const [job] = await db
      .select({ poNumber: jobsTable.poNumber, poReceivedAt: jobsTable.poReceivedAt, poAcknowledgedAt: jobsTable.poAcknowledgedAt })
      .from(jobsTable)
      .where(eq(jobsTable.id, liveJobId));
    expect(job!.poNumber).toBe("55501");
    expect(job!.poReceivedAt).toBeTruthy();
    expect(job!.poAcknowledgedAt).toBeNull();

    // The activity + notification rows were written exactly once.
    const acts = await db.select().from(activitiesTable).where(eq(activitiesTable.entityId, liveJobId));
    expect(acts.filter((a) => a.kind === "po_received").length).toBe(1);
  });

  it("is idempotent on the same PO — does not re-arm after acknowledgement", async () => {
    // Simulate the office acknowledging the banner.
    const ackAt = new Date();
    await db.update(jobsTable).set({ poAcknowledgedAt: ackAt }).where(eq(jobsTable.id, liveJobId));

    const before = (
      await db.select({ at: jobsTable.poReceivedAt }).from(jobsTable).where(eq(jobsTable.id, liveJobId))
    )[0]!.at;

    const msg = await executeClientPoReceive(
      { body: `PO 55501 for unit 204 at ${propName}`, poSource: "office chat" },
      "",
      admin,
    );
    expect(msg.toLowerCase()).toContain("already");

    const [job] = await db
      .select({ poReceivedAt: jobsTable.poReceivedAt, poAcknowledgedAt: jobsTable.poAcknowledgedAt })
      .from(jobsTable)
      .where(eq(jobsTable.id, liveJobId));
    // Acknowledgement preserved, receipt timestamp unchanged — alert NOT re-armed.
    expect(job!.poAcknowledgedAt).toBeTruthy();
    expect(job!.poReceivedAt!.getTime()).toBe(before!.getTime());
    // No duplicate activity row from the no-op.
    const acts = await db.select().from(activitiesTable).where(eq(activitiesTable.entityId, liveJobId));
    expect(acts.filter((a) => a.kind === "po_received").length).toBe(1);
  });

  it("a genuinely NEW PO number re-arms the alert (clears the ack)", async () => {
    const msg = await executeClientPoReceive(
      { body: `new PO 55502 for unit 204 at ${propName}`, poSource: "office chat" },
      "",
      admin,
    );
    expect(msg.toLowerCase()).toContain("attached");
    const [job] = await db
      .select({ poNumber: jobsTable.poNumber, poAcknowledgedAt: jobsTable.poAcknowledgedAt })
      .from(jobsTable)
      .where(eq(jobsTable.id, liveJobId));
    expect(job!.poNumber).toBe("55502");
    expect(job!.poAcknowledgedAt).toBeNull();
  });

  it("reports (never stamps) when the unit has no live job", async () => {
    const msg = await executeClientPoReceive(
      { body: `PO 77701 for unit 999 at ${propName}`, poSource: "office chat" },
      "",
      admin,
    );
    expect(msg.toLowerCase()).toContain("no live job");
    const [job] = await db.select({ poNumber: jobsTable.poNumber }).from(jobsTable).where(eq(jobsTable.id, closedJobId));
    expect(job!.poNumber).toBeNull();
  });

  it("scopes candidates to identity — cannot reach another property's job", async () => {
    const scoped: HaloIdentity = {
      subject: "pm",
      tenantId: "t",
      roles: ["property_manager"],
      source: "enforcer",
      propertyId: propId, // scoped to OUR property, not otherProp
    };
    const msg = await executeClientPoReceive(
      { body: `PO 88801 for unit 204 at ${otherName}`, poSource: "office chat" },
      "",
      scoped,
    );
    // The other property is outside scope, so it never resolves — nothing changed.
    expect(msg.toLowerCase()).toContain("nothing was changed");
    const [job] = await db.select({ poNumber: jobsTable.poNumber }).from(jobsTable).where(eq(jobsTable.id, otherJobId));
    expect(job!.poNumber).toBeNull();
  });
});
