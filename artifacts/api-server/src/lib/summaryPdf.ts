import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type {
  SummaryChecklistSection,
  SummaryFlag,
  SummaryPhoto,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;

const GOLD = rgb(0.725, 0.541, 0.184);
const GOLD_DARK = rgb(0.561, 0.416, 0.122);
const INK = rgb(0.09, 0.094, 0.11);
const SLATE = rgb(0.42, 0.42, 0.44);
const LINE = rgb(0.86, 0.86, 0.88);
const RED = rgb(0.725, 0.11, 0.11);
const RED_BG = rgb(0.996, 0.949, 0.949);
const RED_LINE = rgb(0.992, 0.792, 0.792);

export interface CleaningChecklistPdfSection {
  sectionTitle: string;
  items: { label: string; checked: boolean }[];
}

export interface SummaryPdfData {
  title: string;
  unitNumber: string | null;
  serviceDate: string | null;
  crewLead: string | null;
  timeIn: string | null;
  timeOut: string | null;
  checklist: SummaryChecklistSection[];
  /** Archangel Turn Cleaning checklist — included only for cleaning jobs. */
  cleaningChecklist?: {
    sections: CleaningChecklistPdfSection[];
    signedOffBy: string | null;
    signedOffAt: string | null;
    checkedCount: number;
    totalItems: number;
  };
  flags: SummaryFlag[];
  observations: string | null;
  touchUpNotes: string | null;
  overallResult: string;
  photos: SummaryPhoto[];
  propertyName: string | null;
  propertyAddress: string | null;
  business: {
    companyName: string;
    phone: string | null;
    email: string | null;
  };
}

interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
}

