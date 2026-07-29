/**
 * AUTOMATION ENGINE
 * ---------------------------------------------------------------------------
 * dispatch(evt) is the single entry point. The board posts here, Halo webhooks
 * post here, cron posts here. It:
 *
 *   1. resolves the action           2. runs its guard
 *   3. calls the Halo API            4. fires the action's own events
 *   5. runs stage-entry automations for the template
 *   6. returns an audit record
 */
import { ACTIONS } from './actions.js';
import { TEMPLATES } from './templates.js';
import { call } from './halo-client.js';
import { emit } from './hooks.js';

export async function dispatch(evt) {
  const started = Date.now();
  const action = ACTIONS[evt.action];
  if (!action) return { ok: false, error: 'unknown_action', action: evt.action };

  const ctx = {
    ...evt,
    card: evt.payload?.card || evt.payload?.source_card || {},
    actor: evt.actor || { role: 'system' }
  };

  if (typeof action.guard === 'function') {
    const blocked = action.guard(ctx);
    if (blocked) {
      await emit('action.blocked', { ...evt, reason: blocked });
      return { ok: false, blocked: true, reason: blocked, action: evt.action };
    }
  }

  let result;
  try {
    result = await call(action, ctx);
  } catch (err) {
    await emit('action.failed', { ...evt, error: String(err) });
    return { ok: false, error: String(err), action: evt.action };
  }

  for (const e of action.emits || []) await emit(e, { ...evt, result });

  const fired = [];
  if (action.runsAutomations || action.advances) {
    const tpl = TEMPLATES[ctx.card.template];
    const stage = evt.payload?.to_stage || nextStage(tpl, ctx.card.stage);
    const list = tpl?.onEnter?.[stage] || [];
    for (const a of list) { fired.push(a); await emit(a, { ...evt, stage }); }
  }

  const record = {
    ok: true, action: evt.action, label: action.label,
    card: ctx.card.card_id || null, actor: ctx.actor.role,
    emitted: action.emits || [], automations: fired,
    ms: Date.now() - started, at: new Date().toISOString(), result
  };
  await emit('audit.action', record);
  return record;
}

function nextStage(tpl, stage) {
  if (!tpl) return null;
  const i = tpl.pipeline.indexOf(stage);
  return i < 0 ? null : tpl.pipeline[Math.min(i + 1, tpl.pipeline.length - 1)];
}

/* SLA sweeper — run on an interval; escalates cards past their SLA. */
export async function sweepSLAs(cards) {
  const breached = cards.filter(c => c.sla_minutes_remaining !== null && c.sla_minutes_remaining < 0);
  for (const c of breached) await emit('sla.breached', { action: 'sla.breached', payload: { card: c } });
  return breached.length;
}
