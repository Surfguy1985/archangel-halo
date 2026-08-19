import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
export const reconciliationRunsTable = pgTable("reconciliation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  jobsScanned: integer("jobs_scanned").notNull().default(0),
  discrepanciesFound: integer("discrepancies_found").notNull().default(0),
  triggeredBy: text("triggered_by").notNull(), notes: text("notes"),
});
