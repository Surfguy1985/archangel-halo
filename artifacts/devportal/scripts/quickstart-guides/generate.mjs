#!/usr/bin/env node
// Generates the three branded one-page quick-start guide PDFs.
// Usage: node generate.mjs   (renders HTML + prints to PDF via system chromium)
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const emblem = path.join(repoRoot, "artifacts/halo/public/pwa-512x512.png");
const outDir = path.join(repoRoot, "artifacts/devportal/public/downloads");
mkdirSync(outDir, { recursive: true });

const NAVY = "#07101E";
const NAVY2 = "#0A1930";
const INK = "#13223A";
const LIME = "#B4FF44";
const GOLD = "#6D9B12";
const PAPER = "#F4F7F9";

const css = `
@page { size: Letter; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 8.5in; height: 11in; }
body {
  font-family: "Plus Jakarta Sans", sans-serif;
  background: ${PAPER}; color: ${INK};
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  display: flex; flex-direction: column;
}
.header {
  background: linear-gradient(135deg, ${NAVY} 0%, ${NAVY2} 60%, ${INK} 100%);
  color: #fff; padding: 0.34in 0.5in 0.30in; display: flex; align-items: center; gap: 0.28in;
}
.header img { width: 0.85in; height: 0.85in; border-radius: 0.14in; background: ${PAPER}; }
.kicker { font-family: Outfit, sans-serif; font-weight: 600; letter-spacing: 0.18em;
  text-transform: uppercase; font-size: 9.5pt; color: ${LIME}; margin-bottom: 4pt; }
h1 { font-family: Outfit, sans-serif; font-weight: 700; font-size: 24pt; line-height: 1.1; }
.sub { font-size: 10pt; color: #C7D2E0; margin-top: 4pt; }
.body { flex: 1; padding: 0.32in 0.5in 0.1in; }
.steps { display: grid; grid-template-columns: 1fr 1fr; gap: 0.16in 0.3in; }
.steps.single { grid-template-columns: 1fr; }
.step { display: flex; gap: 0.14in; align-items: flex-start;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8pt; padding: 0.13in 0.16in; }
.num { flex: none; width: 0.28in; height: 0.28in; border-radius: 50%;
  background: ${LIME}; color: ${NAVY}; font-family: Outfit, sans-serif; font-weight: 700;
  font-size: 11.5pt; display: flex; align-items: center; justify-content: center; }
.step h3 { font-family: Outfit, sans-serif; font-size: 10.5pt; font-weight: 700; color: ${NAVY}; }
.step p { font-size: 8.8pt; line-height: 1.35; color: #3B4A61; margin-top: 2pt; }
.step .es { color: ${GOLD}; font-style: italic; }
.rhythm { margin: 0.22in 0.5in 0; background: ${NAVY}; border-radius: 10pt;
  color: #fff; padding: 0.14in 0.22in; }
.rhythm .label { font-family: Outfit, sans-serif; font-weight: 700; font-size: 9pt;
  letter-spacing: 0.14em; text-transform: uppercase; color: ${LIME}; margin-bottom: 5pt; }
.rhythm .flow { display: flex; align-items: center; flex-wrap: wrap; gap: 5pt; font-size: 9pt; }
.rhythm .flow b { font-weight: 700; color: #fff; }
.rhythm .flow span.arrow { color: ${LIME}; font-weight: 700; }
.footer { padding: 0.16in 0.5in 0.26in; display: flex; justify-content: space-between;
  align-items: center; font-size: 8.5pt; color: #64748B; }
.footer .brand { font-family: Outfit, sans-serif; font-weight: 700; color: ${NAVY}; }
.pill { background: ${LIME}; color: ${NAVY}; font-weight: 700; border-radius: 99pt;
  padding: 2.5pt 9pt; font-size: 8.5pt; font-family: Outfit, sans-serif; }
`;

