import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  getTemplate,
  applicableForms,
  COMPANY,
  type PacketForm,
  type PacketField,
  type SignatureValue,
  type PacketAttachmentValue,
} from "@workspace/onboarding-packet";
import { readSourcePdf } from "./packetAssets";

export interface CompilePacketInput {
  templateKey: string;
  crewName: string;
  applicability: { insured: boolean; ach: boolean };
  formsData: Record<string, Record<string, unknown>>;
  signatures: Record<string, SignatureValue | undefined>;
  attachments: Record<string, PacketAttachmentValue[] | undefined>;
  submittedAt?: string | null;
  /** Resolve an uploaded attachment's bytes for embedding. */
  loadAttachment?: (
    att: PacketAttachmentValue,
  ) => Promise<{ bytes: Uint8Array; contentType?: string | null } | null>;
}

const MARGIN = 54;
const PAGE_W = 612;
const PAGE_H = 792;
const NAVY = rgb(0.09, 0.13, 0.24);
const SLATE = rgb(0.28, 0.33, 0.41);
const LINE = rgb(0.82, 0.85, 0.9);

interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
}

function newPage(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN) newPage(ctx);
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const rawLine of String(text).split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxW && line) {
        out.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function drawText(
  ctx: Ctx,
  text: string,
  opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {},
): void {
  const size = opts.size ?? 10;
  const font = opts.font ?? ctx.font;
  const color = opts.color ?? SLATE;
  const indent = opts.indent ?? 0;
  const maxW = PAGE_W - MARGIN * 2 - indent;
  const lines = wrap(text, font, size, maxW);
  const lh = size * 1.4;
  for (const line of lines) {
    ensure(ctx, lh);
    ctx.page.drawText(line, {
      x: MARGIN + indent,
      y: ctx.y - size,
      size,
      font,
      color,
    });
    ctx.y -= lh;
  }
  if (opts.gap) ctx.y -= opts.gap;
}

function rule(ctx: Ctx): void {
  ensure(ctx, 12);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 0.75,
    color: LINE,
  });
  ctx.y -= 12;
}

function fieldValueText(field: PacketField, raw: unknown): string {
  if (raw == null || raw === "") return "—";
  if (field.type === "checkbox") return raw ? "Yes" : "No";
  if ((field.type === "radio" || field.type === "select") && field.options) {
    const opt = field.options.find((o) => o.value === raw);
    return opt ? opt.label : String(raw);
  }
  if (field.type === "workers") {
    if (Array.isArray(raw)) {
      return raw
        .map((w, i) => {
          if (w && typeof w === "object") {
            const vals = Object.values(w as Record<string, unknown>)
              .filter((v) => v != null && v !== "")
              .map((v) => String(v));
            return `${i + 1}. ${vals.join(" · ")}`;
          }
          return `${i + 1}. ${String(w)}`;
        })
        .join("\n");
    }
    return String(raw);
  }
  return String(raw);
}

/**
 * Copies all pages from the source PDF into the output document.
 * Returns the last page added (used for signature overlay), or null if the
 * PDF could not be loaded.
 */
async function appendSourcePdf(
  ctx: Ctx,
  templateKey: string,
  code: string,
): Promise<PDFPage | null> {
  const bytes = await readSourcePdf(templateKey, code);
  if (!bytes) return null;
  let lastPage: PDFPage | null = null;
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await ctx.doc.copyPages(src, src.getPageIndices());
    for (const p of pages) {
      ctx.doc.addPage(p);
      lastPage = p;
    }
  } catch {
    // Skip unreadable source PDFs rather than fail the whole packet.
  }
  // Continue generated content on a fresh page.
  newPage(ctx);
  return lastPage;
}

/**
 * Overlays the typed electronic signature directly onto the last page of the
 * source legal document — at the signature-line area at the bottom of the page.
 * This places the name on the actual signature line rather than on a separate
 * generated page.
 */
