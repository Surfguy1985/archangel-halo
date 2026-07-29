import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  jobsTable,
  crewPhotosTable,
  wingQualitySubmissionsTable,
  wingQualityReviewsTable,
} from "@workspace/db";
import { ObjectStorageService } from "../../lib/objectStorage";
import { logger } from "../../lib/logger";
import {
  reviewQualityEvidence,
  type EvidenceImage,
} from "../ai/reviewer";
import { getWingConfig } from "./config";
import { logWingAudit } from "./audit";
import { createJobOverrideAccruals } from "./overrides";

/**
 * Idempotent sweep: every completed job gets exactly one quality submission
 * built from the job's before/after photo activities. Jobs with no photo
 * evidence are routed straight to NEEDS_REVIEW (never auto-failed).
 */
export async function ensureQualitySubmissions(): Promise<number> {
  const jobs = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        inArray(jobsTable.status, ["complete", "closed"]),
        isNotNull(jobsTable.completedAt),
        isNotNull(jobsTable.crewLeaderId),
      ),
    );
  if (!jobs.length) return 0;
  const jobIds = jobs.map((j) => j.id);
  const existing = await db
    .select({ jobId: wingQualitySubmissionsTable.jobId })
    .from(wingQualitySubmissionsTable)
    .where(inArray(wingQualitySubmissionsTable.jobId, jobIds));
  const have = new Set(existing.map((e) => e.jobId));
  const missing = jobs.filter((j) => !have.has(j.id));
  if (!missing.length) return 0;

  const photos = await db
    .select()
    .from(crewPhotosTable)
    .where(
      inArray(
        crewPhotosTable.jobId,
        missing.map((j) => j.id),
      ),
    );

  let created = 0;
  for (const job of missing) {
    const jobPhotos = photos.filter((p) => p.jobId === job.id && p.storagePath);
    const before = jobPhotos
      .filter((p) => p.phase === "before")
      .map((p) => p.storagePath);
    const after = jobPhotos
      .filter((p) => p.phase === "after")
      .map((p) => p.storagePath);
    const hasEvidence = before.length > 0 || after.length > 0;
    await db
      .insert(wingQualitySubmissionsTable)
      .values({
        jobId: job.id,
        crewId: job.crewLeaderId,
        beforePaths: before,
        afterPaths: after,
        reviewStatus: hasEvidence ? "PENDING" : "NEEDS_REVIEW",
        notes: hasEvidence
          ? null
          : "No photo evidence found for this job. Routed to human review.",
      })
      .onConflictDoNothing();
    if (!hasEvidence) {
      await logWingAudit({
        action: "QUALITY_ESCALATED_NO_EVIDENCE",
        entityType: "job",
        entityId: job.id,
        reason:
          "Job completed without photo evidence; escalated to human review instead of penalizing the crew.",
      });
    }
    created += 1;
  }
  return created;
}

async function loadImage(
  storagePath: string,
  stage: "BEFORE" | "AFTER",
): Promise<EvidenceImage | null> {
  try {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(storagePath);
    const [meta] = await file.getMetadata();
    const contentType = String(meta.contentType || "image/jpeg");
    const mediaType = (
      ["image/jpeg", "image/png", "image/webp"].includes(contentType)
        ? contentType
        : "image/jpeg"
    ) as EvidenceImage["mediaType"];
    const [buffer] = await file.download();
    if (buffer.length > 4.5 * 1024 * 1024) return null;
    return { stage, base64: buffer.toString("base64"), mediaType };
  } catch (err) {
    logger.warn(`wings: failed to load evidence image ${storagePath}: ${err}`);
    return null;
  }
}

