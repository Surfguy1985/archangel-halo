import { jsPDF } from "jspdf";

export type InvoicePdfLine = {
  dateOfWork: string;
  unitNo: string;
  typeOfWork: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type InvoicePdfData = {
  fromCompany: string;
  fromTrade?: string;
  fromAddress?: string;
  fromCityStateZip?: string;
  fromContact?: string;
  fromPhone?: string;
  fromEmail?: string;
  invoiceNo?: string;
  poNumber?: string;
  invoiceDate: string;
  terms?: string;
  dueDate?: string;
  propertyAddress: string;
  lines: InvoicePdfLine[];
  subtotal: number;
  total: number;
  signatureName?: string;
};

const INK = "#17181C";
const MUTED = "#6B6E76";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(d?: string): string {
  if (!d) return "";
  const [y, m, dd] = d.split("-").map(Number);
  if (!y || !m || !dd) return d;
  return new Date(y, m - 1, dd).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function buildInvoicePdf(data: InvoicePdfData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const left = 54;
  const right = 558;
  let y = 60;

  // Header
  doc.setTextColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("SUBCONTRACTOR INVOICE", left, y);
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.setFont("helvetica", "normal");
  doc.text("Archangel Ventures LLC · HALO", right, y, { align: "right" });
  y += 10;
  doc.setDrawColor(23, 24, 28);
  doc.setLineWidth(1.4);
  doc.line(left, y, right, y);
  y += 24;

  // FROM / BILL TO columns
  const colY = y;
  const label = (t: string, x: number, yy: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(MUTED);
    doc.text(t.toUpperCase(), x, yy);
  };
  const bodyLine = (t: string, x: number, yy: number, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(INK);
    doc.text(t, x, yy);
  };

  label("From", left, colY);
  let fy = colY + 15;
  const fromLines = [
    { t: data.fromCompany, b: true },
    { t: data.fromTrade },
    { t: data.fromAddress },
    { t: data.fromCityStateZip },
    { t: data.fromContact },
    { t: data.fromPhone },
    { t: data.fromEmail },
  ].filter((l) => l.t && l.t.trim());
  for (const l of fromLines) {
    bodyLine(l.t!.trim(), left, fy, !!l.b);
    fy += 14;
  }

  const billX = 330;
  label("Bill To", billX, colY);
  let by = colY + 15;
  const billLines = [
    { t: "Archangel Ventures LLC", b: true },
    { t: "ATTN: May Mahboob" },
    { t: "130 N Preston Rd, Suite 334" },
    { t: "Prosper, TX 75078" },
    { t: "Admin@archangelcontractors.com" },
  ];
  for (const l of billLines) {
    bodyLine(l.t, billX, by, !!l.b);
    by += 14;
  }

  y = Math.max(fy, by) + 14;

  // Invoice details strip
  doc.setFillColor(245, 245, 243);
  doc.roundedRect(left, y, right - left, 46, 6, 6, "F");
  const details: [string, string][] = [
    ["Invoice #", data.invoiceNo || "—"],
    ["PO Number", data.poNumber || "—"],
    ["Invoice Date", fmtDate(data.invoiceDate)],
    ["Terms", data.terms || "—"],
    ["Due Date", fmtDate(data.dueDate) || "—"],
  ];
  const cellW = (right - left) / details.length;
  details.forEach(([k, v], i) => {
    const x = left + 12 + i * cellW;
    label(k, x, y + 17);
    bodyLine(v, x, y + 33);
  });
  y += 64;

  // Property address
  label("Property Address", left, y);
  y += 15;
  bodyLine(data.propertyAddress, left, y, true);
  y += 24;

  // Line items table
  const cols = [
    { t: "Date of Work", x: left, w: 78 },
    { t: "Unit #", x: left + 82, w: 52 },
    { t: "Type of Work", x: left + 138, w: 210 },
    { t: "Qty", x: left + 356, w: 40, r: true },
    { t: "Unit Price", x: left + 420, w: 62, r: true },
    { t: "Amount", x: right, w: 0, r: true },
  ];
  doc.setFillColor(23, 24, 28);
  doc.rect(left, y, right - left, 20, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  for (const c of cols) {
    doc.text(c.t.toUpperCase(), c.r ? (c.w ? c.x + c.w : c.x) : c.x + 4, y + 13, {
      align: c.r ? "right" : "left",
    });
  }
  y += 20;

  doc.setTextColor(INK);
  for (const l of data.lines) {
    const typeWrapped = doc.splitTextToSize(l.typeOfWork, 205) as string[];
    const rowH = Math.max(20, typeWrapped.length * 12 + 8);
    if (y + rowH > 700) {
      doc.addPage();
      y = 60;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(fmtDate(l.dateOfWork), left + 4, y + 13);
    doc.text(l.unitNo || "—", left + 86, y + 13);
    doc.text(typeWrapped, left + 142, y + 13);
    doc.text(String(l.qty), left + 396, y + 13, { align: "right" });
    doc.text(money(l.unitPrice), left + 482, y + 13, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(money(l.amount), right, y + 13, { align: "right" });
    y += rowH;
    doc.setDrawColor(225);
    doc.setLineWidth(0.6);
    doc.line(left, y, right, y);
  }

  // Totals
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(MUTED);
  doc.text("Subtotal", left + 380, y);
  doc.setTextColor(INK);
  doc.text(money(data.subtotal), right, y, { align: "right" });
  y += 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("TOTAL DUE", left + 380, y);
  doc.text(money(data.total), right, y, { align: "right" });
  y += 26;

  if (data.terms) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(MUTED);
    doc.text(`Payment terms: ${data.terms}`, left, y);
    y += 14;
  }

  if (data.signatureName) {
    y += 10;
    doc.setDrawColor(150);
    doc.line(left, y, left + 220, y);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(INK);
    doc.text(data.signatureName, left, y - 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(MUTED);
    doc.text("Signature", left, y + 11);
  }

  return doc;
}

export function invoicePdfFileName(data: InvoicePdfData): string {
  const tag = (data.invoiceNo || data.invoiceDate || "invoice")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const company = data.fromCompany
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `invoice-${company || "crew"}-${tag || "draft"}.pdf`;
}

export function downloadInvoicePdf(data: InvoicePdfData): void {
  buildInvoicePdf(data).save(invoicePdfFileName(data));
}

export function invoicePdfFile(data: InvoicePdfData): File {
  const blob = buildInvoicePdf(data).output("blob");
  return new File([blob], invoicePdfFileName(data), { type: "application/pdf" });
}
