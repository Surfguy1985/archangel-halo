-- Outbound SMS delivery tracking.
--
-- Twilio returning 201 only means the message was accepted for sending; the
-- carrier verdict arrives later on a StatusCallback. Without these columns an
-- undelivered message (unverified toll-free = 30032, unregistered 10DLC =
-- 30034) is indistinguishable from a delivered one, which is exactly how a
-- fleet-wide texting outage stayed invisible.
--
-- callback_nonce is the per-message token embedded in the StatusCallback URL.
-- The Twilio connector authenticates with an API key and stores no auth token,
-- so request signatures cannot be verified; the nonce is what proves an
-- inbound status callback corresponds to a message we sent.
-- Idempotent.

ALTER TABLE halo_sms_messages ADD COLUMN IF NOT EXISTS error_code integer;
ALTER TABLE halo_sms_messages ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE halo_sms_messages ADD COLUMN IF NOT EXISTS callback_nonce text;
ALTER TABLE halo_sms_messages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS halo_sms_messages_nonce_uq ON halo_sms_messages (callback_nonce);
