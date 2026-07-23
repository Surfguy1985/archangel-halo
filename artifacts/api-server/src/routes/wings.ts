import { Router, type IRouter } from "express";
import { desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  crewsTable,
  jobsTable,
  propertiesTable,
  wingMembersTable,
  wingAssignmentsTable,
  wingScoreSnapshotsTable,
  wingIncidentsTable,
  wingQualitySubmissionsTable,
  wingQualityReviewsTable,
  wingOverridesTable,
  wingReserveAccountsTable,
  wingReserveTxnsTable,
  wingAutomationRunsTable,
  wingAuditTable,
} from "@workspace/db";
import { ensureWingMembers, recalculateCrewScore } from "../wings/services/member";
import {
  reviewQualitySubmission,
  decideQualitySubmission,
} from "../wings/services/quality";
import { candidatesForJob } from "../wings/services/eligibility";
import {
  runWingsAutomation,
  recentAutomationRuns,
} from "../wings/services/automation";
import { logWingAudit } from "../wings/services/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function crewNameMap(): Promise<Map<string, string>> {
  const crews = await db
    .select({ id: crewsTable.id, name: crewsTable.name })
    .from(crewsTable);
  return new Map(crews.map((c) => [c.id, c.name]));
}

function serializeMember(
  m: typeof wingMembersTable.$inferSelect,
  names: Map<string, string>,
  reasons?: string[] | null,
) {
  return {
    id: m.id,
    crewId: m.crewId,
    crewName: names.get(m.crewId) ?? "Crew",
    sponsorCrewId: m.sponsorCrewId,
    sponsorName: m.sponsorCrewId ? (names.get(m.sponsorCrewId) ?? null) : null,
    sponsorSince: iso(m.sponsorSince),
    membershipStatus: m.membershipStatus,
    approvedAt: iso(m.approvedAt),
    approvedBy: m.approvedBy,
    founderStatus: m.founderStatus,
    founderNumber: m.founderNumber,
    tradeSkills: (m.tradeSkills as string[] | null) ?? [],
    draftTokens: m.draftTokens,
    maxConcurrentJobs: m.maxConcurrentJobs,
    isAvailable: m.isAvailable,
    haloScore: m.haloScore,
    tier: m.tier,
    scoreConfidence: m.scoreConfidence,
    scoreUpdatedAt: iso(m.scoreUpdatedAt),
    scoreReasons: reasons ?? null,
  };
}

router.get("/wings/overview", async (_req, res): Promise<void> => {
  await ensureWingMembers().catch(() => {});
  const [members, submissions, overrides, accounts, incidents, runs] =
    await Promise.all([
      db.select().from(wingMembersTable),
      db.select().from(wingQualitySubmissionsTable),
      db.select().from(wingOverridesTable),
      db.select().from(wingReserveAccountsTable),
      db.select().from(wingIncidentsTable),
      recentAutomationRuns(1),
    ]);
  const tierCounts: Record<string, number> = {};
  for (const m of members) tierCounts[m.tier] = (tierCounts[m.tier] ?? 0) + 1;
  const lastRun = runs[0]
    ? {
        id: runs[0].id,
        kind: runs[0].kind,
        status: runs[0].status,
        actionsRun: runs[0].actionsRun,
        result: (runs[0].result as object | null) ?? null,
        error: runs[0].error,
        startedAt: runs[0].startedAt.toISOString(),
        completedAt: iso(runs[0].completedAt),
      }
    : null;
  res.json({
    members: members.length,
    pendingMembers: members.filter(
      (m) => m.membershipStatus === "PENDING_APPROVAL",
    ).length,
    pendingReviews: submissions.filter((s) => s.reviewStatus === "PENDING")
      .length,
    needsHumanReview: submissions.filter(
      (s) => s.reviewStatus === "NEEDS_REVIEW",
    ).length,
    heldReserve: accounts.reduce((s, a) => s + a.heldBalance, 0),
    releasedReserve: accounts.reduce((s, a) => s + a.releasedBalance, 0),
    readyOverrides: overrides.filter((o) => o.immediateStatus === "READY")
      .length,
    overrideTotal: overrides.reduce((s, o) => s + o.grossOverride, 0),
    openIncidents: incidents.filter((i) => !i.resolvedAt).length,
    lastRun,
    tierCounts,
  });
});

