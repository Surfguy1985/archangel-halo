-- Persist passcode-reset token state in business_settings so that a server
-- restart cannot replay an already-consumed one-time reset link.
-- reset_token_hash   — SHA-256 hex of the random nonce in the emailed link.
-- reset_token_expires_at — when the link expires (1 hour from issuance).
-- Both columns are cleared atomically with the passcode-hash update in the
-- /office-auth/reset handler, so the token is single-use even across restarts.
-- IF NOT EXISTS makes the migration idempotent on databases that already had
-- these columns applied via `drizzle-kit push`.
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS reset_token_hash text,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamptz;