function overlaySignatureOnPage(
  page: PDFPage,
  sig: SignatureValue,
  form: PacketForm,
  font: PDFFont,
  bold: PDFFont,
): void {
  const { width: pw } = page.getSize();
  const ml = 54;
  // y=130 from bottom puts the name right on the signature line area of a
  // standard US-letter contract (typically at ~15-18% from the bottom).
  const sigY = 130;
  const halfW = pw * 0.52 - ml;
  const dateX = ml + halfW + 14;
  const navy = rgb(0.09, 0.13, 0.24);
  const muted = rgb(0.50, 0.52, 0.56);
  const lineClr = rgb(0.25, 0.30, 0.40);

  // ── Signature name ────────────────────────────────────────────────────────
  page.drawText(sig.typedName, {
    x: ml,
    y: sigY + 14,
    size: 12,
    font: bold,
    color: navy,
  });
  // Underline the name to sit on the signature line.
  page.drawLine({
    start: { x: ml, y: sigY + 12 },
    end: { x: ml + halfW, y: sigY + 12 },
    thickness: 0.6,
    color: lineClr,
  });
  page.drawText("Authorized Signature (Electronic)", {
    x: ml,
    y: sigY,
    size: 7,
    font,
    color: muted,
  });

  // ── Date ──────────────────────────────────────────────────────────────────
  page.drawText(sig.signedDate, {
    x: dateX,
    y: sigY + 14,
    size: 11,
    font,
    color: navy,
  });
  page.drawLine({
    start: { x: dateX, y: sigY + 12 },
    end: { x: pw - ml, y: sigY + 12 },
    thickness: 0.6,
    color: lineClr,
  });
  page.drawText("Date", {
    x: dateX,
    y: sigY,
    size: 7,
    font,
    color: muted,
  });

  // ── Title / company (optional) ────────────────────────────────────────────
  if (sig.title || sig.company) {
    page.drawText([sig.title, sig.company].filter(Boolean).join("  ·  "), {
      x: ml,
      y: sigY - 14,
      size: 8,
      font,
      color: rgb(0.35, 0.38, 0.45),
    });
  }

  // ── Micro audit trail at very bottom ─────────────────────────────────────
  const auditParts: string[] = [
    `Form ${form.code}`,
    `Agreed: ${sig.agreed ? "Yes" : "No"}`,
  ];
  if (sig.agreedAt) auditParts.push(sig.agreedAt);
  if (sig.ip) auditParts.push(`IP ${sig.ip}`);
  page.drawText(auditParts.join("  ·  "), {
    x: ml,
    y: 28,
    size: 6.5,
    font,
    color: rgb(0.65, 0.67, 0.72),
  });
}

async function appendAttachment(
  ctx: Ctx,
  att: PacketAttachmentValue,
  load: NonNullable<CompilePacketInput["loadAttachment"]>,
): Promise<void> {
  const loaded = await load(att);
  if (!loaded) {
    drawText(ctx, `Attachment on file: ${att.name}`, { indent: 12 });
    return;
  }
  const ct = (loaded.contentType || att.contentType || "").toLowerCase();
  if (ct.includes("pdf") || att.name.toLowerCase().endsWith(".pdf")) {
    try {
      const src = await PDFDocument.load(loaded.bytes, { ignoreEncryption: true });
      const pages = await ctx.doc.copyPages(src, src.getPageIndices());
      for (const p of pages) ctx.doc.addPage(p);
      newPage(ctx);
      return;
    } catch {
      drawText(ctx, `Attachment on file: ${att.name}`, { indent: 12 });
      return;
    }
  }
  try {
    const img =
      ct.includes("png") || att.name.toLowerCase().endsWith(".png")
        ? await ctx.doc.embedPng(loaded.bytes)
        : await ctx.doc.embedJpg(loaded.bytes);
    const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    const maxW = PAGE_W - MARGIN * 2;
    const maxH = PAGE_H - MARGIN * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, {
      x: (PAGE_W - w) / 2,
      y: (PAGE_H - h) / 2,
      width: w,
      height: h,
    });
    newPage(ctx);
  } catch {
    drawText(ctx, `Attachment on file: ${att.name}`, { indent: 12 });
  }
}

function drawFormHeader(ctx: Ctx, form: PacketForm): void {
  ensure(ctx, 60);
  drawText(ctx, `FORM ${form.code}`, { size: 9, font: ctx.bold, color: rgb(0.55, 0.6, 0.68) });
  drawText(ctx, form.title, { size: 15, font: ctx.bold, color: NAVY, gap: 2 });
  if (form.subtitle) drawText(ctx, form.subtitle, { size: 10, color: SLATE });
  rule(ctx);
}

/**
 * Draws a full signature block on a generated response page.
 * Used only for forms WITHOUT a source PDF (no document page to overlay onto).
 */
function drawSignature(ctx: Ctx, form: PacketForm, sig: SignatureValue | undefined): void {
  if (!form.signature) return;
  ctx.y -= 6;
  ensure(ctx, 90);
  drawText(ctx, "Electronic Signature", { size: 11, font: ctx.bold, color: NAVY, gap: 2 });
  drawText(ctx, form.signature.agreeText, { size: 9, color: SLATE, gap: 4 });
  if (!sig) {
    drawText(ctx, "Not signed", { size: 10, color: rgb(0.7, 0.2, 0.2) });
    return;
  }
  drawText(ctx, `Signed by: ${sig.typedName}`, { size: 11, font: ctx.bold, color: NAVY });
  if (sig.title) drawText(ctx, `Title: ${sig.title}`, { size: 10 });
  if (sig.company) drawText(ctx, `Company: ${sig.company}`, { size: 10 });
  drawText(ctx, `Date: ${sig.signedDate}`, { size: 10 });
  drawText(ctx, `Agreed: ${sig.agreed ? "Yes" : "No"}`, { size: 10 });
  const audit: string[] = [];
  if (sig.agreedAt) audit.push(`Timestamp ${sig.agreedAt}`);
  if (sig.ip) audit.push(`IP ${sig.ip}`);
  if (audit.length) drawText(ctx, audit.join("  ·  "), { size: 8, color: rgb(0.6, 0.63, 0.7) });
}

