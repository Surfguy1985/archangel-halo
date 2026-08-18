/**
 * Regression: the unit photo reel's property filter must be pushed into SQL.
 *
 * GET /api/photo-reel folds three photo sources into one slide per unit and
 * scans each source newest-first with a bounded row budget. That budget is the
 * trap: if a property filter is applied in memory *after* the scan, a busy
 * unrelated community can spend the whole budget and silently empty the
 * selected property's reel. Base44 evidence is the source at risk — it carries
 * its own property/unit labels instead of a job id.
 *
 * Covered:
 *   - a property with NO jobs still gets its Base44 evidence (that feed does
 *     not need a job to name a unit)
 *   - the selected property's evidence survives >400 newer rows belonging to
 *     another property (proves the name filter runs in SQL, not in memory)
 *   - evidence whose property name is shared by two communities stays
 *     unplaced, and never leaks into either property's filtered reel
 *
 * Seeds throwaway rows in the dev database and hits the real express app.
 * Office endpoints are passcode-gated, so the test mints a valid office
 * session cookie with SESSION_SECRET.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, propertiesTable, base44EvidenceTable } from "@workspace/db";
import app from "../app";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const RESOURCE = `reel-test-${randomUUID()}`;

// Distinct enough that a stray production row can never satisfy an assertion.
const SOLO_NAME = `Reel Test Solo ${randomUUID().slice(0, 8)}`;
const TWIN_NAME = `Reel Test Twin ${randomUUID().slice(0, 8)}`;
const NOISE_NAME = `Reel Test Noise ${randomUUID().slice(0, 8)}`;
const SOLO_UNIT = "S-101";
const TWIN_UNIT = "T-202";

// Older than the noise below, so an in-memory filter would drop these first.
const OLD = new Date(Date.now() - 90 * 24 * 3600 * 1000);
const NEW = new Date(Date.now() - 60 * 1000);

let soloId = "";
let twinAId = "";
let twinBId = "";
let noiseId = "";

type Slide = {
  unitNo: string;
  propertyId: string | null;
  propertyName: string | null;
  before: { url: string } | null;
  after: { url: string } | null;
};

async function reel(query: string): Promise<Slide[]> {
  const res = await request(app).get(`/api/photo-reel${query}`).set("Cookie", COOKIE);
  expect(res.status).toBe(200);
  return res.body as Slide[];
}

function evidenceRow(
  base44Id: string,
  propertyName: string,
  unitLabel: string,
  kind: "before" | "after",
  occurredAt: Date,
) {
  return {
    resource: RESOURCE,
    base44Id,
    kind,
    propertyName,
    unitLabel,
    mediaUrl: `https://example.invalid/${base44Id}.jpg`,
    occurredAt,
    lastSeenAt: new Date(),
    payloadHash: base44Id,
  };
}

describe("photo reel property scoping", () => {
  beforeAll(async () => {
    const inserted = await db
      .insert(propertiesTable)
      .values([
        { name: SOLO_NAME },
        { name: TWIN_NAME },
        { name: TWIN_NAME },
        { name: NOISE_NAME },
      ])
      .returning({ id: propertiesTable.id, name: propertiesTable.name });
    soloId = inserted.find((p) => p.name === SOLO_NAME)!.id;
    const twins = inserted.filter((p) => p.name === TWIN_NAME);
    twinAId = twins[0]!.id;
    twinBId = twins[1]!.id;
    noiseId = inserted.find((p) => p.name === NOISE_NAME)!.id;

    // The property under test: no jobs at all, evidence only, and older than
    // every noise row.
    await db.insert(base44EvidenceTable).values([
      evidenceRow("solo-before", SOLO_NAME, SOLO_UNIT, "before", OLD),
      evidenceRow("solo-after", SOLO_NAME, SOLO_UNIT, "after", new Date(OLD.getTime() + 3600_000)),
      evidenceRow("twin-before", TWIN_NAME, TWIN_UNIT, "before", OLD),
      evidenceRow("twin-after", TWIN_NAME, TWIN_UNIT, "after", new Date(OLD.getTime() + 3600_000)),
    ]);

    // More newest-first rows than the reel's per-source scan budget, all
    // belonging to a different community.
    const noise = Array.from({ length: 420 }, (_, i) =>
      evidenceRow(
        `noise-${i}`,
        NOISE_NAME,
        `N-${i}`,
        i % 2 === 0 ? "before" : "after",
        new Date(NEW.getTime() - i * 1000),
      ),
    );
    await db.insert(base44EvidenceTable).values(noise);
  });

  afterAll(async () => {
    await db.delete(base44EvidenceTable).where(eq(base44EvidenceTable.resource, RESOURCE));
    await db
      .delete(propertiesTable)
      .where(inArray(propertiesTable.id, [soloId, twinAId, twinBId, noiseId]));
  });

  it("serves Base44 evidence for a property that has no jobs", async () => {
    const slides = await reel(`?propertyId=${soloId}`);
    const slide = slides.find((s) => s.unitNo === SOLO_UNIT);
    expect(slide, "unit with only Base44 evidence must still get a slide").toBeTruthy();
    expect(slide!.propertyId).toBe(soloId);
    expect(slide!.before).toBeTruthy();
    expect(slide!.after).toBeTruthy();
  });

  it("keeps the selected property's evidence behind hundreds of newer rows elsewhere", async () => {
    const slides = await reel(`?propertyId=${soloId}&limit=40`);
    // The scan budget is spent on the selected property only — nothing from the
    // noisy community may appear, and the older slide must survive.
    expect(slides.every((s) => s.propertyId === soloId)).toBe(true);
    expect(slides.some((s) => s.unitNo === SOLO_UNIT)).toBe(true);
  });

  it("never files evidence under a property whose name two communities share", async () => {
    for (const id of [twinAId, twinBId]) {
      const slides = await reel(`?propertyId=${id}&limit=40`);
      expect(
        slides.some((s) => s.unitNo === TWIN_UNIT),
        "ambiguous property name must stay unplaced, not claim a property",
      ).toBe(false);
    }
  });

  it("returns an empty reel for an unknown property", async () => {
    const slides = await reel(`?propertyId=${randomUUID()}`);
    expect(slides).toEqual([]);
  });
});