function newPage(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_H - 8,
    width: PAGE_W,
    height: 8,
    color: GOLD,
  });
  ctx.y = PAGE_H - 56;
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN) newPage(ctx);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.replace(/\r/g, "").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > width && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${Number(m[1])}`;
}

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

function sectionTitle(ctx: Ctx, title: string): void {
  ensure(ctx, 44);
  ctx.y -= 8;
  ctx.page.drawText(safe(title.toUpperCase()), {
    x: MARGIN,
    y: ctx.y,
    size: 10.5,
    font: ctx.bold,
    color: GOLD_DARK,
  });
  ctx.y -= 7;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 1,
    color: LINE,
  });
  ctx.y -= 14;
}

function para(
  ctx: Ctx,
  text: string,
  opts: { size?: number; color?: ReturnType<typeof rgb>; bold?: boolean; indent?: number; maxWidth?: number } = {},
): void {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.bold : ctx.font;
  const indent = opts.indent ?? 0;
  const width = (opts.maxWidth ?? PAGE_W - MARGIN * 2) - indent;
  for (const chunk of text.split("\n")) {
    for (const line of wrap(safe(chunk) || " ", font, size, width)) {
      ensure(ctx, size + 6);
      ctx.page.drawText(line, {
        x: MARGIN + indent,
        y: ctx.y,
        size,
        font,
        color: opts.color ?? INK,
      });
      ctx.y -= size + 4;
    }
  }
}

async function embedPhoto(
  ctx: Ctx,
  storagePath: string,
): Promise<PDFImage | null> {
  try {
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(storagePath);
    const [buf] = await file.download();
    if (buf[0] === 0x89 && buf[1] === 0x50) return await ctx.doc.embedPng(buf);
    return await ctx.doc.embedJpg(buf);
  } catch (err) {
    logger.warn({ err, storagePath }, "Summary PDF: could not embed photo");
    return null;
  }
}

export async function buildSummaryPdf(data: SummaryPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, font, bold, page: null as unknown as PDFPage, y: 0 };
  newPage(ctx);

  // ---- Header ----
  ctx.page.drawText(safe(data.business.companyName.toUpperCase()), {
    x: MARGIN,
    y: ctx.y,
    size: 10,
    font: bold,
    color: GOLD_DARK,
  });
  ctx.y -= 22;
  ctx.page.drawText(safe(data.title), {
    x: MARGIN,
    y: ctx.y,
    size: 20,
    font: bold,
    color: INK,
  });
  ctx.y -= 16;
  const sub = [
    data.propertyName,
    data.unitNumber ? `Unit ${data.unitNumber}` : null,
    data.serviceDate ? fmtDate(data.serviceDate) : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (sub) {
    ctx.page.drawText(safe(sub), { x: MARGIN, y: ctx.y, size: 10.5, font, color: SLATE });
  }
  ctx.y -= 18;

  // ---- Info grid (two columns of label/value) ----
  const info: [string, string][] = [
    ["Property / site", data.propertyName ?? "—"],
    ["Unit #", data.unitNumber ?? "—"],
    ["Location", data.propertyAddress ?? "—"],
    ["Service date", fmtDate(data.serviceDate)],
    ["Crew lead", data.crewLead ?? "—"],
    ["Time in / out", [data.timeIn, data.timeOut].filter(Boolean).join(" – ") || "—"],
  ];
  const colW = (PAGE_W - MARGIN * 2 - 20) / 2;
  ensure(ctx, 3 * 30 + 10);
  const gridTop = ctx.y;
  for (let i = 0; i < info.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (colW + 20);
    const y = gridTop - row * 30;
    ctx.page.drawText(info[i]![0].toUpperCase(), { x, y, size: 7.5, font: bold, color: SLATE });
    const value = wrap(safe(info[i]![1]), font, 10, colW)[0] ?? "—";
    ctx.page.drawText(value, { x, y: y - 12, size: 10, font: bold, color: INK });
  }
  ctx.y = gridTop - 3 * 30 - 4;

  // ---- Checklist in columns ----
  sectionTitle(ctx, "Completed checklist");
  const sections = data.checklist.filter((s) => s.items.some((i) => i.checked));
  const nCols = Math.min(3, Math.max(1, sections.length));
  const cW = (PAGE_W - MARGIN * 2 - (nCols - 1) * 14) / nCols;
  for (let start = 0; start < sections.length; start += nCols) {
    const rowSecs = sections.slice(start, start + nCols);
    // Measure needed height for this row of columns.
    const colHeights = rowSecs.map((sec) => {
      let h = 16;
      for (const it of sec.items.filter((i) => i.checked)) {
        h += wrap(safe(it.label), font, 8.5, cW - 12).length * 11 + 2;
      }
      return h;
    });
    const rowH = Math.max(...colHeights);
    ensure(ctx, rowH + 8);
    const top = ctx.y;
    rowSecs.forEach((sec, ci) => {
      const x = MARGIN + ci * (cW + 14);
      let y = top;
      ctx.page.drawText(safe(sec.section.toUpperCase()), { x, y, size: 8, font: bold, color: SLATE });
      y -= 14;
      for (const it of sec.items.filter((i) => i.checked)) {
        const lines = wrap(safe(it.label), font, 8.5, cW - 12);
        // Checkmark
        ctx.page.drawLine({ start: { x: x + 1, y: y + 2.5 }, end: { x: x + 3, y: y + 0.5 }, thickness: 1.1, color: GOLD_DARK });
        ctx.page.drawLine({ start: { x: x + 3, y: y + 0.5 }, end: { x: x + 6.5, y: y + 5.5 }, thickness: 1.1, color: GOLD_DARK });
        for (let li = 0; li < lines.length; li++) {
          ctx.page.drawText(lines[li]!, { x: x + 11, y, size: 8.5, font, color: INK });
          y -= 11;
        }
        y -= 2;
      }
    });
    ctx.y = top - rowH;
  }

  // ---- Archangel Turn Cleaning Checklist ----
  if (data.cleaningChecklist && data.cleaningChecklist.sections.length > 0) {
    const cc = data.cleaningChecklist;
    const GREEN = rgb(0.12, 0.55, 0.25);
    const LIGHT_GREEN = rgb(0.9, 0.98, 0.91);
    sectionTitle(ctx, `Turn Cleaning Checklist — ${cc.checkedCount}/${cc.totalItems} items completed`);
    if (cc.signedOffBy) {
      para(ctx, `Signed off by ${cc.signedOffBy}${cc.signedOffAt ? ` on ${new Date(cc.signedOffAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}`, {
        size: 9,
        color: GREEN,
        bold: true,
      });
      ctx.y -= 4;
    }
    for (const sec of cc.sections) {
      const checkedCount = sec.items.filter((i) => i.checked).length;
      ensure(ctx, 20);
      ctx.y -= 4;
      ctx.page.drawText(safe(`${sec.sectionTitle.toUpperCase()}  (${checkedCount}/${sec.items.length})`), {
        x: MARGIN,
        y: ctx.y,
        size: 8.5,
        font: bold,
        color: SLATE,
      });
      ctx.y -= 12;
      const nCols = 2;
      const cW2 = (PAGE_W - MARGIN * 2 - 16) / nCols;
      const secItems = sec.items;
      for (let r = 0; r < secItems.length; r += nCols) {
        const rowItems = secItems.slice(r, r + nCols);
        const rowHeights = rowItems.map((it) => wrap(safe(it.label), font, 8, cW2 - 14).length * 10.5 + 2);
        const rowH = Math.max(...rowHeights, 12);
        ensure(ctx, rowH + 2);
        const top = ctx.y;
        rowItems.forEach((it, ci) => {
          const x = MARGIN + ci * (cW2 + 16);
          const lines = wrap(safe(it.label), font, 8, cW2 - 14);
          if (it.checked) {
            ctx.page.drawRectangle({ x: x - 1, y: top - rowH + 1, width: cW2, height: rowH + 2, color: LIGHT_GREEN });
            ctx.page.drawLine({ start: { x: x + 1.5, y: top - 2 }, end: { x: x + 3.5, y: top - 4.5 }, thickness: 1, color: GREEN });
            ctx.page.drawLine({ start: { x: x + 3.5, y: top - 4.5 }, end: { x: x + 7.5, y: top + 0.5 }, thickness: 1, color: GREEN });
          } else {
            ctx.page.drawRectangle({ x: x + 1, y: top - 5.5, width: 6, height: 6, borderColor: SLATE, borderWidth: 0.8 });
          }
          let y = top;
          for (const line of lines) {
            ctx.page.drawText(line, { x: x + 12, y, size: 8, font, color: it.checked ? GREEN : INK });
            y -= 10.5;
          }
        });
        ctx.y = top - rowH - 2;
      }
      ctx.y -= 6;
    }
    ctx.y -= 4;
  }

  // ---- Red flag box ----
  const flagged = data.flags.filter((f) => f.checked);
  if (flagged.length > 0) {
    const flagLines: string[][] = flagged.map((f) =>
      wrap(safe(f.note ? `${f.label} — ${f.note}` : f.label), font, 9.5, PAGE_W - MARGIN * 2 - 40),
    );
    const bodyH = flagLines.reduce((s, l) => s + l.length * 12 + 3, 0);
    const boxH = 30 + bodyH + 10;
    ensure(ctx, boxH + 14);
    ctx.y -= 6;
    const boxTop = ctx.y;
    ctx.page.drawRectangle({
      x: MARGIN,
      y: boxTop - boxH,
      width: PAGE_W - MARGIN * 2,
      height: boxH,
      color: RED_BG,
      borderColor: RED_LINE,
      borderWidth: 1,
    });
    ctx.page.drawText("WHILE WE WERE THERE, WE NOTICED...", {
      x: MARGIN + 14,
      y: boxTop - 20,
      size: 9.5,
      font: bold,
      color: RED,
    });
    let fy = boxTop - 36;
    for (const lines of flagLines) {
      for (let li = 0; li < lines.length; li++) {
        ctx.page.drawText(li === 0 ? `•  ${lines[li]!}` : lines[li]!, {
          x: MARGIN + 18 + (li === 0 ? 0 : 10),
          y: fy,
          size: 9.5,
          font,
          color: rgb(0.5, 0.08, 0.08),
        });
        fy -= 12;
      }
      fy -= 3;
    }
    ctx.y = boxTop - boxH - 8;
  }

  // ---- Notes ----
  if (data.observations) {
    sectionTitle(ctx, "Additional observations");
    para(ctx, data.observations, { size: 9.5 });
  }
  if (data.touchUpNotes) {
    sectionTitle(ctx, "Touch-up requests");
    para(ctx, data.touchUpNotes, { size: 9.5 });
  }

  // ---- Overall result ----
  const resultLabel =
    data.overallResult === "exceeded"
      ? "Exceeded"
      : data.overallResult === "followup"
        ? "Follow-up needed"
        : "Met scope";
  ensure(ctx, 26);
  ctx.y -= 6;
  ctx.page.drawText("OVERALL RESULT:", { x: MARGIN, y: ctx.y, size: 9, font: bold, color: SLATE });
  ctx.page.drawText(resultLabel, {
    x: MARGIN + 92,
    y: ctx.y,
    size: 10,
    font: bold,
    color: data.overallResult === "followup" ? RED : GOLD_DARK,
  });
  ctx.y -= 16;

  // ---- Before & after photos ----
  if (data.photos.length > 0) {
    sectionTitle(ctx, "Before & after");
    const before = data.photos.filter((p) => p.phase === "before");
    const after = data.photos.filter((p) => p.phase !== "before");
    const half = (PAGE_W - MARGIN * 2 - 16) / 2;
    const rows = Math.max(before.length, after.length);
    for (let r = 0; r < rows; r++) {
      const pair = [before[r] ?? null, after[r] ?? null];
      const imgs = await Promise.all(
        pair.map((p) => (p ? embedPhoto(ctx, p.path) : Promise.resolve(null))),
      );
      const heights = imgs.map((img) =>
        img ? Math.min(190, (img.height / img.width) * half) : 0,
      );
      const rowH = Math.max(...heights, 0);
      if (rowH === 0) continue;
      ensure(ctx, rowH + 26);
      const top = ctx.y;
      imgs.forEach((img, ci) => {
        if (!img) return;
        const scale = Math.min(half / img.width, heights[ci]! / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = MARGIN + ci * (half + 16);
        ctx.page.drawImage(img, { x: x + (half - w) / 2, y: top - h, width: w, height: h });
        ctx.page.drawText(ci === 0 ? "BEFORE" : "AFTER", {
          x: x + half / 2 - 16,
          y: top - rowH - 12,
          size: 7.5,
          font: bold,
          color: SLATE,
        });
      });
      ctx.y = top - rowH - 24;
    }
  }

  // ---- Archangel Promise footer ----
  ensure(ctx, 60);
  ctx.y -= 8;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 1,
    color: LINE,
  });
  ctx.y -= 18;
  const promise =
    "THE ARCHANGEL PROMISE — Not satisfied? We return within 24 hours to make it right. No charge.";
  const pw = bold.widthOfTextAtSize(promise, 9);
  ctx.page.drawText(promise, {
    x: Math.max(MARGIN, (PAGE_W - pw) / 2),
    y: ctx.y,
    size: 9,
    font: bold,
    color: INK,
  });
  ctx.y -= 14;
  const contact = [data.business.companyName, data.business.phone, data.business.email]
    .filter(Boolean)
    .join("  ·  ");
  const cw = font.widthOfTextAtSize(safe(contact), 8.5);
  ctx.page.drawText(safe(contact), {
    x: Math.max(MARGIN, (PAGE_W - cw) / 2),
    y: ctx.y,
    size: 8.5,
    font,
    color: SLATE,
  });

  return doc.save();
}
