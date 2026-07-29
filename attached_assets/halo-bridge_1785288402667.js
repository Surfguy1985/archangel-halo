/**
 * BOARD → SERVER BRIDGE
 * Drop this on the page that renders the board. Every button press on every
 * card already emits a window event; this forwards it to the automation engine
 * and shows the result.
 */
(function () {
  const ENDPOINT = window.HALO_ENDPOINT || '/api/actions';
  const queue = [];
  let flushing = false;

  async function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    while (queue.length) {
      const evt = queue.shift();
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(evt)
        });
        const out = await res.json();
        window.dispatchEvent(new CustomEvent('halo:result', { detail: out }));
        if (out.blocked) console.warn('[halo] blocked:', out.reason);
        else console.log('[halo]', out.action, '→', out.emitted, out.automations || []);
      } catch (err) {
        console.error('[halo] dispatch failed, re-queuing', err);
        queue.unshift(evt); await new Promise(r => setTimeout(r, 2000));
      }
    }
    flushing = false;
  }

  window.HALO = {
    dispatch(evt) { queue.push(evt); flush(); },
    on(event, fn) { window.addEventListener('halo:result', e => { if (e.detail.action === event) fn(e.detail); }); }
  };

  window.addEventListener('halo:action', e => window.HALO.dispatch(e.detail));
  console.log('[halo] bridge armed →', ENDPOINT);
})();
