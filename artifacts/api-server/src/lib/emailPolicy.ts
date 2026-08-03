/**
 * Kill switches for AUTOMATIC emails (owner decision, Aug 2026): only urgent
 * alerts, the weekly scorecard, past-due payment reminders, client board
 * digests, and emergency work request alerts stay on automatically.
 *
 * Everything listed here is hard-disabled. Flip a flag to `true` to bring a
 * send back — every disabled call site checks its flag and is otherwise
 * unchanged. Manually triggered emails (invoices, bids, pay requests,
 * welcome/password links, manual recaps/reminders, the manual digest/close
 * endpoints) do NOT consult these flags.
 */
export const AUTO_EMAILS = {
  /** 6:45a scheduled daily task-list digest to the owner. */
  dailyDigest: false,
  /** 6:30p scheduled evening close summary to the owner. */
  eveningClose: false,
  /** Lead nurture drip campaign steps (scheduler + campaign start). */
  leadNurtureDrip: false,
  /** Auto live job link / recap email when a job is scheduled or completed. */
  autoJobRecapLinks: false,
  /** Crew thank-you email on job close-out. */
  crewThankYou: false,
  /** Auto-reply thank-you to new phone-in inquiries. */
  inquiryAutoReply: false,
} as const;
