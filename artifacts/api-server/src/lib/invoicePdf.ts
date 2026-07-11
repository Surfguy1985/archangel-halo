import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

export interface InvoicePdfLineItem {
  dateOfWork?: string | null;
  unitNo?: string | null;
  typeOfWork: string;
  description?: string | null;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface InvoicePdfCompany {
  name: string;
  tagline?: string | null;
  street: string;
  city: string;
  attn: string;
  phone?: string | null;
  email: string;
}

export interface InvoicePdfData {
  invoiceNo: string;
  company?: InvoicePdfCompany;
  paymentInstructions?: string | null;
  poNumber?: string | null;
  terms?: string | null;
  issuedOn?: string | null;
  dueAt?: string | null;
  billToName?: string | null;
  propertyAddress?: string | null;
  notes?: string | null;
  amount: number;
  lineItems: InvoicePdfLineItem[];
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

const DEFAULT_COMPANY: InvoicePdfCompany = {
  name: "ArchAngel Contractors",
  tagline: "Restoration & make-ready",
  street: "130 N Preston Rd, Suite 334",
  city: "Prosper, TX 75078",
  attn: "ATTN: May Mahboob",
  email: "admin@archangelcontractors.com",
};

interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  // Accept YYYY-MM-DD (date-only) and ISO timestamps; format from parts to
  // avoid timezone drift for date-only values.
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
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

function spaced(s: string): string {
  return s.toUpperCase().split("").join(" ");
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function generateInvoicePdf(
  data: InvoicePdfData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { doc, font, bold, page, y: PAGE_H };
  const COMPANY = data.company ?? DEFAULT_COMPANY;

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;

  // ---- Top gold band ----
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 8,
    width: PAGE_W,
    height: 8,
    color: GOLD,
  });

  ctx.y = PAGE_H - 56;

  // ---- Header: company (FROM) left, INVOICE right ----
  page.drawText(COMPANY.name, {
    x: left,
    y: ctx.y,
    size: 20,
    font: bold,
    color: INK,
  });
  page.drawText(spaced(COMPANY.tagline || "Restoration & make-ready"), {
    x: left,
    y: ctx.y - 15,
    size: 7,
    font: bold,
    color: GOLD_DARK,
  });

  const invLabel = "INVOICE";
  page.drawText(invLabel, {
    x: right - bold.widthOfTextAtSize(invLabel, 26),
    y: ctx.y - 4,
    size: 26,
    font: bold,
    color: GOLD,
  });
  const noLabel = `#${data.invoiceNo}`;
  page.drawText(noLabel, {
    x: right - font.widthOfTextAtSize(noLabel, 11),
    y: ctx.y - 20,
    size: 11,
    font,
    color: SLATE,
  });

  ctx.y -= 44;
  page.drawLine({
    start: { x: left, y: ctx.y },
    end: { x: right, y: ctx.y },
    thickness: 1,
    color: LINE,
  });
  ctx.y -= 26;

  // ---- FROM / BILL TO / INVOICE DETAILS (3 columns) ----
  const colTop = ctx.y;
  const col1 = left;
  const col2 = left + contentW * 0.36;
  const col3 = left + contentW * 0.68;

  const heading = (label: string, x: number, y: number) => {
    page.drawText(spaced(label), {
      x,
      y,
      size: 7,
      font: bold,
      color: GOLD_DARK,
    });
  };
  const lineAt = (
    text: string,
    x: number,
    y: number,
    opts?: { bold?: boolean; color?: ReturnType<typeof rgb>; size?: number },
  ) => {
    page.drawText(text, {
      x,
      y,
      size: opts?.size ?? 9.5,
      font: opts?.bold ? bold : font,
      color: opts?.color ?? INK,
    });
  };

  // FROM
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

  // BILL TO
  heading("Bill To", col2, colTop);
  let y2 = colTop - 15;
  lineAt(data.billToName || "Client", col2, y2, { bold: true });
  y2 -= 13;
  for (const ln of wrap(
    data.propertyAddress || "—",
    font,
    9.5,
    contentW * 0.3,
  )) {
    lineAt(ln, col2, y2, { color: SLATE });
    y2 -= 12;
  }

  // INVOICE DETAILS
  heading("Invoice Details", col3, colTop);
  let y3 = colTop - 15;
  const detail = (k: string, v: string) => {
    lineAt(k, col3, y3, { color: SLATE, size: 8.5 });
    const vw = font.widthOfTextAtSize(v, 9);
    lineAt(v, right - vw, y3, { bold: true, size: 9 });
    y3 -= 14;
  };
  detail("Invoice #", data.invoiceNo);
  detail("PO Number", data.poNumber || "—");
  detail("Invoice Date", fmtDate(data.issuedOn));
  detail("Terms", data.terms || "Net 30");
  detail("Due Date", fmtDate(data.dueAt));

  ctx.y = Math.min(y1, y2, y3) - 12;

  // ---- Property address banner ----
  const bannerH = 26;
  page.drawRectangle({
    x: left,
    y: ctx.y - bannerH,
    width: contentW,
    height: bannerH,
    color: PAPER,
    borderColor: LINE,
    borderWidth: 0.75,
  });
  lineAt(
    `PROPERTY: ${data.propertyAddress || "—"}`,
    left + 12,
    ctx.y - 17,
    { bold: true, size: 8.5, color: GOLD_DARK },
  );
  ctx.y -= bannerH + 22;