/**
 * Draws a compact signature reference note on the generated response page when
 * the real signature has already been overlaid onto the source document page.
 */
function drawSignatureReference(ctx: Ctx, sig: SignatureValue | undefined): void {
  ctx.y -= 6;
  ensure(ctx, 36);
  if (!sig) {
    drawText(ctx, "⚠ Signature not collected.", { size: 10, color: rgb(0.7, 0.2, 0.2) });
    return;
  }
  drawText(ctx, `Electronically signed by ${sig.typedName} on ${sig.signedDate} — see signature on document page above.`, {
    size: 9,
    color: SLATE,
  });
  const audit: string[] = [];
  if (sig.agreedAt) audit.push(`Timestamp ${sig.agreedAt}`);
  if (sig.ip) audit.push(`IP ${sig.ip}`);
  if (audit.length) drawText(ctx, audit.join("  ·  "), { size: 8, color: rgb(0.6, 0.63, 0.7) });
}

/** Build the single compiled packet PDF. Returns PDF bytes. */
export async function compilePacket(input: CompilePacketInput): Promise<Uint8Array> {
  const tpl = getTemplate(input.templateKey);
  if (!tpl) throw new Error(`Unknown template: ${input.templateKey}`);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, font, bold, page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN };

  // Cover page.
  ctx.y = PAGE_H - 140;
  drawText(ctx, COMPANY.name.toUpperCase(), { size: 12, font: bold, color: rgb(0.55, 0.6, 0.68) });
  ctx.y -= 8;
  drawText(ctx, tpl.label, { size: 24, font: bold, color: NAVY, gap: 10 });
  drawText(ctx, `Subcontractor: ${input.crewName}`, { size: 13, color: SLATE });
  drawText(ctx, `Insured: ${input.applicability.insured ? "Yes" : "No"}`, { size: 11 });
  drawText(ctx, `Payment by ACH: ${input.applicability.ach ? "Yes" : "No"}`, { size: 11 });
  if (input.submittedAt) drawText(ctx, `Submitted: ${input.submittedAt}`, { size: 11 });
  drawText(ctx, `Venue: ${COMPANY.venue}`, { size: 11 });
  ctx.y -= 10;
  rule(ctx);
  drawText(ctx, "This packet compiles every executed form, the subcontractor's responses, electronic signatures, and any submitted attachments.", { size: 10, color: SLATE });

  const forms = applicableForms(tpl, input.applicability);

  for (const form of forms) {
    // Source legal document pages (authoritative text).
    // For forms with a signature block, the typed name is overlaid directly
    // onto the last page of the source PDF — on the document's signature line.
    let sourceSigPage: PDFPage | null = null;
    if (form.hasSourcePdf) {
      sourceSigPage = await appendSourcePdf(ctx, tpl.key, form.code);
      // Overlay signature onto the source document's last page right away,
      // before we move on to the generated response page.
      if (sourceSigPage && form.signature) {
        const sig = input.signatures[form.code];
        if (sig) {
          overlaySignatureOnPage(sourceSigPage, sig, form, font, bold);
        }
      }
    } else {
      newPage(ctx);
    }

    // Generated response/completion page.
    drawFormHeader(ctx, form);
    if (form.intro) drawText(ctx, form.intro, { size: 10, color: SLATE, gap: 6 });

    const data = input.formsData[form.code] || {};
    if (form.fields.length > 0) {
      drawText(ctx, "Responses", { size: 11, font: bold, color: NAVY, gap: 2 });
      for (const field of form.fields) {
        drawText(ctx, field.label, { size: 9, font: bold, color: SLATE });
        drawText(ctx, fieldValueText(field, data[field.key]), { size: 11, color: NAVY, indent: 8, gap: 4 });
      }
    }

    if (form.kind === "info" && form.fields.length === 0 && !form.signature) {
      drawText(ctx, "Reference document — included for the subcontractor's records.", { size: 10, color: SLATE });
    }

    if (form.signature) {
      if (sourceSigPage) {
        // Signature was already overlaid onto the source document — just note it.
        drawSignatureReference(ctx, input.signatures[form.code]);
      } else {
        // No source PDF: render the full signature block on this generated page.
        drawSignature(ctx, form, input.signatures[form.code]);
      }
    }

    // Attachments.
    const atts = input.attachments[form.code] || [];
    if (atts.length > 0) {
      ctx.y -= 6;
      drawText(ctx, "Attachments", { size: 11, font: bold, color: NAVY, gap: 2 });
      for (const att of atts) {
        drawText(ctx, `• ${att.name}`, { size: 10, color: NAVY });
        if (input.loadAttachment) {
          await appendAttachment(ctx, att, input.loadAttachment);
        }
      }
    }
  }

  return doc.save();
}
