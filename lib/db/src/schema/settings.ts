import { boolean, doublePrecision, pgTable, primaryKey, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const businessSettingsTable = pgTable("business_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyName: text("company_name").notNull().default("Archangel Ventures LLC"),
  tagline: text("tagline").notNull().default("Restoration & Make-Ready"),
  street: text("street").notNull().default("130 N Preston Rd, Suite 334"),
  city: text("city").notNull().default("Prosper, TX 75078"),
  attn: text("attn").notNull().default("ATTN: May Mahboob"),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default("admin@archangelcontractors.com"),
  paymentInstructions: text("payment_instructions").notNull().default(""),
  taxRatePct: doublePrecision("tax_rate_pct").notNull().default(0),
  // Expenses at or above this amount require approval before posting to the
  // books. 0 disables the approval workflow.
  expenseApprovalThreshold: doublePrecision("expense_approval_threshold")
    .notNull()
    .default(0),
  // When true, HALO automatically emails the property contact a live job link
  // when a job is scheduled and again when it's completed.
  autoSendRecapLinks: boolean("auto_send_recap_links").notNull().default(true),
  // When true, the Autopilot background agent watches for overdue invoices,
  // stale crew offers, and aging unscheduled jobs and raises alerts.
  autopilotEnabled: boolean("autopilot_enabled").notNull().default(true),
  // When true, Autopilot executes its proposed actions (reminder emails,
  // rebroadcasts) immediately. When false, actions wait for one-tap approval.
  autopilotAutoApprove: boolean("autopilot_auto_approve").notNull().default(false),
  // When true, a job cannot close out until its job summary (recap) has been
  // sent to the property manager — enforced server-side in the close-out checklist.
  requireSummaryBeforeCloseOut: boolean("require_summary_before_close_out")
    .notNull()
    .default(false),
  // scrypt hash of the office passcode ("s2:<salt>:<hash>", base64url). NULL
  // until the office sets one up; while NULL the office API answers 401 with
  // setupRequired so the apps show the create-passcode screen.
  officePasscodeHash: text("office_passcode_hash"),
  // scrypt hash of the Walk app's own passcode — deliberately separate from
  // the office passcode so field staff can unlock Walk without office access.
  walkPasscodeHash: text("walk_passcode_hash"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BusinessSettings = typeof businessSettingsTable.$inferSelect;

// Cross-reference table: maps a Base44 entity ID to the HALO UUID so the
// periodic sync can upsert without polluting any existing table with an
// external-ID column.  PK is (resource, base44_id) so each Base44 record
// maps to exactly one HALO row, and re-syncing is always idempotent.
export const base44SyncMapTable = pgTable(
  "base44_sync_map",
  {
    resource: text("resource").notNull(),
    base44Id: text("base44_id").notNull(),
    haloId: text("halo_id").notNull(), // UUID stored as text for cross-table flexibility
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.resource, t.base44Id] })],
);

// Singleton row of saved Tax Planner inputs. Like business_settings, this is
// preserved by the Settings data reset.
export const taxPlannerSettingsTable = pgTable("tax_planner_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull().default("sole_proprietor"),
  filingStatus: text("filing_status").notNull().default("single"),
  ownershipPercent: doublePrecision("ownership_percent").notNull().default(100),
  ownerW2Wages: doublePrecision("owner_w2_wages").notNull().default(0),
  otherW2Wages: doublePrecision("other_w2_wages").notNull().default(0),
  otherTaxableIncome: doublePrecision("other_taxable_income").notNull().default(0),
  aboveLineAdjustments: doublePrecision("above_line_adjustments").notNull().default(0),
  itemizedDeductions: doublePrecision("itemized_deductions").notNull().default(0),
  qbiDeduction: doublePrecision("qbi_deduction").notNull().default(0),
  taxCredits: doublePrecision("tax_credits").notNull().default(0),
  federalWithholding: doublePrecision("federal_withholding").notNull().default(0),
  estimatedPaymentsMade: doublePrecision("estimated_payments_made").notNull().default(0),
  stateEffectiveRatePct: doublePrecision("state_effective_rate_pct").notNull().default(0),
  partnershipSEIncomePercent: doublePrecision("partnership_se_income_percent")
    .notNull()
    .default(100),
  reserveBufferRatePct: doublePrecision("reserve_buffer_rate_pct").notNull().default(5),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaxPlannerSettings = typeof taxPlannerSettingsTable.$inferSelect;
