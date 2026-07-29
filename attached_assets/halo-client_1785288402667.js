/**
 * HALO API CLIENT
 * Thin fetch wrapper. Set DRY_RUN=true to log calls instead of sending them —
 * useful while you build out the matching endpoints on the Halo side.
 */
const BASE    = process.env.HALO_API_BASE || 'https://api.yourhalo.app/v1';
const KEY     = process.env.HALO_API_KEY  || '';
const DRY_RUN = String(process.env.DRY_RUN || 'true') === 'true';

function fill(path, ctx) {
  return path.replace(/:([a-z_]+)/g, (_, k) => {
    const v = ctx.card?.[k] ?? ctx.payload?.[k] ?? ctx[k];
    return encodeURIComponent(v ?? ('missing_' + k));
  });
}

export async function call(action, ctx) {
  const url  = BASE + fill(action.endpoint, ctx);
  const body = action.method === 'GET' ? undefined : JSON.stringify(action.body(ctx));

  if (DRY_RUN) {
    console.log('[halo:dry-run] ' + action.method + ' ' + url, body || '');
    return { ok: true, dryRun: true, url, method: action.method, body: body ? JSON.parse(body) : null };
  }

  const res = await fetch(url, {
    method: action.method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error('Halo ' + res.status + ' on ' + url + ': ' + text.slice(0, 300));
  return data;
}
