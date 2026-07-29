/**
 * HOOK BUS
 * ---------------------------------------------------------------------------
 * Every action emits one or more events. Anything in your CRM can subscribe.
 *
 *   import { on, once, emit } from './hooks.js';
 *   on('notify.vendor', async (evt) => { await twilio.sms(...) });
 *   on('*',             async (evt) => { await auditLog.write(evt) });
 *
 * Handlers run in parallel; a throwing handler is logged and never blocks the
 * others, so one bad integration cannot wedge the board.
 */
const registry = new Map();

export function on(event, handler) {
  if (!registry.has(event)) registry.set(event, new Set());
  registry.get(event).add(handler);
  return () => registry.get(event).delete(handler);
}

export function once(event, handler) {
  const off = on(event, async (...a) => { off(); return handler(...a); });
  return off;
}

export async function emit(event, evt) {
  const targets = [...(registry.get(event) || []), ...(registry.get('*') || [])];
  const results = await Promise.allSettled(targets.map(h => h(evt, event)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error('[hook:' + event + '] handler ' + i + ' failed:', r.reason);
  });
  return results.length;
}

export function registered() {
  return [...registry.entries()].map(([k, v]) => ({ event: k, handlers: v.size }));
}

/* --------------------------------------------------------------------------
 * The complete event catalogue. Subscribe to any of these.
 * ------------------------------------------------------------------------ */
export const EVENTS = {
  card:        ['card.opened','card.created','card.moved','card.lane_changed','card.stage_changed','card.snoozed','card.export_requested'],
  crew:        ['crew.location_viewed','crew.clock_in','crew.clock_out','crew.geofence_enter','crew.geofence_exit','crew.credentials_revoked'],
  maintenance: ['notify.tech','tech_app.push','route.recalculate','route.published','photo.qc_required','photo.before_required','photo.after_required','work_order.created'],
  money:       ['ap.queued_for_run','ach.file_generated','ledger.posted','ledger.locked','budget.commit','budget.reserve','budget.actualize','budget.variance_accepted','budget.reforecast_pending'],
  vendor:      ['notify.vendor','notify.vendors.remittance','vendor.job_report_generated','vendor.rework_required','vendor.scope_frozen','vendor.credit_for_catch','vendor.crew_unblocked','jobs.blocked'],
  compliance:  ['compliance.reminder_scheduled','compliance.packet_filed','notify.inspector','fine.accrual_stop','jobs.flag_uninsured'],
  access:      ['access.revoked','access.window_extended','access.auto_revoke','audit.access','audit.access_closed'],
  leasing:     ['notify.lead','notify.resident','unit.soft_held','unit.available','backup_unit.tagged','turn.priority_changed','renewal.offers_queued','renewal.reminder_scheduled','units.retagged','marketing.copy_refresh','marketing.publish','survey.send','screening.run'],
  collections: ['legal.queue_updated','ledger.plan_created','attorney.package'],
  people:      ['payroll.line_queued','assignment.changed','inventory.par_flag','inventory.par_rebaselined'],
  emergency:   ['page.oncall','page.manager','incident.report_opened','notify.regional','insurance.notify','owner.notify'],
  system:      ['export.queued','triage.cleared','sla.response_met','sla.breached','sentiment.recheck_scheduled','audit.view']
};
