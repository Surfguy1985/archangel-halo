/**
 * Today's scheduled HALO jobs on portfolio properties — crew presence
 * for the Pulse guide. Not GPS Finder / Site Twin.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import {
  db,
  jobsTable,
  crewsTable,
  propertiesTable,
  datePartsInZone,
} from "@workspace/db";

export type PortfolioCrewToday = {
  propertyId: string;
  propertyName: string;
  unitNumber: string | null;
  jobNo: string;
  crewName: string;
  status: string;
  scheduledOn: string | null;
};

const DONE = ["complete", "paid", "cancelled", "closed"];

export async function computePortfolioCrewToday(args: {
  properties: Array<{ id: string; name: string; timezone?: string | null }>;
  now?: Date;
}): Promise<PortfolioCrewToday[]> {
  if (args.properties.length === 0) return [];
  const now = args.now ?? new Date();
  const ids = args.properties.map((p) => p.id);
  const names = new Map(args.properties.map((p) => [p.id, p.name]));
  const todayByTz = new Map<string, string>();
  const civilToday = (tz: string) => {
    const hit = todayByTz.get(tz);
    if (hit) return hit;
    const p = datePartsInZone(now, tz);
    const ymd = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    todayByTz.set(tz, ymd);
    return ymd;
  };

  const rows = await db
    .select({
      propertyId: jobsTable.propertyId,
      unitNo: jobsTable.unitNo,
      jobNo: jobsTable.jobNo,
      status: jobsTable.status,
      scheduledOn: jobsTable.scheduledOn,
      crewName: crewsTable.name,
      timezone: propertiesTable.timezone,
    })
    .from(jobsTable)
    .leftJoin(crewsTable, eq(crewsTable.id, jobsTable.crewLeaderId))
    .innerJoin(propertiesTable, eq(propertiesTable.id, jobsTable.propertyId))
    .where(and(inArray(jobsTable.propertyId, ids), notInArray(jobsTable.status, DONE)));

  const out: PortfolioCrewToday[] = [];
  for (const row of rows) {
    const tz = row.timezone || "America/Chicago";
    const today = civilToday(tz);
    const onToday = !row.scheduledOn || row.scheduledOn === today;
    if (!onToday) continue;
    out.push({
      propertyId: row.propertyId,
      propertyName: names.get(row.propertyId) ?? "Property",
      unitNumber: row.unitNo,
      jobNo: row.jobNo,
      crewName: row.crewName?.trim() || "Uncrewed",
      status: row.status,
      scheduledOn: row.scheduledOn,
    });
  }
  out.sort((a, b) => a.propertyName.localeCompare(b.propertyName) || (a.unitNumber ?? "").localeCompare(b.unitNumber ?? ""));
  return out.slice(0, 80);
}
