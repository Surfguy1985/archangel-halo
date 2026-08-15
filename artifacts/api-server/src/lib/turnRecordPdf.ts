/**
 * Unit Turn Record PDF. Deterministic pdf-lib layout — no headless browser.
 * Full = sections 1–9. Move-out condition = 1, 3, 7, 9.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const INK = rgb(0.027, 0.063, 0.118);
const GOLD = rgb(0.91, 0.765, 0.416);
const SLATE = rgb(0.35, 0.4, 0.45);
const LINE = rgb(0.85, 0.86, 0.88);

export type TurnRecordPdfInput = {
  variant: "full" | "move_out_condition";
  propertyName: string;
  unitNumber: string;
  timezone: string;
  daysVacant: number;
  targetTurnDays: number;
  finalCostLabel: string;
  verificationHash: string;
  datesLabel: string;
  timeline: Array<{ stage: string; enteredAt: string; exitedAt: string; duration: string; owner: string }>;
  photos: Array<{ room: string; phase: string; caption: string; bytes: Uint8Array | null }>;
  scopeLines: Array<{ description: string; qty: number; price: string; revision: string }>;
  qcLabel: string;
  attendance: Array<{ type: string; at: string; distance: string }>;
  invoiceLines: Array<{ description: string; amount: string }>;
  poNumber: string;
  complianceScore: string;
  chain: Array<{ id: string; sha256: string; capturedAt: string; receivedAt: string; flags: string }>;
};

export async function renderTurnRecordPdf(input: TurnRecordPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sections = input.variant === "move_out_condition" ? new Set([1, 3, 7, 9]) : new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);

  if (sections.has(1)) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    y = heading(page, bold, y, "Unit turn record");
    y = line(page, font, y, input.propertyName);
    y = line(page, font, y, `Unit ${input.unitNumber}`);
    y = line(page, font, y, input.datesLabel);
    y = line(page, font, y, `Days vacant ${input.daysVacant}  ·  target ${input.targetTurnDays}`);
    y = line(page, font, y, `Final cost ${input.finalCostLabel}`);
    y = line(page, bold, y, `Verification ${input.verificationHash}`);
    if (input.variant === "move_out_condition") {
      y = line(page, font, y, "Move-out condition report — deposit dispute cut");
    }
  }

  if (sections.has(2)) {
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = heading(page, bold, PAGE_H - MARGIN, "Timeline");
    for (const row of input.timeline) {
      if (y < MARGIN + 40) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      y = line(page, bold, y, `${row.stage}  ·  ${row.owner}`);
      y = line(page, font, y, `${row.enteredAt} → ${row.exitedAt}  ·  ${row.duration}`);
    }
  }

  if (sections.has(3)) {
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = heading(page, bold, PAGE_H - MARGIN, "Condition at move-out");
    const before = input.photos.filter((p) => p.phase === "before");
    ({ page, y } = await photoGrid(doc, page, font, y, before));
  }

  if (sections.has(4)) {
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = heading(page, bold, PAGE_H - MARGIN, "Scope approved");
    if (input.scopeLines.length === 0) {
      line(page, font, y, "Scope and pricing land in Segment 6.");
    } else {
      for (const row of input.scopeLines) {
        if (y < MARGIN + 24) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
        }
        y = line(page, font, y, `${row.description}  ×${row.qty}  ${row.price}  (${row.revision})`);
      }
    }
  }

  if (sections.has(5)) {
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = heading(page, bold, PAGE_H - MARGIN, "Work performed");
    const after = input.photos.filter((p) => p.phase === "after" || p.phase === "during");
    await photoGrid(doc, page, font, y, after);
  }

  if (sections.has(6)) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    let y = heading(page, bold, PAGE_H - MARGIN, "QC result");
    line(page, font, y, input.qcLabel);
    const qc = input.photos.filter((p) => p.phase === "qc");
    if (qc.length) await photoGrid(doc, page, font, y - 24, qc);
  }

  if (sections.has(7)) {
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = heading(page, bold, PAGE_H - MARGIN, "Attendance");
    if (input.attendance.length === 0) {
      line(page, font, y, "No GPS check-in recorded.");
    } else {
      for (const row of input.attendance) {
        if (y < MARGIN + 20) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
        }
        y = line(page, font, y, `${row.type}  ${row.at}  ${row.distance}`);
      }
    }
  }

  if (sections.has(8)) {
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = heading(page, bold, PAGE_H - MARGIN, "Invoice");
    y = line(page, font, y, `PO ${input.poNumber || "—"}  ·  compliance ${input.complianceScore || "—"}`);
    if (input.invoiceLines.length === 0) {
      line(page, font, y, "Invoice lines land in Segment 6.");
    } else {
      for (const row of input.invoiceLines) {
        if (y < MARGIN + 20) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
        }
        y = line(page, font, y, `${row.description}  ${row.amount}`);
      }
    }
  }

  if (sections.has(9)) {
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = heading(page, bold, PAGE_H - MARGIN, "Chain of custody");
    for (const row of input.chain) {
      if (y < MARGIN + 48) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      y = line(page, bold, y, row.id);
      y = line(page, font, y, row.sha256);
      y = line(page, font, y, `captured ${row.capturedAt}  received ${row.receivedAt}`);
      if (row.flags) y = line(page, font, y, row.flags);
    }
  }

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

function winAnsi(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, (ch) => {
    if (ch === "—" || ch === "–" || ch === "·") return "-";
    if (ch === "→") return "->";
    return " ";
  });
}

async function photoGrid(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  y: number,
  photos: TurnRecordPdfInput["photos"],
): Promise<{ page: PDFPage; y: number }> {
  if (photos.length === 0) {
    line(page, font, y, "No photos in this section.");
    return { page, y: y - 16 };
  }
  const cell = 120;
  let col = 0;
  for (const photo of photos) {
    if (y - cell < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      col = 0;
    }
    const x = MARGIN + col * (cell + 12);
    if (photo.bytes && photo.bytes.length > 0) {
      try {
        const img = await doc.embedPng(photo.bytes);
        page.drawImage(img, { x, y: y - 96, width: 96, height: 96 });
      } catch {
        page.drawRectangle({ x, y: y - 96, width: 96, height: 96, borderColor: LINE, borderWidth: 1 });
      }
    } else {
      page.drawRectangle({ x, y: y - 96, width: 96, height: 96, borderColor: LINE, borderWidth: 1 });
    }
    page.drawText(winAnsi(`${photo.room} ${photo.phase}`).slice(0, 22), {
      x,
      y: y - 110,
      size: 8,
      font,
      color: SLATE,
    });
    col += 1;
    if (col === 4) {
      col = 0;
      y -= cell;
    }
  }
  if (col !== 0) y -= cell;
  return { page, y };
}
