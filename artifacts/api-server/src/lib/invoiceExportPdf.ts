/**
 * Entrata-ready invoice PDF. Deterministic pdf-lib — no headless browser.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const INK = rgb(0.027, 0.063, 0.118);
const GOLD = rgb(0.91, 0.765, 0.416);
const SLATE = rgb(0.35, 0.4, 0.45);

export type InvoicePdfInput = {
  invoiceNumber: string;
  propertyCode: string;
  propertyName: string;
  unitNumber: string;
  poNumber: string;
  issuedOn: string;
  subtotalCents: string;
  taxCents: string;
  totalCents: string;
  lines: Array<{
    description: string;
    qty: number;
    unitPriceCents: string;
    extendedCents: string;
    glCode: string | null;
    unitNumber: string;
  }>;
};

function winAnsi(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, (ch) => {
    if (ch === "—" || ch === "–" || ch === "·") return "-";
    return " ";
  });
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  y = heading(page, bold, y, "Unit turn invoice");
  y = line(page, font, y, input.propertyName);
  y = line(page, font, y, `Property ${input.propertyCode}  Unit ${input.unitNumber}`);
  y = line(page, font, y, `Invoice ${input.invoiceNumber}  PO ${input.poNumber || "-"}  ${input.issuedOn}`);
  y -= 8;
  y = line(page, bold, y, "Description                  GL     Qty     Amount");
  for (const row of input.lines) {
    if (y < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    y = line(
      page,
      font,
      y,
      `${row.description}  ${row.glCode ?? "6200"}  ${row.qty}  ${row.extendedCents}c  unit ${row.unitNumber}`,
    );
  }
  y -= 8;
  y = line(page, bold, y, `Total ${input.totalCents} cents`);
  return doc.save();
}

function heading(page: PDFPage, font: PDFFont, y: number, text: string): number {
  page.drawText(winAnsi(text), { x: MARGIN, y, size: 16, font, color: INK });
  page.drawRectangle({ x: MARGIN, y: y - 8, width: 80, height: 2, color: GOLD });
  return y - 28;
}

function line(page: PDFPage, font: PDFFont, y: number, text: string): number {
  page.drawText(winAnsi(text).slice(0, 96), { x: MARGIN, y, size: 10, font, color: SLATE });
  return y - 16;
}
