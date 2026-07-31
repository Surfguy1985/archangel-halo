/**
 * Presentation Mode seed/teardown tests.
 *
 * The narrated Board Demo relies on the seed creating REAL crew_photos rows
 * for the demo drywall job (they back the before/after photos card and its
 * tour step). If photo seeding silently degrades, the tour narrates over a
 * missing card. These tests hit the real dev database:
 *
 *   - seed creates the demo property + crew_photos rows for the demo job
 *   - photos carry the expected before/after phases
 *   - teardown removes the property and every demo crew_photos row
 *
 * Seeding is idempotent (seed tears down any prior demo first), and teardown
 * only ever touches rows tagged with the hard demo markers, so running this
 * against the dev DB is safe.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  propertiesTable,
  crewsTable,
  jobsTable,
  crewPhotosTable,
} from "@workspace/db";
import {
  DEMO_PROPERTY_NAME,
  seedPresentationDemo,
  teardownPresentationDemo,
  getPresentationDemoState,
} from "./presentationDemo";

async function demoJobIds(propertyId: string): Promise<string[]> {
  const jobs = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.propertyId, propertyId));
  return jobs.map((j) => j.id);
}

async function demoPhotos(propertyId: string) {
  const jobIds = await demoJobIds(propertyId);
  if (!jobIds.length) return [];
  return db.select().from(crewPhotosTable).where(inArray(crewPhotosTable.jobId, jobIds));
}

describe("presentation demo seed/teardown", () => {
  let propertyId: string;

  beforeAll(async () => {
    const seeded = await seedPresentationDemo();
    propertyId = seeded.propertyId;
    expect(seeded.dashboardToken).toBeTruthy();
  });

  afterAll(async () => {
    // Always clean up, even if assertions failed mid-run.
    await teardownPresentationDemo();
  });

  it("seed creates the demo property and reports active state", async () => {
    const [prop] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId))
      .limit(1);
    expect(prop?.name).toBe(DEMO_PROPERTY_NAME);

    const state = await getPresentationDemoState();
    expect(state.active).toBe(true);
    expect(state.propertyId).toBe(propertyId);
    expect(state.dashboardToken).toBeTruthy();
  });

  it("seed creates crew_photos rows for the demo job with before/after phases", async () => {
    const photos = await demoPhotos(propertyId);
    // Photo seeding is best-effort only when object storage is missing; in
    // this workspace storage IS configured, so absence means real breakage.
    expect(photos.length).toBeGreaterThan(0);
    const phases = new Set(photos.map((p) => p.phase));
    expect(phases.has("before")).toBe(true);
    expect(phases.has("after")).toBe(true);
    // Every photo belongs to a demo crew and serves from the fixed demo path.
    for (const p of photos) {
      expect(p.storagePath).toMatch(/^\/objects\/demo-board\//);
    }
    const crewIds = [...new Set(photos.map((p) => p.crewId))];
    const crews = await db.select().from(crewsTable).where(inArray(crewsTable.id, crewIds));
    expect(crews.length).toBe(crewIds.length);
    for (const c of crews) expect(c.email).toBe("demo-crew@falkon.example");
  });

  it("teardown removes the demo property and all demo crew_photos rows", async () => {
    // Capture the job ids BEFORE teardown deletes them.
    const jobIds = await demoJobIds(propertyId);
    expect(jobIds.length).toBeGreaterThan(0);
    const before = await demoPhotos(propertyId);
    expect(before.length).toBeGreaterThan(0);

    const removed = await teardownPresentationDemo();
    expect(removed).toBe(true);

    const [prop] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId))
      .limit(1);
    expect(prop).toBeUndefined();

    const after = await db
      .select()
      .from(crewPhotosTable)
      .where(inArray(crewPhotosTable.jobId, jobIds));
    expect(after.length).toBe(0);

    const state = await getPresentationDemoState();
    expect(state.active).toBe(false);

    // Second teardown is a safe no-op.
    expect(await teardownPresentationDemo()).toBe(false);
  });
});
