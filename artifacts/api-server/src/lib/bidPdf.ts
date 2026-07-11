import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

export interface BidPdfLineItem {
  service: string;
  description?: string | null;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface BidPdfCompany {
  name: string;
  tagline?: string | null;
  street: string;
  city: string;
  attn: string;
  phone?: string | null;
  email: string;
}

export interface BidPdfData {
  bidNo: string;
  company: BidPdfCompany;
  paymentInstructions?: string | null;
  preparedForName?: string | null;
  propertyName?: string | null;
  propertyAddress?: string | null;
  unitNo?: string | null;
  scope?: string | null;
  welcomeMessage?: string | null;
  sentAt?: string | null;
  amount: number;
  lineItems: BidPdfLineItem[];
}

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
const PAPER = rgb(0.99, 0.985, 0.972);

function money(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  let y: number, m: number, d: number;
  if (dateOnly) {
    y = Number(dateOnly[1]);
    m = Number(dateOnly[2]);
    d = Number(dateOnly[3]);
  } else {
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return "—";
    y = dt.getFullYear();
    m = dt.getMonth() + 1;
    d = dt.getDate();
  }
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

function spaced(s: string): string {
  return s.toUpperCase().split("").join(" ");
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [""];
}

export async function generateBidPdf(data: BidPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H;

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;
  const COMPANY = data.company;

  const lineAt = (
    text: string,
    x: number,
    yy: number,
    opts?: { bold?: boolean; color?: ReturnType<typeof rgb>; size?: number },
  ) => {
    page.drawText(text, {
      x,
      y: yy,
      size: opts?.size ?? 9.5,
      font: opts?.bold ? bold : font,
      color: opts?.color ?? INK,
    });
  };
  const heading = (label: string, x: number, yy: number) => {
    page.drawText(spaced(label), {
      x,
      y: yy,
      size: 7,
      font: bold,
      color: GOLD_DARK,
    });
  };
  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: GOLD });
      y = PAGE_H - 48;
    }
  };

  // ---- Top gold band ----
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: GOLD });
  y = PAGE_H - 56;

  // ---- Header ----
  page.drawText(COMPANY.name, { x: left, y, size: 20, font: bold, color: INK });
  page.drawText(spaced(COMPANY.tagline || "Restoration & make-ready"), {
    x: left,
    y: y - 15,
    size: 7,
    font: bold,
    color: GOLD_DARK,
  });
  const label = "PROPOSAL";
  page.drawText(label, {
    x: right - bold.widthOfTextAtSize(label, 26),
    y: y - 4,
    size: 26,
    font: bold,
    color: GOLD,
  });
  const noLabel = `#${data.bidNo}`;
  page.drawText(noLabel, {
    x: right - font.widthOfTextAtSize(noLabel, 11),
    y: y - 20,
    size: 11,
    font,
    color: SLATE,
  });

  y -= 44;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: LINE });
  y -= 26;

  // ---- FROM / PREPARED FOR / DETAILS ----
  const colTop = y;
  const col1 = left;
  const col2 = left + contentW * 0.36;
  const col3 = left + contentW * 0.68;

  heading("From", col1, colTop);
  let y1 = colTop - 15;
  lineAt(COMPANY.name, col1, y1, { bold: true });
  y1 -= 13;
  lineAt(COMPANY.street, col1, y1, { color: SLATE });
  y1 -= 12;
  lineAt(COMPANY.city, col1, y1, { color: SLATE });
  y1 -= 12;
  if (COMPANY.phone) {
    lineAt(COMPANY.phone, col1, y1, { color: SLATE, size: 8.5 });
    y1 -= 12;
  }
  lineAt(COMPANY.email, col1, y1, { color: SLATE, size: 8.5 });

  heading("Prepared For", col2, colTop);
  let y2 = colTop - 15;
  lineAt(data.preparedForName || data.propertyName || "Client", col2, y2, { bold: true });
  y2 -= 13;
  if (data.preparedForName && data.propertyName) {
    lineAt(data.propertyName, col2, y2, { color: SLATE });
    y2 -= 12;
  }
  for (const ln of wrap(data.propertyAddress || "—", font, 9.5, contentW * 0.3)) {
    lineAt(ln, col2, y2, { color: SLATE });
    y2 -= 12;
  }
  if (data.unitNo) {
    lineAt(`Unit ${data.unitNo}`, col2, y2, { color: SLATE });
    y2 -= 12;
  }

  heading("Proposal Details", col3, colTop);
  let y3 = colTop - 15;
  const detail = (k: string, v: string) => {
    lineAt(k, col3, y3, { color: SLATE, size: 8.5 });
    const vw = font.widthOfTextAtSize(v, 9);
    lineAt(v, right - vw, y3, { bold: true, size: 9 });
    y3 -= 14;
  };
  detail("Proposal #", data.bidNo);
  detail("Date", fmtDate(data.sentAt ?? new Date().toISOString()));
  detail("Valid For", "30 days");
  detail("Total", money(data.amount));

  y = Math.min(y1, y2, y3) - 12;

  // ---- Property banner ----
  const bannerH = 26;
  page.drawRectangle({
    x: left,
    y: y - bannerH,
    width: contentW,
    height: bannerH,
    color: PAPER,
    borderColor: LINE,
    borderWidth: 0.75,
  });
  const bannerText = `PROPERTY: ${data.propertyName || "—"}${data.propertyAddress ? ` · ${data.propertyAddress}` : ""}`;
  lineAt(bannerText.slice(0, 110), left + 12, y - 17, {
    bold: true,
    size: 8.5,
    color: GOLD_DARK,
  });
  y -= bannerH + 20;

  // ---- Welcome message ----
  if (data.welcomeMessage?.trim()) {
    ensure(80);
    heading("A Note From Us", left, y);
    y -= 15;
    for (const ln of wrap(data.welcomeMessage.trim(), font, 9.5, contentW)) {
      ensure(14);
      lineAt(ln, left, y, { color: SLATE, size: 9.5 });
      y -= 13;
    }
    y -= 8;
  }

  // ---- Scope ----
  if (data.scope?.trim()) {
    ensure(50);
    heading("Scope of Work", left, y);
    y -= 15;
    for (const ln of wrap(data.scope.trim(), font, 9.5, contentW)) {
      ensure(14);
      lineAt(ln, left, y, { color: INK, size: 9.5 });
      y -= 13;
    }
    y -= 8;
  }

  // ---- Breakdown table ----
  ensure(60);
  const cols = {
    service: left,
    qty: left + contentW * 0.62,
    price: left + contentW * 0.76,
    amount: right,
  };
  const headerY = y;
  page.drawRectangle({ x: left, y: headerY - 18, width: contentW, height: 18, color: INK });
  const th = (t: string, x: number, rightAlign = false) => {
    const lab = spaced(t);
    const w = rightAlign ? bold.widthOfTextAtSize(lab, 7) : 0;
    page.drawText(lab, {
      x: x - w,
      y: headerY - 12.5,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    });
  };
  th("Service", cols.service + 6);
  th("Qty", cols.qty + 8, true);
  th("Unit Price", cols.price + 26, true);
  th("Amount", cols.amount - 6, true);
  y = headerY - 18;

  const items = data.lineItems.length
    ? data.lineItems
    : [
        {
          service: data.scope || "Proposed services",
          description: null,
          qty: 1,
          unitPrice: data.amount,
          amount: data.amount,
        },
      ];

  items.forEach((it, idx) => {
    const descLines = it.description
      ? wrap(it.description, font, 8, contentW * 0.5)
      : [];
    const rowH = 20 + descLines.length * 10;
    ensure(rowH + 4);
    if (idx % 2 === 1) {
      page.drawRectangle({ x: left, y: y - rowH, width: contentW, height: rowH, color: ROW_ALT });
    }
    const textY = y - 14;
    lineAt(it.service, cols.service + 6, textY, { bold: true, size: 9 });
    const qtyStr = String(it.qty);
    lineAt(qtyStr, cols.qty + 8 - font.widthOfTextAtSize(qtyStr, 8.5), textY, { size: 8.5 });
    const priceStr = money(it.unitPrice);
    lineAt(priceStr, cols.price + 26 - font.widthOfTextAtSize(priceStr, 8.5), textY, { size: 8.5 });
    const amtStr = money(it.amount);
    lineAt(amtStr, cols.amount - 6 - bold.widthOfTextAtSize(amtStr, 9), textY, { bold: true, size: 9 });
    let dy = textY - 11;
    for (const dl of descLines) {
      lineAt(dl, cols.service + 6, dy, { size: 8, color: FAINT });
      dy -= 10;
    }
    y -= rowH;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
  });

  // ---- Totals ----
  ensure(70);
  y -= 14;
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const totalsX = left + contentW * 0.6;
  const totalRow = (lab: string, value: string, opts?: { big?: boolean }) => {
    const size = opts?.big ? 13 : 9.5;
    lineAt(spaced(lab), totalsX, y, {
      bold: true,
      size: opts?.big ? 9 : 7.5,
      color: opts?.big ? INK : SLATE,
    });
    const vw = bold.widthOfTextAtSize(value, size);
    lineAt(value, right - vw, y - (opts?.big ? 2 : 0), {
      bold: true,
      size,
      color: opts?.big ? GOLD_DARK : INK,
    });
  };
  totalRow("Subtotal", money(subtotal));
  y -= 20;
  page.drawLine({ start: { x: totalsX, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.75, color: LINE });
  y -= 6;
  totalRow("Proposal Total", money(subtotal), { big: true });
  y -= 34;

  // ---- Payment & remittance ----
  ensure(90);
  page.drawLine({ start: { x: left, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.5, color: LINE });
  heading("Payment & Remittance", left, y - 6);
  y -= 22;
  const remit = `Remit to: ${COMPANY.name}, ${COMPANY.street}, ${COMPANY.city} (${COMPANY.attn}).`;
  const instructions =
    data.paymentInstructions?.trim() ||
    "Payment may be issued by check or ACH/bank transfer. Standard invoicing terms are Net 30 upon completion of work.";
  for (const ln of wrap(`${remit} ${instructions}`, font, 9, contentW)) {
    ensure(14);
    lineAt(ln, left, y, { color: SLATE, size: 9 });
    y -= 12;
  }
  y -= 14;

  // ---- Acceptance ----
  ensure(90);
  heading("Acceptance", left, y);
  y -= 16;
  for (const ln of wrap(
    `By signing below, you authorize ${COMPANY.name} to proceed with the work described in this proposal at the pricing shown above.`,
    font,
    9,
    contentW,
  )) {
    lineAt(ln, left, y, { color: SLATE, size: 9 });
    y -= 12;
  }
  y -= 24;
  const sigW = contentW * 0.42;
  page.drawLine({ start: { x: left, y }, end: { x: left + sigW, y }, thickness: 0.75, color: INK });
  page.drawLine({ start: { x: right - sigW, y }, end: { x: right, y }, thickness: 0.75, color: INK });
  lineAt("Authorized signature", left, y - 12, { size: 7.5, color: FAINT });
  lineAt("Date", right - sigW, y - 12, { size: 7.5, color: FAINT });

  // ---- Footer ----
  page.drawLine({
    start: { x: left, y: MARGIN + 22 },
    end: { x: right, y: MARGIN + 22 },
    thickness: 0.5,
    color: LINE,
  });
  page.drawText(`${COMPANY.name} · ${COMPANY.attn}`, {
    x: left,
    y: MARGIN + 8,
    size: 7.5,
    font,
    color: FAINT,
  });
  page.drawText(COMPANY.email, {
    x: right - font.widthOfTextAtSize(COMPANY.email, 7.5),
    y: MARGIN + 8,
    size: 7.5,
    font,
    color: FAINT,
  });

  return doc.save();
}
