/**
 * Shipped demo photos (Thornbury Pulse + presentation board) live on disk so
 * Pulse works without Replit object storage. Paths are fixed names only —
 * never user-controlled object IDs.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const SAFE_FILE = /^[a-zA-Z0-9._-]+\.jpe?g$/i;
const BUNDLED_FOLDERS = new Set(["thornbury-pulse", "demo-board"]);

export function demoAssetsDir(): string | null {
  const candidates = [
    path.resolve(import.meta.dirname, "../assets/demo"),
    path.resolve(import.meta.dirname, "../../assets/demo"),
    path.resolve(process.cwd(), "assets/demo"),
    path.resolve(process.cwd(), "artifacts/api-server/assets/demo"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function resolveBundledObjectFile(objectPath: string): string | null {
  if (!objectPath.startsWith("/objects/")) return null;
  const parts = objectPath.slice("/objects/".length).split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [folder, file] = parts;
  if (!BUNDLED_FOLDERS.has(folder) || !SAFE_FILE.test(file)) return null;
  const dir = demoAssetsDir();
  if (!dir) return null;
  const full = path.join(dir, file);
  return existsSync(full) ? full : null;
}
