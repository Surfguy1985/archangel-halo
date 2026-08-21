/**
 * Idempotent Thornbury Pulse seed — property, PM login, jobs, check-ins,
 * GPS, units, and before/after photos. Never deletes a real Base44-synced
 * Thornbury row; only fills gaps tagged with the Pulse job-number prefix.
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, ilike } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientAccountsTable,
  clientUsersTable,
  crewsTable,
  jobsTable,
  invoicesTable,
  crewCheckinsTable,
  crewPhotosTable,
  crewTrackPointsTable,
  propertyUnitsTable,
  jobLineItemsTable,
  workRequestsTable,
} from "@workspace/db";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";
import { demoAssetsDir } from "./bundledObjects";
import { logger } from "./logger";
import { PULSE_PROPERTY_NAME } from "./pulseSeat";
import { buildThornburySiteUnits, THORNBURY_SITE_META } from "./thornburySitePlan";

export const PULSE_JOB_PREFIX = "TP-";
export const PULSE_CREW_EMAIL = "pulse-crew@thornbury.halo.local";
export const PULSE_PM_EMAIL = "pm@thornbury.chaseoaks";

const THORNBURY_LAT = 33.0705;
const THORNBURY_LNG = -96.751;
const THORNBURY_ADDRESS = "7101 Chase Oaks Blvd, Plano, TX";

const DEMO_PHOTOS: Array<{ file: string; phase: "before" | "after"; note: string }> = [
  { file: "photo-before-1.jpg", phase: "before", note: "Living room wall damage — before" },
  { file: "photo-before-2.jpg", phase: "before", note: "Patch and tape in progress" },
  { file: "photo-after-1.jpg", phase: "after", note: "Repaired and repainted — after" },
  { file: "photo-after-2.jpg", phase: "after", note: "Final coat, eggshell finish" },
];

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function hashClientPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function pulsePmPassword(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HALO_PULSE_PM_PASSWORD) return env.HALO_PULSE_PM_PASSWORD;
  const secret = env.SESSION_SECRET ?? "dev";
  return `Pulse-${createHash("sha256").update(`thornbury:${secret}`).digest("hex").slice(0, 10)}`;
}

async function findThornbury() {
  const exact = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.name, PULSE_PROPERTY_NAME))
    .limit(1);
  if (exact[0]) return exact[0];
  const fuzzy = await db
    .select()
    .from(propertiesTable)
    .where(ilike(propertiesTable.name, "%thornbur%"))
    .limit(1);
  return fuzzy[0] ?? null;
}

async function seedPhotos(crewId: string, jobId: string, today: Date): Promise<number> {
  const existing = await db
    .select({ id: crewPhotosTable.id })
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.jobId, jobId));
  if (existing.length >= DEMO_PHOTOS.length) return existing.length;

  const assetsDir = demoAssetsDir();
  if (!assetsDir || !existsSync(path.join(assetsDir, DEMO_PHOTOS[0].file))) {
    logger.warn({ assetsDir }, "thornbury pulse: photo assets not found");
    return existing.length;
  }

  let privateDir: string | null = null;
  try {
    privateDir = new ObjectStorageService().getPrivateObjectDir();
    if (privateDir && !privateDir.endsWith("/")) privateDir = `${privateDir}/`;
    if (privateDir === "replace_me/" || privateDir === "replace_me") privateDir = null;
  } catch {
    privateDir = null;
  }

  const rows: (typeof crewPhotosTable.$inferInsert)[] = [];
  for (const [i, p] of DEMO_PHOTOS.entries()) {
    try {
      const buf = await readFile(path.join(assetsDir, p.file));
      if (privateDir) {
        try {
          const objectEntityPath = `${privateDir}thornbury-pulse/${p.file}`;
          const parts = objectEntityPath.startsWith("/") ? objectEntityPath.slice(1) : objectEntityPath;
          const [bucketName, ...rest] = parts.split("/");
          await objectStorageClient
            .bucket(bucketName)
            .file(rest.join("/"))
            .save(buf, { contentType: "image/jpeg" });
        } catch (err) {
          logger.warn({ err, file: p.file }, "thornbury pulse: object storage upload skipped");
        }
      }
      rows.push({
        crewId,
        jobId,
        storagePath: `/objects/thornbury-pulse/${p.file}`,
        takenOn: localYmd(today),
        phase: p.phase,
        note: p.note,
        sizeBytes: buf.length,
        lat: THORNBURY_LAT,
        lng: THORNBURY_LNG,
        capturedAt: new Date(today.getTime() - (4 - i) * 3600000),
      });
    } catch (err) {
      logger.warn({ err, file: p.file }, "thornbury pulse: could not seed photo");
    }
  }
  if (rows.length) {
    try {
      await db.insert(crewPhotosTable).values(rows).onConflictDoNothing();
    } catch (err) {
      // unique storage_path — already seeded
      logger.warn({ err }, "thornbury pulse photos seed conflict (idempotent skip)");
    }
  }
  return existing.length + rows.length;
}

export type ThornburyPulseSeedResult = {
  propertyId: string;
  propertyName: string;
  dashboardToken: string;
  loginEmail: string;
  loginPassword: string;
  jobs: number;
  photos: number;
  createdProperty: boolean;
};

export async function ensureThornburyPulse(): Promise<ThornburyPulseSeedResult> {
  const password = pulsePmPassword();
  let createdProperty = false;
  let prop = await findThornbury();
  if (!prop) {
    const [created] = await db
      .insert(propertiesTable)
      .values({
        name: PULSE_PROPERTY_NAME,
        pmcName: "Chase Oaks Residential",
        address: THORNBURY_ADDRESS,
        city: "Plano",
        units: 5,
        latitude: THORNBURY_LAT,
        longitude: THORNBURY_LNG,
        geocodedAt: new Date(),
        brief: "Pulse demo community — Thornbury at Chase Oaks.",
        status: "active",
      })
      .returning();
    prop = created;
    createdProperty = true;
  } else {
    await db
      .update(propertiesTable)
      .set({
        latitude: prop.latitude ?? THORNBURY_LAT,
        longitude: prop.longitude ?? THORNBURY_LNG,
        address: prop.address ?? THORNBURY_ADDRESS,
        city: prop.city ?? "Plano",
      })
      .where(eq(propertiesTable.id, prop.id));
  }

  const [existingAccount] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.propertyId, prop.id))
    .limit(1);
  let dashboardToken = existingAccount?.dashboardToken ?? newToken();
  if (!existingAccount) {
    await db.insert(clientAccountsTable).values({
      propertyId: prop.id,
      tier: "pro",
      dashboardToken,
      notes: "Thornbury Pulse property-manager workspace.",
      status: "active",
    });
  }

  const [existingUser] = await db
    .select()
    .from(clientUsersTable)
    .where(
      and(eq(clientUsersTable.propertyId, prop.id), eq(clientUsersTable.email, PULSE_PM_EMAIL)),
    )
    .limit(1);
  if (!existingUser) {
    await db.insert(clientUsersTable).values({
      propertyId: prop.id,
      name: "Thornbury PM",
      email: PULSE_PM_EMAIL,
      role: "admin",
      passwordHash: hashClientPassword(password),
      active: true,
    });
  } else {
    await db
      .update(clientUsersTable)
      .set({ passwordHash: hashClientPassword(password), active: true, role: "admin" })
      .where(eq(clientUsersTable.id, existingUser.id));
  }

  // Full site plate from leasing office maps (buildings 1–20 + unit numbers)
  const siteUnits = buildThornburySiteUnits();
  const existingUnits = await db
    .select()
    .from(propertyUnitsTable)
    .where(eq(propertyUnitsTable.propertyId, prop.id));
  const byLabel = new Map(existingUnits.map((u) => [u.label, u]));
  const toInsert = siteUnits.filter((u) => !byLabel.has(u.label));
  const toUpdate = siteUnits.filter((u) => byLabel.has(u.label));
  if (toInsert.length) {
    // batch insert
    for (let i = 0; i < toInsert.length; i += 80) {
      const chunk = toInsert.slice(i, i + 80);
      await db.insert(propertyUnitsTable).values(
        chunk.map((u) => ({
          propertyId: prop.id,
          label: u.label,
          x: u.x,
          y: u.y,
          w: u.w,
          h: u.h,
        })),
      );
    }
  }
  for (const u of toUpdate) {
    const row = byLabel.get(u.label)!;
    // Refresh layout coords when seed re-runs
    if (row.x !== u.x || row.y !== u.y) {
      await db
        .update(propertyUnitsTable)
        .set({ x: u.x, y: u.y, w: u.w, h: u.h, updatedAt: new Date() })
        .where(eq(propertyUnitsTable.id, row.id));
    }
  }
  logger.info(
    { propertyId: prop.id, units: siteUnits.length, inserted: toInsert.length, meta: THORNBURY_SITE_META.unitCount },
    "thornbury site plan units applied",
  );

  const crewRows = await db.select().from(crewsTable).where(eq(crewsTable.email, PULSE_CREW_EMAIL));
  let paint = crewRows[0];
  let makeReady = crewRows[1];
  if (!paint) {
    const inserted = await db
      .insert(crewsTable)
      .values([
        {
          name: "Elena Vasquez",
          trade: "Paint & Make-Ready",
          phone: "(972) 555-0144",
          email: PULSE_CREW_EMAIL,
          isLeader: true,
          active: true,
          portalToken: newToken(),
          agreementAcceptedAt: new Date(),
        },
        {
          name: "Marcus Cole",
          trade: "Flooring",
          phone: "(972) 555-0188",
          email: PULSE_CREW_EMAIL,
          isLeader: true,
          active: true,
          portalToken: newToken(),
          agreementAcceptedAt: new Date(),
        },
      ])
      .returning();
    paint = inserted[0]!;
    makeReady = inserted[1]!;
  } else if (!makeReady) {
    const [second] = await db
      .insert(crewsTable)
      .values({
        name: "Marcus Cole",
        trade: "Flooring",
        phone: "(972) 555-0188",
        email: PULSE_CREW_EMAIL,
        isLeader: true,
        active: true,
        portalToken: newToken(),
        agreementAcceptedAt: new Date(),
      })
      .returning();
    makeReady = second!;
  }

  const today = new Date();
  const ymd = localYmd(today);
  const fourDaysAgo = new Date(today.getTime() - 4 * 86400000);
  const completedOn = new Date(today.getTime() - 1 * 86400000);

  const wantedJobs: Array<{
    jobNo: string;
    unitNo: string;
    description: string;
    status: string;
    crewId: string;
    scheduledOn: string;
    completedAt: Date | null;
    tracker: boolean;
  }> = [
    {
      jobNo: `${PULSE_JOB_PREFIX}204`,
      unitNo: "2001",
      description: "Make-ready paint + wall prep, Unit 2001",
      status: "in_progress",
      crewId: paint.id,
      scheduledOn: ymd,
      completedAt: null,
      tracker: true,
    },
    {
      jobNo: `${PULSE_JOB_PREFIX}1161`,
      unitNo: "1161",
      description: "Carpet and vinyl plank, Unit 1161",
      status: "scheduled",
      crewId: makeReady.id,
      scheduledOn: localYmd(new Date(today.getTime() + 2 * 86400000)),
      completedAt: null,
      tracker: false,
    },
    {
      jobNo: `${PULSE_JOB_PREFIX}5000`,
      unitNo: "5000",
      description: "Make-Ready Package, Unit 5000",
      status: "complete",
      crewId: paint.id,
      scheduledOn: localYmd(fourDaysAgo),
      completedAt: completedOn,
      tracker: false,
    },
  ];

  const existingJobs = await db.select().from(jobsTable).where(eq(jobsTable.propertyId, prop.id));
  const byNo = new Map(existingJobs.map((j) => [j.jobNo, j]));
  for (const spec of wantedJobs) {
    if (byNo.has(spec.jobNo)) continue;
    const [row] = await db
      .insert(jobsTable)
      .values({
        jobNo: spec.jobNo,
        propertyId: prop.id,
        unitNo: spec.unitNo,
        category: "make_ready",
        description: spec.description,
        status: spec.status,
        crewLeaderId: spec.crewId,
        scheduledOn: spec.scheduledOn,
        scheduledTime: "9:00 AM",
        completedAt: spec.completedAt,
        trackerToken: spec.tracker ? newToken() : null,
      })
      .returning();
    byNo.set(spec.jobNo, row!);
  }

  const live = byNo.get(`${PULSE_JOB_PREFIX}204`)!;
  const done = byNo.get(`${PULSE_JOB_PREFIX}5000`);

  const existingCheckins = await db
    .select({ id: crewCheckinsTable.id })
    .from(crewCheckinsTable)
    .where(eq(crewCheckinsTable.jobId, live.id));
  if (!existingCheckins.length) {
    await db.insert(crewCheckinsTable).values({
      crewId: paint.id,
      jobId: live.id,
      kind: "checkin",
      lat: THORNBURY_LAT,
      lng: THORNBURY_LNG,
      accuracy: 8,
      label: "Unit 2001 — on site",
      createdAt: new Date(today.getTime() - 95 * 60 * 1000),
    });
  }

  const existingTrail = await db
    .select({ id: crewTrackPointsTable.id })
    .from(crewTrackPointsTable)
    .where(eq(crewTrackPointsTable.jobId, live.id))
    .limit(1);
  if (!existingTrail.length) {
    const points = Array.from({ length: 12 }, (_, i) => ({
      crewId: paint.id,
      jobId: live.id,
      lat: THORNBURY_LAT + i * 0.00004,
      lng: THORNBURY_LNG + i * 0.00003,
      accuracy: 10,
      createdAt: new Date(today.getTime() - (90 - i * 5) * 60 * 1000),
    }));
    await db.insert(crewTrackPointsTable).values(points);
  }

  const photosLive = await seedPhotos(paint.id, live.id, today);
  let photosDone = 0;
  if (done) {
    const existingDone = await db
      .select({ id: crewPhotosTable.id })
      .from(crewPhotosTable)
      .where(eq(crewPhotosTable.jobId, done.id));
    if (!existingDone.length) {
      photosDone = await seedPhotos(paint.id, done.id, completedOn);
    } else {
      photosDone = existingDone.length;
    }
  }
  const photos = photosLive + photosDone;

  const liveLines = await db
    .select({ id: jobLineItemsTable.id })
    .from(jobLineItemsTable)
    .where(eq(jobLineItemsTable.jobId, live.id));
  if (!liveLines.length) {
    await db.insert(jobLineItemsTable).values([
      {
        jobId: live.id,
        service: "Wall prep / patch & tape",
        unit: "job",
        rate: 185,
        qty: 1,
        assignedCrewId: paint.id,
        completedAt: new Date(today.getTime() - 80 * 60 * 1000),
        completedByCrewId: paint.id,
      },
      {
        jobId: live.id,
        service: "Interior paint — living room",
        unit: "job",
        rate: 420,
        qty: 1,
        assignedCrewId: paint.id,
      },
      {
        jobId: live.id,
        service: "Trim and doors",
        unit: "job",
        rate: 95,
        qty: 1,
        assignedCrewId: paint.id,
      },
    ]);
  }

  const [pendingReq] = await db
    .select({ id: workRequestsTable.id })
    .from(workRequestsTable)
    .where(eq(workRequestsTable.propertyId, prop.id))
    .limit(1);
  if (!pendingReq) {
    await db.insert(workRequestsTable).values({
      propertyId: prop.id,
      requesterName: "Thornbury PM",
      serviceLabel: "HVAC not cooling",
      unitNo: "6000",
      units: ["6000"],
      notes: "Resident in 6000 reports no cooling since yesterday afternoon. Please inspect the condenser.",
      neededBy: localYmd(new Date(today.getTime() + 86400000)),
      emergency: true,
      status: "pending",
      photoPaths: ["/objects/thornbury-pulse/photo-before-1.jpg"],
    });
  }

  if (done) {
    const [inv] = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.propertyId, prop.id))
      .limit(1);
    if (!inv) {
      await db.insert(invoicesTable).values({
        invoiceNo: `${PULSE_JOB_PREFIX}INV-5000`,
        propertyId: prop.id,
        jobId: done.id,
        status: "paid",
        amount: 275,
        taxAmount: 0,
        paidAt: completedOn,
      });
    }
  }

  return {
    propertyId: prop.id,
    propertyName: prop.name,
    dashboardToken,
    loginEmail: PULSE_PM_EMAIL,
    loginPassword: password,
    jobs: wantedJobs.length,
    photos,
    createdProperty,
  };
}
