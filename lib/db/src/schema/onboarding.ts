import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * A Welcome Kit onboarding packet sent to a crew. One row per send.
 * Status flow: sent -> in_progress -> submitted.
 */
export const crewPacketsTable = pgTable("crew_packets", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  templateKey: text("template_key").notNull(),
  status: text("status").notNull().default("sent"),
  /** { insured: boolean, ach: boolean } */
  applicability: jsonb("applicability"),
  /** { [formCode]: { [fieldKey]: value } } */
  formsData: jsonb("forms_data"),
  /** { [formCode]: SignatureValue } */
  signatures: jsonb("signatures"),
  /** { [formCode]: PacketAttachmentValue[] } */
  attachments: jsonb("attachments"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CrewPacket = typeof crewPacketsTable.$inferSelect;
