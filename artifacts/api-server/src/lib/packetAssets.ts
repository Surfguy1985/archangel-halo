import { readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { getTemplate, SOURCE_PDF_CODES } from "@workspace/onboarding-packet";

/** Resolve the packet-assets directory regardless of cwd. */
function assetsRoot(): string {
  const candidates = [
    path.resolve(__dirname, "..", "packet-assets"),
    path.resolve(process.cwd(), "packet-assets"),
    path.resolve(process.cwd(), "artifacts/api-server/packet-assets"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

const CODE_HAS_PDF = new Set<string>(SOURCE_PDF_CODES);

/** Absolute path to a form's source legal PDF, or null if none exists. */
export function sourcePdfPath(templateKey: string, code: string): string | null {
  const tpl = getTemplate(templateKey);
  if (!tpl) return null;
  if (!CODE_HAS_PDF.has(code)) return null;
  const file = path.resolve(assetsRoot(), tpl.locale, `${code}.pdf`);
  if (!existsSync(file)) return null;
  return file;
}

export async function readSourcePdf(
  templateKey: string,
  code: string,
): Promise<Uint8Array | null> {
  const file = sourcePdfPath(templateKey, code);
  if (!file) return null;
  return new Uint8Array(await readFile(file));
}