router.get("/wings/members", async (_req, res): Promise<void> => {
  await ensureWingMembers().catch(() => {});
  const [members, names, crews, assignments, incidents] = await Promise.all([
    db.select().from(wingMembersTable),
    crewNameMap(),
    db
      .select({ id: crewsTable.id, w9SubmittedAt: crewsTable.w9SubmittedAt })
      .from(crewsTable),
    db
      .select({ crewId: wingAssignmentsTable.crewId })
      .from(wingAssignmentsTable)
      .where(isNotNull(wingAssignmentsTable.completedAt)),
    db.select().from(wingIncidentsTable),
  ]);
  const w9Map = new Map(crews.map((c) => [c.id, !!c.w9SubmittedAt]));
  const jobCounts = new Map<string, number>();
  for (const a of assignments)
    jobCounts.set(a.crewId, (jobCounts.get(a.crewId) ?? 0) + 1);
  const openIncidentCounts = new Map<string, number>();
  for (const i of incidents) {
    if (!i.resolvedAt && i.crewId)
      openIncidentCounts.set(
        i.crewId,
        (openIncidentCounts.get(i.crewId) ?? 0) + 1,
      );
  }
  const snapshots = members.length
    ? await db
        .select()
        .from(wingScoreSnapshotsTable)
        .where(
          inArray(
            wingScoreSnapshotsTable.crewId,
            members.map((m) => m.crewId),
          ),
        )
        .orderBy(desc(wingScoreSnapshotsTable.createdAt))
    : [];
  const latestReasons = new Map<string, string[]>();
  for (const s of snapshots) {
    if (!latestReasons.has(s.crewId)) {
      latestReasons.set(s.crewId, (s.reasons as string[] | null) ?? []);
    }
  }
  res.json(
    members
      .map((m) => ({
        ...serializeMember(m, names, latestReasons.get(m.crewId)),
        readiness: {
          completedJobs: jobCounts.get(m.crewId) ?? 0,
          w9OnFile: w9Map.get(m.crewId) ?? false,
          openIncidents: openIncidentCounts.get(m.crewId) ?? 0,
        },
      }))
      .sort((a, b) => b.haloScore - a.haloScore),
  );
});

const memberApprovalSchema = z.object({
  approve: z.boolean(),
  reason: z.string().max(2000).optional(),
});

router.post(
  "/wings/members/:crewId/approval",
  async (req, res): Promise<void> => {
    if (!UUID_RE.test(req.params.crewId)) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    const parsed = memberApprovalSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const [member] = await db
      .select()
      .from(wingMembersTable)
      .where(eq(wingMembersTable.crewId, req.params.crewId));
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    const nextStatus = parsed.data.approve ? "ACTIVE" : "SUSPENDED";
    const [updated] = await db
      .update(wingMembersTable)
      .set({
        membershipStatus: nextStatus,
        approvedAt: parsed.data.approve ? new Date() : null,
        approvedBy: parsed.data.approve ? "ADMIN" : null,
      })
      .where(eq(wingMembersTable.crewId, req.params.crewId))
      .returning();
    await logWingAudit({
      actorType: "ADMIN",
      action: parsed.data.approve ? "MEMBER_APPROVED" : "MEMBER_SUSPENDED",
      entityType: "crew",
      entityId: req.params.crewId,
      before: { membershipStatus: member.membershipStatus },
      after: { membershipStatus: nextStatus },
      reason:
        parsed.data.reason ??
        (parsed.data.approve
          ? "Approved for the Founding Wings program."
          : "Suspended from the Founding Wings program."),
    });
    const names = await crewNameMap();
    res.json(serializeMember(updated, names));
  },
);

const memberUpdateSchema = z.object({
  sponsorCrewId: z.string().uuid().nullable().optional(),
  founderStatus: z
    .enum(["NONE", "CANDIDATE", "FOUNDING_50", "FOUNDING_100"])
    .optional(),
  founderNumber: z.number().int().min(1).max(1000).nullable().optional(),
  isAvailable: z.boolean().optional(),
  maxConcurrentJobs: z.number().int().min(1).max(20).optional(),
  draftTokens: z.number().int().min(0).max(100).optional(),
});

