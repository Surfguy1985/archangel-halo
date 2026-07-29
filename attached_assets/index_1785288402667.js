import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch } from '../src/engine.js';
import { ACTIONS } from '../src/actions.js';
import { TEMPLATES } from '../src/templates.js';
import { emit, registered, EVENTS } from '../src/hooks.js';
import '../src/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const audit = [];

/* ---- the board posts every button press here ---------------------------- */
app.post('/api/actions', async (req, res) => {
  const record = await dispatch(req.body);
  audit.unshift(record); audit.length = Math.min(audit.length, 500);
  res.status(record.ok ? 200 : 422).json(record);
});

/* ---- discovery: what can this board do? --------------------------------- */
app.get('/api/actions', (_req, res) => res.json(
  Object.entries(ACTIONS).map(([id, a]) => ({
    id, label: a.label, method: a.method, endpoint: a.endpoint,
    emits: a.emits || [], advances: !!a.advances, guarded: !!a.guard
  }))
));
app.get('/api/templates', (_req, res) => res.json(TEMPLATES));
app.get('/api/events',    (_req, res) => res.json({ catalogue: EVENTS, subscribed: registered() }));
app.get('/api/audit',     (_req, res) => res.json(audit));
app.get('/api/health',    (_req, res) => res.json({ ok: true, actions: Object.keys(ACTIONS).length, templates: Object.keys(TEMPLATES).length }));

/* ---- Halo pushes back into the board ------------------------------------ */
app.post('/webhooks/halo', async (req, res) => {
  const secret = process.env.HALO_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.get('x-halo-signature') || '';
    const mac = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sig.padEnd(mac.length).slice(0, mac.length)))) {
      return res.status(401).json({ ok: false, error: 'bad_signature' });
    }
  }
  const { event, data } = req.body || {};
  await emit(event, { action: event, payload: data, source: 'halo' });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Halo Kanban on :' + PORT);
  console.log('  board      http://localhost:' + PORT + '/board.html');
  console.log('  actions    ' + Object.keys(ACTIONS).length + ' registered');
  console.log('  templates  ' + Object.keys(TEMPLATES).length + ' registered');
});