  // ---- Line items table ----
  const cols = {
    date: left,
    unit: left + contentW * 0.16,
    type: left + contentW * 0.26,
    qty: left + contentW * 0.66,
    price: left + contentW * 0.78,
    amount: right,
  };
  const headerY = ctx.y;
  page.drawRectangle({
    x: left,
    y: headerY - 18,
    width: contentW,
    height: 18,
    color: INK,
  });
  const th = (t: string, x: number, rightAlign = false) => {
    const label = spaced(t);
    const w = rightAlign ? bold.widthOfTextAtSize(label, 7) : 0;
    page.drawText(label, {
      x: x - w,
      y: headerY - 12.5,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    });
  };
  th("Date", cols.date + 6);
  th("Unit", cols.unit);
  th("Type of Work", cols.type);
  th("Qty", cols.qty + 8, true);
  th("Unit Price", cols.price + 26, true);
  th("Amount", cols.amount - 6, true);

  ctx.y = headerY - 18;

  const items = data.lineItems.length
    ? data.lineItems
    : [
        {
          typeOfWork: "Services rendered",
          qty: 1,
          unitPrice: data.amount,
          amount: data.amount,
          dateOfWork: null,
          unitNo: null,
          description: null,
        },
      ];

  items.forEach((it, idx) => {
    const descLines = it.description
      ? wrap(it.description, font, 8, contentW * 0.38)
      : [];
    const rowH = 20 + descLines.length * 10;
    if (idx % 2 === 1) {
      page.drawRectangle({
        x: left,
        y: ctx.y - rowH,
        width: contentW,
        height: rowH,
        color: ROW_ALT,
      });
    }
    const textY = ctx.y - 14;
    lineAt(fmtDate(it.dateOfWork), cols.date + 6, textY, {
      size: 8.5,
      color: SLATE,
    });
    lineAt(it.unitNo || "—", cols.unit, textY, { size: 8.5 });
    lineAt(it.typeOfWork, cols.type, textY, { bold: true, size: 9 });
    const qtyStr = String(it.qty);
    lineAt(qtyStr, cols.qty + 8 - font.widthOfTextAtSize(qtyStr, 8.5), textY, {
      size: 8.5,
    });
    const priceStr = money(it.unitPrice);
    lineAt(
      priceStr,
      cols.price + 26 - font.widthOfTextAtSize(priceStr, 8.5),
      textY,
      { size: 8.5 },
    );
    const amtStr = money(it.amount);
    lineAt(amtStr, cols.amount - 6 - bold.widthOfTextAtSize(amtStr, 9), textY, {
      bold: true,
      size: 9,
    });
    let dy = textY - 11;
    for (const dl of descLines) {
      lineAt(dl, cols.type, dy, { size: 8, color: FAINT });
      dy -= 10;
    }
    ctx.y -= rowH;
    page.drawLine({
      start: { x: left, y: ctx.y },
      end: { x: right, y: ctx.y },
      thickness: 0.5,
      color: LINE,
    });
  });

  // ---- Totals ----
  ctx.y -= 14;
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const totalsX = left + contentW * 0.6;
  const totalRow = (
    label: string,
    value: string,
    opts?: { big?: boolean },
  ) => {
    const size = opts?.big ? 13 : 9.5;
    lineAt(spaced(label), totalsX, ctx.y, {
      bold: true,
      size: opts?.big ? 9 : 7.5,
      color: opts?.big ? INK : SLATE,
    });
    const vw = bold.widthOfTextAtSize(value, size);
    lineAt(value, right - vw, ctx.y - (opts?.big ? 2 : 0), {
      bold: true,
      size,
      color: opts?.big ? GOLD_DARK : INK,
    });
  };
  totalRow("Subtotal", money(subtotal));
  ctx.y -= 20;
  page.drawLine({
    start: { x: totalsX, y: ctx.y + 8 },
    end: { x: right, y: ctx.y + 8 },
    thickness: 0.75,
    color: LINE,
  });
  ctx.y -= 6;
  totalRow("Total Due", money(subtotal), { big: true });
  ctx.y -= 34;

  // ---- Payment terms & details ----
  page.drawLine({
    start: { x: left, y: ctx.y + 8 },
    end: { x: right, y: ctx.y + 8 },
    thickness: 0.5,
    color: LINE,
  });
  heading("Payment Terms & Details", left, ctx.y - 6);
  ctx.y -= 22;
  const termsLine =
    `This invoice is issued on ${data.terms || "Net 30"} terms` +
    (data.dueAt ? ` — payment is due by ${fmtDate(data.dueAt)}` : "") +
    ".";
  const instructions =
    data.paymentInstructions?.trim() ||
    "Payment may be issued by check or ACH/bank transfer to the remittance information on file.";
  for (const ln of wrap(`${termsLine} ${instructions}`, font, 9, contentW)) {
    lineAt(ln, left, ctx.y, { color: SLATE, size: 9 });
    ctx.y -= 12;
  }

  if (data.notes) {
    ctx.y -= 8;
    heading("Notes", left, ctx.y);
    ctx.y -= 14;
    for (const ln of wrap(data.notes, font, 9, contentW)) {
      lineAt(ln, left, ctx.y, { color: SLATE, size: 9 });
      ctx.y -= 12;
    }
  }

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
  const foot = COMPANY.email;
  page.drawText(foot, {
    x: right - font.widthOfTextAtSize(foot, 7.5),
    y: MARGIN + 8,
    size: 7.5,
    font,
    color: FAINT,
  });

  return doc.save();
}
