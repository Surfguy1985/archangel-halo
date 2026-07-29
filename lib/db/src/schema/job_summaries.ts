import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export interface SummaryChecklistSection {
  section: string;
  items: { label: string; checked: boolean }[];
}

export interface SummaryFlag {
  label: string;
  checked: boolean;
  note: string;
}

export interface SummaryPhoto {
  phase: string; // before | after | progress
  path: string; // object storage path (serve via /api/storage<path>)
}

// One service-recap document per job, prefilled at close-out and shared with
// the property manager via a stable public token (/summary/:token on the root app).
export const jobSummariesTable = pgTable("job_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().unique(),
  propertyId: uuid("property_id").notNull(),
  token: text("token").notNull().unique(),
  title: text("title").notNull().default("Service Recap"),
  unitNumber: text("unit_number"),
  serviceDate: text("service_date"), // YYYY-MM-DD (local)
  crewLead: text("crew_lead"),
  timeIn: text("time_in"),
  timeOut: text("time_out"),
  checklist: jsonb("checklist").$type<SummaryChecklistSection[]>().notNull().default([]),
  flags: jsonb("flags").$type<SummaryFlag[]>().notNull().default([]),
  observations: text("observations"),
  touchUpNotes: text("touch_up_notes"),
  overallResult: text("overall_result").notNull().default("met"), // exceeded | met | followup
  photos: jsonb("photos").$type<SummaryPhoto[]>().notNull().default([]),
  status: text("status").notNull().default("draft"), // draft | sent
  sentTo: text("sent_to"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobSummary = typeof jobSummariesTable.$inferSelect;
