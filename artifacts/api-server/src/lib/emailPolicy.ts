/**
 * Automatic-email policy — owner-controlled via Settings.
 *
 * `getAutoEmails()` reads live values from business_settings so the owner
 * can toggle each automatic email from the Settings screen without a code
 * change.  Every disabled call site checks its flag and is otherwise
 * unchanged.
 *
 * Manually triggered emails (invoices, bids, pay requests, welcome/password
 * links, manual recaps/reminders, the manual digest/close endpoints) do NOT
 * consult these flags.
 *
 * Note: `autoJobRecapLinks` is governed by the existing `autoSendRecapLinks`
 * column (already in business_settings); no separate column is needed.
 */
import { getBusinessSettings } from "./businessSettings";

export interface AutoEmailPolicy {
  /** 6:45am scheduled daily task-list digest to the owner. */
  dailyDigest: boolean;
  /** 6:30pm scheduled evening close summary to the owner. */
  eveningClose: boolean;
  /** Lead nurture drip campaign steps (scheduler + campaign start). */
  leadNurtureDrip: boolean;
  /** Auto live job link / recap email when a job is scheduled or completed. */
  autoJobRecapLinks: boolean;
  /** Crew thank-you email on job close-out. */
  crewThankYou: boolean;
  /** Auto-reply thank-you to new phone-in inquiries. */
  inquiryAutoReply: boolean;
}

/** Read the current automatic-email policy from business_settings. */
export async function getAutoEmails(): Promise<AutoEmailPolicy> {
  const s = await getBusinessSettings();
  return {
    dailyDigest: s.emailDailyDigest ?? false,
    eveningClose: s.emailEveningClose ?? false,
    leadNurtureDrip: s.emailLeadNurtureDrip ?? false,
    autoJobRecapLinks: s.emailAutoJobRecapLinks ?? false,
    crewThankYou: s.emailCrewThankYou ?? false,
    inquiryAutoReply: s.emailInquiryAutoReply ?? false,
  };
}
