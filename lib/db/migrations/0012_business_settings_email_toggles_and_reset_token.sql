-- business_settings: email toggle columns + reset-token state.
-- Added as part of email scheduler + passcode-reset feature work.
-- Idempotent.

ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS email_daily_digest          boolean NOT NULL DEFAULT false;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS email_evening_close         boolean NOT NULL DEFAULT false;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS email_lead_nurture_drip     boolean NOT NULL DEFAULT false;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS email_crew_thank_you        boolean NOT NULL DEFAULT false;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS email_inquiry_auto_reply    boolean NOT NULL DEFAULT false;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS email_auto_job_recap_links  boolean NOT NULL DEFAULT false;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS reset_token_hash            text;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS reset_token_expires_at      timestamptz;
