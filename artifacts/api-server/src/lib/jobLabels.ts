import { inArray } from "drizzle-orm";
import { db, jobsTable, propertiesTable } from "@workspace/db";

export function buildJobLabel(
  jobNo: string,
  propertyName?: string | null,
  unitNo?: string | null,
): string {
  const where = [propertyName, unitNo ? `Unit ${unitNo}` : null]
    .filter(Boolean)
    .join(" · ");
  return where ? `#${jobNo} — ${where}` : `#${jobNo}`;
}

export async function jobLabelMap(
  jobIds: string[],
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(jobIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const jobs = await db
    .select()
    .from(jobsTable)
    .where(inArray(jobsTable.id, ids));
  const propIds = Array.from(new Set(jobs.map((j) => j.propertyId)));
  const props = propIds.length
    ? await db
        .select()
        .from(propertiesTable)
        .where(inArray(propertiesTable.id, propIds))
    : [];
  const propName = new Map(props.map((p) => [p.id, p.name]));
  return new Map(
    jobs.map((j) => [
      j.id,
      buildJobLabel(j.jobNo, propName.get(j.propertyId), j.unitNo),
    ]),
  );
}
