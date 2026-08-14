-- Known crew name variants (e.g. "bryce beck" → the "Bryce Back" row).
-- Written when duplicate crew rows are merged so the Base44 sync stops
-- re-creating a fresh row for a spelling variant. alias is normalized
-- (lowercased, whitespace collapsed) and unique.
-- Idempotent.

CREATE TABLE IF NOT EXISTS crew_aliases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id    uuid NOT NULL,
  alias      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crew_aliases_alias_uq ON crew_aliases (alias);
