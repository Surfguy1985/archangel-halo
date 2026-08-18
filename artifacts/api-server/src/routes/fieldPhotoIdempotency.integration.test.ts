/**
 * Field photo capture must survive the crew's phone re-sending an upload.
 *
 * A crew on bad signal registers a photo, the response never arrives, and the
 * app sends it again. Two things must hold on that second send:
 *
 *   1. it registers the SAME photo — one crew_photos row, one mirrored
 *      before/after activity, same id handed back — never a second copy of the
 *      evidence in the vault, the recap or the office feed;
 *   2. side work AFTER the photo row is committed (activity mirror, audit,
 *      photo-list reload) can never fail the request. A 500 there is what
 *      pushes the phone into the retry above in the first place.
 *
 * Runs against the real express app and the dev database with throwaway rows.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db,
  crewsTable,
  crewPhotosTable,
  crewCheckinLinksTable,
  activitiesTable,
  jobsTable,
  propertiesTable,
} from "@workspace/db";
import { hashCrewToken } from "../lib/crewCheckinCore";
import { ensureFieldPhotoSchema } from "../lib/ensureFieldPhotoSchema";
import app from "../app";

const PORTAL_TOKEN = `idem-portal-${randomUUID()}`;
/** A second, unrelated crew — used to prove one link can't reach another's photos. */
const OTHER_PORTAL_TOKEN = `idem-other-${randomUUID()}`;
// Paycard tokens are shape-checked before lookup (crew_ + hex), so a random
// label here would be rejected as malformed before reaching the photo code.
const PAYCARD_TOKEN = `crew_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
const PATHS: string[] = [];

let crewId = "";
let otherCrewId = "";
let linkId = "";
let propertyId = "";
/** The job the photo is taken for, and the job the crew moves on to. */
let jobId = "";
let otherJobId = "";
/** A real job this crew was never put on. */
let foreignJobId = "";

/** A storage path nobody else will claim; the object itself need not exist. */
function newPath(): string {
  const p = `/objects/uploads/${randomUUID()}`;
  PATHS.push(p);
  return p;
}

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

beforeAll(async () => {
  // The unique indexes are the backstop for the concurrent case.
  await ensureFieldPhotoSchema();

  const [crew] = await db
    .insert(crewsTable)
    .values({
      name: `Idem Test Crew ${randomUUID().slice(0, 8)}`,
      portalToken: PORTAL_TOKEN,
      active: true,
    })
    .returning();
  crewId = crew.id;

  const [otherCrew] = await db
    .insert(crewsTable)
    .values({
      name: `Idem Test Crew B ${randomUUID().slice(0, 8)}`,
      portalToken: OTHER_PORTAL_TOKEN,
      active: true,
    })
    .returning();
  otherCrewId = otherCrew.id;

  const [property] = await db
    .insert(propertiesTable)
    .values({ name: `Idem Test Property ${randomUUID().slice(0, 8)}` })
    .returning();
  propertyId = property.id;

  const [jobA, jobB, jobC] = await db
    .insert(jobsTable)
    .values([
      // Assigned to this crew: the portal refuses photos for someone else's job.
      {
        jobNo: `IDEM-A-${randomUUID().slice(0, 6)}`,
        propertyId,
        unitNo: "A-1",
        crewLeaderId: crewId,
      },
      {
        jobNo: `IDEM-B-${randomUUID().slice(0, 6)}`,
        propertyId,
        unitNo: "B-2",
        crewLeaderId: crewId,
      },
      // Deliberately unassigned to the crew under test.
      { jobNo: `IDEM-X-${randomUUID().slice(0, 6)}`, propertyId, unitNo: "X-9" },
    ])
    .returning();
  jobId = jobA.id;
  otherJobId = jobB.id;
  foreignJobId = jobC.id;

  const [link] = await db
    .insert(crewCheckinLinksTable)
    .values({
      token: `h:${hashCrewToken(PAYCARD_TOKEN)}`,
      tokenHash: hashCrewToken(PAYCARD_TOKEN),
      tokenPrefix: PAYCARD_TOKEN.slice(0, 14),
      crewId: crew.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      label: "idempotency test paycard",
    })
    .returning();
  linkId = link.id;
});

afterAll(async () => {
  for (const p of PATHS) {
    await db.delete(activitiesTable).where(eq(activitiesTable.storagePath, p));
    await db.delete(crewPhotosTable).where(eq(crewPhotosTable.storagePath, p));
  }
  if (linkId) {
    await db.delete(crewCheckinLinksTable).where(eq(crewCheckinLinksTable.id, linkId));
  }
  for (const id of [crewId, otherCrewId].filter(Boolean)) {
    await db.delete(crewsTable).where(eq(crewsTable.id, id));
  }
  for (const id of [jobId, otherJobId, foreignJobId].filter(Boolean)) {
    await db.delete(jobsTable).where(eq(jobsTable.id, id));
  }
  if (propertyId) {
    await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
  }
});

async function countRows(storagePath: string) {
  const photos = await db
    .select({ id: crewPhotosTable.id })
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.storagePath, storagePath));
  const mirrors = await db
    .select({ id: activitiesTable.id })
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.storagePath, storagePath),
        eq(activitiesTable.entityType, "job"),
      ),
    );
  return { photos: photos.length, mirrors: mirrors.length };
}

describe("field photo registration is idempotent", () => {
  it("portal: a re-sent upload returns the same photo, not a second one", async () => {
    const storagePath = newPath();
    const body = { storagePath, takenOn: localDay(), phase: "before" as const };

    const first = await request(app).post(`/api/portal/${PORTAL_TOKEN}/photos`).send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post(`/api/portal/${PORTAL_TOKEN}/photos`).send(body);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    expect((await countRows(storagePath)).photos).toBe(1);
  });

  it("portal: two simultaneous re-sends still leave one photo", async () => {
    const storagePath = newPath();
    const body = { storagePath, takenOn: localDay(), phase: "after" as const };
    const send = () => request(app).post(`/api/portal/${PORTAL_TOKEN}/photos`).send(body);

    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    expect((await countRows(storagePath)).photos).toBe(1);
  });

  it("paycard: a re-sent upload returns the same photo", async () => {
    const storagePath = newPath();
    const body = { storagePath, phase: "before" as const };

    const first = await request(app).post(`/api/checkin/${PAYCARD_TOKEN}/photos`).send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post(`/api/checkin/${PAYCARD_TOKEN}/photos`).send(body);
    expect(second.status).toBe(201);
    expect(second.body.photo.id).toBe(first.body.photo.id);

    expect((await countRows(storagePath)).photos).toBe(1);
  });
});

describe("a crew link can't reach past its own evidence", () => {
  it("an unassigned job is refused and nothing is deleted", async () => {
    const fieldPhotos = await import("../lib/fieldPhotos");
    const discard = vi.spyOn(fieldPhotos, "discardOrphanedUpload");
    const storagePath = newPath();

    // A job that exists but belongs to nobody on this link, and a job id that
    // isn't even a uuid (which would otherwise throw mid-insert).
    for (const badJob of [foreignJobId, "not-a-uuid"]) {
      const res = await request(app)
        .post(`/api/checkin/${PAYCARD_TOKEN}/photos`)
        .send({ storagePath, phase: "before", jobId: badJob });
      expect(res.status).toBe(400);
    }
    expect(discard).not.toHaveBeenCalled();
    expect((await countRows(storagePath)).photos).toBe(0);
    discard.mockRestore();
  });

  it("refuses to discard an object another photo still references", async () => {
    const { discardOrphanedUpload } = await import("../lib/fieldPhotos");
    const storagePath = newPath();
    const res = await request(app)
      .post(`/api/checkin/${PAYCARD_TOKEN}/photos`)
      .send({ storagePath, phase: "before", jobId });
    expect(res.status).toBe(201);

    // Even called outright, cleanup must leave a registered object alone.
    await discardOrphanedUpload(storagePath);
    expect((await countRows(storagePath)).photos).toBe(1);
  });

  it("won't hand another crew's photo back as this crew's retry", async () => {
    const storagePath = newPath();
    const first = await request(app)
      .post(`/api/portal/${PORTAL_TOKEN}/photos`)
      .send({ storagePath, takenOn: localDay(), phase: "before", jobId });
    expect(first.status).toBe(201);

    const stolen = await request(app)
      .post(`/api/portal/${OTHER_PORTAL_TOKEN}/photos`)
      .send({ storagePath, takenOn: localDay(), phase: "before" });
    expect(stolen.status).toBe(403);
    expect(stolen.body.id).toBeUndefined();

    // The original crew still owns exactly one photo at that path.
    const [row] = await db
      .select({ crewId: crewPhotosTable.crewId })
      .from(crewPhotosTable)
      .where(eq(crewPhotosTable.storagePath, storagePath));
    expect(row.crewId).toBe(crewId);
  });

  it("portal refuses a storage path we never minted", async () => {
    for (const path of [
      "/objects/private/business/logo.png",
      "/objects/uploads/../private/secret.png",
      "/not-an-object/anything.jpg",
    ]) {
      const res = await request(app)
        .post(`/api/portal/${PORTAL_TOKEN}/photos`)
        .send({ storagePath: path, takenOn: localDay(), phase: "before", jobId });
      expect(res.status).toBe(400);
      // Neither the vault nor the office feed may learn about it.
      const rows = await countRows(path);
      expect(rows.photos).toBe(0);
      expect(rows.mirrors).toBe(0);
    }
  });

  it("paycard refuses a storage path we never minted", async () => {
    const fieldPhotos = await import("../lib/fieldPhotos");
    const discard = vi.spyOn(fieldPhotos, "discardOrphanedUpload");
    const res = await request(app)
      .post(`/api/checkin/${PAYCARD_TOKEN}/photos`)
      .send({ storagePath: "/objects/private/business/logo.png", phase: "before" });
    expect(res.status).toBe(400);
    expect(discard).not.toHaveBeenCalled();
    discard.mockRestore();
  });
});

describe("nothing after the commit may fail the request", () => {
  it("portal: a broken activity mirror still returns the saved photo", async () => {
    const fieldPhotos = await import("../lib/fieldPhotos");
    const spy = vi
      .spyOn(fieldPhotos, "mirrorFieldPhotoActivity")
      .mockRejectedValue(new Error("mirror exploded"));
    try {
      const storagePath = newPath();
      const res = await request(app)
        .post(`/api/portal/${PORTAL_TOKEN}/photos`)
        .send({ storagePath, takenOn: localDay(), phase: "before" });
      expect(res.status).toBe(201);
      expect((await countRows(storagePath)).photos).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("portal: a resend repairs a mirror that failed the first time", async () => {
    const storagePath = newPath();
    const body = { storagePath, takenOn: localDay(), phase: "before" as const, jobId };
    const fieldPhotos = await import("../lib/fieldPhotos");

    const spy = vi
      .spyOn(fieldPhotos, "mirrorFieldPhotoActivity")
      .mockRejectedValue(new Error("mirror exploded"));
    const first = await request(app).post(`/api/portal/${PORTAL_TOKEN}/photos`).send(body);
    spy.mockRestore();
    expect(first.status).toBe(201);
    // The photo is saved but the office cannot see it yet.
    expect((await countRows(storagePath)).mirrors).toBe(0);

    // The crew's phone resends; that is the only chance to repair the mirror.
    const second = await request(app).post(`/api/portal/${PORTAL_TOKEN}/photos`).send(body);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    const rows = await countRows(storagePath);
    expect(rows.photos).toBe(1);
    expect(rows.mirrors).toBe(1);
  });

  it("portal: the loser of a race repairs the winner's failed mirror", async () => {
    const storagePath = newPath();
    const body = { storagePath, takenOn: localDay(), phase: "after" as const, jobId };
    const fieldPhotos = await import("../lib/fieldPhotos");
    const send = () => request(app).post(`/api/portal/${PORTAL_TOKEN}/photos`).send(body);

    // Both racers fail to mirror — this is the winner committing the row while
    // its own mirror blows up.
    const spy = vi
      .spyOn(fieldPhotos, "mirrorFieldPhotoActivity")
      .mockRejectedValue(new Error("mirror exploded"));
    const [a, b] = await Promise.all([send(), send()]);
    spy.mockRestore();
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    expect((await countRows(storagePath)).mirrors).toBe(0);

    // Any later arrival — a third racer or the phone resending — repairs it.
    const third = await send();
    expect(third.status).toBe(201);
    const rows = await countRows(storagePath);
    expect(rows.photos).toBe(1);
    expect(rows.mirrors).toBe(1);
  });

  it("paycard: a resend mirrors onto the photo's own job, not today's", async () => {
    const storagePath = newPath();
    const fieldPhotos = await import("../lib/fieldPhotos");
    const mirror = vi.spyOn(fieldPhotos, "mirrorFieldPhotoActivity");

    const first = await request(app)
      .post(`/api/checkin/${PAYCARD_TOKEN}/photos`)
      .send({ storagePath, phase: "before", jobId });
    expect(first.status).toBe(201);

    // Row now says job A. Simulate the crew's dispatch moving on before the
    // phone retries: the resend must NOT drag the photo onto the new job.
    mirror.mockClear();
    const second = await request(app)
      .post(`/api/checkin/${PAYCARD_TOKEN}/photos`)
      .send({ storagePath, phase: "after", jobId: otherJobId });
    expect(second.status).toBe(201);
    expect(second.body.photo.id).toBe(first.body.photo.id);
    expect(mirror).toHaveBeenCalledWith(expect.objectContaining({ jobId, phase: "before" }));
    mirror.mockRestore();

    const mirrors = await db
      .select({ entityId: activitiesTable.entityId })
      .from(activitiesTable)
      .where(eq(activitiesTable.storagePath, storagePath));
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0].entityId).toBe(jobId);
  });

  it("paycard: a broken activity mirror still returns the saved photo", async () => {
    const fieldPhotos = await import("../lib/fieldPhotos");
    const spy = vi
      .spyOn(fieldPhotos, "mirrorFieldPhotoActivity")
      .mockRejectedValue(new Error("mirror exploded"));
    try {
      const storagePath = newPath();
      const res = await request(app)
        .post(`/api/checkin/${PAYCARD_TOKEN}/photos`)
        .send({ storagePath, phase: "after" });
      expect(res.status).toBe(201);
      expect(res.body.photo.id).toBeTruthy();
      expect((await countRows(storagePath)).photos).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
