// Client hub built-in documents: per-property price list + client board
// tutorial one-pager. Styled to match bidPdf.ts.
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;

const GOLD = rgb(0.725, 0.541, 0.184);
const GOLD_DARK = rgb(0.561, 0.416, 0.122);
const INK = rgb(0.09, 0.094, 0.11);
const SLATE = rgb(0.42, 0.42, 0.44);
const FAINT = rgb(0.62, 0.62, 0.64);
const LINE = rgb(0.86, 0.86, 0.88);
const ROW_ALT = rgb(0.972, 0.965, 0.945);

// pdf-lib standard fonts are WinAnsi-only; map common typography, strip the rest.
function safe(s: string): string {
  const mapped = s
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u00B7]/g, "\u00B7");
  return mapped.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "").trim() || "-";
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function spaced(s: string): string {
  return s.toUpperCase().split("").join(" ");
}
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) { out.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [""];
}

interface DocShellCtx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
}

async function startDoc(companyNameRaw: string, docLabel: string, subtitle: string): Promise<DocShellCtx> {
  const companyName = safe(companyNameRaw);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: GOLD });
  let y = PAGE_H - 56;
  page.drawText(companyName, { x: MARGIN, y, size: 20, font: bold, color: INK });
  const lab = docLabel.toUpperCase();
  page.drawText(lab, {
    x: PAGE_W - MARGIN - bold.widthOfTextAtSize(lab, 22),
    y: y - 2,
    size: 22,
    font: bold,
    color: GOLD,
  });
  page.drawText(spaced(subtitle), { x: MARGIN, y: y - 16, size: 7, font: bold, color: GOLD_DARK });
  y -= 40;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: LINE });
  y -= 26;
  return { doc, font, bold, page, y };
}

export interface PriceListRow {
  service: string;
  detail?: string | null;
  unit?: string | null;
  rate: number;
}

export async function generatePriceListPdf(opts: {
  companyName: string;
  propertyName: string;
  items: PriceListRow[];
}): Promise<Uint8Array> {
  const ctx = await startDoc(opts.companyName, "Price List", "Agreed service pricing");
  const companyName = safe(opts.companyName);
  const propertyName = safe(opts.propertyName);
  const items = opts.items.map((i) => ({
    service: safe(i.service),
    detail: i.detail ? safe(i.detail) : null,
    unit: i.unit ? safe(i.unit) : null,
    rate: i.rate,
  }));
  const { doc, font, bold } = ctx;
  let { page, y } = ctx;
  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;

  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: GOLD });
      y = PAGE_H - 48;
    }
  };

  // Property banner
  const bannerH = 26;
  page.drawRectangle({ x: left, y: y - bannerH, width: contentW, height: bannerH, color: ROW_ALT, borderColor: LINE, borderWidth: 0.75 });
  page.drawText(`PROPERTY: ${propertyName}`.slice(0, 110), { x: left + 12, y: y - 17, size: 8.5, font: bold, color: GOLD_DARK });
  y -= bannerH + 20;

  if (!items.length) {
    page.drawText("No price list has been set up for this property yet.", { x: left, y, size: 10, font, color: SLATE });
    page.drawText("Contact your account manager and we'll get one on file.", { x: left, y: y - 14, size: 10, font, color: SLATE });
  } else {
    // Table header
    const cols = { service: left, unit: left + contentW * 0.66, rate: right };
    page.drawRectangle({ x: left, y: y - 18, width: contentW, height: 18, color: INK });
    const th = (t: string, x: number, rightAlign = false) => {
      const l = spaced(t);
      const w = rightAlign ? bold.widthOfTextAtSize(l, 7) : 0;
      page.drawText(l, { x: x - w, y: y - 12.5, size: 7, font: bold, color: rgb(1, 1, 1) });
    };
    th("Service", cols.service + 6);
    th("Unit", cols.unit + 20, true);
    th("Rate", cols.rate - 6, true);
    y -= 18;

    items.forEach((it, idx) => {
      const descLines = it.detail ? wrap(it.detail, font, 8, contentW * 0.55) : [];
      const rowH = 20 + descLines.length * 10;
      ensure(rowH + 4);
      if (idx % 2 === 1) page.drawRectangle({ x: left, y: y - rowH, width: contentW, height: rowH, color: ROW_ALT });
      const textY = y - 14;
      page.drawText(it.service, { x: cols.service + 6, y: textY, size: 9, font: bold, color: INK });
      const unitStr = it.unit || "each";
      page.drawText(unitStr, { x: cols.unit + 20 - font.widthOfTextAtSize(unitStr, 8.5), y: textY, size: 8.5, font, color: SLATE });
      const rateStr = money(it.rate);
      page.drawText(rateStr, { x: cols.rate - 6 - bold.widthOfTextAtSize(rateStr, 9), y: textY, size: 9, font: bold, color: GOLD_DARK });
      let dy = textY - 11;
      for (const dl of descLines) {
        page.drawText(dl, { x: cols.service + 6, y: dy, size: 8, font, color: FAINT });
        dy -= 10;
      }
      y -= rowH;
      page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
    });

    y -= 20;
    ensure(30);
    for (const ln of wrap(
      "Pricing above reflects your agreed per-service rates. Quantities are billed as performed; anything not listed is quoted before work begins.",
      font, 8.5, contentW,
    )) {
      page.drawText(ln, { x: left, y, size: 8.5, font, color: SLATE });
      y -= 11;
    }
  }

  // Footer
  page.drawLine({ start: { x: left, y: MARGIN + 22 }, end: { x: right, y: MARGIN + 22 }, thickness: 0.5, color: LINE });
  page.drawText(`${companyName} · ${propertyName}`, { x: left, y: MARGIN + 8, size: 7.5, font, color: FAINT });
  return doc.save();
}

