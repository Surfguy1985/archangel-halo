-- Phase 3: auditable Falkon policy decisions + pending approvals.
-- Idempotent.

CREATE TABLE IF NOT EXISTS falkon_policy_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL,
  mode text NOT NULL,
  action text NOT NULL,
  decision text NOT NULL,
  actor_channel text NOT NULL,
  actor text,
  role text,
  tenant_id text,
  capability text,
  target_type text,
  target_id text,
  policy_granted boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  approval_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS falkon_policy_decisions_created_idx
  ON falkon_policy_decisions (created_at);

CREATE INDEX IF NOT EXISTS falkon_pending_approvals_status_idx
  ON falkon_pending_approvals (status);

CREATE TABLE IF NOT EXISTS falkon_pending_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  target_type text,
  target_id text,
  actor text,
  role text,
  tenant_id text,
  capability text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
