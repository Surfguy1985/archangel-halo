/**
 * ACTION REGISTRY
 * ---------------------------------------------------------------------------
 * Every button on every card resolves to exactly one entry here.
 * The board UI emits { action, payload } — this file says what that means:
 *
 *   label      human string shown in audit log
 *   method     HTTP verb against the Halo API
 *   endpoint   Halo API path (:token segments come from payload.card)
 *   body       (ctx) => object   request body builder
 *   emits      events published on the bus after a successful call
 *   advances   true if the card should move to its next stage on success
 *   guard      (ctx) => string|null  return a reason to block the action
 *
 * Add a new card action by adding a key here and referencing it from
 * TEMPLATES[<template>].actions in ./templates.js — nothing else to change.
 */

const money = (ctx) => ctx.card.amount ?? null;

export const ACTIONS = {

  /* ----------------------------------------------------------- generic */
  'card.opened': {
    label: 'Card opened', method: 'POST', endpoint: '/cards/:card_id/views',
    body: (c) => ({ actor: c.actor.id }), emits: ['audit.view']
  },
  'card.stage_advanced': {
    label: 'Stage advanced', method: 'PATCH', endpoint: '/cards/:card_id',
    body: (c) => ({ stage: c.payload.to_stage }),
    emits: ['card.stage_changed'], runsAutomations: true
  },
  'card.moved': {
    label: 'Card moved between lanes', method: 'PATCH', endpoint: '/cards/:card_id',
    body: (c) => ({ lane: c.payload.to_lane }), emits: ['card.lane_changed']
  },
  'card.export_requested': {
    label: 'Export a single card', method: 'POST', endpoint: '/cards/:card_id/exports',
    body: (c) => ({ formats: ['png', 'html', 'json', 'pdf'] }), emits: ['export.queued']
  },
  'export.completed': {
    label: 'Export finished', method: 'POST', endpoint: '/exports/receipts',
    body: (c) => ({ format: c.payload.format, count: c.payload.count }), emits: []
  },
  'ops.snooze_card': {
    label: 'Snooze card', method: 'PATCH', endpoint: '/cards/:card_id',
    body: () => ({ snoozed_until: '+1d@08:00' }), emits: ['card.snoozed']
  },

  /* -------------------------------------------------------------- bulk */
  'bulk.export_requested': {
    label: 'Bulk export', method: 'POST', endpoint: '/exports/batch',
    body: (c) => ({ card_ids: c.payload.cards.map(x => x.card_id) }), emits: ['export.queued']
  },
  'bulk.advance_stage': {
    label: 'Advance many cards', method: 'POST', endpoint: '/cards/batch/advance',
    body: (c) => ({ card_ids: c.payload.cards.map(x => x.card_id) }),
    emits: ['card.stage_changed'], runsAutomations: true
  },
  'bulk.assign': {
    label: 'Assign many cards', method: 'POST', endpoint: '/cards/batch/assign',
    body: (c) => ({ card_ids: c.payload.cards.map(x => x.card_id), assignee_id: c.payload.assignee.id }),
    emits: ['assignment.changed', 'notify.tech']
  },
  'bulk.defer': {
    label: 'Defer many cards', method: 'POST', endpoint: '/cards/batch/snooze',
    body: (c) => ({ card_ids: c.payload.cards.map(x => x.card_id), until: c.payload.until }),
    emits: ['card.snoozed']
  },
  'triage.approve': { label: 'Triage — approve', method: 'POST', endpoint: '/triage/:card_id/approve', body: () => ({}), emits: ['triage.cleared'] },
  'triage.assign':  { label: 'Triage — assign',  method: 'POST', endpoint: '/triage/:card_id/assign',  body: (c) => ({ assignee: c.card.owner }), emits: ['assignment.changed'] },
  'triage.defer':   { label: 'Triage — defer',   method: 'POST', endpoint: '/triage/:card_id/defer',   body: () => ({ until: '+1d@08:00' }), emits: ['card.snoozed'] },

  /* --------------------------------------------------- work orders (wo) */
  'maint.dispatch_tech': {
    label: 'Dispatch a technician', method: 'POST', endpoint: '/work-orders/:card_id/dispatch',
    body: (c) => ({ unit: c.card.unit, priority: c.card.sla_minutes_remaining < 60 ? 'urgent' : 'normal' }),
    emits: ['notify.tech', 'sms.resident.window', 'route.recalculate'], advances: true
  },
  'maint.hold_for_parts': {
    label: 'Hold for parts', method: 'POST', endpoint: '/work-orders/:card_id/hold',
    body: () => ({ reason: 'parts' }), emits: ['purchasing.parts_needed', 'sms.resident.delay']
  },
  'maint.create_work_order_from_finding': {
    label: 'Escalate a crew finding into a work order',
    method: 'POST', endpoint: '/work-orders',
    body: (c) => ({
      source: { type: 'vendor_finding', card_id: c.payload.source_card.card_id },
      unit: c.payload.finding.unit,
      summary: c.payload.finding.text,
      severity: c.payload.finding.severity,
      reported_by: c.payload.finding.reported_by,
      sla_minutes: c.payload.created.sla_minutes,
      assignee_id: 'usr_mwebb'
    }),
    emits: ['notify.tech', 'vendor.credit_for_catch', 'card.created']
  },
  'maint.book_pm_service': {
    label: 'Book preventive service', method: 'POST', endpoint: '/assets/:asset_id/service-orders',
    body: (c) => ({ vendor: c.card.owner, window: 'next_available' }),
    emits: ['vendor.slot_requested', 'asset.warranty_clock_reset'], advances: true
  },
  'maint.defer_pm': {
    label: 'Defer preventive service', method: 'PATCH', endpoint: '/assets/:asset_id',
    body: () => ({ pm_deferred: true }),
    emits: ['finance.risk_accepted', 'asset.warranty_at_risk'],
    guard: (c) => c.card.warranty_voids_in_days < 30 ? 'Deferral voids the warranty in under 30 days — needs owner sign-off' : null
  },

  /* -------------------------------------------------------- make-ready */
  'turn.release_for_reinspection': {
    label: 'Release turn for re-inspection', method: 'POST', endpoint: '/turns/:card_id/reinspect',
    body: () => ({}), emits: ['notify.leasing', 'inspection.scheduled'], advances: true
  },
  'turn.hold_unit': {
    label: 'Hold the unit', method: 'POST', endpoint: '/turns/:card_id/hold',
    body: () => ({}), emits: ['leasing.unit_unavailable']
  },

  /* ---------------------------------------------------------- accounts */
  'ap.approve_invoice': {
    label: 'Approve an invoice', method: 'POST', endpoint: '/invoices/:card_id/approve',
    body: (c) => ({ amount: money(c), gl_code: c.card.gl_code ?? '5210' }),
    emits: ['ap.queued_for_run', 'notify.vendor', 'budget.commit'], advances: true,
    guard: (c) => c.card.three_way_match === false ? 'PO / receipt / invoice do not match' : null
  },
  'ap.hold_invoice': {
    label: 'Hold an invoice', method: 'POST', endpoint: '/invoices/:card_id/hold',
    body: () => ({ reason: 'manager_hold' }), emits: ['notify.vendor']
  },
  'ap.release_payment_run': {
    label: 'Release the payment run', method: 'POST', endpoint: '/payment-runs/:card_id/release',
    body: () => ({ method: 'ach' }),
    emits: ['ach.file_generated', 'notify.vendors.remittance', 'ledger.posted'], advances: true,
    guard: (c) => c.card.owner_approval === false ? 'Owner approval still outstanding' : null
  },
  'ap.split_payment_run': {
    label: 'Split the payment run', method: 'POST', endpoint: '/payment-runs/:card_id/split',
    body: () => ({}), emits: ['ap.run_split']
  },
  'finance.send_reforecast': {
    label: 'Send a budget reforecast', method: 'POST', endpoint: '/budgets/:gl_code/reforecast',
    body: (c) => ({ variance: c.card.variance, period: c.card.period }),
    emits: ['notify.owner', 'budget.reforecast_pending'], advances: true
  },
  'finance.absorb_variance': {
    label: 'Absorb the variance', method: 'PATCH', endpoint: '/budgets/:gl_code',
    body: () => ({ variance_accepted: true }), emits: ['budget.variance_accepted']
  },

  /* ----------------------------------------------------------- vendors */
  'vendor.approve_change_order': {
    label: 'Approve a change order', method: 'POST', endpoint: '/change-orders/:card_id/approve',
    body: (c) => ({ delta: c.card.delta }),
    emits: ['vendor.crew_unblocked', 'budget.commit', 'notify.vendor'], advances: true,
    guard: (c) => (c.card.delta_amount ?? 0) > 5000 ? 'Change orders above $5,000 need owner approval' : null
  },
  'vendor.deny_change_order': {
    label: 'Deny a change order', method: 'POST', endpoint: '/change-orders/:card_id/deny',
    body: () => ({}), emits: ['notify.vendor', 'vendor.scope_frozen']
  },
  'vendor.signoff_job': {
    label: 'Sign off a vendor job', method: 'POST', endpoint: '/jobs/:card_id/signoff',
    body: () => ({ photos_required: true }),
    emits: ['vendor.job_report_generated', 'ap.invoice_expected', 'crew.credentials_revoked'], advances: true,
    guard: (c) => c.card.after_photos_count === 0 ? 'After-photos are required before sign-off' : null
  },
  'vendor.reject_job': {
    label: 'Reject vendor work', method: 'POST', endpoint: '/jobs/:card_id/reject',
    body: () => ({}), emits: ['notify.vendor', 'vendor.rework_required']
  },
  'vendor.job_report_opened': {
    label: 'Open the Halo job report', method: 'GET', endpoint: '/jobs/:card_id/report',
    body: () => ({}), emits: []
  },
  'crew.locate_requested': {
    label: 'Locate a crew member', method: 'GET', endpoint: '/crew/:badge/location',
    body: () => ({}), emits: ['crew.location_viewed']
  },
  'purchasing.issue_po': {
    label: 'Issue a purchase order', method: 'POST', endpoint: '/purchase-orders',
    body: (c) => ({ lines: c.card.lines, vendor: 'home_depot_pro' }),
    emits: ['budget.reserve', 'notify.shop', 'inventory.par_rebaselined'], advances: true
  },
  'purchasing.edit_draft': {
    label: 'Edit the draft order', method: 'GET', endpoint: '/purchase-orders/:card_id/edit',
    body: () => ({}), emits: []
  },

  /* -------------------------------------------------------- compliance */
  'compliance.request_coi_renewal': {
    label: 'Request a COI renewal', method: 'POST', endpoint: '/vendors/:vendor_id/coi/request',
    body: () => ({ channel: 'email' }), emits: ['notify.vendor', 'compliance.reminder_scheduled'], advances: true
  },
  'compliance.suspend_vendor': {
    label: 'Suspend a vendor', method: 'POST', endpoint: '/vendors/:vendor_id/suspend',
    body: () => ({ reason: 'insurance_lapsed' }),
    emits: ['jobs.blocked', 'access.credentials_revoked', 'notify.vendor']
  },
  'compliance.dispatch_and_file_packet': {
    label: 'Dispatch cure work and file the evidence packet',
    method: 'POST', endpoint: '/violations/:card_id/cure',
    body: (c) => ({ evidence_complete: c.card.evidence_complete }),
    emits: ['notify.inspector', 'work_order.created', 'compliance.packet_filed'], advances: true,
    guard: (c) => c.card.evidence_complete === false ? 'Evidence packet is incomplete — 2 items missing' : null
  },
  'compliance.request_extension': {
    label: 'Request a cure extension', method: 'POST', endpoint: '/violations/:card_id/extension',
    body: () => ({}), emits: ['notify.inspector']
  },

  /* ------------------------------------------------------------ access */
  'access.extend_credential': {
    label: 'Extend a virtual key', method: 'PATCH', endpoint: '/credentials/:token',
    body: () => ({ extend_hours: 4 }), emits: ['access.window_extended', 'notify.vendor']
  },
  'access.revoke_credential': {
    label: 'Revoke a virtual key', method: 'DELETE', endpoint: '/credentials/:token',
    body: () => ({}), emits: ['access.revoked', 'audit.access']
  },

  /* -------------------------------------------------------------- comms */
  'comms.send_suggested_reply': {
    label: 'Send the suggested reply', method: 'POST', endpoint: '/threads/:card_id/messages',
    body: (c) => ({ body: c.card.suggested_reply, source: 'linked_work_order' }),
    emits: ['sla.response_met', 'sentiment.recheck_scheduled'], advances: true
  },
  'comms.open_composer': { label: 'Write a reply manually', method: 'GET', endpoint: '/threads/:card_id', body: () => ({}), emits: [] },

  /* ------------------------------------------------------------ leasing */
  'leasing.prioritize_gap_units': {
    label: 'Prioritize the occupancy-gap units', method: 'POST', endpoint: '/turns/prioritize',
    body: (c) => ({ unit_ids: c.card.gap_units ?? [] }),
    emits: ['turn.priority_changed', 'renewal.offers_queued'], advances: true
  },
  'leasing.confirm_tour_and_hold': {
    label: 'Confirm a tour and soft-hold the unit', method: 'POST', endpoint: '/leads/:card_id/confirm',
    body: (c) => ({ hold_hours: 48, unit: c.card.unit }),
    emits: ['notify.lead', 'unit.soft_held', 'backup_unit.tagged'], advances: true
  },
  'leasing.release_unit': { label: 'Release the held unit', method: 'POST', endpoint: '/units/:unit/release', body: () => ({}), emits: ['unit.available'] },
  'leasing.send_renewal_offer': {
    label: 'Send a renewal offer', method: 'POST', endpoint: '/leases/:lease_id/renewal-offer',
    body: (c) => ({ increase_pct: c.card.increase_pct ?? 4.2, term_months: 12 }),
    emits: ['notify.resident', 'renewal.reminder_scheduled'], advances: true,
    guard: (c) => (c.card.open_work_orders ?? 0) > 0 ? 'Close open work orders before pricing a renewal' : null
  },
  'leasing.adjust_renewal_rate': { label: 'Adjust the renewal rate', method: 'GET', endpoint: '/leases/:lease_id/pricing', body: () => ({}), emits: [] },
  'leasing.generate_deposit_statement': {
    label: 'Generate the deposit statement', method: 'POST', endpoint: '/move-outs/:card_id/statement',
    body: (c) => ({ withheld: c.card.withheld, refund: c.card.refund }),
    emits: ['refund.ach_queued', 'damages.pushed_to_turn_budget', 'notify.former_resident'], advances: true,
    guard: (c) => c.card.photos_paired === false ? 'Move-in / move-out photos are not paired for every charge' : null
  },
  'inspection.schedule_rewalk': { label: 'Schedule a re-walk', method: 'POST', endpoint: '/inspections/:card_id/rewalk', body: () => ({}), emits: ['notify.tech'] },
  'leasing.extend_promo': {
    label: 'Extend a concession', method: 'PATCH', endpoint: '/promotions/:promo_id',
    body: () => ({ ends_on: '+15d' }), emits: ['units.retagged', 'marketing.copy_refresh'], advances: true
  },
  'leasing.end_promo': {
    label: 'End a concession', method: 'POST', endpoint: '/promotions/:promo_id/end',
    body: () => ({}), emits: ['units.retagged', 'marketing.copy_refresh']
  },

  /* -------------------------------------------------------- collections */
  'collections.serve_notice': {
    label: 'Serve a 3-day notice', method: 'POST', endpoint: '/delinquencies/:card_id/notice',
    body: (c) => ({ type: 'tx_3_day', balance: c.card.balance }),
    emits: ['legal.queue_updated', 'ledger.locked', 'notify.resident'], advances: true
  },
  'collections.offer_payment_plan': {
    label: 'Offer a payment plan', method: 'POST', endpoint: '/delinquencies/:card_id/plan',
    body: () => ({ months: 12 }), emits: ['notify.resident', 'ledger.plan_created']
  },

  /* ------------------------------------------------------------ people */
  'payroll.approve_bonus': {
    label: 'Approve a technician bonus', method: 'POST', endpoint: '/payroll/bonuses/:card_id/approve',
    body: (c) => ({ amount: c.card.bonus_amount }),
    emits: ['payroll.line_queued', 'notify.tech', 'inventory.par_flag'], advances: true
  },
  'payroll.send_to_review': { label: 'Send bonus to review', method: 'POST', endpoint: '/payroll/bonuses/:card_id/review', body: () => ({}), emits: ['notify.ops'] },

  /* ---------------------------------------------------------- emergency */
  'emergency.escalate_oncall': {
    label: 'Escalate to the on-call ladder', method: 'POST', endpoint: '/emergencies/:card_id/escalate',
    body: () => ({ ladder: ['oncall_tech', 'maintenance_supervisor', 'property_manager', 'regional'] }),
    emits: ['page.oncall', 'incident.report_opened', 'notify.regional'], advances: true
  },
  'emergency.page_manager': {
    label: 'Page the property manager', method: 'POST', endpoint: '/emergencies/:card_id/page',
    body: () => ({ target: 'property_manager' }), emits: ['page.manager']
  },

  /* -------------------------------------------------------- dispatching */
  'dispatch.autobalance_route': {
    label: 'Auto-balance the route', method: 'POST', endpoint: '/routes/:card_id/balance',
    body: () => ({ optimize: 'drive_time' }),
    emits: ['tech_app.updated', 'sms.resident.windows', 'route.published'], advances: true
  },
  'dispatch.assign_manually': { label: 'Assign stops manually', method: 'GET', endpoint: '/routes/:card_id', body: () => ({}), emits: [] }
};

export const actionIds = () => Object.keys(ACTIONS);
export const getAction = (id) => ACTIONS[id] || null;