router.patch("/wings/members/:crewId", async (req, res): Promise<void> => {
  if (!UUID_RE.test(req.params.crewId)) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  const parsed = memberUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const [member] = await db
    .select()
    .from(wingMembersTable)
    .where(eq(wingMembersTable.crewId, req.params.crewId));
  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  const input = parsed.data;
  if (input.sponsorCrewId) {
    if (input.sponsorCrewId === req.params.crewId) {
      res.status(400).json({ error: "A crew cannot sponsor itself" });
      return;
    }
    const [sponsor] = await db
      .select({ id: crewsTable.id })
      .from(crewsTable)
      .where(eq(crewsTable.id, input.sponsorCrewId));
    if (!sponsor) {
      res.status(400).json({ error: "Sponsor crew not found" });
      return;
    }
  }
  const updates: Partial<typeof wingMembersTable.$inferInsert> = {};
  if (input.sponsorCrewId !== undefined) {
    updates.sponsorCrewId = input.sponsorCrewId;
    updates.sponsorSince = input.sponsorCrewId ? new Date() : null;
  }
  if (input.founderStatus !== undefined) updates.founderStatus = input.founderStatus;
  if (input.founderNumber !== undefined) updates.founderNumber = input.founderNumber;
  if (input.isAvailable !== undefined) updates.isAvailable = input.isAvailable;
  if (input.maxConcurrentJobs !== undefined)
    updates.maxConcurrentJobs = input.maxConcurrentJobs;
  if (input.draftTokens !== undefined) updates.draftTokens = input.draftTokens;

  const [updated] = await db
    .update(wingMembersTable)
    .set(updates)
    .where(eq(wingMembersTable.crewId, req.params.crewId))
    .returning();
  await logWingAudit({
    actorType: "ADMIN",
    action: "MEMBER_UPDATED",
    entityType: "crew",
    entityId: req.params.crewId,
    before: {
      sponsorCrewId: member.sponsorCrewId,
      founderStatus: member.founderStatus,
      isAvailable: member.isAvailable,
    },
    after: updates,
    reason: "Manual update from the Wings admin page.",
  });
  const names = await crewNameMap();
  res.json(serializeMember(updated, names));
});

router.post(
  "/wings/members/:crewId/recalculate",
  async (req, res): Promise<void> => {
    if (!UUID_RE.test(req.params.crewId)) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    await ensureWingMembers().catch(() => {});
    try {
      const result = await recalculateCrewScore(req.params.crewId, "ADMIN");
      const [member] = await db
        .select()
        .from(wingMembersTable)
        .where(eq(wingMembersTable.crewId, req.params.crewId));
      const names = await crewNameMap();
      res.json(serializeMember(member, names, result.reasons));
    } catch {
      res.status(404).json({ error: "Member not found" });
    }
  },
);

router.get("/wings/quality", async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const submissions = await db
    .select()
    .from(wingQualitySubmissionsTable)
    .orderBy(desc(wingQualitySubmissionsTable.submittedAt));
  const filtered = status
    ? submissions.filter((s) => s.reviewStatus === status)
    : submissions;
  const jobIds = [...new Set(filtered.map((s) => s.jobId))];
  const [reviews, jobs, names] = await Promise.all([
    filtered.length
      ? db
          .select()
          .from(wingQualityReviewsTable)
          .where(
            inArray(
              wingQualityReviewsTable.submissionId,
              filtered.map((s) => s.id),
            ),
          )
      : Promise.resolve([]),
    jobIds.length
      ? db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
      : Promise.resolve([]),
    crewNameMap(),
  ]);
  const propIds = [...new Set(jobs.map((j) => j.propertyId).filter(Boolean))];
  const props = propIds.length
    ? await db
        .select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable)
        .where(inArray(propertiesTable.id, propIds as string[]))
    : [];
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const reviewBySub = new Map(reviews.map((r) => [r.submissionId, r]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  res.json(
    filtered.map((s) => {
      const job = jobById.get(s.jobId);
      const r = reviewBySub.get(s.id);
      return {
        id: s.id,
        jobId: s.jobId,
        jobNo: job?.jobNo ?? null,
        jobCategory: job?.category ?? null,
        propertyName: job?.propertyId
          ? (propName.get(job.propertyId) ?? null)
          : null,
        crewId: s.crewId,
        crewName: s.crewId ? (names.get(s.crewId) ?? null) : null,
        reviewStatus: s.reviewStatus,
        notes: s.notes,
        beforeCount: ((s.beforePaths as string[] | null) ?? []).length,
        afterCount: ((s.afterPaths as string[] | null) ?? []).length,
        submittedAt: s.submittedAt.toISOString(),
        review: r
          ? {
              status: r.status,
              finalScore: r.finalScore,
              completenessScore: r.completenessScore,
              craftsmanshipScore: r.craftsmanshipScore,
              propertyProtectionScore: r.propertyProtectionScore,
              safetyScore: r.safetyScore,
              anomalyRisk: r.anomalyRisk,
              confidence: r.confidence,
              criticalConcern: r.criticalConcern,
              summary: r.summary,
              concerns: (r.concerns as string[] | null) ?? [],
              decidedBy: r.decidedBy,
              reviewedAt: iso(r.reviewedAt),
            }
          : null,
      };
    }),
  );
});

