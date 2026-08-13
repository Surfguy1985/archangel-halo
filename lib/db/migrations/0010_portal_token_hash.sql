-- Hash-at-rest for crew portal URL tokens.
-- Idempotent: safe to re-run. Legacy plaintext in portal_token still verifies.

ALTER TABLE crews ADD COLUMN IF NOT EXISTS portal_token_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS crews_portal_token_hash_uq
  ON crews (portal_token_hash);
