-- Harvest: HALO-owned EOD briefing snapshot (not Base44 SoR).
-- Idempotent.

CREATE TABLE IF NOT EXISTS halo_eod_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_date date NOT NULL,
  summary text NOT NULL,
  fallback_used boolean NOT NULL DEFAULT true,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS halo_eod_briefings_date_uq
  ON halo_eod_briefings (local_date);