export async function generateBoardTutorialPdf(companyName: string): Promise<Uint8Array> {
  const ctx = await startDoc(companyName, "Quick Guide", "Your client board in one page");
  const { doc, font, bold } = ctx;
  const page = ctx.page;
  let y = ctx.y;
  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;

  const section = (title: string, body: string) => {
    page.drawText(spaced(title), { x: left, y, size: 7.5, font: bold, color: GOLD_DARK });
    y -= 15;
    for (const ln of wrap(body, font, 9.5, contentW)) {
      page.drawText(ln, { x: left, y, size: 9.5, font, color: INK });
      y -= 13;
    }
    y -= 10;
  };

  section(
    "What the board is",
    "Your board is a live view of everything we're doing at your property. Every card is a real update — a job in progress, an invoice, a completed walk, or an alert that needs your eyes. It updates automatically; there's nothing to refresh or install.",
  );
  section(
    "Reading the rails",
    "Cards flow left to right through five rails: Requests, Scheduled, In Progress, Billing, and Alerts. A card in Billing means an invoice is ready for you; a card in Alerts means something needs a decision. Tap any card to open the full detail — photos, notes, and actions.",
  );
  section(
    "Requesting work",
    "Tap Request Work to start a new job. Pick the service, unit, and any notes or photos — or, if we've sent you a bid, type the bid number (B-xxxx) at the top and everything fills in for you. Emergencies skip the PO requirement and get flagged to the office immediately.",
  );
  section(
    "Paying invoices",
    "When an invoice card appears, open it and tap Pay — you can pay online or mark that a check is on its way. Invoices always tie back to the job card they came from, so the paper trail stays in one place.",
  );
  section(
    "The Hub, Units & Map",
    "The Hub (this page's home) keeps quick links, documents like this one and your price list, and your team's contacts. Units shows the live status of every unit at a glance, and the Map gives you a bird's-eye view of the property.",
  );
  section(
    "Need help?",
    "Use Contact Maintenance in the Hub for anything urgent, or reply to any card with a message — the office sees it right away.",
  );

  page.drawLine({ start: { x: left, y: MARGIN + 22 }, end: { x: right, y: MARGIN + 22 }, thickness: 0.5, color: LINE });
  page.drawText(`${companyName} · Client board quick guide`, { x: left, y: MARGIN + 8, size: 7.5, font, color: FAINT });
  return doc.save();
}
