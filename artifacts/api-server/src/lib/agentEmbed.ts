/**
 * Superpower 1 — Hugging Face Transformers.js + MiniLM
 *   npm: @huggingface/transformers
 *   model: Xenova/all-MiniLM-L6-v2 (Apache-2.0 ONNX of sentence-transformers)
 *
 * Production tries WASM first (native onnxruntime-node scripts are often
 * ignored by pnpm), then CPU. Tests / AGENT_HF=0: hashed character 3-grams
 * so CI never downloads the model.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./agentPaths";

const DIM = 384;

export type EmbedderKind = "minilm" | "hash";

let kind: EmbedderKind = "hash";
let extractor: null | ((text: string) => Promise<number[]>) = null;
let triedHf = false;

function hashEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  for (let i = 0; i < t.length - 2; i++) {
    const g = t.slice(i, i + 3);
    let h = 2166136261;
    for (let j = 0; j < g.length; j++) h = Math.imul(h ^ g.charCodeAt(j), 16777619);
    v[(h >>> 0) % DIM] += 1;
  }
  return l2(v);
}

function l2(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  const d = Math.sqrt(n) || 1;
  return v.map((x) => x / d);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function pad384(row: number[]): number[] {
  if (row.length === DIM) return row;
  return l2(row.concat(new Array(Math.max(0, DIM - row.length)).fill(0)).slice(0, DIM));
}

type Pipe = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{
  tolist?: () => unknown;
}>;

async function makeExtractor(pipe: Pipe): Promise<(text: string) => Promise<number[]>> {
  return async (text: string) => {
    const out = await pipe(text, { pooling: "mean", normalize: true });
    const listed = typeof out.tolist === "function" ? out.tolist() : [];
    const row = Array.isArray(listed) && Array.isArray(listed[0]) ? listed[0] : listed;
    return pad384(Array.isArray(row) ? row.map(Number) : []);
  };
}

async function loadMiniLm(): Promise<((text: string) => Promise<number[]>) | null> {
  if (process.env.AGENT_HF === "0" || process.env.VITEST) return null;
  try {
    const { env, pipeline } = await import("@huggingface/transformers");
    const cache = join(agentDir(), "hf-cache");
    mkdirSync(cache, { recursive: true });
    env.cacheDir = cache;
    env.allowRemoteModels = true;
    env.useFSCache = true;
    try {
      const wasm = (env as { backends?: { onnx?: { wasm?: { numThreads?: number } } } }).backends?.onnx?.wasm;
      if (wasm) wasm.numThreads = 1;
    } catch {
      /* onnx wasm backend is optional */
    }
    const model = process.env.AGENT_HF_MODEL || "Xenova/all-MiniLM-L6-v2";
    // WASM is the path that actually runs when pnpm ignores onnxruntime-node
    // build scripts. CPU is the native fallback when those binaries exist.
    for (const device of ["wasm", "cpu"] as const) {
      try {
        const pipe = (await pipeline("feature-extraction", model, { dtype: "q8", device })) as unknown as Pipe;
        return makeExtractor(pipe);
      } catch {
        continue;
      }
    }
    const pipe = (await pipeline("feature-extraction", model, { dtype: "q8" })) as unknown as Pipe;
    return makeExtractor(pipe);
  } catch {
    return null;
  }
}

export async function embed(text: string): Promise<{ vector: number[]; kind: EmbedderKind }> {
  if (!triedHf) {
    triedHf = true;
    extractor = await loadMiniLm();
    if (extractor) kind = "minilm";
  }
  if (extractor) {
    try {
      return { vector: await extractor(text), kind: "minilm" };
    } catch {
      extractor = null;
      kind = "hash";
    }
  }
  return { vector: hashEmbed(text), kind: "hash" };
}

export function embedSync(text: string): number[] {
  return hashEmbed(text);
}

export function embedderKind(): EmbedderKind {
  return kind;
}

export const EMBED_DIM = DIM;