async function serializeQualityItem(submissionId: string) {
  const [s] = await db
    .select()
    .from(wingQualitySubmissionsTable)
    .where(eq(wingQualitySubmissionsTable.id, submissionId));
  if (!s) return null;
  const [r] = await db
    .select()
    .from(wingQualityReviewsTable)
    .where(eq(wingQualityReviewsTable.submissionId, submissionId));
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, s.jobId));
  const names = await crewNameMap();
  return {
    id: s.id,
    jobId: s.jobId,
    jobNo: job?.jobNo ?? null,
    jobCategory: job?.category ?? null,
    propertyName: null,
    crewId: s.crewId,
    crewName: s.crewId ? (names.get(s.crewId) ?? null) : null,
    reviewStatus: s.reviewStatus,
    notes: s.notes,
    beforeCount: ((s.beforePaths as string[] | null) ?? []).length,
    afterCount: ((s.afterPaths as string[] | null) ?? []).length,
    submittedAt: s.submittedAt.toISOString(),
    review: r
      ? {
          status: r.status,
          finalScore: r.finalScore,
          completenessScore: r.completenessScore,
          craftsmanshipScore: r.craftsmanshipScore,
          propertyProtectionScore: r.propertyProtectionScore,
          safetyScore: r.safetyScore,
          anomalyRisk: r.anomalyRisk,
          confidence: r.confidence,
          criticalConcern: r.criticalConcern,
          summary: r.summary,
          concerns: (r.concerns as string[] | null) ?? [],
          decidedBy: r.decidedBy,
          reviewedAt: iso(r.reviewedAt),
        }
      : null,
  };
}

