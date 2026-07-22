import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
  db,
  jobsTable,
  propertiesTable,
  crewsTable,
  crewCheckinsTable,
  crewPhotosTable,
  photoSharesTable,
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

export interface DayReportJobGroup {
  job: Job | null;
  propertyName: string | null;
  propertyAddress: string | null;
  checkins: CrewCheckin[];
  photos: CrewPhoto[];
}

export interface DayReportData {
  crewName: string;
  crewTrade: string | null;
  day: string;
  businessName: string;
  notes: string | null;
  groups: DayReportJobGroup[];
  allPhotos: CrewPhoto[];
}

export async function gatherDayReport(
  token: string,
): Promise<DayReportData | null> {
  const [share] = await db
    .select()
    .from(photoSharesTable)
    .where(eq(photoSharesTable.token, token));
  if (!share) return null;

  const [dy, dm, dd] = share.day.split("-").map(Number);
  const dayStart = new Date(dy, dm - 1, dd);
  const dayEnd = new Date(dy, dm - 1, dd + 1);

  const [[crew], [settings], photos, checkins] = await Promise.all([
    db.select().from(crewsTable).where(eq(crewsTable.id, share.crewId)).limit(1),
    db.select().from(businessSettingsTable).limit(1),
    db
      .select()
      .from(crewPhotosTable)
      .where(
        and(
          eq(crewPhotosTable.crewId, share.crewId),
          eq(crewPhotosTable.takenOn, share.day),
        ),
      )
      .orderBy(crewPhotosTable.createdAt),
    db
      .select()
      .from(crewCheckinsTable)
      .where(
        and(
          eq(crewCheckinsTable.crewId, share.crewId),
          gte(crewCheckinsTable.createdAt, dayStart),
          lt(crewCheckinsTable.createdAt, dayEnd),
        ),
      )
      .orderBy(crewCheckinsTable.createdAt),
  ]);

  const jobIds = Array.from(
    new Set(
      [...photos.map((p) => p.jobId), ...checkins.map((c) => c.jobId)].filter(
        (v): v is string => !!v,
      ),
    ),
  );
  const jobs = jobIds.length
    ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
    : [];
  const propIds = Array.from(new Set(jobs.map((j) => j.propertyId)));
  const props = propIds.length
    ? await db
        .select()
        .from(propertiesTable)
        .where(inArray(propertiesTable.id, propIds))
    : [];
  const propById = new Map(props.map((p) => [p.id, p]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  // Preserve first-seen order of jobs across photos + checkins; general last.
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const src of [...photos, ...checkins]) {
    const k = src.jobId ?? "none";
    if (!seen.has(k)) {
      seen.add(k);
      orderedKeys.push(k);
    }
  }
  orderedKeys.sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : 0));

  const groups: DayReportJobGroup[] = orderedKeys.map((k) => {
    const job = k === "none" ? null : (jobById.get(k) ?? null);
    const prop = job ? propById.get(job.propertyId) : undefined;
    return {
      job,
      propertyName: prop?.name ?? null,
      propertyAddress: prop?.address ?? null,
      checkins: checkins.filter((c) => (c.jobId ?? "none") === k),
      photos: photos.filter((p) => (p.jobId ?? "none") === k),
    };
  });

  return {
    crewName: crew?.name ?? "Crew",
    crewTrade: crew?.trade ?? null,
    day: share.day,
    businessName: settings?.companyName ?? "ArchAngel Contractors",
    notes: share.notes,
    groups,
    allPhotos: photos,
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
    logger.warn({ err, storagePath }, "Day report: could not embed photo");
    return null;
  }
}

async function drawPhotoBlock(
  ctx: Ctx,
  photo: CrewPhoto,
  crewName: string,
  x: number,
  boxW: number,
): Promise<number> {
  const loaded = await embedPhoto(ctx, photo.storagePath);
  const imgH = loaded ? Math.min(200, (loaded.h / loaded.w) * boxW) : 24;
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
    `${photo.phase === "before" ? "BEFORE" : photo.phase === "after" ? "AFTER" : "PHOTO"} · ${crewName}`,
  );
  meta.push(`Captured: ${fmtWhen(photo.capturedAt ?? photo.createdAt)}`);
  if (photo.lat != null && photo.lng != null) meta.push(`GPS: ${gps(photo)}`);
  if (photo.note) meta.push(`Note: ${photo.note}`);
  if (photo.sha256) meta.push(`SHA-256: ${photo.sha256.slice(0, 32)}…`);
  for (const m of meta.slice(0, 5)) {
    ctx.page.drawText(m.length > 60 ? `${m.slice(0, 60)}…` : m, {
      x,
      y: my,
      size: 7.5,
      font: ctx.font,
      color: SLATE,
    });
    my -= 10;
  }
  return total;
}