export async function reviewQualitySubmission(submissionId: string) {
  const [submission] = await db
    .select()
    .from(wingQualitySubmissionsTable)
    .where(eq(wingQualitySubmissionsTable.id, submissionId));
  if (!submission) throw new Error("Submission not found.");
  const [existingReview] = await db
    .select()
    .from(wingQualityReviewsTable)
    .where(eq(wingQualityReviewsTable.submissionId, submissionId));
  if (existingReview) return existingReview;

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, submission.jobId));
  if (!job) throw new Error("Job not found for submission.");

  const config = await getWingConfig();
  const beforePaths = (submission.beforePaths as string[] | null) ?? [];
  const afterPaths = (submission.afterPaths as string[] | null) ?? [];
  const images = (
    await Promise.all([
      ...beforePaths.map((p) => loadImage(p, "BEFORE" as const)),
      ...afterPaths.map((p) => loadImage(p, "AFTER" as const)),
    ])
  ).filter((img): img is EvidenceImage => img != null);

  if (!images.length) {
    await db
      .update(wingQualitySubmissionsTable)
      .set({ reviewStatus: "NEEDS_REVIEW" })
      .where(eq(wingQualitySubmissionsTable.id, submissionId));
    return null;
  }

  const ai = await reviewQualityEvidence({
    job: {
      name: `${job.jobNo} — ${job.category ?? "Job"}`,
      description: job.description,
    },
    notes: submission.notes,
    images,
    maxImages: config.quality.maxImagesPerReview,
  });

  const weightedScore =
    ai.completenessScore * 0.35 +
    ai.craftsmanshipScore * 0.35 +
    ai.propertyProtectionScore * 0.15 +
    ai.safetyScore * 0.15;

  let finalStatus = "NEEDS_REVIEW";
  if (
    ai.recommendedStatus === "PASS" &&
    ai.confidence >= config.quality.autoPassConfidence &&
    !ai.criticalConcern &&
    ai.anomalyRisk < 0.35
  ) {
    finalStatus = "PASS";
  } else if (
    ai.recommendedStatus === "FAIL" &&
    ai.criticalConcern &&
    config.quality.autoFailCritical &&
    ai.confidence >= 0.9
  ) {
    finalStatus = "FAIL";
  }

  const [review] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(wingQualityReviewsTable)
      .values({
        submissionId,
        status: finalStatus,
        finalScore: Math.round(weightedScore * 100) / 100,
        completenessScore: ai.completenessScore,
        craftsmanshipScore: ai.craftsmanshipScore,
        propertyProtectionScore: ai.propertyProtectionScore,
        safetyScore: ai.safetyScore,
        anomalyRisk: ai.anomalyRisk,
        confidence: ai.confidence,
        criticalConcern: ai.criticalConcern,
        summary: ai.summary,
        concerns: ai.concerns,
        evidence: ai.evidence,
        aiModel: "claude-opus-4-7",
        decidedBy: "AI",
      })
      .onConflictDoNothing()
      .returning();
    await tx
      .update(wingQualitySubmissionsTable)
      .set({ reviewStatus: finalStatus })
      .where(eq(wingQualitySubmissionsTable.id, submissionId));
    return inserted;
  });

  await logWingAudit({
    actorType: "AI",
    action: "QUALITY_EVIDENCE_REVIEWED",
    entityType: "quality_submission",
    entityId: submissionId,
    after: {
      status: finalStatus,
      score: weightedScore,
      confidence: ai.confidence,
      criticalConcern: ai.criticalConcern,
      concerns: ai.concerns,
    },
    reason: ai.summary,
  });

  if (finalStatus === "PASS") {
    await createJobOverrideAccruals(submission.jobId).catch(() => {});
  }
  return review ?? null;
}

export async function decideQualitySubmission(input: {
  submissionId: string;
  status: "PASS" | "FAIL" | "NEEDS_REVIEW";
  reason: string;
  finalScore?: number;
}) {
  const [submission] = await db
    .select()
    .from(wingQualitySubmissionsTable)
    .where(eq(wingQualitySubmissionsTable.id, input.submissionId));
  if (!submission) throw new Error("Submission not found.");
  const [existing] = await db
    .select()
    .from(wingQualityReviewsTable)
    .where(eq(wingQualityReviewsTable.submissionId, input.submissionId));
  const score = Math.max(
    0,
    Math.min(100, input.finalScore ?? existing?.finalScore ?? 0),
  );

  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(wingQualityReviewsTable)
        .set({
          status: input.status,
          finalScore: score,
          summary: input.reason,
          decidedBy: "ADMIN",
          reviewedAt: new Date(),
        })
        .where(eq(wingQualityReviewsTable.submissionId, input.submissionId));
    } else {
      await tx.insert(wingQualityReviewsTable).values({
        submissionId: input.submissionId,
        status: input.status,
        finalScore: score,
        completenessScore: score,
        craftsmanshipScore: score,
        propertyProtectionScore: score,
        safetyScore: score,
        anomalyRisk: 0,
        confidence: 1,
        criticalConcern: input.status === "FAIL",
        summary: input.reason,
        concerns: input.status === "PASS" ? [] : [input.reason],
        evidence: { manualDecision: true },
        decidedBy: "ADMIN",
      });
    }
    await tx
      .update(wingQualitySubmissionsTable)
      .set({ reviewStatus: input.status })
      .where(eq(wingQualitySubmissionsTable.id, input.submissionId));
  });

  await logWingAudit({
    actorType: "ADMIN",
    action: "QUALITY_DECISION_OVERRIDDEN",
    entityType: "quality_submission",
    entityId: input.submissionId,
    before: existing
      ? { status: existing.status, finalScore: existing.finalScore }
      : undefined,
    after: { status: input.status, finalScore: score },
    reason: input.reason,
  });

  if (input.status === "PASS") {
    await createJobOverrideAccruals(submission.jobId).catch(() => {});
  }
}
