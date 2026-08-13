-- Add per-email on/off toggle columns to business_settings so the owner can
-- enable or disable each automatic email from the Settings screen without a
-- code change. All defaults are false (matching the hard-disabled baseline).
-- IF NOT EXISTS makes every statement idempotent on environments that already
-- had columns applied via drizzle-kit push.
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS email_daily_digest          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_evening_close         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_lead_nurture_drip     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_auto_job_recap_links  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_crew_thank_you        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_inquiry_auto_reply    boolean NOT NULL DEFAULT false;
