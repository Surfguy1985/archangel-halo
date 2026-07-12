import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { BusinessReport, PropertyReportRow, ReportJobRow } from "./businessReport";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;

const GOLD = rgb(0.725, 0.541, 0.184);
const GOLD_DARK = rgb(0.561, 0.416, 0.122);
const INK = rgb(0.09, 0.094, 0.11);
const SLATE = rgb(0.42, 0.42, 0.44);
const LINE = rgb(0.86, 0.86, 0.88);
const ROW_ALT = rgb(0.972, 0.965, 0.945);
const GREEN = rgb(0.13, 0.5, 0.28);
const RED = rgb(0.72, 0.16, 0.16);

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

function pct(f: number | null): string {
  if (f == null) return "—";
  return `${(f * 100).toFixed(1)}%`;
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

function sectionTitle(ctx: Ctx, title: string): void {
  ensure(ctx, 60);
  ctx.y -= 10;
  ctx.page.drawText(title.toUpperCase(), {
    x: MARGIN,
    y: ctx.y,
    size: 11,
    font: ctx.bold,
    color: GOLD_DARK,
  });
  ctx.y -= 8;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 1,
    color: LINE,
  });
  ctx.y -= 16;
}

function textRight(
  ctx: Ctx,
  text: string,
  xRight: number,
  size: number,
  font: PDFFont,
  color = INK,
): void {
  ctx.page.drawText(text, {
    x: xRight - font.widthOfTextAtSize(text, size),
    y: ctx.y,
    size,
    font,
    color,
  });
}

function propertyBlock(ctx: Ctx, row: PropertyReportRow): void {
  const catLines = row.supplyCategories.length;
  ensure(ctx, 96 + catLines * 11);
  const left = MARGIN;
  const right = PAGE_W - MARGIN;

  ctx.page.drawRectangle({
    x: left - 6,
    y: ctx.y - 4,
    width: right - left + 12,
    height: 18,
    color: ROW_ALT,
  });
  ctx.page.drawText(row.propertyName, {
    x: left,
    y: ctx.y,
    size: 10.5,
    font: ctx.bold,
    color: INK,
  });
  textRight(
    ctx,
    `Net ${money(row.netProfit)}  ·  Margin ${pct(row.marginPct)}`,
    right,
    9.5,
    ctx.bold,
    row.netProfit >= 0 ? GREEN : RED,
  );
  ctx.y -= 16;

  const cols: [string, string][] = [
    ["Revenue (invoiced)", money(row.revenue)],
    ["Collected", money(row.collected)],
    ["Still owed", money(row.outstanding)],
    ["Crew / sub invoices", money(row.laborExpenses)],
    ["Supplies & materials", money(row.suppliesExpenses)],
    ["Jobs", `${row.jobsCompleted} done · ${row.jobsActive} active`],
  ];
  const colW = (right - left) / 3;
  for (let i = 0; i < cols.length; i++) {
    const cx = left + (i % 3) * colW;
    const [label, value] = cols[i];
    ctx.page.drawText(label, {
      x: cx,
      y: ctx.y,
      size: 7.5,
      font: ctx.font,
      color: SLATE,
    });
    ctx.page.drawText(value, {
      x: cx,
      y: ctx.y - 11,
      size: 9.5,
      font: ctx.bold,
      color: INK,
    });
    if (i % 3 === 2) ctx.y -= 28;
  }
  if (cols.length % 3 !== 0) ctx.y -= 28;

  if (row.supplyCategories.length > 0) {
    ctx.page.drawText("Supply spend by category:", {
      x: left,
      y: ctx.y,
      size: 7.5,
      font: ctx.font,
      color: SLATE,
    });
    ctx.y -= 11;
    for (const c of row.supplyCategories) {
      ctx.page.drawText(`•  ${c.category}`, {
        x: left + 8,
        y: ctx.y,
        size: 8.5,
        font: ctx.font,
        color: INK,
      });
      textRight(ctx, money(c.amount), left + 220, 8.5, ctx.font, INK);
      ctx.y -= 11;
    }
  }
  ctx.y -= 10;
}

function jobsTable(ctx: Ctx, jobs: ReportJobRow[], empty: string): void {
  if (jobs.length === 0) {
    ensure(ctx, 20);
    ctx.page.drawText(empty, {
      x: MARGIN,
      y: ctx.y,
      size: 9,
      font: ctx.font,
      color: SLATE,
    });
    ctx.y -= 18;
    return;
  }
  for (const j of jobs) {
    ensure(ctx, 26);
    ctx.page.drawText(`${j.jobNo} — ${j.propertyName}`, {
      x: MARGIN,
      y: ctx.y,
      size: 9.5,
      font: ctx.bold,
      color: INK,
    });
    textRight(
      ctx,
      `${j.grossProfit != null ? money(j.grossProfit) : "—"}  ·  ${pct(j.marginPct)}`,
      PAGE_W - MARGIN,
      9.5,
      ctx.bold,
      (j.marginPct ?? 1) < 0.25 || (j.grossProfit ?? 0) < 0 ? RED : GREEN,
    );
    ctx.y -= 12;
    if (j.description) {
      ctx.page.drawText(j.description.slice(0, 110), {
        x: MARGIN,
        y: ctx.y,
        size: 8,
        font: ctx.font,
        color: SLATE,
      });
      ctx.y -= 12;
    }
    ctx.y -= 4;
  }
}

