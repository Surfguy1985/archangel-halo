import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const importUploadsTable = pgTable("import_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  objectPath: text("object_path"),
  summary: text("summary"),
  committed: integer("committed").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  messages: text("messages").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ImportUpload = typeof importUploadsTable.$inferSelect;
