/**
 * Can this crew act on this job?
 *
 * Crew-facing surfaces (portal link, paycard check-in link) carry no login —
 * the token identifies the crew and nothing else. So any job id the phone
 * sends has to be checked against how the crew was actually put on that job,
 * or a crew could attach evidence to somebody else's work.
 */
import {
  db,
  jobsTable,
  schedulesTable,
  crewDispatchAssignmentsTable,
} from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { localToday } from "./localDate";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A non-uuid job id makes postgres throw, not return empty — screen it first. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export async function jobBelongsToCrew(jobId: string, crewId: string): Promise<boolean> {
  if (!isUuid(jobId) || !isUuid(crewId)) return false;
  // 1. Direct assignment: this crew is the job leader.
  const [direct] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.crewLeaderId, crewId)))
    .limit(1);
  if (direct) return true;
  // 2. Schedule row: crew was dispatched via a schedule entry.
  const [sched] = await db
    .select({ id: schedulesTable.id })
    .from(schedulesTable)
    .where(and(eq(schedulesTable.jobId, jobId), eq(schedulesTable.crewLeaderId, crewId)))
    .limit(1);
  if (sched) return true;
  // 3. Member dispatch assignment for today. Excludes pending_move rows
  //    because those members are leaving the job, not actively on it.
  const [dispatch] = await db
    .select({ id: crewDispatchAssignmentsTable.id })
    .from(crewDispatchAssignmentsTable)
    .where(
      and(
        eq(crewDispatchAssignmentsTable.jobId, jobId),
        eq(crewDispatchAssignmentsTable.memberId, crewId),
        eq(crewDispatchAssignmentsTable.day, localToday()),
        ne(crewDispatchAssignmentsTable.status, "pending_move"),
      ),
    )
    .limit(1);
  return !!dispatch;
}
