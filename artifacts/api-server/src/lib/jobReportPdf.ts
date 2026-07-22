import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  jobsTable,
  propertiesTable,
  crewsTable,
  schedulesTable,
  crewCheckinsTable,
  crewPhotosTable,
  businessSettingsTable,
  type Job,
  type CrewCheckin,
  type CrewPhoto,
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

export interface JobReportData {
  job: Job;
  propertyName: string | null;
  propertyAddress: string | null;
  crewName: string | null;
  crewTrade: string | null;
  businessName: string;
  checkins: (CrewCheckin & { crewName: string | null })[];
  photos: (CrewPhoto & { crewName: string | null })[];
}

export async function gatherJobReport(
  jobId: string,
): Promise<JobReportData | null> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return null;
  const [[property], [settings], checkins, photos, schedules] =
    await Promise.all([
      db
        .select()
        .from(propertiesTable)
        .where(eq(propertiesTable.id, job.propertyId))
        .limit(1),
      db.select().from(businessSettingsTable).limit(1),
      db
        .select()
        .from(crewCheckinsTable)
        .where(eq(crewCheckinsTable.jobId, jobId))
        .orderBy(crewCheckinsTable.createdAt),
      db
        .select()
        .from(crewPhotosTable)
        .where(eq(crewPhotosTable.jobId, jobId))
        .orderBy(crewPhotosTable.createdAt),
      db.select().from(schedulesTable).where(eq(schedulesTable.jobId, jobId)),
    ]);
  const crewIds = Array.from(
    new Set(
      [
        job.crewLeaderId,
        ...schedules.map((s) => s.crewLeaderId),
        ...checkins.map((c) => c.crewId),
        ...photos.map((p) => p.crewId),
      ].filter((v): v is string => !!v),
    ),
  );
  const crews = crewIds.length
    ? await db.select().from(crewsTable).where(inArray(crewsTable.id, crewIds))
    : [];
  const nameOf = new Map(crews.map((c) => [c.id, c.name]));
  const lead = job.crewLeaderId
    ? crews.find((c) => c.id === job.crewLeaderId)
    : null;
  return {
    job,
    propertyName: property?.name ?? null,
    propertyAddress: property?.address ?? null,
    crewName: lead?.name ?? null,
    crewTrade: lead?.trade ?? null,
    businessName: settings?.companyName ?? "ArchAngel Contractors",
    checkins: checkins.map((c) => ({
      ...c,
      crewName: nameOf.get(c.crewId) ?? null,
    })),
    photos: photos.map((p) => ({
      ...p,
      crewName: nameOf.get(p.crewId) ?? null,
    })),
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

function para(
  ctx: Ctx,
  text: string,
  opts: { size?: number; color?: ReturnType<typeof rgb>; bold?: boolean; indent?: number } = {},
): void {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.bold : ctx.font;
  const indent = opts.indent ?? 0;
  const width = PAGE_W - MARGIN * 2 - indent;
  for (const chunk of text.split("\n")) {
    for (const line of wrap(chunk || " ", font, size, width)) {
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

function kv(ctx: Ctx, label: string, value: string): void {
  ensure(ctx, 16);
  ctx.page.drawText(label, {
    x: MARGIN,
    y: ctx.y,
    size: 9,
    font: ctx.bold,
    color: SLATE,
  });
  const lines = wrap(value, ctx.font, 10, PAGE_W - MARGIN * 2 - 150);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      ctx.y -= 13;
      ensure(ctx, 16);
    }
    ctx.page.drawText(lines[i]!, {
      x: MARGIN + 150,
      y: ctx.y,
      size: 10,
      font: ctx.font,
      color: INK,
    });
  }
  ctx.y -= 16;
}

function fmtWhen(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

function gps(c: { lat: number | null; lng: number | null; accuracy: number | null }): string {
  if (c.lat == null || c.lng == null) return "No GPS fix";
  const acc = c.accuracy != null ? ` (±${Math.round(c.accuracy)} m)` : "";
  return `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}${acc}`;
}

async function embedPhoto(
  ctx: Ctx,
  storagePath: string,
): Promise<{ img: PDFImage; w: number; h: number } | null> {
  try {
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(storagePath);
    const [buf] = await file.download();
    let img: PDFImage;
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      img = await ctx.doc.embedPng(buf);
    } else {
      img = await ctx.doc.embedJpg(buf);
    }
    return { img, w: img.width, h: img.height };
  } catch (err) {
    logger.warn({ err, storagePath }, "Job report: could not embed photo");
    return null;
  }
}

async function drawPhotoBlock(
  ctx: Ctx,
  photo: JobReportData["photos"][number],
  x: number,
  boxW: number,
): Promise<number> {
  const loaded = await embedPhoto(ctx, photo.storagePath);
  const imgH = loaded
    ? Math.min(200, (loaded.h / loaded.w) * boxW)
    : 24;
  const metaH = 58;
  const total = imgH + metaH;
  if (loaded) {
    const scale = Math.min(boxW / loaded.w, imgH / loaded.h);
    const w = loaded.w * scale;
    const h = loaded.h * scale;
    ctx.page.drawImage(loaded.img, {
      x: x + (boxW - w) / 2,
      y: ctx.y - h,
      width: w,
      height: h,
    });
  } else {
    ctx.page.drawText("(photo unavailable)", {
      x,
      y: ctx.y - 14,
      size: 9,
      font: ctx.font,
      color: SLATE,
    });
  }
  let my = ctx.y - imgH - 12;
  const meta: string[] = [];
  meta.push(
    `${photo.phase === "before" ? "BEFORE" : photo.phase === "after" ? "AFTER" : "PHOTO"} · ${photo.crewName ?? "Crew"}`,
  );
  meta.push(`Captured: ${fmtWhen(photo.capturedAt ?? photo.createdAt)}`);
  if (photo.lat != null && photo.lng != null) meta.push(`GPS: ${gps(photo)}`);
  if (photo.sha256) meta.push(`SHA-256: ${photo.sha256.slice(0, 32)}…`);
  for (const m of meta) {
    ctx.page.drawText(m.length > 60 ? `${m.slice(0, 60)}…` : m, {
      x,
      y: my,
      size: 7.5,
      font: m.startsWith("SHA-256") ? ctx.font : ctx.font,
      color: SLATE,
    });
    my -= 10;
  }
  return total;
}

export async function buildJobReportPdf(data: JobReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, font, bold, page: null as unknown as PDFPage, y: 0 };
  newPage(ctx);

  const { job } = data;

  // Header
  ctx.page.drawText(data.businessName.toUpperCase(), {
    x: MARGIN,
    y: ctx.y,
    size: 10,
    font: bold,
    color: GOLD_DARK,
  });
  ctx.y -= 20;
  ctx.page.drawText(`Job Completion & Evidence Report — ${job.jobNo}`, {
    x: MARGIN,
    y: ctx.y,
    size: 17,
    font: bold,
    color: INK,
  });
  ctx.y -= 16;
  ctx.page.drawText(`Generated ${fmtWhen(new Date())}`, {
    x: MARGIN,
    y: ctx.y,
    size: 9,
    font,
    color: SLATE,
  });
  ctx.y -= 18;

  sectionTitle(ctx, "Job details");
  kv(ctx, "Job number", job.jobNo);
  if (job.woNo) kv(ctx, "Work order", job.woNo);
  kv(ctx, "Property", [data.propertyName, data.propertyAddress].filter(Boolean).join(" — ") || "—");
  if (job.unitNo) kv(ctx, "Unit", job.unitNo);
  kv(ctx, "Category", job.category ?? "—");
  kv(ctx, "Status", job.status + (job.completedAt ? ` (completed ${fmtWhen(job.completedAt)})` : ""));
  kv(ctx, "Scheduled for", job.scheduledOn ?? "—");
  kv(ctx, "Crew", [data.crewName, data.crewTrade].filter(Boolean).join(" · ") || "—");

  sectionTitle(ctx, "Job description (as assigned)");
  para(ctx, job.description?.trim() || "No description recorded.");

  sectionTitle(ctx, "GPS time on site");
  if (data.checkins.length === 0) {
    para(ctx, "No GPS check-ins recorded for this job.", { color: SLATE });
  } else {
    for (const c of data.checkins) {
      ensure(ctx, 30);
      para(
        ctx,
        `${c.kind === "checkout" ? "CHECK-OUT" : "CHECK-IN"} — ${fmtWhen(c.createdAt)}`,
        { bold: true, size: 9.5 },
      );
      para(ctx, `${c.crewName ?? "Crew"} · ${gps(c)}${c.label ? ` · ${c.label}` : ""}`, {
        size: 9,
        color: SLATE,
        indent: 10,
      });
      ctx.y -= 4;
    }
  }

  const workNotes = data.checkins.filter((c) => c.kind === "checkout" && c.note?.trim());
  sectionTitle(ctx, "Work completed (crew statement)");
  if (workNotes.length === 0) {
    para(ctx, "No completion statement recorded.", { color: SLATE });
  } else {
    for (const c of workNotes) {
      para(ctx, `"${c.note!.trim()}"`);
      para(ctx, `— ${c.crewName ?? "Crew"}, ${fmtWhen(c.createdAt)}`, {
        size: 9,
        color: SLATE,
      });
      ctx.y -= 6;
    }
  }

  // Before / after photos side by side
  const befores = data.photos.filter((p) => p.phase === "before");
  const afters = data.photos.filter((p) => p.phase === "after");
  const others = data.photos.filter((p) => p.phase !== "before" && p.phase !== "after");

  sectionTitle(ctx, "Photo evidence — before & after");
  if (befores.length === 0 && afters.length === 0) {
    para(ctx, "No before/after photos recorded.", { color: SLATE });
  } else {
    const colW = (PAGE_W - MARGIN * 2 - 20) / 2;
    const pairs = Math.max(befores.length, afters.length);
    for (let i = 0; i < pairs; i++) {
      ensure(ctx, 270);
      const startY = ctx.y;
      let used = 0;
      if (befores[i]) {
        used = Math.max(used, await drawPhotoBlock(ctx, befores[i]!, MARGIN, colW));
      }
      if (afters[i]) {
        used = Math.max(used, await drawPhotoBlock(ctx, afters[i]!, MARGIN + colW + 20, colW));
      }
      ctx.y = startY - used - 14;
    }
  }

  if (others.length > 0) {
    sectionTitle(ctx, "Additional photos");
    const colW = (PAGE_W - MARGIN * 2 - 20) / 2;
    for (let i = 0; i < others.length; i += 2) {
      ensure(ctx, 270);
      const startY = ctx.y;
      let used = await drawPhotoBlock(ctx, others[i]!, MARGIN, colW);
      if (others[i + 1]) {
        used = Math.max(
          used,
          await drawPhotoBlock(ctx, others[i + 1]!, MARGIN + colW + 20, colW),
        );
      }
      ctx.y = startY - used - 14;
    }
  }

  // Evidence integrity appendix
  sectionTitle(ctx, "Evidence integrity record");
  para(
    ctx,
    "Each photo below was fingerprinted with SHA-256 at the moment it was uploaded from the crew's device. " +
      "Any alteration to a photo file — even a single pixel — produces a different fingerprint. " +
      "To verify a photo has not been tampered with, recompute its SHA-256 hash and compare it to the value recorded here.",
    { size: 9, color: SLATE },
  );
  ctx.y -= 6;
  if (data.photos.length === 0) {
    para(ctx, "No photos on record.", { color: SLATE });
  } else {
    for (const p of data.photos) {
      ensure(ctx, 40);
      para(
        ctx,
        `${p.phase === "before" ? "BEFORE" : p.phase === "after" ? "AFTER" : "PHOTO"} · uploaded ${fmtWhen(p.createdAt)} by ${p.crewName ?? "crew"}${p.sizeBytes ? ` · ${Math.round(p.sizeBytes / 1024)} KB` : ""}`,
        { size: 8.5, bold: true },
      );
      para(ctx, `SHA-256: ${p.sha256 ?? "not recorded"}`, {
        size: 8,
        color: SLATE,
        indent: 10,
      });
      if (p.lat != null && p.lng != null) {
        para(ctx, `GPS at capture: ${gps(p)}`, { size: 8, color: SLATE, indent: 10 });
      }
      ctx.y -= 4;
    }
  }

  ensure(ctx, 60);
  ctx.y -= 10;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 1,
    color: LINE,
  });
  ctx.y -= 14;
  para(
    ctx,
    `This report was generated automatically by HALO from records captured in the field. GPS positions, timestamps, and file fingerprints are recorded at the time of the event and are not editable after the fact. ${data.businessName}.`,
    { size: 8, color: SLATE },
  );

  return doc.save();
}
