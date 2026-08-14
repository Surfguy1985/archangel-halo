-- Durable reminders: office-internal notes tied to any entity.
-- Idempotent.

CREATE TABLE IF NOT EXISTS reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text          text NOT NULL,
  entity_type   text,
  entity_id     text,
  entity_label  text,
  remind_at     timestamptz,
  dismissed_at  timestamptz,
  snoozed_until timestamptz,
  created_by    text NOT NULL DEFAULT 'office',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
