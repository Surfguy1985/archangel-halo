import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// HALO Walk — property-manager walk sessions. No DB FKs (project convention);
// property/job references are guarded in code.
export const walksTable = pgTable("walks", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  kind: text("kind").notNull().default("discovery"), // baseline | qa | completion | discovery
  status: text("status").notNull().default("open"), // open | completed
  notes: text("notes"),
  // Jobs created at completion: [{ id, jobNo, unitNo, photoCount }]
  createdJobs: jsonb("created_jobs"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const walkCapturesTable = pgTable("walk_captures", {
  id: uuid("id").primaryKey().defaultRandom(),
  walkId: uuid("walk_id").notNull(),
  // Set when the walk is completed and this capture's unit became a job.
  jobId: uuid("job_id"),
  unitNo: text("unit_no"),
  // First photo (legacy scalar) — kept in sync with photos[0] for old readers.
  storagePath: text("storage_path"),
  // All photo storage paths for this capture (multi-photo support).
  photos: jsonb("photos").$type<string[] | null>(),
  service: text("service"),
  qty: doublePrecision("qty"),
  unitPrice: doublePrecision("unit_price"),
  note: text("note"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
