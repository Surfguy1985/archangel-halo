import { db, businessSettingsTable, type BusinessSettings } from "@workspace/db";

export const DEFAULT_PAYMENT_INSTRUCTIONS =
  "Payment may be issued by check or ACH/bank transfer. " +
  "Make checks payable to Archangel Ventures LLC and mail to " +
  "130 N Preston Rd, Suite 334, Prosper, TX 75078. " +
  "For ACH remittance details, contact admin@archangelcontractors.com.";

/** Load the single business-settings row, seeding defaults on first use. */
export async function getBusinessSettings(): Promise<BusinessSettings> {
  const [existing] = await db.select().from(businessSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(businessSettingsTable)
    .values({ paymentInstructions: DEFAULT_PAYMENT_INSTRUCTIONS })
    .returning();
  return created;
}
