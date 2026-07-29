import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

async function extractPdf(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf}).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ");
    parts.push(line);
 }
  return parts.join("\n");
}

export type ExtractResult = { content: string; mimeType: string; isPdf: boolean};

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function extractFileText(file: File): Promise<ExtractResult> {
  if (isPdfFile(file)) {
    const content = await extractPdf(file);
    return { content, mimeType: "text/plain", isPdf: true};
 }
  const content = await file.text();
  return { content, mimeType: file.type || "text/plain", isPdf: false};
}

/**
 * Render PDF pages to high-res JPEG images (base64, no data-url prefix) so
 * scanned/image-only PDFs can be OCR'd by the AI scanner.
 */
export async function renderPdfPages(
  file: File,
  maxPages = 6,
): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf}).promise;
  const pages: string[] = [];
  const count = Math.min(pdf.numPages, maxPages);
  for (let i = 1; i <= count; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1});
    const scale = Math.min(3, 2200 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale});
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport} as never).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    pages.push(dataUrl.slice(dataUrl.indexOf(",") + 1));
 }
  return pages;
}
