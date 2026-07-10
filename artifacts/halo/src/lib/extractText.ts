import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

async function extractPdf(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
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

export type ExtractResult = { content: string; mimeType: string };

export async function extractFileText(file: File): Promise<ExtractResult> {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    const content = await extractPdf(file);
    return { content, mimeType: "text/plain" };
  }
  const content = await file.text();
  return { content, mimeType: file.type || "text/plain" };
}
