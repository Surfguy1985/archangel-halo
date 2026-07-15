import { inArray } from "drizzle-orm";
import {
  db,
  crewsTable,
  crewPhotosTable,
  schedulesTable,
} from "@workspace/db";

export type CrewJobPhoto = {
  id: string;
  url: string;
  takenOn: string;
  note: string | null;
  crewName: string | null;
  jobId: string;
  jobNo: string | null;
  unitNo: string | null;
};

type JobLike = {
  id: string;
  jobNo: string;
  unitNo: string | null;
  crewLeaderId: string | null;
  scheduledOn: string | null;
};

/**
 * Match crew portal photos to specific jobs. A photo belongs to a job when the
 * crew who took it was scheduled on that exact job for the day the photo was
 * taken (via the schedules table, or the job's own crewLeaderId + scheduledOn).
 */
export async function crewPhotosForJobs(
  jobs: JobLike[],
): Promise<CrewJobPhoto[]> {
  if (jobs.length === 0) return [];
  const jobIds = jobs.map((j) => j.id);
  const schedules = await db
    .select()
    .from(schedulesTable)
    .where(inArray(schedulesTable.jobId, jobIds));

  // key: `${crewId}|${date}` -> jobId (first match wins so a photo lands on one job)
  const pairToJob = new Map<string, string>();
  for (const s of schedules) {
    if (s.crewLeaderId && s.scheduledOn) {
      const key = `${s.crewLeaderId}|${s.scheduledOn}`;
      if (!pairToJob.has(key)) pairToJob.set(key, s.jobId);
    }
  }
  for (const j of jobs) {
    if (j.crewLeaderId && j.scheduledOn) {
      const key = `${j.crewLeaderId}|${j.scheduledOn}`;
      if (!pairToJob.has(key)) pairToJob.set(key, j.id);
    }
  }
  if (pairToJob.size === 0) return [];

  const crewIds = [...new Set([...pairToJob.keys()].map((k) => k.split("|")[0]))];
  const [photos, crews] = await Promise.all([
    db
      .select()
      .from(crewPhotosTable)
      .where(inArray(crewPhotosTable.crewId, crewIds)),
    db.select().from(crewsTable).where(inArray(crewsTable.id, crewIds)),
  ]);
  const crewName = new Map(crews.map((c) => [c.id, c.name]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  const out: CrewJobPhoto[] = [];
  for (const p of photos) {
    const jobId = pairToJob.get(`${p.crewId}|${p.takenOn}`);
    if (!jobId) continue;
    const job = jobById.get(jobId);
    if (!job) continue;
    out.push({
      id: p.id,
      url: `/api/storage${p.storagePath}`,
      takenOn: p.takenOn,
      note: p.note ?? null,
      crewName: crewName.get(p.crewId) ?? null,
      jobId,
      jobNo: job.jobNo ?? null,
      unitNo: job.unitNo ?? null,
    });
  }
  out.sort(
    (a, b) =>
      b.takenOn.localeCompare(a.takenOn) || a.id.localeCompare(b.id),
  );
  return out;
}
