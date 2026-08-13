-- Harvest: SMS log, voice EOD call log, estimate drafts (not invoices).
-- Idempotent.

CREATE TABLE IF NOT EXISTS halo_sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL,
  crew_id uuid,
  from_e164 text NOT NULL,
  to_e164 text NOT NULL,
  body text NOT NULL,
  twilio_sid text,
  status text NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS halo_sms_messages_sid_uq
  ON halo_sms_messages (twilio_sid);

CREATE INDEX IF NOT EXISTS halo_sms_messages_crew_idx
  ON halo_sms_messages (crew_id, created_at);

CREATE TABLE IF NOT EXISTS halo_voice_eod_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id uuid NOT NULL,
  phone text NOT NULL,
  vapi_call_id text,
  status text NOT NULL DEFAULT 'queued',
  transcript text,
  summary text,
  structured jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS halo_voice_eod_calls_vapi_uq
  ON halo_voice_eod_calls (vapi_call_id);

CREATE TABLE IF NOT EXISTS halo_estimate_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid,
  walk_id uuid,
  source text NOT NULL,
  headline text NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
