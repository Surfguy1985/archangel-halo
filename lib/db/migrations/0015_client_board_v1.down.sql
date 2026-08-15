-- Rollback Client Board v1 Segment 1.
-- Drops derived objects first, then tables, then additive property columns.
-- Existing office tables (properties rows, invoices, bids, price_items) are
-- not dropped. Seeded CAF Demo properties must be removed by the seed
-- teardown (double-marker) or Settings reset before this runs, or they will
-- retain timezone/org columns until this ALTER.

DROP TRIGGER IF EXISTS client_turns_refresh_metrics ON client_turns;
DROP TRIGGER IF EXISTS client_turn_stage_events_refresh_metrics ON client_turn_stage_events;
DROP TRIGGER IF EXISTS client_turn_stage_events_append_only ON client_turn_stage_events;
DROP TRIGGER IF EXISTS client_audit_log_append_only ON client_audit_log;
DROP TRIGGER IF EXISTS client_turn_invoice_lines_append_only ON client_turn_invoice_lines;

DROP FUNCTION IF EXISTS refresh_client_turn_metrics_from_turn();
DROP FUNCTION IF EXISTS refresh_client_turn_metrics_from_event();
DROP FUNCTION IF EXISTS refresh_open_client_turn_metrics(timestamp with time zone, text);
DROP FUNCTION IF EXISTS refresh_client_turn_metrics(uuid, timestamp with time zone);
DROP FUNCTION IF EXISTS refresh_client_turn_metrics(uuid);
DROP FUNCTION IF EXISTS halo_append_only_guard();

DROP TABLE IF EXISTS client_idempotency_keys;
DROP TABLE IF EXISTS client_saved_views;
DROP TABLE IF EXISTS client_portfolio_notifications;
DROP TABLE IF EXISTS client_audit_log;
DROP TABLE IF EXISTS client_turn_forecasts;
DROP TABLE IF EXISTS client_capacity_holds;
DROP TABLE IF EXISTS client_capacity_declarations;
DROP TABLE IF EXISTS client_vendor_scorecards;
DROP TABLE IF EXISTS client_vendor_bid_lines;
DROP TABLE IF EXISTS client_vendor_bids;
DROP TABLE IF EXISTS client_bid_invitations;
DROP TABLE IF EXISTS client_bid_requests;
DROP TABLE IF EXISTS client_entrata_purchase_orders;
DROP TABLE IF EXISTS client_entrata_imports;
DROP TABLE IF EXISTS client_variance_requests;
DROP TABLE IF EXISTS client_turn_invoice_lines;
DROP TABLE IF EXISTS client_turn_invoices;
DROP TABLE IF EXISTS client_scope_lines;
DROP TABLE IF EXISTS client_scopes;
DROP TABLE IF EXISTS client_price_list_items;
DROP TABLE IF EXISTS client_price_lists;
DROP TABLE IF EXISTS client_turn_records;
DROP TABLE IF EXISTS client_gps_events;
DROP TABLE IF EXISTS client_evidence_items;
DROP TABLE IF EXISTS client_turn_outbox;
DROP TABLE IF EXISTS client_prediction_log;
DROP TABLE IF EXISTS client_turn_metrics_mv;
DROP TABLE IF EXISTS client_turn_stage_events;
DROP TABLE IF EXISTS client_turns;
DROP TABLE IF EXISTS client_stage_ownership;
DROP TABLE IF EXISTS client_units;
DROP TABLE IF EXISTS client_portfolio_properties;
DROP TABLE IF EXISTS client_portfolios;
DROP TABLE IF EXISTS client_org_members;
DROP TABLE IF EXISTS client_orgs;
DROP TABLE IF EXISTS client_board_flags;

ALTER TABLE properties DROP COLUMN IF EXISTS timezone;
ALTER TABLE properties DROP COLUMN IF EXISTS avg_daily_rent_cents;
ALTER TABLE properties DROP COLUMN IF EXISTS target_turn_days;
ALTER TABLE properties DROP COLUMN IF EXISTS occupied_addon_applies;
ALTER TABLE properties DROP COLUMN IF EXISTS entrata_property_id;
ALTER TABLE properties DROP COLUMN IF EXISTS client_org_id;
ALTER TABLE properties DROP COLUMN IF EXISTS invoice_tolerance_bps;
ALTER TABLE properties DROP COLUMN IF EXISTS variance_review_minutes;
ALTER TABLE properties DROP COLUMN IF EXISTS scope_approval_cents;
ALTER TABLE properties DROP COLUMN IF EXISTS bid_score_weights;
