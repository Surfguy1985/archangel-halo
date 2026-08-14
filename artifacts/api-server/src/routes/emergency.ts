import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  jobsTable,
  crewsTable,
  propertiesTable,
  crewCheckinsTable,
  emergencyPingsTable,
  emergencyPingTargetsTable,
  crewPayHoldsTable,
  schedulesTable,
  activitiesTable,
  notificationsTable,
} from "@workspace/db";
import {
  GetEmergencyCandidatesParams,
  GetEmergencyCandidatesResponse,
  GetEmergencyPingParams,
  GetEmergencyPingResponse,
  SendEmergencyPingParams,
  SendEmergencyPingBody,
  SendEmergencyPingResponse,
  CancelEmergencyPingParams,
  CancelEmergencyPingResponse,
} from "@workspace/api-zod";
import { smsEnabled, sendSms } from "../lib/sms";
import { mintPortalToken, portalTokenColumns } from "../lib/portalToken";
import { recomputeJobFinancials } from "../lib/jobFinance";
import { syncJobLaborLedger } from "../lib/ledger";
import { logger } from "../lib/logger";
import { pushToCrews } from "../lib/pushNotification";

const router: IRouter = Router();

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Candidate = {
  crewId: string;
  name: string;
  trade: string | null;
  phone: string | null;
  selfiePath: string | null;
  distanceMeters: number | null;
  distanceMiles: number | null;
  lastCheckinAt: string | null;
  minutesAgo: number | null;
  checkinLabel: string | null;
};

async function rankCandidates(propertyLat: number | null, propertyLng: number | null) {
  const crews = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.active, true));
  const checkins = await db
    .select()
    .from(crewCheckinsTable)
    .orderBy(desc(crewCheckinsTable.createdAt));
  // Latest check-in with coordinates, per crew.
  const latest = new Map<string, (typeof checkins)[number]>();
  for (const c of checkins) {
    if (c.lat == null || c.lng == null) continue;
    if (!latest.has(c.crewId)) latest.set(c.crewId, c);
  }
  const now = Date.now();
  const out: Candidate[] = crews.map((crew) => {
    const ci = latest.get(crew.id) ?? null;
    const hasCoords =
      ci != null && propertyLat != null && propertyLng != null;
    const dist = hasCoords
      ? haversineMeters(propertyLat, propertyLng, ci.lat!, ci.lng!)
      : null;
    return {
      crewId: crew.id,
      name: crew.name,
      trade: crew.trade ?? null,
      phone: crew.phone ?? null,
      selfiePath: crew.selfiePath ?? null,
      distanceMeters: dist != null ? Math.round(dist) : null,
      distanceMiles: dist != null ? Math.round((dist / 1609.344) * 10) / 10 : null,
      lastCheckinAt: ci ? ci.createdAt.toISOString() : null,
      minutesAgo: ci
        ? Math.max(0, Math.round((now - ci.createdAt.getTime()) / 60000))
        : null,
      checkinLabel: ci?.label ?? null,
    };
  });
  // Closest first; crews with no location data sink to the bottom.
  out.sort((a, b) => {
    if (a.distanceMeters == null && b.distanceMeters == null)
      return a.name.localeCompare(b.name);
    if (a.distanceMeters == null) return 1;
    if (b.distanceMeters == null) return -1;
    return a.distanceMeters - b.distanceMeters;
  });
  return out;
}

router.get(
  "/jobs/:id/emergency/candidates",
  async (req, res): Promise<void> => {
    const { id } = GetEmergencyCandidatesParams.parse(req.params);
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const [prop] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, job.propertyId));
    const lat = prop?.latitude ?? null;
    const lng = prop?.longitude ?? null;
    const candidates = await rankCandidates(lat, lng);
    res.json(
      GetEmergencyCandidatesResponse.parse({
        propertyName: prop?.name ?? null,
        propertyHasLocation: lat != null && lng != null,
        smsAvailable: await smsEnabled(),
        jobPay: job.crewRate ?? 0,
        candidates,
      }),
    );
  },
);

async function pingView(ping: typeof emergencyPingsTable.$inferSelect) {
  const [targets, crews, holds] = await Promise.all([
    db
      .select()
      .from(emergencyPingTargetsTable)
      .where(eq(emergencyPingTargetsTable.pingId, ping.id)),
    db.select().from(crewsTable),
    db
      .select()
      .from(crewPayHoldsTable)
      .where(eq(crewPayHoldsTable.pingId, ping.id)),
  ]);
  const crewName = new Map(crews.map((c) => [c.id, c.name]));
  const hold = holds[0] ?? null;
  return {
    id: ping.id,
    jobId: ping.jobId,
    status: ping.status,
    bonusAmount: ping.bonusAmount,
    payAmount: ping.payAmount,
    neededBy: ping.neededBy,
    note: ping.note,
    filledByCrewId: ping.filledByCrewId,
    filledByCrewName: ping.filledByCrewId
      ? (crewName.get(ping.filledByCrewId) ?? null)
      : null,
    filledAt: ping.filledAt ? ping.filledAt.toISOString() : null,
    createdAt: ping.createdAt.toISOString(),
    expiresAt: ping.expiresAt ? ping.expiresAt.toISOString() : null,
    expiredAt: ping.expiredAt ? ping.expiredAt.toISOString() : null,
    hold: hold
      ? {
          id: hold.id,
          crewId: hold.crewId,
          amount: hold.amount,
          bonusAmount: hold.bonusAmount,
          status: hold.status,
          heldAt: hold.heldAt.toISOString(),
          releasedAt: hold.releasedAt ? hold.releasedAt.toISOString() : null,
        }
      : null,
    targets: targets
      .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
      .map((t) => ({
        id: t.id,
        crewId: t.crewId,
        crewName: crewName.get(t.crewId) ?? "Unknown crew",
        status: t.status,
        distanceMeters: t.distanceMeters,
        smsSent: t.smsSent,
        sentAt: t.sentAt.toISOString(),
        respondedAt: t.respondedAt ? t.respondedAt.toISOString() : null,
      })),
  };
}

