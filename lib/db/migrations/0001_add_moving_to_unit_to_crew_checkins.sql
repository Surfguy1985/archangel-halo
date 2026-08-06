-- Add moving_to_unit to crew_checkins so the office tracker map can show
-- a "Moving to unit X" bubble while a crew is travelling between jobs.
-- IF NOT EXISTS makes this idempotent on databases that already had the
-- column applied via `drizzle-kit push` before this migration was created.
ALTER TABLE crew_checkins
  ADD COLUMN IF NOT EXISTS moving_to_unit text;
