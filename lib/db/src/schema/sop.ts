import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Per-property SOP billing rule extracted by AI from an uploaded guideline
// document. One rule per property; every invoice created for the property
// must follow it (enforced server-side at invoice creation).
export const propertySopRulesTable = pgTable("property_sop_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull().unique(),
  fileName: text("file_name").notNull(),
  mediaType: text("media_type").notNull(),
  // Source document kept verbatim (base64) so the office can re-open it.
  fileData: text("file_data").notNull(),
  rules: jsonb("rules").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
