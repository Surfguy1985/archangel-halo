/**
 * Idempotent DDL for Client Board v1 (Segment 1).
 * Applied at API boot via ensureClientBoardSchema and kept as migration 0015.
 *
 * drizzle-kit push is TTY-bound in this repo — do not rely on it to create
 * these tables. CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only.
 */

export const CLIENT_BOARD_DDL: readonly string[] = [
  // ── properties: additive columns (never a second properties table) ─────
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Chicago'`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS avg_daily_rent_cents bigint`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS target_turn_days integer NOT NULL DEFAULT 7`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS occupied_addon_applies boolean NOT NULL DEFAULT false`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS entrata_property_id text`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS client_org_id uuid`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS invoice_tolerance_bps integer NOT NULL DEFAULT 0`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS variance_review_minutes integer NOT NULL DEFAULT 12`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS scope_approval_cents bigint NOT NULL DEFAULT 500000`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS bid_score_weights jsonb NOT NULL DEFAULT '{"priceVsSchedule":35,"onTime":25,"rework":20,"capacity":20}'::jsonb`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS capacity_hold_hours integer NOT NULL DEFAULT 72`,

  // ── tenancy ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS client_orgs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    type text NOT NULL,
    timezone text NOT NULL DEFAULT 'America/Chicago',
    slug text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_orgs_slug_uq ON client_orgs (slug)`,
  `ALTER TABLE client_orgs ADD COLUMN IF NOT EXISTS crew_portal_comp boolean NOT NULL DEFAULT false`,

  `CREATE TABLE IF NOT EXISTS client_org_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    scope jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS client_org_members_org_idx ON client_org_members (org_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_org_members_org_user_uq ON client_org_members (org_id, user_id)`,

  `CREATE TABLE IF NOT EXISTS client_portfolios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS client_portfolios_org_idx ON client_portfolios (org_id)`,

  `CREATE TABLE IF NOT EXISTS client_portfolio_properties (
    portfolio_id uuid NOT NULL,
    property_id uuid NOT NULL,
    PRIMARY KEY (portfolio_id, property_id)
  )`,

  `CREATE TABLE IF NOT EXISTS client_board_flags (
    segment text PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── operational units ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS client_units (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL,
    unit_number text NOT NULL,
    bedrooms integer NOT NULL DEFAULT 1,
    bathrooms numeric(3,1) NOT NULL DEFAULT 1.0,
    sqft integer,
    market_rent_cents bigint NOT NULL,
    latitude double precision,
    longitude double precision,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_units_property_number_uq
     ON client_units (property_id, unit_number)`,
  `CREATE INDEX IF NOT EXISTS client_units_property_idx ON client_units (property_id)`,
  `ALTER TABLE client_units ADD COLUMN IF NOT EXISTS entrata_unit_id text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_units_property_entrata_unit_uq
     ON client_units (property_id, entrata_unit_id) WHERE entrata_unit_id IS NOT NULL`,

  // ── turns (no mutable days_vacant column — events are the truth) ───────
  `CREATE TABLE IF NOT EXISTS client_turns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id uuid NOT NULL,
    property_id uuid NOT NULL,
    org_id uuid NOT NULL,
    status text NOT NULL,
    notice_given_at timestamptz,
    scheduled_vacate_at timestamptz,
    actual_vacate_at timestamptz,
    ready_at timestamptz,
    next_move_in_at timestamptz,
    target_ready_at timestamptz,
    predicted_ready_at timestamptz,
    prediction_confidence text,
    work_source text NOT NULL DEFAULT 'third_party',
    assigned_vendor_org_id uuid,
    verification_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS client_turns_property_status_idx
     ON client_turns (property_id, status)`,
  `CREATE INDEX IF NOT EXISTS client_turns_open_idx
     ON client_turns (property_id, actual_vacate_at)
     WHERE ready_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS client_turns_org_idx ON client_turns (org_id)`,
  `CREATE INDEX IF NOT EXISTS client_turns_unit_idx ON client_turns (unit_id)`,
  `ALTER TABLE client_turns ADD COLUMN IF NOT EXISTS entrata_notice_id text`,
  `ALTER TABLE client_turns ADD COLUMN IF NOT EXISTS entrata_lease_id text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_turns_org_notice_uq
     ON client_turns (org_id, entrata_notice_id) WHERE entrata_notice_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS client_turn_stage_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    stage text NOT NULL,
    event text NOT NULL,
    occurred_at timestamptz NOT NULL,
    actor_id text,
    actor_org_id uuid,
    source text NOT NULL DEFAULT 'app',
    meta jsonb,
    received_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS client_turn_stage_events_turn_occurred_idx
     ON client_turn_stage_events (turn_id, occurred_at)`,

  `CREATE TABLE IF NOT EXISTS client_stage_ownership (
    stage text PRIMARY KEY,
    owner text NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS client_turn_metrics_mv (
    turn_id uuid PRIMARY KEY,
    property_id uuid NOT NULL,
    days_vacant integer NOT NULL DEFAULT 0,
    stage_durations jsonb NOT NULL DEFAULT '{}',
    client_owned_hours numeric(12,2) NOT NULL DEFAULT 0,
    vendor_owned_hours numeric(12,2) NOT NULL DEFAULT 0,
    shared_owned_hours numeric(12,2) NOT NULL DEFAULT 0,
    client_owned_ms bigint NOT NULL DEFAULT 0,
    vendor_owned_ms bigint NOT NULL DEFAULT 0,
    over_target_days integer NOT NULL DEFAULT 0,
    vacancy_cost_cents bigint NOT NULL DEFAULT 0,
    is_stalled boolean NOT NULL DEFAULT false,
    current_stage text,
    refreshed_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS client_turn_metrics_mv_property_idx
     ON client_turn_metrics_mv (property_id)`,

  `CREATE TABLE IF NOT EXISTS client_prediction_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    predicted_ready_at timestamptz NOT NULL,
    confidence text NOT NULL,
    predicted_at timestamptz NOT NULL DEFAULT now(),
    actual_ready_at timestamptz,
    method text,
    sample_size integer
  )`,
  `CREATE INDEX IF NOT EXISTS client_prediction_log_turn_idx
     ON client_prediction_log (turn_id, predicted_at)`,

  `CREATE TABLE IF NOT EXISTS client_turn_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    org_id uuid NOT NULL,
    property_id uuid NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    last_error text
  )`,
  `CREATE INDEX IF NOT EXISTS client_turn_outbox_pending_idx
     ON client_turn_outbox (created_at)
     WHERE processed_at IS NULL`,

  // ── evidence ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS client_evidence_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    kind text NOT NULL,
    phase text NOT NULL,
    room text,
    storage_key text NOT NULL,
    sha256 text NOT NULL,
    mime text,
    bytes bigint,
    device_captured_at timestamptz,
    server_received_at timestamptz NOT NULL DEFAULT now(),
    device_lat double precision,
    device_lng double precision,
    gps_accuracy_m double precision,
    exif jsonb,
    captured_by_user_id text,
    integrity_flags jsonb,
    tombstoned_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS client_evidence_items_turn_phase_idx
     ON client_evidence_items (turn_id, phase)`,

  `CREATE TABLE IF NOT EXISTS client_gps_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    accuracy_m double precision,
    occurred_at timestamptz NOT NULL,
    distance_from_unit_m double precision,
    received_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS client_gps_events_turn_occurred_idx
     ON client_gps_events (turn_id, occurred_at)`,

  `CREATE TABLE IF NOT EXISTS client_turn_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    org_id uuid NOT NULL,
    variant text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    storage_key text,
    sha256 text,
    bytes bigint,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    ready_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS client_turn_records_turn_idx
     ON client_turn_records (turn_id, created_at)`,

  // ── pricing / scopes / invoices (integer cents; not office tables) ─────
  `CREATE TABLE IF NOT EXISTS client_price_lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL,
    revision text NOT NULL,
    effective_from timestamptz NOT NULL,
    effective_to timestamptz,
    source_sop_doc_id text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS client_price_list_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id uuid NOT NULL,
    code text NOT NULL,
    description text NOT NULL,
    category text,
    uom text NOT NULL DEFAULT 'ea',
    unit_price_cents bigint NOT NULL,
    tier text,
    is_bid_only boolean NOT NULL DEFAULT false,
    min_charge_cents bigint
  )`,
  `CREATE INDEX IF NOT EXISTS client_price_list_items_list_idx
     ON client_price_list_items (price_list_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_price_list_items_code_tier_uq
     ON client_price_list_items (price_list_id, code, COALESCE(tier, ''))`,

  `CREATE TABLE IF NOT EXISTS client_scopes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    created_by text,
    submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS client_scope_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_id uuid NOT NULL,
    price_item_id uuid,
    description text NOT NULL,
    qty integer NOT NULL DEFAULT 1,
    uom text NOT NULL DEFAULT 'ea',
    unit_price_cents bigint NOT NULL,
    extended_cents bigint NOT NULL,
    compliance text NOT NULL DEFAULT 'matched',
    variance_reason text,
    approved_by text,
    approved_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS client_scope_lines_scope_compliance_idx
     ON client_scope_lines (scope_id, compliance)`,
  `ALTER TABLE client_scope_lines ADD COLUMN IF NOT EXISTS code text`,
  `ALTER TABLE client_scope_lines ADD COLUMN IF NOT EXISTS tier text`,

  `CREATE TABLE IF NOT EXISTS client_variance_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    scope_id uuid NOT NULL,
    scope_line_id uuid NOT NULL,
    turn_id uuid NOT NULL,
    property_id uuid NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    nearest_price_item_id uuid,
    requested_qty integer NOT NULL DEFAULT 1,
    requested_unit_price_cents bigint NOT NULL,
    schedule_unit_price_cents bigint,
    delta_cents bigint NOT NULL DEFAULT 0,
    counter_qty integer,
    counter_unit_price_cents bigint,
    decided_by text,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS client_variance_requests_turn_idx
     ON client_variance_requests (turn_id, status)`,

  `CREATE TABLE IF NOT EXISTS client_turn_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    scope_id uuid NOT NULL,
    invoice_number text NOT NULL,
    po_number text,
    status text NOT NULL DEFAULT 'draft',
    subtotal_cents bigint NOT NULL,
    tax_cents bigint NOT NULL DEFAULT 0,
    total_cents bigint NOT NULL,
    compliance_score text,
    submitted_at timestamptz,
    entrata_export_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_turn_invoices_number_uq
     ON client_turn_invoices (invoice_number)`,
  `ALTER TABLE client_turn_invoices ADD COLUMN IF NOT EXISTS first_pass_accepted boolean NOT NULL DEFAULT false`,

  `CREATE TABLE IF NOT EXISTS client_entrata_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    kind text NOT NULL,
    filename text NOT NULL,
    sha256 text NOT NULL,
    adapter text NOT NULL DEFAULT 'csv',
    status text NOT NULL DEFAULT 'applied',
    created_count integer NOT NULL DEFAULT 0,
    updated_count integer NOT NULL DEFAULT 0,
    skipped_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_entrata_imports_org_sha_uq
     ON client_entrata_imports (org_id, sha256)`,
  `CREATE INDEX IF NOT EXISTS client_entrata_imports_org_idx
     ON client_entrata_imports (org_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS client_entrata_purchase_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    property_id uuid NOT NULL,
    unit_id uuid,
    po_number text NOT NULL,
    amount_cents bigint NOT NULL,
    gl_code text,
    issued_on text,
    invoice_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_entrata_purchase_orders_org_po_uq
     ON client_entrata_purchase_orders (org_id, po_number)`,

  `CREATE TABLE IF NOT EXISTS client_turn_invoice_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL,
    price_item_id uuid,
    description text NOT NULL,
    qty integer NOT NULL DEFAULT 1,
    uom text NOT NULL DEFAULT 'ea',
    unit_price_cents bigint NOT NULL,
    extended_cents bigint NOT NULL,
    compliance text NOT NULL,
    gl_code text,
    unit_number text,
    sort_order integer NOT NULL DEFAULT 0
  )`,

  // ── bids ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS client_bid_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id uuid NOT NULL,
    scope_id uuid NOT NULL,
    property_id uuid NOT NULL,
    due_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS client_bid_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bid_request_id uuid NOT NULL,
    vendor_org_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'invited',
    viewed_at timestamptz
  )`,

  `CREATE TABLE IF NOT EXISTS client_vendor_bids (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bid_request_id uuid NOT NULL,
    vendor_org_id uuid NOT NULL,
    total_cents bigint NOT NULL,
    earliest_start_at timestamptz,
    promised_days integer,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    score integer
  )`,

  `CREATE TABLE IF NOT EXISTS client_vendor_bid_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bid_id uuid NOT NULL,
    price_item_code text NOT NULL,
    description text NOT NULL,
    qty integer NOT NULL DEFAULT 1,
    unit_price_cents bigint NOT NULL
  )`,
  `ALTER TABLE client_bid_requests ADD COLUMN IF NOT EXISTS org_id uuid`,
  `ALTER TABLE client_bid_requests ADD COLUMN IF NOT EXISTS score_weights jsonb NOT NULL DEFAULT '{"priceVsSchedule":35,"onTime":25,"rework":20,"capacity":20}'::jsonb`,
  `ALTER TABLE client_bid_requests ADD COLUMN IF NOT EXISTS awarded_vendor_org_id uuid`,
  `ALTER TABLE client_bid_requests ADD COLUMN IF NOT EXISTS awarded_at timestamptz`,
  `ALTER TABLE client_bid_requests ADD COLUMN IF NOT EXISTS po_payload jsonb`,
  `ALTER TABLE client_vendor_bid_lines ADD COLUMN IF NOT EXISTS extended_cents bigint NOT NULL DEFAULT 0`,
  `ALTER TABLE client_vendor_bid_lines ADD COLUMN IF NOT EXISTS tier text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_bid_invitations_req_vendor_uq
     ON client_bid_invitations (bid_request_id, vendor_org_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_vendor_bids_req_vendor_uq
     ON client_vendor_bids (bid_request_id, vendor_org_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_vendor_bid_lines_bid_code_tier_uq
     ON client_vendor_bid_lines (bid_id, price_item_code, COALESCE(tier, ''))`,

  `CREATE TABLE IF NOT EXISTS client_vendor_scorecards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_org_id uuid NOT NULL,
    property_id uuid NOT NULL,
    on_time_pct integer NOT NULL DEFAULT 0,
    rework_rate integer NOT NULL DEFAULT 0,
    avg_turn_days numeric(8,2),
    disputes_count integer NOT NULL DEFAULT 0,
    capacity_units_per_week integer NOT NULL DEFAULT 0,
    window_start timestamptz NOT NULL,
    window_end timestamptz NOT NULL
  )`,

  // ── forecasting ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS client_capacity_declarations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_org_id uuid NOT NULL,
    trade text NOT NULL,
    week_start timestamptz NOT NULL,
    units_capacity integer NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_capacity_declarations_uq
     ON client_capacity_declarations (vendor_org_id, trade, week_start)`,

  `CREATE TABLE IF NOT EXISTS client_capacity_holds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id uuid NOT NULL,
    org_id uuid NOT NULL,
    property_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    turn_id uuid NOT NULL,
    vendor_org_id uuid NOT NULL,
    trade text NOT NULL,
    week_start timestamptz NOT NULL,
    units integer NOT NULL DEFAULT 1,
    status text NOT NULL,
    expires_at timestamptz NOT NULL,
    confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_capacity_holds_turn_trade_live_uq
     ON client_capacity_holds (turn_id, trade)
     WHERE status IN ('held', 'confirmed')`,
  `CREATE INDEX IF NOT EXISTS client_capacity_holds_week_idx
     ON client_capacity_holds (week_start, trade, status)`,

  `CREATE TABLE IF NOT EXISTS client_turn_forecasts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL,
    week_start timestamptz NOT NULL,
    projected_units integer NOT NULL,
    projected_spend_cents bigint NOT NULL,
    confidence text NOT NULL,
    generated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_turn_forecasts_property_week_uq
     ON client_turn_forecasts (property_id, week_start)`,

  // ── cross-cutting ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS client_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    actor_id text,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    before jsonb,
    after jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    ip text,
    user_agent text
  )`,
  `CREATE INDEX IF NOT EXISTS client_audit_log_org_idx
     ON client_audit_log (org_id, occurred_at)`,

  `CREATE TABLE IF NOT EXISTS client_portfolio_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    kind text NOT NULL,
    payload jsonb,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS client_saved_views (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    name text NOT NULL,
    filters jsonb NOT NULL DEFAULT '{}',
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS client_idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    response_status integer NOT NULL,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_idempotency_keys_org_key_uq
     ON client_idempotency_keys (org_id, key)`,

  // ── append-only guards ─────────────────────────────────────────────────
  `CREATE OR REPLACE FUNCTION halo_append_only_guard()
   RETURNS trigger
   LANGUAGE plpgsql
   AS $fn$
   BEGIN
     IF TG_OP = 'DELETE'
        AND current_setting('halo.allow_append_delete', true) = 'on' THEN
       RETURN OLD;
     END IF;
     RAISE EXCEPTION 'append-only table % cannot be updated or deleted', TG_TABLE_NAME
       USING ERRCODE = 'integrity_constraint_violation';
   END;
   $fn$`,

  `DROP TRIGGER IF EXISTS client_turn_stage_events_append_only ON client_turn_stage_events`,
  `CREATE TRIGGER client_turn_stage_events_append_only
     BEFORE UPDATE OR DELETE ON client_turn_stage_events
     FOR EACH ROW EXECUTE PROCEDURE halo_append_only_guard()`,

  `DROP TRIGGER IF EXISTS client_audit_log_append_only ON client_audit_log`,
  `CREATE TRIGGER client_audit_log_append_only
     BEFORE UPDATE OR DELETE ON client_audit_log
     FOR EACH ROW EXECUTE PROCEDURE halo_append_only_guard()`,

  `DROP TRIGGER IF EXISTS client_turn_invoice_lines_append_only ON client_turn_invoice_lines`,
  `CREATE TRIGGER client_turn_invoice_lines_append_only
     BEFORE UPDATE OR DELETE ON client_turn_invoice_lines
     FOR EACH ROW EXECUTE PROCEDURE halo_append_only_guard()`,

  // ── metrics refresh (derived from events, property TZ day math) ────────
  // Triggers must drop before the function; PG will not DROP FUNCTION otherwise.
  `DROP TRIGGER IF EXISTS client_turn_stage_events_refresh_metrics ON client_turn_stage_events`,
  `DROP TRIGGER IF EXISTS client_turns_refresh_metrics ON client_turns`,
  `DROP FUNCTION IF EXISTS refresh_client_turn_metrics_from_event()`,
  `DROP FUNCTION IF EXISTS refresh_client_turn_metrics_from_turn()`,
  `DROP FUNCTION IF EXISTS refresh_open_client_turn_metrics(timestamp with time zone, text)`,
  `DROP FUNCTION IF EXISTS refresh_client_turn_metrics(uuid)`,
  `DROP FUNCTION IF EXISTS refresh_client_turn_metrics(uuid, timestamp with time zone)`,
  `CREATE OR REPLACE FUNCTION refresh_client_turn_metrics(p_turn_id uuid, p_as_of timestamptz DEFAULT NULL)
   RETURNS void
   LANGUAGE plpgsql
   AS $fn$
   DECLARE
     v_property_id uuid;
     v_tz text;
     v_target integer;
     v_rent bigint;
     v_vacate timestamptz;
     v_ready timestamptz;
     v_days integer;
     v_over integer;
     v_month_days integer;
     v_cost bigint;
     v_client_ms bigint;
     v_vendor_ms bigint;
     v_shared_ms bigint;
     v_durations jsonb;
     v_current text;
     v_now timestamptz;
     v_as_of timestamptz;
     v_current_ms bigint := 0;
     v_p75 bigint;
     v_stalled boolean := false;
   BEGIN
     v_now := COALESCE(p_as_of, clock_timestamp());
     SELECT
       t.property_id,
       COALESCE(p.timezone, 'America/Chicago'),
       COALESCE(p.target_turn_days, 7),
       COALESCE(u.market_rent_cents, 0),
       t.actual_vacate_at,
       t.ready_at,
       t.status
     INTO
       v_property_id, v_tz, v_target, v_rent, v_vacate, v_ready, v_current
     FROM client_turns t
     JOIN properties p ON p.id = t.property_id
     JOIN client_units u ON u.id = t.unit_id
     WHERE t.id = p_turn_id;

     IF NOT FOUND THEN
       RETURN;
     END IF;

     IF v_vacate IS NULL THEN
       v_days := 0;
     ELSE
       v_days := (
         (COALESCE(v_ready, v_now) AT TIME ZONE v_tz)::date
         - (v_vacate AT TIME ZONE v_tz)::date
       );
     END IF;

     -- Completed turns freeze open intervals at ready_at. Pairing with
     -- clock_timestamp() would make the terminal ready stage grow forever.
     v_as_of := COALESCE(v_ready, v_now);

     v_over := GREATEST(0, v_days - v_target);

     v_month_days := EXTRACT(DAY FROM (
       date_trunc('month', (COALESCE(v_ready, v_now) AT TIME ZONE v_tz))
       + interval '1 month'
       - interval '1 day'
     ))::integer;
     IF v_month_days < 28 THEN
       v_month_days := 30;
     END IF;

     v_cost := (v_over::bigint * v_rent) / v_month_days;

     WITH ordered AS (
       SELECT
         id,
         stage,
         event,
         occurred_at,
         row_number() OVER (
           PARTITION BY stage, event
           ORDER BY occurred_at, id
         ) AS n
       FROM client_turn_stage_events
       WHERE turn_id = p_turn_id
     ),
     pairs AS (
       SELECT
         e.stage,
         e.occurred_at AS entered_at,
         COALESCE(x.occurred_at, v_as_of) AS exited_at
       FROM ordered e
       LEFT JOIN ordered x
         ON x.stage = e.stage
        AND x.event = 'exited'
        AND x.n = e.n
       WHERE e.event = 'entered'
     ),
     summed AS (
       SELECT
         p.stage,
         o.owner,
         GREATEST(0, (EXTRACT(EPOCH FROM (p.exited_at - p.entered_at)) * 1000))::bigint AS ms
       FROM pairs p
       JOIN client_stage_ownership o ON o.stage = p.stage
     ),
     by_stage AS (
       SELECT stage, MAX(owner) AS owner, SUM(ms) AS ms_sum
       FROM summed
       GROUP BY stage
     )
     SELECT
       COALESCE(jsonb_object_agg(stage, ms_sum), '{}'::jsonb),
       COALESCE(SUM(ms_sum) FILTER (WHERE owner = 'client'), 0),
       COALESCE(SUM(ms_sum) FILTER (WHERE owner = 'vendor'), 0),
       COALESCE(SUM(ms_sum) FILTER (WHERE owner = 'shared'), 0)
     INTO v_durations, v_client_ms, v_vendor_ms, v_shared_ms
     FROM by_stage;

     v_client_ms := COALESCE(v_client_ms, 0);
     v_vendor_ms := COALESCE(v_vendor_ms, 0);
     v_shared_ms := COALESCE(v_shared_ms, 0);
     v_durations := COALESCE(v_durations, '{}'::jsonb);

     -- is_stalled lives here, not in a post-commit UPDATE. Ready is terminal.
     IF v_ready IS NOT NULL OR v_current = 'ready' THEN
       v_stalled := false;
     ELSE
       WITH ordered AS (
         SELECT
           id,
           event,
           occurred_at,
           row_number() OVER (PARTITION BY event ORDER BY occurred_at, id) AS n
         FROM client_turn_stage_events
         WHERE turn_id = p_turn_id AND stage = v_current
       )
       SELECT COALESCE(
         GREATEST(0, (EXTRACT(EPOCH FROM (v_as_of - e.occurred_at)) * 1000))::bigint,
         0
       )
       INTO v_current_ms
       FROM ordered e
       LEFT JOIN ordered x ON x.event = 'exited' AND x.n = e.n
       WHERE e.event = 'entered' AND x.id IS NULL
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT 1;
       v_current_ms := COALESCE(v_current_ms, 0);

       WITH peer_ordered AS (
         SELECT
           e.id,
           e.turn_id,
           e.event,
           e.occurred_at,
           row_number() OVER (
             PARTITION BY e.turn_id, e.event
             ORDER BY e.occurred_at, e.id
           ) AS n
         FROM client_turn_stage_events e
         JOIN client_turns t ON t.id = e.turn_id
         WHERE t.property_id = v_property_id
           AND e.stage = v_current
           AND e.turn_id <> p_turn_id
           AND e.occurred_at >= v_now - interval '90 days'
       ),
       peer_pairs AS (
         SELECT GREATEST(
           0,
           (EXTRACT(EPOCH FROM (x.occurred_at - e.occurred_at)) * 1000)
         )::bigint AS ms
         FROM peer_ordered e
         JOIN peer_ordered x
           ON x.turn_id = e.turn_id
          AND x.event = 'exited'
          AND x.n = e.n
         WHERE e.event = 'entered'
       ),
       ranked AS (
         SELECT
           ms,
           row_number() OVER (ORDER BY ms) AS rn,
           count(*) OVER () AS n
         FROM peer_pairs
       )
       SELECT ms INTO v_p75
       FROM ranked
       WHERE n > 0
         AND rn = LEAST(n, GREATEST(1, CEIL(0.75 * n)::integer))
       LIMIT 1;

       v_stalled := (v_p75 IS NOT NULL AND v_p75 > 0 AND v_current_ms > v_p75);
     END IF;

     INSERT INTO client_turn_metrics_mv (
       turn_id, property_id, days_vacant, stage_durations,
       client_owned_hours, vendor_owned_hours, shared_owned_hours,
       client_owned_ms, vendor_owned_ms,
       over_target_days, vacancy_cost_cents, is_stalled, current_stage, refreshed_at
     ) VALUES (
       p_turn_id,
       v_property_id,
       v_days,
       v_durations,
       ROUND((v_client_ms::numeric / 3600000), 2),
       ROUND((v_vendor_ms::numeric / 3600000), 2),
       ROUND((v_shared_ms::numeric / 3600000), 2),
       v_client_ms,
       v_vendor_ms,
       v_over,
       v_cost,
       v_stalled,
       v_current,
       v_now
     )
     ON CONFLICT (turn_id) DO UPDATE SET
       property_id = EXCLUDED.property_id,
       days_vacant = EXCLUDED.days_vacant,
       stage_durations = EXCLUDED.stage_durations,
       client_owned_hours = EXCLUDED.client_owned_hours,
       vendor_owned_hours = EXCLUDED.vendor_owned_hours,
       shared_owned_hours = EXCLUDED.shared_owned_hours,
       client_owned_ms = EXCLUDED.client_owned_ms,
       vendor_owned_ms = EXCLUDED.vendor_owned_ms,
       over_target_days = EXCLUDED.over_target_days,
       vacancy_cost_cents = EXCLUDED.vacancy_cost_cents,
       is_stalled = EXCLUDED.is_stalled,
       current_stage = EXCLUDED.current_stage,
       refreshed_at = EXCLUDED.refreshed_at;
   END;
   $fn$`,

  `CREATE OR REPLACE FUNCTION refresh_open_client_turn_metrics(
     p_as_of timestamptz DEFAULT NULL,
     p_timezone text DEFAULT NULL
   )
   RETURNS integer
   LANGUAGE plpgsql
   AS $fn$
   DECLARE
     v_n integer := 0;
     r record;
   BEGIN
     FOR r IN
       SELECT t.id
       FROM client_turns t
       JOIN properties p ON p.id = t.property_id
       WHERE t.ready_at IS NULL
         AND (p_timezone IS NULL OR p.timezone = p_timezone)
     LOOP
       PERFORM refresh_client_turn_metrics(r.id, p_as_of);
       v_n := v_n + 1;
     END LOOP;
     RETURN v_n;
   END;
   $fn$`,

  `CREATE OR REPLACE FUNCTION refresh_client_turn_metrics_from_event()
   RETURNS trigger
   LANGUAGE plpgsql
   AS $fn$
   BEGIN
     PERFORM refresh_client_turn_metrics(NEW.turn_id);
     RETURN NEW;
   END;
   $fn$`,

  `DROP TRIGGER IF EXISTS client_turn_stage_events_refresh_metrics ON client_turn_stage_events`,
  `CREATE TRIGGER client_turn_stage_events_refresh_metrics
     AFTER INSERT ON client_turn_stage_events
     FOR EACH ROW EXECUTE PROCEDURE refresh_client_turn_metrics_from_event()`,

  `CREATE OR REPLACE FUNCTION refresh_client_turn_metrics_from_turn()
   RETURNS trigger
   LANGUAGE plpgsql
   AS $fn$
   BEGIN
     PERFORM refresh_client_turn_metrics(NEW.id);
     RETURN NEW;
   END;
   $fn$`,

  `DROP TRIGGER IF EXISTS client_turns_refresh_metrics ON client_turns`,
  `CREATE TRIGGER client_turns_refresh_metrics
     AFTER UPDATE OF actual_vacate_at, ready_at, status ON client_turns
     FOR EACH ROW EXECUTE PROCEDURE refresh_client_turn_metrics_from_turn()`,
];

/** Lookup seed — must match STAGE_OWNERSHIP_SEED in clientBoardEnums.ts */
export const CLIENT_STAGE_OWNERSHIP_SEED_SQL = `
INSERT INTO client_stage_ownership (stage, owner) VALUES
  ('notice', 'shared'),
  ('vacated', 'shared'),
  ('walk', 'vendor'),
  ('scoped', 'vendor'),
  ('pending_approval', 'client'),
  ('approved', 'client'),
  ('scheduled', 'vendor'),
  ('in_progress', 'vendor'),
  ('qc', 'vendor'),
  ('rework', 'vendor'),
  ('ready', 'shared')
ON CONFLICT (stage) DO UPDATE SET owner = EXCLUDED.owner
`;

export const CLIENT_BOARD_FLAGS_SEED_SQL = `
INSERT INTO client_board_flags (segment, enabled) VALUES
  ('dataModel', true),
  ('turnEngine', true),
  ('pulse', true),
  ('propertyBoard', true),
  ('evidence', true),
  ('invoiceCompliance', true),
  ('csvImport', true),
  ('bidBoard', true),
  ('pipeline', true),
  ('workSource', true),
  ('realtime', false),
  ('security', false),
  ('demo', false)
ON CONFLICT (segment) DO NOTHING
`;

export function renderClientBoardMigrationSql(): string {
  const header = `-- Client Board v1 (CAF Edition) — Segment 1
-- Generated from lib/db/src/clientBoardDdl.ts. Do not edit by hand.
-- Apply: psql "$DATABASE_URL" -f lib/db/migrations/0015_client_board_v1.sql
--    or: API boot via ensureClientBoardSchema() (idempotent).
-- Rollback: 0015_client_board_v1.down.sql
--
-- Do NOT drizzle-kit push --force; see .agents/memory/halo-dev-db-divergence.md
--
-- Invariants:
--   * turn clock is event-sourced (client_turn_stage_events append-only)
--   * no mutable days_vacant column on client_turns
--   * client-owned stages are first-class (client_stage_ownership)
--   * money is bigint cents
--   * timestamps are timestamptz UTC; day math uses properties.timezone
--   * table names are client_* so we do not collide with office
--     invoices / bids / notifications / price_items / property_units

`;
  const statements = CLIENT_BOARD_DDL.map((stmt) => stmt.trim().replace(/;+\s*$/, "") + ";");
  const seeds = [
    CLIENT_STAGE_OWNERSHIP_SEED_SQL.trim().replace(/;+\s*$/, "") + ";",
    CLIENT_BOARD_FLAGS_SEED_SQL.trim().replace(/;+\s*$/, "") + ";",
  ];
  return `${header}${statements.join("\n\n")}\n\n${seeds.join("\n\n")}\n`;
}