router.post("/wings/quality/:id/review", async (req, res): Promise<void> => {
  if (!UUID_RE.test(req.params.id)) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  try {
    await reviewQualitySubmission(req.params.id);
  } catch (err) {
    logger.warn(`wings: manual quality review failed: ${err}`);
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  const item = await serializeQualityItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  res.json(item);
});

const decisionSchema = z.object({
  status: z.enum(["PASS", "FAIL", "NEEDS_REVIEW"]),
  reason: z.string().min(1).max(2000),
  finalScore: z.number().min(0).max(100).optional(),
});

router.post("/wings/quality/:id/decision", async (req, res): Promise<void> => {
  if (!UUID_RE.test(req.params.id)) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  try {
    await decideQualitySubmission({
      submissionId: req.params.id,
      ...parsed.data,
    });
  } catch {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  const item = await serializeQualityItem(req.params.id);
  res.json(item);
});

router.get("/wings/overrides", async (_req, res): Promise<void> => {
  const [overrides, names] = await Promise.all([
    db
      .select()
      .from(wingOverridesTable)
      .orderBy(desc(wingOverridesTable.createdAt)),
    crewNameMap(),
  ]);
  const jobIds = [...new Set(overrides.map((o) => o.jobId))];
  const jobs = jobIds.length
    ? await db
        .select({ id: jobsTable.id, jobNo: jobsTable.jobNo })
        .from(jobsTable)
        .where(inArray(jobsTable.id, jobIds))
    : [];
  const jobNo = new Map(jobs.map((j) => [j.id, j.jobNo]));
  res.json(
    overrides.map((o) => ({
      id: o.id,
      jobId: o.jobId,
      jobNo: jobNo.get(o.jobId) ?? null,
      sponsorCrewId: o.sponsorCrewId,
      sponsorName: names.get(o.sponsorCrewId) ?? null,
      recruitCrewId: o.recruitCrewId,
      recruitName: names.get(o.recruitCrewId) ?? null,
      allocatedGrossProfit: o.allocatedGrossProfit,
      baseRate: o.baseRate,
      qualityMultiplier: o.qualityMultiplier,
      grossOverride: o.grossOverride,
      immediateAmount: o.immediateAmount,
      reserveAmount: o.reserveAmount,
      reserveBonus: o.reserveBonus,
      reserveDebit: o.reserveDebit,
      status: o.status,
      immediateStatus: o.immediateStatus,
      qualityWindowEndsAt: iso(o.qualityWindowEndsAt),
      reserveReleasedAt: iso(o.reserveReleasedAt),
      createdAt: o.createdAt.toISOString(),
    })),
  );
});

router.get("/wings/reserve", async (_req, res): Promise<void> => {
  const [accounts, txns, names] = await Promise.all([
    db.select().from(wingReserveAccountsTable),
    db
      .select()
      .from(wingReserveTxnsTable)
      .orderBy(desc(wingReserveTxnsTable.createdAt))
      .limit(100),
    crewNameMap(),
  ]);
  res.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      crewId: a.crewId,
      crewName: names.get(a.crewId) ?? null,
      heldBalance: a.heldBalance,
      releasedBalance: a.releasedBalance,
      debitedBalance: a.debitedBalance,
    })),
    transactions: txns.map((t) => ({
      id: t.id,
      crewId: t.crewId,
      crewName: names.get(t.crewId) ?? null,
      overrideId: t.overrideId,
      type: t.type,
      amount: t.amount,
      note: t.note,
      createdAt: t.createdAt.toISOString(),
    })),
    totals: {
      held: accounts.reduce((s, a) => s + a.heldBalance, 0),
      released: accounts.reduce((s, a) => s + a.releasedBalance, 0),
      debited: accounts.reduce((s, a) => s + a.debitedBalance, 0),
    },
  });
});

