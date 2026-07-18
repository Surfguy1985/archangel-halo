import { doublePrecision, pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const businessSettingsTable = pgTable("business_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyName: text("company_name").notNull().default("ArchAngel Contractors"),
  tagline: text("tagline").notNull().default("Restoration & Make-Ready"),
  street: text("street").notNull().default("130 N Preston Rd, Suite 334"),
  city: text("city").notNull().default("Prosper, TX 75078"),
  attn: text("attn").notNull().default("ATTN: May Mahboob"),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default("admin@archangelcontractors.com"),
  paymentInstructions: text("payment_instructions").notNull().default(""),
  taxRatePct: doublePrecision("tax_rate_pct").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BusinessSettings = typeof businessSettingsTable.$inferSelect;