router.get("/jobs/:id/emergency", async (req, res): Promise<void> => {
  const { id } = GetEmergencyPingParams.parse(req.params);
  const [ping] = await db
    .select()
    .from(emergencyPingsTable)
    .where(eq(emergencyPingsTable.jobId, id))
    .orderBy(desc(emergencyPingsTable.createdAt))
    .limit(1);
  res.json(
    GetEmergencyPingResponse.parse({ ping: ping ? await pingView(ping) : null }),
  );
});

router.post("/jobs/:id/emergency/ping", async (req, res): Promise<void> => {
  const { id } = SendEmergencyPingParams.parse(req.params);
  const body = SendEmergencyPingBody.parse(req.body);
  const crewIds = [...new Set(body.crewIds)];
  if (crewIds.length === 0) {
    res.status(400).json({ error: "Select at least one crew to ping" });
    return;
  }
  if (body.bonusAmount < 0) {
    res.status(400).json({ error: "Bonus can't be negative" });
    return;
  }
  const expiresInMinutes = body.expiresInMinutes ?? null;
  if (
    expiresInMinutes != null &&
    (!Number.isFinite(expiresInMinutes) || expiresInMinutes < 1)
  ) {
    res.status(400).json({ error: "Expiry must be at least 1 minute" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (
    ["complete", "paid", "cancelled"].includes(job.status) ||
    job.clearedAt
  ) {
    res.status(409).json({ error: "This job can no longer be emergency-pinged" });
    return;
  }
  const [existing] = await db
    .select()
    .from(emergencyPingsTable)
    .where(
      and(
        eq(emergencyPingsTable.jobId, id),
        eq(emergencyPingsTable.status, "open"),
      ),
    );
  if (existing) {
    res.status(409).json({
      error: "An emergency ping is already out for this job — cancel it first.",
    });
    return;
  }

  const crews = await db
    .select()
    .from(crewsTable)
    .where(inArray(crewsTable.id, crewIds));
  if (crews.length !== crewIds.length) {
    res.status(400).json({ error: "One of the selected crews no longer exists" });
    return;
  }

  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, job.propertyId));
  const ranked = await rankCandidates(
    prop?.latitude ?? null,
    prop?.longitude ?? null,
  );
  const rankedById = new Map(ranked.map((r) => [r.crewId, r]));

  const pay = job.crewRate ?? 0;
  const bonus = Math.round(body.bonusAmount * 100) / 100;

  const ping = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(emergencyPingsTable)
      .values({
        jobId: id,
        bonusAmount: bonus,
        payAmount: pay,
        neededBy: body.neededBy ?? null,
        note: body.note ?? null,
        status: "open",
        expiresAt:
          expiresInMinutes != null
            ? new Date(Date.now() + expiresInMinutes * 60 * 1000)
            : null,
      })
      .returning();
    for (const crew of crews) {
      // Every recipient needs a live portal link.
      if (!crew.portalToken) {
        const minted = mintPortalToken();
        await tx
          .update(crewsTable)
          .set(portalTokenColumns(minted))
          .where(eq(crewsTable.id, crew.id));
        crew.portalToken = minted.token;
      }
      const r = rankedById.get(crew.id);
      await tx.insert(emergencyPingTargetsTable).values({
        pingId: p!.id,
        jobId: id,
        crewId: crew.id,
        status: "pending",
        distanceMeters: r?.distanceMeters ?? null,
        checkinAt: r?.lastCheckinAt ? new Date(r.lastCheckinAt) : null,
      });
    }
    // NOTE: sameDayPay/emergencyBonus are set on the job only when a crew
    // actually commits — a ping alone must not change job economics.
    return p!;
  });

  // Best-effort SMS — never fails the ping.
  const canSms = await smsEnabled();
  const propLabel = [prop?.name, prop?.address].filter(Boolean).join(", ");
  for (const crew of crews) {
    let smsSent: string | null = null;
    if (canSms && crew.phone) {
      const msg = `URGENT — ${propLabel || "a property"} needs you ASAP. Pay $${pay.toFixed(0)} + $${bonus.toFixed(0)} bonus, same-day pay.${body.neededBy ? ` Needed by ${body.neededBy}.` : ""} Open your crew portal to commit — first to accept gets it.`;
      const result = await sendSms(crew.phone, msg);
      smsSent = result.ok ? "sent" : (result.error ?? "failed");
    }
    if (smsSent) {
      await db
        .update(emergencyPingTargetsTable)
        .set({ smsSent })
        .where(
          and(
            eq(emergencyPingTargetsTable.pingId, ping.id),
            eq(emergencyPingTargetsTable.crewId, crew.id),
          ),
        );
    }
  }

  pushToCrews(crews, {
    title: "🚨 Emergency offer",
    body: `${propLabel || "A property"} needs you ASAP. Pay $${pay.toFixed(0)} + $${bonus.toFixed(0)} bonus — first to accept gets it.`,
    data: { kind: "emergency", jobId: id },
  });

  const jobLabel = [job.jobNo, job.category].filter(Boolean).join(" · ");
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: id,
    kind: "note",
    body: `Emergency ping sent to ${crews.length} crew${crews.length === 1 ? "" : "s"} — $${bonus.toFixed(2)} bonus on top of $${pay.toFixed(2)} pay, same-day payout`,
  });
  await db.insert(notificationsTable).values({
    kind: "emergency_ping_sent",
    priority: "urgent",
    entityType: "job",
    entityId: id,
    title: `Emergency ping out for ${jobLabel}`,
    body: `${crews.length} crew${crews.length === 1 ? "" : "s"} pinged with a $${bonus.toFixed(2)} bonus. First to commit wins.`,
  });

  logger.info({ jobId: id, pingId: ping.id, crews: crews.length }, "emergency ping sent");
  res.status(201).json(SendEmergencyPingResponse.parse(await pingView(ping)));
});

