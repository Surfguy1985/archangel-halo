import { useState, useEffect, useRef, useMemo } from "react";

/* ================================================================
   SOP INVOICE WIZARD ENGINE
   - Upload an SOP / billing guideline doc (PDF or image)
   - AI extracts a per-property billing rule ("seed")
   - Rules + source docs live in a persistent Vault
   - Invoice Builder generates invoices in the exact format the
     rule requires, branded with your company identity
   - Embeddable in Halo CRM: pass ?property=<name or alias> in the
     URL and the engine auto-selects the matching SOP rule
   ================================================================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

:root{
  --ink:#131A22;
  --paper:#F3F5F2;
  --card:#FFFFFF;
  --line:#D9DED8;
  --estate:#1F5C4C;
  --estate-soft:#E4EEE9;
  --brass:#B98A2F;
  --muted:#5A655F;
  --danger:#9C3A2E;
}
.iwx *{box-sizing:border-box;margin:0;padding:0}
.iwx{font-family:'Public Sans',system-ui,sans-serif;color:var(--ink);background:var(--paper);min-height:100vh;display:flex}
.iwx h1,.iwx h2,.iwx h3{font-family:'Bricolage Grotesque',sans-serif}
.iwx .mono{font-family:'JetBrains Mono',monospace}

/* ---- binder spine ---- */
.spine{width:230px;flex-shrink:0;background:var(--ink);color:#E9EDEA;display:flex;flex-direction:column;padding:22px 0;position:relative}
.spine::after{content:'';position:absolute;top:0;right:0;bottom:0;width:5px;background:repeating-linear-gradient(180deg,var(--brass) 0 26px,transparent 26px 40px);opacity:.55}
.spine-brand{padding:0 22px 22px;border-bottom:1px solid rgba(255,255,255,.12)}
.spine-brand .kicker{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--brass);font-weight:600}
.spine-brand h1{font-size:21px;font-weight:700;line-height:1.15;margin-top:6px}
.spine nav{display:flex;flex-direction:column;margin-top:14px}
.spine nav button{all:unset;cursor:pointer;padding:12px 22px;font-size:13.5px;font-weight:600;color:#B9C2BD;display:flex;justify-content:space-between;align-items:center;border-left:3px solid transparent}
.spine nav button:hover{color:#fff;background:rgba(255,255,255,.05)}
.spine nav button.on{color:#fff;background:rgba(255,255,255,.08);border-left-color:var(--brass)}
.spine nav button .count{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--brass)}
.spine nav button:focus-visible{outline:2px solid var(--brass);outline-offset:-2px}
.spine-foot{margin-top:auto;padding:16px 22px;font-size:11px;color:#7A857F;line-height:1.5}

/* ---- main ---- */
.main{flex:1;min-width:0;padding:30px 36px 60px;overflow-x:hidden}
.main-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.main-head h2{font-size:26px;font-weight:700}
.main-head p{color:var(--muted);font-size:13.5px;margin-top:4px;max-width:62ch}

.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:960px){.grid2{grid-template-columns:1fr}.iwx{flex-direction:column}.spine{width:100%;flex-direction:row;align-items:center;padding:10px 8px}.spine nav{flex-direction:row;margin-top:0;flex-wrap:wrap}.spine-brand{border:none;padding:6px 14px}.spine-foot{display:none}.main{padding:20px 16px 50px}}

.btn{all:unset;cursor:pointer;background:var(--estate);color:#fff;font-weight:600;font-size:13.5px;padding:10px 18px;border-radius:7px;display:inline-flex;align-items:center;gap:8px}
.btn:hover{background:#17493C}
.btn:focus-visible{outline:2px solid var(--brass);outline-offset:2px}
.btn.ghost{background:transparent;color:var(--estate);border:1px solid var(--estate)}
.btn.ghost:hover{background:var(--estate-soft)}
.btn.small{padding:6px 12px;font-size:12.5px}
.btn.danger{background:transparent;color:var(--danger);border:1px solid var(--danger)}
.btn.danger:hover{background:#F7ECEA}
.btn[disabled]{opacity:.45;cursor:not-allowed}

.field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
.field label{font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.field input,.field select,.field textarea{font:inherit;font-size:13.5px;padding:9px 11px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--ink)}
.field input:focus,.field select:focus,.field textarea:focus{outline:2px solid var(--estate);outline-offset:0;border-color:var(--estate)}

.pill{display:inline-block;font-size:11px;font-weight:600;padding:3px 9px;border-radius:99px;background:var(--estate-soft);color:var(--estate)}
.pill.brass{background:#F5EBD6;color:#8A6620}

/* ---- drop zone ---- */
.drop{border:2px dashed var(--line);border-radius:10px;padding:40px 24px;text-align:center;background:#fff;cursor:pointer;transition:border-color .15s}
.drop:hover,.drop.over{border-color:var(--estate);background:var(--estate-soft)}
.drop .big{font-family:'Bricolage Grotesque',sans-serif;font-size:17px;font-weight:600;margin-bottom:4px}
.drop .sub{font-size:12.5px;color:var(--muted)}

/* ---- vault list ---- */
.sop-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--line);border-radius:9px;background:#fff;margin-bottom:10px}
.sop-tab{width:8px;align-self:stretch;border-radius:4px;background:var(--estate)}
.sop-row h3{font-size:15px;font-weight:700}
.sop-row .meta{font-size:12px;color:var(--muted);margin-top:2px}
.sop-row .actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}

/* ---- rule sheet ---- */
.rule-sheet{font-size:13px}
.rule-sheet dt{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:10px}
.rule-sheet dd{margin-top:2px}

/* ---- invoice paper (the client's exact document) ---- */
.paper-wrap{background:#E7EAE6;border:1px solid var(--line);border-radius:10px;padding:28px;display:flex;justify-content:center}
.paper{background:#fff;width:100%;max-width:760px;padding:44px 48px;box-shadow:0 8px 30px rgba(19,26,34,.14);position:relative}
.paper::before{content:'';position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--brand,#1F5C4C)}
.paper .inv-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:30px}
.paper .inv-title{font-family:'Bricolage Grotesque',sans-serif;font-size:30px;font-weight:800;letter-spacing:.02em;color:var(--brand,#1F5C4C)}
.paper table{width:100%;border-collapse:collapse;font-size:13px;margin-top:18px}
.paper th{text-align:left;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#666;border-bottom:2px solid var(--brand,#1F5C4C);padding:6px 8px}
.paper td{padding:8px;border-bottom:1px solid #ECECEC;vertical-align:top}
.paper td.num,.paper th.num{text-align:right;font-family:'JetBrains Mono',monospace}
.totals{margin-top:14px;margin-left:auto;width:260px;font-size:13px}
.totals .row{display:flex;justify-content:space-between;padding:5px 8px}
.totals .row.grand{border-top:2px solid var(--brand,#1F5C4C);font-weight:700;font-size:15px;margin-top:4px}
.seal{position:absolute;right:40px;bottom:34px;border:1.5px solid var(--brass);color:var(--brass);border-radius:6px;padding:5px 10px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;transform:rotate(-4deg);opacity:.85}
.foot-note{margin-top:26px;font-size:11.5px;color:#555;line-height:1.55;white-space:pre-wrap}

.notice{border-left:4px solid var(--brass);background:#FBF6EA;padding:12px 14px;font-size:13px;border-radius:0 8px 8px 0;margin-bottom:16px}
.err{border-left-color:var(--danger);background:#F9EFED;color:var(--danger)}

.li-row{display:grid;grid-template-columns:1fr 2fr 90px 110px 34px;gap:8px;margin-bottom:8px;align-items:center}
.li-row input,.li-row select{font:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--line);border-radius:6px}
.li-row .x{all:unset;cursor:pointer;color:var(--danger);font-weight:700;text-align:center}
@media(max-width:760px){.li-row{grid-template-columns:1fr 1fr;grid-auto-rows:auto}}

.code-block{background:var(--ink);color:#D8E2DC;font-family:'JetBrains Mono',monospace;font-size:12px;padding:14px 16px;border-radius:8px;overflow-x:auto;line-height:1.6;white-space:pre}

@media print{
  .spine,.no-print{display:none !important}
  .iwx{background:#fff}
  .main{padding:0}
  .paper-wrap{background:#fff;border:none;padding:0}
  .paper{box-shadow:none;max-width:none}
}
@media (prefers-reduced-motion: reduce){.iwx *{transition:none !important;animation:none !important}}
`;

/* ---------------- helpers ---------------- */
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

const money = (n, cur = "USD") => {
  const v = isFinite(+n) ? +n : 0;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(v); }
  catch { return "$" + v.toFixed(2); }
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, d) => {
  const t = new Date(iso + "T00:00:00");
  t.setDate(t.getDate() + (parseInt(d, 10) || 0));
  return t.toISOString().slice(0, 10);
};
const fmtDate = (iso, style) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (style === "DD/MM/YYYY") return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  if (style === "YYYY-MM-DD") return iso;
  if (style === "Month D, YYYY") return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
};

/* storage: index in one key, each SOP's source file in its own key */
const K_INDEX = "iwx-index";
const K_BRAND = "iwx-branding";
const K_SEQ = "iwx-seq";
const fileKey = (id) => `iwx-file-${id}`;

async function sGet(key, fallback) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : fallback; }
  catch { return fallback; }
}
async function sSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); return true; }
  catch (e) { console.error("storage set failed", e); return false; }
}
async function sDel(key) { try { await window.storage.delete(key); } catch {} }

/* ---------------- AI extraction ---------------- */
const EXTRACT_PROMPT = `You are the rule-extraction stage of an invoice engine. The attached document is an SOP / billing guideline from a property management company or client. Extract every requirement that governs how invoices for this property must be built.

Respond with ONLY minified JSON, no markdown fences, no preamble, exactly this shape (use null when the document doesn't say; keep arrays short and factual):
{"property":{"name":"","aliases":[],"client_company":"","billing_address":""},"format":{"invoice_number_format":"","date_format":"MM/DD/YYYY","currency":"USD","tax_rate_percent":0,"payment_terms":"","due_days":30,"po_required":false,"remit_to":"","delivery_method":"","send_to":""},"required_fields":[],"line_item_rules":[{"category":"","description_rule":"","rate_type":"flat|hourly|per_unit","default_rate":null}],"special_instructions":[]}

Rules: property.name is the property this SOP governs. aliases = other names/codes the property is called. invoice_number_format may contain {SEQ} for the running number and {YYYY}/{MM} for date parts. required_fields = fields the client insists appear on every invoice. special_instructions = anything else the SOP demands (approval steps, photo attachments, threshold limits, formatting demands). Be exhaustive but concise.`;

async function extractRules(base64, mediaType, isPdf) {
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: [block, { type: "text", text: EXTRACT_PROMPT }] }],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Extraction request failed");
  const text = (data.content || []).map((i) => (i.type === "text" ? i.text : "")).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

/* ---------------- default branding ---------------- */
const DEFAULT_BRAND = {
  company: "Your Company",
  tagline: "Property Services",
  logo: null,           // data URL
  primary: "#1F5C4C",
  accent: "#B98A2F",
  address: "",
  email: "",
  phone: "",
};

/* ================================================================ */
export default function InvoiceWizardEngine() {
  const [view, setView] = useState("vault");
  const [sops, setSops] = useState([]);
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [seq, setSeq] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [banner, setBanner] = useState(null); // {kind:'ok'|'err', text}

  /* boot: load persisted state, then honor ?property= from the CRM embed */
  useEffect(() => {
    (async () => {
      const [idx, b, s] = await Promise.all([sGet(K_INDEX, []), sGet(K_BRAND, DEFAULT_BRAND), sGet(K_SEQ, 1)]);
      setSops(idx); setBrand({ ...DEFAULT_BRAND, ...b }); setSeq(s); setLoaded(true);
      try {
        const p = new URLSearchParams(window.location.search).get("property");
        if (p && idx.length) {
          const hit = matchProperty(idx, p);
          if (hit) { setBuilderSopId(hit.id); setView("builder"); }
        }
      } catch {}
    })();
  }, []);

  const persistIndex = async (next) => { setSops(next); await sSet(K_INDEX, next); };

  const flash = (kind, text) => { setBanner({ kind, text }); setTimeout(() => setBanner(null), 6000); };

  /* ---------------- extraction flow ---------------- */
  const [extracting, setExtracting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const isImg = /^image\/(png|jpeg|webp|gif)$/.test(file.type);
    if (!isPdf && !isImg) { flash("err", "Upload a PDF or an image (PNG/JPG) of the SOP."); return; }
    if (file.size > 4 * 1024 * 1024) { flash("err", "File is over 4 MB. Export a smaller PDF or a page image and try again."); return; }
    setExtracting(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Could not read the file"));
        r.readAsDataURL(file);
      });
      const rules = await extractRules(base64, file.type, isPdf);
      const id = uid();
      const entry = {
        id,
        fileName: file.name,
        fileType: file.type,
        addedAt: todayISO(),
        rules,
      };
      const stored = await sSet(fileKey(id), { name: file.name, type: file.type, data: base64 });
      if (!stored) entry.fileMissing = true;
      await persistIndex([entry, ...sops]);
      flash("ok", `Rule created for “${rules?.property?.name || file.name}”. It's now in the vault and live in the invoice builder.`);
      setView("vault");
    } catch (e) {
      console.error(e);
      flash("err", "Extraction failed: " + (e.message || "unknown error") + ". Try a clearer scan or a smaller document.");
    } finally {
      setExtracting(false);
    }
  };

  const deleteSop = async (id) => {
    await persistIndex(sops.filter((s) => s.id !== id));
    await sDel(fileKey(id));
  };

  const openSource = async (id) => {
    const f = await sGet(fileKey(id), null);
    if (!f) { flash("err", "The original document isn't stored for this rule."); return; }
    const url = `data:${f.type};base64,${f.data}`;
    const w = window.open("");
    if (w) {
      w.document.write(f.type === "application/pdf"
        ? `<iframe src="${url}" style="width:100%;height:100vh;border:0"></iframe>`
        : `<img src="${url}" style="max-width:100%">`);
    }
  };

  /* ---------------- builder state ---------------- */
  const [builderSopId, setBuilderSopId] = useState(null);
  const activeSop = useMemo(() => sops.find((s) => s.id === builderSopId) || null, [sops, builderSopId]);
  const [inv, setInv] = useState(null);

  useEffect(() => {
    if (!activeSop) { setInv(null); return; }
    const r = activeSop.rules || {};
    const f = r.format || {};
    const date = todayISO();
    const number = (f.invoice_number_format || "INV-{YYYY}-{SEQ}")
      .replace("{SEQ}", String(seq).padStart(4, "0"))
      .replace("{YYYY}", date.slice(0, 4))
      .replace("{MM}", date.slice(5, 7));
    setInv({
      number,
      date,
      due: addDays(date, f.due_days ?? 30),
      po: "",
      items: (r.line_item_rules || []).slice(0, 3).map((li) => ({
        id: uid(), category: li.category || "", desc: li.description_rule || "", qty: 1, rate: li.default_rate ?? "",
      })),
      notes: (r.special_instructions || []).join("\n"),
    });
  }, [builderSopId, activeSop]);

  const rules = activeSop?.rules || {};
  const fmt = rules.format || {};
  const cur = fmt.currency || "USD";
  const subtotal = (inv?.items || []).reduce((a, i) => a + (+i.qty || 0) * (+i.rate || 0), 0);
  const tax = subtotal * ((+fmt.tax_rate_percent || 0) / 100);
  const total = subtotal + tax;

  const setItem = (id, patch) => setInv((v) => ({ ...v, items: v.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const addItem = () => setInv((v) => ({ ...v, items: [...v.items, { id: uid(), category: "", desc: "", qty: 1, rate: "" }] }));
  const rmItem = (id) => setInv((v) => ({ ...v, items: v.items.filter((i) => i.id !== id) }));

  const printInvoice = async () => {
    const next = seq + 1;
    setSeq(next); await sSet(K_SEQ, next);
    window.print();
  };

  /* ---------------- branding ---------------- */
  const logoRef = useRef(null);
  const saveBrand = async (patch) => {
    const next = { ...brand, ...patch };
    setBrand(next); await sSet(K_BRAND, next);
  };
  const handleLogo = (file) => {
    if (!file || !/^image\//.test(file.type)) return;
    if (file.size > 400 * 1024) { flash("err", "Logo must be under 400 KB. Use a compressed PNG or SVG-as-PNG."); return; }
    const r = new FileReader();
    r.onload = () => saveBrand({ logo: r.result });
    r.readAsDataURL(file);
  };

  /* ---------------- render ---------------- */
  const NAV = [
    ["vault", "SOP Vault", sops.length],
    ["extract", "New SOP → Rule", null],
    ["builder", "Invoice Builder", null],
    ["branding", "Branding", null],
    ["integration", "Halo CRM Embed", null],
  ];

  return (
    <div className="iwx">
      <style>{CSS}</style>

      <aside className="spine no-print">
        <div className="spine-brand">
          <div className="kicker">Invoice Engine</div>
          <h1>{brand.company}</h1>
        </div>
        <nav aria-label="Engine sections">
          {NAV.map(([k, label, count]) => (
            <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
              <span>{label}</span>
              {count !== null && <span className="count">{count}</span>}
            </button>
          ))}
        </nav>
        <div className="spine-foot">
          Every invoice is generated from an SOP rule in the vault — one fixed seed per property.
        </div>
      </aside>

      <main className="main">
        {banner && <div className={`notice no-print ${banner.kind === "err" ? "err" : ""}`}>{banner.text}</div>}
        {!loaded && <div className="card">Loading the vault…</div>}

        {/* ============ VAULT ============ */}
        {loaded && view === "vault" && (
          <>
            <div className="main-head">
              <div>
                <h2>SOP Vault</h2>
                <p>Every guideline document you've uploaded, with the billing rule extracted from it. The builder pulls from here — by property.</p>
              </div>
              <button className="btn" onClick={() => setView("extract")}>+ Add an SOP</button>
            </div>
            {sops.length === 0 && (
              <div className="drop" onClick={() => setView("extract")} role="button" tabIndex={0}
                   onKeyDown={(e) => e.key === "Enter" && setView("extract")}>
                <div className="big">The vault is empty</div>
                <div className="sub">Upload your first SOP guideline document to create a billing rule.</div>
              </div>
            )}
            {sops.map((s) => (
              <VaultRow key={s.id} sop={s}
                onBuild={() => { setBuilderSopId(s.id); setView("builder"); }}
                onSource={() => openSource(s.id)}
                onDelete={() => deleteSop(s.id)} />
            ))}
          </>
        )}

        {/* ============ EXTRACT ============ */}
        {loaded && view === "extract" && (
          <>
            <div className="main-head">
              <div>
                <h2>New SOP → Rule</h2>
                <p>Drop in the property management company's SOP or billing guideline. The engine reads it, extracts every formatting and content requirement, and saves a fixed rule for that property.</p>
              </div>
            </div>
            <div
              className={`drop ${dragOver ? "over" : ""}`}
              role="button" tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
            >
              <div className="big">{extracting ? "Reading the SOP…" : "Drop the SOP here, or click to choose a file"}</div>
              <div className="sub">{extracting ? "Extracting the billing rule — this takes a few seconds." : "PDF or image (PNG/JPG), up to 4 MB. Scanned documents are read with OCR."}</div>
            </div>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }}
                   onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
            <div className="notice" style={{ marginTop: 18 }}>
              After extraction, open the rule in the vault and check it against the source document once. From then on every invoice for that property follows the rule exactly.
            </div>
          </>
        )}

        {/* ============ BUILDER ============ */}
        {loaded && view === "builder" && (
          <>
            <div className="main-head no-print">
              <div>
                <h2>Invoice Builder</h2>
                <p>Pick a property. The engine loads its SOP rule and builds the invoice in the exact required format.</p>
              </div>
              {activeSop && inv && <button className="btn" onClick={printInvoice}>Print / Save as PDF</button>}
            </div>

            <div className="card no-print" style={{ marginBottom: 18 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="prop-sel">Property (SOP rule)</label>
                <select id="prop-sel" value={builderSopId || ""} onChange={(e) => setBuilderSopId(e.target.value || null)}>
                  <option value="">— choose a property —</option>
                  {sops.map((s) => (
                    <option key={s.id} value={s.id}>{s.rules?.property?.name || s.fileName}</option>
                  ))}
                </select>
              </div>
            </div>

            {activeSop && inv && (
              <div className="grid2">
                <div className="card no-print">
                  <h3 style={{ fontSize: 16, marginBottom: 12 }}>Invoice details</h3>
                  <div className="grid2">
                    <div className="field"><label>Invoice #</label>
                      <input className="mono" value={inv.number} onChange={(e) => setInv({ ...inv, number: e.target.value })} /></div>
                    <div className="field"><label>Date</label>
                      <input type="date" value={inv.date} onChange={(e) => setInv({ ...inv, date: e.target.value, due: addDays(e.target.value, fmt.due_days ?? 30) })} /></div>
                    <div className="field"><label>Due</label>
                      <input type="date" value={inv.due} onChange={(e) => setInv({ ...inv, due: e.target.value })} /></div>
                    {fmt.po_required && (
                      <div className="field"><label>PO # (required by SOP)</label>
                        <input value={inv.po} onChange={(e) => setInv({ ...inv, po: e.target.value })} /></div>
                    )}
                  </div>

                  <h3 style={{ fontSize: 16, margin: "10px 0 10px" }}>Line items</h3>
                  {(rules.line_item_rules || []).length > 0 && (
                    <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                      SOP categories: {(rules.line_item_rules || []).map((l) => l.category).filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {inv.items.map((i) => (
                    <div className="li-row" key={i.id}>
                      <input aria-label="Category" placeholder="Category" value={i.category} onChange={(e) => setItem(i.id, { category: e.target.value })} />
                      <input aria-label="Description" placeholder="Description" value={i.desc} onChange={(e) => setItem(i.id, { desc: e.target.value })} />
                      <input aria-label="Quantity" type="number" min="0" step="0.25" placeholder="Qty" value={i.qty} onChange={(e) => setItem(i.id, { qty: e.target.value })} />
                      <input aria-label="Rate" type="number" min="0" step="0.01" placeholder="Rate" value={i.rate} onChange={(e) => setItem(i.id, { rate: e.target.value })} />
                      <button className="x" aria-label="Remove line" onClick={() => rmItem(i.id)}>×</button>
                    </div>
                  ))}
                  <button className="btn ghost small" onClick={addItem}>+ Add line</button>

                  <div className="field" style={{ marginTop: 14 }}>
                    <label>Footer notes (pre-filled from SOP special instructions)</label>
                    <textarea rows={3} value={inv.notes} onChange={(e) => setInv({ ...inv, notes: e.target.value })} />
                  </div>

                  {(rules.required_fields || []).length > 0 && (
                    <div className="notice" style={{ marginTop: 6 }}>
                      SOP requires on every invoice: {(rules.required_fields || []).join(", ")}
                    </div>
                  )}
                </div>

                {/* the client's exact document */}
                <div>
                  <div className="paper-wrap">
                    <div className="paper" style={{ "--brand": brand.primary }}>
                      <div className="inv-head">
                        <div>
                          {brand.logo
                            ? <img src={brand.logo} alt={brand.company + " logo"} style={{ maxHeight: 54, maxWidth: 190, objectFit: "contain" }} />
                            : <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 20 }}>{brand.company}</div>}
                          <div style={{ fontSize: 11.5, color: "#555", marginTop: 6, whiteSpace: "pre-line" }}>
                            {[brand.tagline, brand.address, brand.email, brand.phone].filter(Boolean).join("\n")}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="inv-title">INVOICE</div>
                          <div className="mono" style={{ fontSize: 13, marginTop: 4 }}>{inv.number}</div>
                          <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
                            Date: {fmtDate(inv.date, fmt.date_format)}<br />
                            Due: {fmtDate(inv.due, fmt.date_format)}{fmt.payment_terms ? ` · ${fmt.payment_terms}` : ""}
                            {fmt.po_required && inv.po ? <><br />PO: <span className="mono">{inv.po}</span></> : null}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 40, fontSize: 12.5 }}>
                        <div>
                          <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#777", marginBottom: 3 }}>Bill to</div>
                          <strong>{rules.property?.client_company || rules.property?.name || "—"}</strong>
                          <div style={{ whiteSpace: "pre-line", color: "#444" }}>{rules.property?.billing_address || ""}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#777", marginBottom: 3 }}>Property</div>
                          <strong>{rules.property?.name || "—"}</strong>
                        </div>
                      </div>

                      <table>
                        <thead>
                          <tr><th>Category</th><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr>
                        </thead>
                        <tbody>
                          {inv.items.map((i) => (
                            <tr key={i.id}>
                              <td>{i.category}</td><td>{i.desc}</td>
                              <td className="num">{i.qty}</td>
                              <td className="num">{i.rate === "" ? "" : money(i.rate, cur)}</td>
                              <td className="num">{money((+i.qty || 0) * (+i.rate || 0), cur)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="totals">
                        <div className="row"><span>Subtotal</span><span className="mono">{money(subtotal, cur)}</span></div>
                        {(+fmt.tax_rate_percent || 0) > 0 && (
                          <div className="row"><span>Tax ({fmt.tax_rate_percent}%)</span><span className="mono">{money(tax, cur)}</span></div>
                        )}
                        <div className="row grand"><span>Total due</span><span className="mono">{money(total, cur)}</span></div>
                      </div>

                      {(fmt.remit_to || inv.notes) && (
                        <div className="foot-note">
                          {fmt.remit_to ? `Remit to: ${fmt.remit_to}\n` : ""}
                          {inv.notes}
                        </div>
                      )}
                      <div className="seal">Per SOP · {rules.property?.name || activeSop.fileName}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!activeSop && sops.length === 0 && (
              <div className="notice">No rules in the vault yet — add an SOP first.</div>
            )}
          </>
        )}

        {/* ============ BRANDING ============ */}
        {loaded && view === "branding" && (
          <>
            <div className="main-head">
              <div>
                <h2>Branding</h2>
                <p>Your identity on every invoice the engine produces — logo, colors, and contact block. Saved once, applied everywhere.</p>
              </div>
            </div>
            <div className="grid2">
              <div className="card">
                <div className="field"><label>Company name</label>
                  <input value={brand.company} onChange={(e) => saveBrand({ company: e.target.value })} /></div>
                <div className="field"><label>Tagline / division</label>
                  <input value={brand.tagline} onChange={(e) => saveBrand({ tagline: e.target.value })} /></div>
                <div className="field"><label>Address</label>
                  <textarea rows={2} value={brand.address} onChange={(e) => saveBrand({ address: e.target.value })} /></div>
                <div className="grid2">
                  <div className="field"><label>Email</label>
                    <input value={brand.email} onChange={(e) => saveBrand({ email: e.target.value })} /></div>
                  <div className="field"><label>Phone</label>
                    <input value={brand.phone} onChange={(e) => saveBrand({ phone: e.target.value })} /></div>
                </div>
                <div className="grid2">
                  <div className="field"><label>Primary color</label>
                    <input type="color" value={brand.primary} onChange={(e) => saveBrand({ primary: e.target.value })} style={{ height: 42, padding: 4 }} /></div>
                  <div className="field"><label>Accent color</label>
                    <input type="color" value={brand.accent} onChange={(e) => saveBrand({ accent: e.target.value })} style={{ height: 42, padding: 4 }} /></div>
                </div>
                <div className="field"><label>Logo (PNG/JPG, under 400 KB)</label>
                  <input ref={logoRef} type="file" accept="image/*" onChange={(e) => { handleLogo(e.target.files?.[0]); e.target.value = ""; }} /></div>
                {brand.logo && <button className="btn danger small" onClick={() => saveBrand({ logo: null })}>Remove logo</button>}
              </div>
              <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 220 }}>
                <div style={{ textAlign: "center" }}>
                  {brand.logo
                    ? <img src={brand.logo} alt="Logo preview" style={{ maxHeight: 80, maxWidth: 260, objectFit: "contain" }} />
                    : <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 26 }}>{brand.company}</div>}
                  <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center" }}>
                    <span title="Primary" style={{ width: 34, height: 34, borderRadius: 8, background: brand.primary, display: "inline-block" }} />
                    <span title="Accent" style={{ width: 34, height: 34, borderRadius: 8, background: brand.accent, display: "inline-block" }} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>This is how the invoice header renders.</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ============ INTEGRATION ============ */}
        {loaded && view === "integration" && (
          <>
            <div className="main-head">
              <div>
                <h2>Halo CRM Embed</h2>
                <p>Run the engine inside the Properties section of Halo. The engine recognizes which SOP governs the property and opens its rule automatically.</p>
              </div>
            </div>
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>How recognition works</h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                Open the engine with a <span className="mono">?property=</span> parameter. It's matched against each rule's property name and its aliases (extracted from the SOP), and the Invoice Builder opens pre-loaded with that property's rule. Add extra aliases to a rule from the vault if a property goes by a different name inside Halo.
              </p>
            </div>
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>Embed in Halo (custom tab / iframe)</h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 10 }}>
                In Halo, add a custom tab or custom button on the Property/Site entity that opens this app's URL, injecting Halo's field variable for the site or property name:
              </p>
              <div className="code-block">{`<iframe
  src="https://YOUR-DEPLOYED-URL/?property=$SITENAME"
  style="width:100%; height:100vh; border:0">
</iframe>

// or as a custom button link:
https://YOUR-DEPLOYED-URL/?property=$SITENAME`}</div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
                Replace <span className="mono">$SITENAME</span> with the variable token your Halo instance uses for the property/site field. Deploy this app anywhere that serves it over HTTPS.
              </p>
            </div>
            <div className="card">
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>Test recognition now</h3>
              <RecognitionTester sops={sops} onOpen={(id) => { setBuilderSopId(id); setView("builder"); }} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* ---------------- property matcher ---------------- */
function matchProperty(sops, query) {
  const q = String(query).trim().toLowerCase();
  if (!q) return null;
  for (const s of sops) {
    const names = [s.rules?.property?.name, ...(s.rules?.property?.aliases || [])]
      .filter(Boolean).map((n) => String(n).toLowerCase());
    if (names.some((n) => n === q || n.includes(q) || q.includes(n))) return s;
  }
  return null;
}

/* ---------------- vault row + rule sheet ---------------- */
function VaultRow({ sop, onBuild, onSource, onDelete }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const r = sop.rules || {};
  const f = r.format || {};
  return (
    <div>
      <div className="sop-row">
        <div className="sop-tab" aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <h3>{r.property?.name || sop.fileName}</h3>
          <div className="meta mono">{sop.fileName} · added {sop.addedAt}</div>
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {r.property?.client_company && <span className="pill">{r.property.client_company}</span>}
            {f.payment_terms && <span className="pill brass">{f.payment_terms}</span>}
            {f.po_required && <span className="pill brass">PO required</span>}
          </div>
        </div>
        <div className="actions">
          <button className="btn small" onClick={onBuild}>Build invoice</button>
          <button className="btn ghost small" onClick={() => setOpen(!open)}>{open ? "Hide rule" : "View rule"}</button>
          <button className="btn ghost small" onClick={onSource}>Source doc</button>
          {!confirming
            ? <button className="btn danger small" onClick={() => setConfirming(true)}>Delete</button>
            : <button className="btn danger small" onClick={onDelete}>Confirm delete</button>}
        </div>
      </div>
      {open && (
        <div className="card rule-sheet" style={{ margin: "-4px 0 12px", borderTop: "none", borderRadius: "0 0 10px 10px" }}>
          <dl>
            <dt>Property / aliases</dt>
            <dd>{[r.property?.name, ...(r.property?.aliases || [])].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>Bill to</dt>
            <dd>{r.property?.client_company || "—"}{r.property?.billing_address ? ` — ${r.property.billing_address}` : ""}</dd>
            <dt>Invoice format</dt>
            <dd className="mono">{f.invoice_number_format || "—"} · {f.date_format || "MM/DD/YYYY"} · {f.currency || "USD"} · tax {f.tax_rate_percent || 0}% · due in {f.due_days ?? 30} days</dd>
            <dt>Delivery</dt>
            <dd>{[f.delivery_method, f.send_to, f.remit_to && `remit: ${f.remit_to}`].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>Required fields</dt>
            <dd>{(r.required_fields || []).join(", ") || "—"}</dd>
            <dt>Line item rules</dt>
            <dd>{(r.line_item_rules || []).map((l, i) => (
              <div key={i}>• <strong>{l.category || "General"}</strong>{l.description_rule ? ` — ${l.description_rule}` : ""}{l.default_rate != null ? ` (${l.rate_type || "flat"} ${l.default_rate})` : ""}</div>
            ))}{(r.line_item_rules || []).length === 0 && "—"}</dd>
            <dt>Special instructions</dt>
            <dd>{(r.special_instructions || []).map((s, i) => <div key={i}>• {s}</div>)}{(r.special_instructions || []).length === 0 && "—"}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

/* ---------------- recognition tester ---------------- */
function RecognitionTester({ sops, onOpen }) {
  const [q, setQ] = useState("");
  const hit = matchProperty(sops, q);
  return (
    <div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="rec-test">Property name or alias (as Halo would send it)</label>
        <input id="rec-test" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Aspen Ridge Apartments" />
      </div>
      {q && (hit
        ? <div className="notice">Matched: <strong>{hit.rules?.property?.name}</strong> — <button className="btn small" style={{ marginLeft: 8 }} onClick={() => onOpen(hit.id)}>Open in builder</button></div>
        : <div className="notice err">No rule matches “{q}”. Upload that property's SOP, or add this name as an alias.</div>)}
    </div>
  );
}