function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function buildDayReportPdf(data: DayReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, font, bold, page: null as unknown as PDFPage, y: 0 };
  newPage(ctx);

  // Header
  ctx.page.drawText(data.businessName.toUpperCase(), {
    x: MARGIN,
    y: ctx.y,
    size: 10,
    font: bold,
    color: GOLD_DARK,
  });
  ctx.y -= 20;
  ctx.page.drawText("Daily Field Report", {
    x: MARGIN,
    y: ctx.y,
    size: 17,
    font: bold,
    color: INK,
  });
  ctx.y -= 16;
  ctx.page.drawText(
    `${data.crewName}${data.crewTrade ? ` · ${data.crewTrade}` : ""} — ${formatDayLabel(data.day)}`,
    { x: MARGIN, y: ctx.y, size: 10.5, font, color: INK },
  );
  ctx.y -= 14;
  ctx.page.drawText(`Generated ${fmtWhen(new Date())}`, {
    x: MARGIN,
    y: ctx.y,
    size: 9,
    font,
    color: SLATE,
  });
  ctx.y -= 18;

  // Day summary
  const totalCheckins = data.groups.reduce((n, g) => n + g.checkins.length, 0);
  sectionTitle(ctx, "Day at a glance");
  kv(ctx, "Crew", [data.crewName, data.crewTrade].filter(Boolean).join(" · "));
  kv(ctx, "Date", formatDayLabel(data.day));
  kv(
    ctx,
    "Jobs worked",
    String(data.groups.filter((g) => g.job).length) +
      (data.groups.some((g) => !g.job) ? " (+ general activity)" : ""),
  );
  kv(ctx, "Site visits logged", String(totalCheckins));
  kv(ctx, "Photos captured", String(data.allPhotos.length));

  if (data.notes?.trim()) {
    sectionTitle(ctx, "Notes from the office");
    para(ctx, data.notes.trim());
  }

  for (const g of data.groups) {
    const job = g.job;
    sectionTitle(
      ctx,
      job
        ? `${job.jobNo} — ${[g.propertyName, job.unitNo ? `Unit ${job.unitNo}` : null].filter(Boolean).join(" · ") || "Job"}`
        : "General activity (not tied to a job)",
    );

    if (job) {
      kv(
        ctx,
        "Property",
        [g.propertyName, g.propertyAddress].filter(Boolean).join(" — ") || "—",
      );
      if (job.unitNo) kv(ctx, "Unit", job.unitNo);
      if (job.woNo) kv(ctx, "Work order", job.woNo);
      kv(ctx, "Category", job.category ?? "—");
      kv(
        ctx,
        "Status",
        job.status + (job.completedAt ? ` (completed ${fmtWhen(job.completedAt)})` : ""),
      );
      if (job.description?.trim()) {
        para(ctx, "Scope of work:", { bold: true, size: 9.5 });
        para(ctx, job.description.trim(), { size: 9.5, indent: 10 });
        ctx.y -= 4;
      }
    }

    // Timeline
    if (g.checkins.length > 0) {
      para(ctx, "On-site record:", { bold: true, size: 9.5 });
      for (const c of g.checkins) {
        ensure(ctx, 30);
        para(
          ctx,
          `${c.kind === "checkout" ? "CHECK-OUT" : "CHECK-IN"} — ${fmtWhen(c.createdAt)}`,
          { bold: true, size: 9, indent: 10 },
        );
        para(ctx, `${gps(c)}${c.label ? ` · ${c.label}` : ""}`, {
          size: 8.5,
          color: SLATE,
          indent: 20,
        });
        if (c.note?.trim()) {
          para(ctx, `Work completed: "${c.note.trim()}"`, {
            size: 9,
            indent: 20,
          });
        }
        ctx.y -= 3;
      }
      ctx.y -= 4;
    } else {
      para(ctx, "No GPS check-ins recorded.", { color: SLATE, size: 9 });
    }

    // Photos
    const befores = g.photos.filter((p) => p.phase === "before");
    const afters = g.photos.filter((p) => p.phase === "after");
    const others = g.photos.filter((p) => p.phase !== "before" && p.phase !== "after");
    const colW = (PAGE_W - MARGIN * 2 - 20) / 2;

    if (befores.length > 0 || afters.length > 0) {
      para(ctx, "Before & after:", { bold: true, size: 9.5 });
      ctx.y -= 4;
      const pairs = Math.max(befores.length, afters.length);
      for (let i = 0; i < pairs; i++) {
        ensure(ctx, 270);
        const startY = ctx.y;
        let used = 0;
        if (befores[i]) {
          used = Math.max(
            used,
            await drawPhotoBlock(ctx, befores[i]!, data.crewName, MARGIN, colW),
          );
        }
        if (afters[i]) {
          used = Math.max(
            used,
            await drawPhotoBlock(ctx, afters[i]!, data.crewName, MARGIN + colW + 20, colW),
          );
        }
        ctx.y = startY - used - 14;
      }
    }
    if (others.length > 0) {
      para(ctx, befores.length + afters.length > 0 ? "More photos:" : "Photos:", {
        bold: true,
        size: 9.5,
      });
      ctx.y -= 4;
      for (let i = 0; i < others.length; i += 2) {
        ensure(ctx, 270);
        const startY = ctx.y;
        let used = await drawPhotoBlock(ctx, others[i]!, data.crewName, MARGIN, colW);
        if (others[i + 1]) {
          used = Math.max(
            used,
            await drawPhotoBlock(ctx, others[i + 1]!, data.crewName, MARGIN + colW + 20, colW),
          );
        }
        ctx.y = startY - used - 14;
      }
    }
    if (g.photos.length === 0) {
      para(ctx, "No photos for this job — check-in activity only.", {
        color: SLATE,
        size: 9,
      });
    }
  }

  // Evidence integrity appendix
  sectionTitle(ctx, "Evidence integrity record");
  para(
    ctx,
    "Each photo was fingerprinted with SHA-256 at the moment it was uploaded from the crew's device. " +
      "Any alteration to a photo file — even a single pixel — produces a different fingerprint. " +
      "To verify a photo has not been tampered with, recompute its SHA-256 hash and compare it to the value recorded here.",
    { size: 9, color: SLATE },
  );
  ctx.y -= 6;
  if (data.allPhotos.length === 0) {
    para(ctx, "No photos on record.", { color: SLATE });
  } else {
    for (const p of data.allPhotos) {
      ensure(ctx, 40);
      para(
        ctx,
        `${p.phase === "before" ? "BEFORE" : p.phase === "after" ? "AFTER" : "PHOTO"} · uploaded ${fmtWhen(p.createdAt)}${p.sizeBytes ? ` · ${Math.round(p.sizeBytes / 1024)} KB` : ""}`,
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