function page({ kicker, title, sub, steps, single, rhythm, footNote }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Plus+Jakarta+Sans:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>${css}</style></head><body>
<div class="header">
  <img src="file://${emblem}">
  <div>
    <div class="kicker">${kicker}</div>
    <h1>${title}</h1>
    <div class="sub">${sub}</div>
  </div>
</div>
<div class="body"><div class="steps${single ? " single" : ""}">
${steps
  .map(
    (s, i) => `<div class="step"><div class="num">${i + 1}</div><div>
  <h3>${s.h}</h3><p>${s.p}</p>${s.es ? `<p class="es">${s.es}</p>` : ""}</div></div>`,
  )
  .join("\n")}
</div></div>
<div class="rhythm"><div class="label">${rhythm.label}</div>
  <div class="flow">${rhythm.items.map((x) => `<b>${x}</b>`).join('<span class="arrow">&rarr;</span>')}</div>
</div>
<div class="footer">
  <div><span class="brand">HALO &mdash; Archangel Operations</span> &nbsp;&middot;&nbsp; ${footNote}</div>
  <div class="pill">Quick Start</div>
</div>
</body></html>`;
}

const guides = [
  {
    file: "quickstart-office",
    html: page({
      kicker: "Office Team",
      title: "Office Quick-Start Guide",
      sub: "Run the whole operation from the HALO app — phone or desktop.",
      steps: [
        { h: "Unlock HALO and start on Today", p: "Enter the office passcode to sign in. The Today feed is your morning briefing: blockers, margin alerts, jobs that lost a crew, and anything needing a decision." },
        { h: "Create and staff jobs in one step", p: "Use Quick Job to create a job and assign the crew in one sheet — or broadcast it to the job board and let the first crew claim it." },
        { h: "Dispatch and track the day", p: "The dispatch board moves a job's crew, date, and status together. Every job card shows its 5-stage timeline from scheduled to closed out." },
        { h: "Keep money tied to jobs", p: "Every invoice links to a job card. Send invoices with a pay link, and watch payments land on the Money summary." },
        { h: "Scan checks into the filing cabinet", p: "Money &rarr; Scan Check reads the check photo, records the payment against an invoice, and files the image in the searchable Check Files archive." },
        { h: "Message crews — and ping in emergencies", p: "Chat with crews (attachments included) from the crew command center. Use the emergency ping to text every crew for urgent same-day work." },
        { h: "Close out clean", p: "The close-out checklist won't let a job clear until the crew is paid, the client invoice is paid, and the recap summary is sent." },
      ],
      rhythm: { label: "Daily rhythm", items: ["AM: Today feed", "Dispatch crews", "Midday: crew messages &amp; photos", "PM: invoices &amp; checks", "Close out finished jobs"] },
      footNote: "Tip: Settings &rarr; Training Center replays the narrated in-app tour any time.",
    }),
  },
  {
    file: "quickstart-crew",
    html: page({
      kicker: "Crews / Cuadrillas",
      title: "Crew Quick-Start Guide",
      sub: "Everything runs from your portal link. / Todo funciona desde el enlace de tu portal.",
      steps: [
        { h: "Save your portal link", p: "Open the link the office texts you and add it to your home screen. It's your personal portal — no password needed.", es: "Abre el enlace que te env&iacute;a la oficina y agr&eacute;galo a tu pantalla de inicio. Es tu portal personal — sin contrase&ntilde;a." },
        { h: "Check your schedule &amp; route", p: "Your day's jobs appear on the schedule with one-tap directions for the whole route.", es: "Los trabajos del d&iacute;a aparecen en tu agenda con direcciones de un toque para toda la ruta." },
        { h: "Check in and take BEFORE photos", p: "When you arrive, check in at the job and photograph the site before you start.", es: "Al llegar, marca tu entrada y toma fotos del sitio antes de empezar." },
        { h: "Message the office anytime", p: "Questions, problems, or files — send them in the message thread and the office answers there.", es: "Preguntas, problemas o archivos — env&iacute;alos en el chat y la oficina te responde ah&iacute;." },
        { h: "AFTER photos, then check out", p: "Photograph the finished work — check-out asks for after photos so you get credit for the job.", es: "Fotograf&iacute;a el trabajo terminado — la salida pide fotos de despu&eacute;s para que te acrediten el trabajo." },
        { h: "Send your invoice from the portal", p: "Create your invoice right in the portal, link it to the job, and track it until it's paid.", es: "Crea tu factura en el portal, v&iacute;nculala al trabajo y s&iacute;guela hasta que te paguen." },
        { h: "Need help? Open the Guide tab", p: "The Guide tab explains everything in English and Spanish.", es: "La pesta&ntilde;a Gu&iacute;a explica todo en ingl&eacute;s y espa&ntilde;ol." },
      ],
      rhythm: { label: "Daily rhythm / Ritmo diario", items: ["Open portal / Abre el portal", "Route &amp; directions / Ruta", "Check in + before photos / Entrada + fotos", "Work &amp; message / Trabaja y comunica", "After photos + check out / Fotos + salida"] },
      footNote: "Deep link: add ?guide=en or ?guide=es to open the Guide in your language.",
    }),
  },
  {
    file: "quickstart-client",
    html: page({
      kicker: "Clients &amp; Property Managers",
      title: "Client Board Quick-Start Guide",
      sub: "Your live board shows every piece of work at your properties.",
      steps: [
        { h: "Open your board link and sign in", p: "Use the board link from your HALO team. Admins can invite teammates and set each person's permissions from the Access page." },
        { h: "Read the board at a glance", p: "Each card is one piece of work. Lanes show progress left to right — new, in progress, and done. Cards update live as the field team works." },
        { h: "Tap a card for the full story", p: "Details, photos, invoices, and a message thread live on every card. Reply on the card and the office sees it immediately." },
        { h: "Pay right from the card", p: "Cards with an invoice show a Pay button — review the invoice and pay in a few taps. Receipts stay attached to the card." },
        { h: "Request new work from your board", p: "Send a maintenance or work request without leaving the board — it becomes a card the office triages right away." },
        { h: "See your properties on the Units map", p: "The Units and Map pages color-code every unit's status, and the Hub collects documents and updates in one place." },
        { h: "Look back with History", p: "Finished cards auto-archive to History after completion. Search past work anytime or export it all to CSV." },
      ],
      rhythm: { label: "Weekly rhythm", items: ["Scan the board", "Reply on cards", "Approve &amp; pay invoices", "Request new work", "Review History"] },
      footNote: "Tip: add ?present=1 to your board link for a narrated walkthrough for new teammates.",
    }),
  },
];

function findBrowser() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const bin of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      return execSync(`which ${bin}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {}
  }
  throw new Error("No Chromium/Chrome binary found. Set CHROMIUM_PATH to a browser executable.");
}

const chromium = findBrowser();
const tmp = mkdtempSync(path.join(tmpdir(), "halo-quickstart-"));
for (const g of guides) {
  const htmlPath = path.join(tmp, `${g.file}.html`);
  writeFileSync(htmlPath, g.html);
  const pdfPath = path.join(outDir, `halo-${g.file}.pdf`);
  execFileSync(chromium, [
    "--headless", "--no-sandbox", "--disable-gpu",
    "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`,
    "--virtual-time-budget=8000",
    `file://${htmlPath}`,
  ], { stdio: "inherit" });
  console.log("wrote", pdfPath);
}