export async function generateBusinessReportPdf(
  report: BusinessReport,
  insights?: {
    summary: string;
    suggestions: { propertyName?: string | null; title: string; detail: string }[];
  } | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, font, bold, page: doc.addPage([PAGE_W, PAGE_H]), y: 0 };

  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_H - 8,
    width: PAGE_W,
    height: 8,
    color: GOLD,
  });
  ctx.y = PAGE_H - 56;

  ctx.page.drawText("ArchAngel Contractors", {
    x: MARGIN,
    y: ctx.y,
    size: 20,
    font: bold,
    color: INK,
  });
  ctx.page.drawText("B U S I N E S S   R E P O R T", {
    x: MARGIN,
    y: ctx.y - 15,
    size: 7,
    font: bold,
    color: GOLD_DARK,
  });
  const dateLabel = new Date(report.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  textRight(ctx, dateLabel, PAGE_W - MARGIN, 10, font, SLATE);
  ctx.y -= 40;

  // ---- Totals ----
  sectionTitle(ctx, "Business at a glance");
  const t = report.totals;
  const tiles: [string, string][] = [
    ["Revenue (invoiced)", money(t.revenue)],
    ["Collected", money(t.collected)],
    ["Still owed", money(t.outstanding)],
    ["Crew / sub invoices", money(t.laborExpenses)],
    ["Supplies & materials", money(t.suppliesExpenses)],
    ["Total expenses", money(t.totalExpenses)],
    ["Net profit", money(t.netProfit)],
    ["Overall margin", pct(t.marginPct)],
    ["Jobs", `${t.jobsCompleted} done · ${t.jobsActive} active`],
  ];
  const colW = (PAGE_W - MARGIN * 2) / 3;
  for (let i = 0; i < tiles.length; i++) {
    const cx = MARGIN + (i % 3) * colW;
    ctx.page.drawText(tiles[i][0], {
      x: cx,
      y: ctx.y,
      size: 7.5,
      font,
      color: SLATE,
    });
    ctx.page.drawText(tiles[i][1], {
      x: cx,
      y: ctx.y - 13,
      size: 12,
      font: bold,
      color:
        tiles[i][0] === "Net profit"
          ? t.netProfit >= 0
            ? GREEN
            : RED
          : INK,
    });
    if (i % 3 === 2) ctx.y -= 34;
  }
  if (tiles.length % 3 !== 0) ctx.y -= 34;
  ctx.y -= 6;

  // ---- Per property ----
  sectionTitle(ctx, "Property breakdown");
  for (const row of report.properties) propertyBlock(ctx, row);

  // ---- Jobs ----
  sectionTitle(ctx, "Most profitable jobs");
  jobsTable(ctx, report.topJobs, "No jobs with profit tracked yet.");
  sectionTitle(ctx, "Weak jobs (thin or negative margin)");
  jobsTable(ctx, report.weakJobs, "No weak jobs — margins look healthy.");

  // ---- Insights ----
  if (insights) {
    sectionTitle(ctx, "Suggested improvements");
    const wrapText = (s: string, size: number, f: PDFFont): string[] => {
      const maxW = PAGE_W - MARGIN * 2;
      const words = s.split(/\s+/);
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > maxW && cur) {
          lines.push(cur);
          cur = w;
        } else cur = test;
      }
      if (cur) lines.push(cur);
      return lines;
    };
    for (const line of wrapText(insights.summary, 9.5, font)) {
      ensure(ctx, 14);
      ctx.page.drawText(line, {
        x: MARGIN,
        y: ctx.y,
        size: 9.5,
        font,
        color: INK,
      });
      ctx.y -= 13;
    }
    ctx.y -= 6;
    for (const s of insights.suggestions) {
      const detailLines = wrapText(s.detail, 8.5, font);
      ensure(ctx, 18 + detailLines.length * 11);
      const title = s.propertyName ? `${s.propertyName}: ${s.title}` : s.title;
      ctx.page.drawText(`•  ${title}`, {
        x: MARGIN,
        y: ctx.y,
        size: 9.5,
        font: bold,
        color: GOLD_DARK,
      });
      ctx.y -= 13;
      for (const line of detailLines) {
        ctx.page.drawText(line, {
          x: MARGIN + 12,
          y: ctx.y,
          size: 8.5,
          font,
          color: SLATE,
        });
        ctx.y -= 11;
      }
      ctx.y -= 6;
    }
  }

  return doc.save();
}