router.post("/jobs/:id/emergency/cancel", async (req, res): Promise<void> => {
  const { id } = CancelEmergencyPingParams.parse(req.params);
  const [ping] = await db
    .select()
    .from(emergencyPingsTable)
    .where(eq(emergencyPingsTable.jobId, id))
    .orderBy(desc(emergencyPingsTable.createdAt))
    .limit(1);
  if (!ping) {
    res.status(404).json({ error: "No emergency ping for this job" });
    return;
  }
  if (ping.status === "cancelled") {
    res.status(409).json({ error: "This ping is already cancelled" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (job && (job.clearedAt || job.status === "complete")) {
    res.status(409).json({
      error: "This job is already complete — the hold releases through close-out instead.",
    });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Guarded: only cancel a ping that hasn't already been cancelled.
    const cancelled = await tx
      .update(emergencyPingsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(
        and(
          eq(emergencyPingsTable.id, ping.id),
          inArray(emergencyPingsTable.status, ["open", "filled"]),
        ),
      )
      .returning();
    if (cancelled.length === 0) return { ok: false as const };
    await tx
      .update(emergencyPingTargetsTable)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(
        and(
          eq(emergencyPingTargetsTable.pingId, ping.id),
          eq(emergencyPingTargetsTable.status, "pending"),
        ),
      );
    // Return any live hold: guarded HELD -> CANCELLED, never touches a
    // released hold.
    await tx
      .update(crewPayHoldsTable)
      .set({ status: "CANCELLED", cancelledAt: new Date() })
      .where(
        and(
          eq(crewPayHoldsTable.pingId, ping.id),
          eq(crewPayHoldsTable.status, "HELD"),
        ),
      );
    // Undo the commit's effects on the job: strip emergency economics and,
    // if the winning crew is still assigned, unstaff so the job shows as
    // "lost its crew" in Today rather than silently keeping the assignment.
    if (job) {
      const wasFilled = cancelled[0]!.filledByCrewId != null;
      const unstaff =
        wasFilled && job.crewLeaderId === cancelled[0]!.filledByCrewId;
      await tx
        .update(jobsTable)
        .set({
          sameDayPay: false,
          emergencyBonus: null,
          ...(unstaff
            ? {
                crewLeaderId: null,
                crewVacatedAt: new Date(),
                boardStatus:
                  job.boardStatus === "filled" ? "reopened" : job.boardStatus,
              }
            : {}),
        })
        .where(eq(jobsTable.id, job.id));
      if (unstaff) {
        await tx
          .delete(schedulesTable)
          .where(
            and(
              eq(schedulesTable.jobId, job.id),
              eq(schedulesTable.crewLeaderId, cancelled[0]!.filledByCrewId!),
            ),
          );
      }
    }
    return { ok: true as const, ping: cancelled[0]! };
  });

  if (!result.ok) {
    res.status(409).json({ error: "This ping was already resolved" });
    return;
  }
  // Emergency economics were stripped from the job — resync stored margins
  // and the labor ledger so no bonus lingers in the books.
  await recomputeJobFinancials(id);
  await syncJobLaborLedger(id);

  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: id,
    kind: "note",
    body: "Emergency ping cancelled — held pay returned and the job unstaffed if it was claimed through this ping",
  });
  res.json(CancelEmergencyPingResponse.parse(await pingView(result.ping)));
});

export default router;