router.get("/wings/eligibility/:jobId", async (req, res): Promise<void> => {
  if (!UUID_RE.test(req.params.jobId)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  await ensureWingMembers().catch(() => {});
  try {
    const candidates = await candidatesForJob(req.params.jobId);
    res.json(
      candidates.map((c) => ({
        crewId: c.crewId,
        crewName: c.crewName,
        eligible: c.eligible,
        rankScore: c.rankScore,
        haloScore: c.haloScore,
        tier: c.tier,
        founderStatus: c.founderStatus,
        reasons: c.reasons,
      })),
    );
  } catch {
    res.status(404).json({ error: "Job not found" });
  }
});

router.get("/wings/incidents", async (_req, res): Promise<void> => {
  const [incidents, names] = await Promise.all([
    db
      .select()
      .from(wingIncidentsTable)
      .orderBy(desc(wingIncidentsTable.occurredAt)),
    crewNameMap(),
  ]);
  const jobIds = [...new Set(incidents.map((i) => i.jobId).filter(Boolean))];
  const jobs = jobIds.length
    ? await db
        .select({ id: jobsTable.id, jobNo: jobsTable.jobNo })
        .from(jobsTable)
        .where(inArray(jobsTable.id, jobIds as string[]))
    : [];
  const jobNo = new Map(jobs.map((j) => [j.id, j.jobNo]));
  res.json(
    incidents.map((i) => ({
      id: i.id,
      jobId: i.jobId,
      jobNo: i.jobId ? (jobNo.get(i.jobId) ?? null) : null,
      crewId: i.crewId,
      crewName: i.crewId ? (names.get(i.crewId) ?? null) : null,
      type: i.type,
      severity: i.severity,
      description: i.description,
      cost: i.cost,
      occurredAt: i.occurredAt.toISOString(),
      resolvedAt: iso(i.resolvedAt),
    })),
  );
});

const incidentSchema = z.object({
  jobId: z.string().uuid().nullable().optional(),
  crewId: z.string().uuid().nullable().optional(),
  type: z.enum([
    "CALLBACK",
    "REWORK",
    "DAMAGE",
    "CUSTOMER_COMPLAINT",
    "SAFETY",
    "OTHER",
  ]),
  severity: z.number().int().min(1).max(5).optional(),
  description: z.string().min(1).max(4000),
  cost: z.number().min(0).nullable().optional(),
});

router.post("/wings/incidents", async (req, res): Promise<void> => {
  const parsed = incidentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const input = parsed.data;
  if (input.jobId) {
    const [job] = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(eq(jobsTable.id, input.jobId));
    if (!job) {
      res.status(400).json({ error: "Job not found" });
      return;
    }
  }
  if (input.crewId) {
    const [crew] = await db
      .select({ id: crewsTable.id })
      .from(crewsTable)
      .where(eq(crewsTable.id, input.crewId));
    if (!crew) {
      res.status(400).json({ error: "Crew not found" });
      return;
    }
  }
  const [created] = await db
    .insert(wingIncidentsTable)
    .values({
      jobId: input.jobId ?? null,
      crewId: input.crewId ?? null,
      type: input.type,
      severity: input.severity ?? 1,
      description: input.description,
      cost: input.cost ?? null,
    })
    .returning();
  await logWingAudit({
    actorType: "ADMIN",
    action: "INCIDENT_LOGGED",
    entityType: "wing_incident",
    entityId: created.id,
    after: { type: created.type, severity: created.severity },
    reason: input.description,
  });
  const names = await crewNameMap();
  res.status(201).json({
    id: created.id,
    jobId: created.jobId,
    jobNo: null,
    crewId: created.crewId,
    crewName: created.crewId ? (names.get(created.crewId) ?? null) : null,
    type: created.type,
    severity: created.severity,
    description: created.description,
    cost: created.cost,
    occurredAt: created.occurredAt.toISOString(),
    resolvedAt: null,
  });
});

router.post("/wings/incidents/:id/resolve", async (req, res): Promise<void> => {
  if (!UUID_RE.test(req.params.id)) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  const [resolved] = await db
    .update(wingIncidentsTable)
    .set({ resolvedAt: new Date() })
    .where(eq(wingIncidentsTable.id, req.params.id))
    .returning();
  if (!resolved) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  await logWingAudit({
    actorType: "ADMIN",
    action: "INCIDENT_RESOLVED",
    entityType: "wing_incident",
    entityId: resolved.id,
  });
  const names = await crewNameMap();
  res.json({
    id: resolved.id,
    jobId: resolved.jobId,
    jobNo: null,
    crewId: resolved.crewId,
    crewName: resolved.crewId ? (names.get(resolved.crewId) ?? null) : null,
    type: resolved.type,
    severity: resolved.severity,
    description: resolved.description,
    cost: resolved.cost,
    occurredAt: resolved.occurredAt.toISOString(),
    resolvedAt: iso(resolved.resolvedAt),
  });
});

function serializeRun(r: typeof wingAutomationRunsTable.$inferSelect) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    actionsRun: r.actionsRun,
    result: (r.result as object | null) ?? null,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    completedAt: iso(r.completedAt),
  };
}

router.post("/wings/automation/run", async (_req, res): Promise<void> => {
  const { runId, status, actionsRun } = await runWingsAutomation({
    withBrief: true,
  });
  if (!runId) {
    res.json({
      id: "",
      kind: "DAILY_FOUNDING_WINGS",
      status,
      actionsRun,
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
    return;
  }
  const [run] = await db
    .select()
    .from(wingAutomationRunsTable)
    .where(eq(wingAutomationRunsTable.id, runId));
  res.json(serializeRun(run));
});

router.get("/wings/automation/runs", async (_req, res): Promise<void> => {
  const runs = await recentAutomationRuns(20);
  res.json(runs.map(serializeRun));
});

router.get("/wings/audit", async (req, res): Promise<void> => {
  const limit = Math.min(
    200,
    Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50),
  );
  const entries = await db
    .select()
    .from(wingAuditTable)
    .orderBy(desc(wingAuditTable.createdAt))
    .limit(limit);
  res.json(
    entries.map((e) => ({
      id: e.id,
      actorType: e.actorType,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: (e.before as object | null) ?? null,
      after: (e.after as object | null) ?? null,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    })),
  );
});

export default router;
