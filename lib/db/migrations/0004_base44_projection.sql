-- Phase 1: Base44 projection health + evidence + non-destructive sync metadata.
-- Idempotent: safe to re-run.

ALTER TABLE base44_sync_map ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE base44_sync_map ADD COLUMN IF NOT EXISTS stale_at timestamptz;
ALTER TABLE base44_sync_map ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
ALTER TABLE base44_sync_map ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE base44_sync_map ADD COLUMN IF NOT EXISTS payload_hash text;

CREATE TABLE IF NOT EXISTS base44_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at timestamptz NOT NULL,
  finished_at timestamptz,
  duration_ms integer,
  status text NOT NULL,
  error_code text,
  freshness text NOT NULL DEFAULT 'unavailable',
  total_created integer NOT NULL DEFAULT 0,
  total_updated integer NOT NULL DEFAULT 0,
  total_stale integer NOT NULL DEFAULT 0,
  total_errors integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 1,
  resources jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS base44_sync_runs_attempted_idx
  ON base44_sync_runs (attempted_at);

CREATE TABLE IF NOT EXISTS base44_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource text NOT NULL,
  base44_id text NOT NULL,
  kind text NOT NULL,
  property_name text,
  unit_label text,
  title text,
  body text,
  media_url text,
  occurred_at timestamptz,
  source_updated_at timestamptz,
  last_seen_at timestamptz NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS base44_evidence_resource_id_uq
  ON base44_evidence (resource, base44_id);
CREATE INDEX IF NOT EXISTS base44_evidence_property_idx
  ON base44_evidence (property_name);
CREATE INDEX IF NOT EXISTS base44_evidence_kind_idx
  ON base44_evidence (kind);
