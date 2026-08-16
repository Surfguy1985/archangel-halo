/**
 * Superpower 3a — Mem0 retrieve.
 * Official package: `mem0ai` MemoryClient when MEM0_API_KEY is set.
 * Local path: same add/search shape, MiniLM/hash vectors, jsonl next to the graph.
 */

import "./agentTelemetry";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryClient } from "mem0ai";
import { cosine, embed, embedderKind, embedSync, type EmbedderKind } from "./agentEmbed";
import { agentDir } from "./agentPaths";
import { daysFromGraph, rememberGraph } from "./agentGraph";

export type AgentEpisode = {
  id: string;
  at: string;
  question: string;
  answer: string;
  unit?: string | null;
  days?: number | null;
  nextMove?: string | null;
  helpful?: boolean | null;
  vector: number[];
};

export type RetrievedMemory = {
  question: string;
  answer: string;
  score: number;
  unit?: string | null;
  at: string;
};

/** Mem0 Embedder contract — implemented locally so we never load mem0ai/oss (sqlite). */
class HaloEmbedder {
  async embed(text: string): Promise<number[]> {
    return (await embed(text)).vector;
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

const embedder = new HaloEmbedder();

function episodesPath(): string {
  return join(agentDir(), "episodes.jsonl");
}

function cloudClient(): MemoryClient | null {
  const key = process.env.MEM0_API_KEY;
  if (!key) return null;
  return new MemoryClient({ apiKey: key });
}

async function loadLocal(): Promise<AgentEpisode[]> {
  try {
    const raw = await readFile(episodesPath(), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentEpisode)
      .filter((e) => Array.isArray(e.vector) && typeof e.question === "string");
  } catch {
    return [];
  }
}

export async function rememberEpisode(
  ep: Omit<AgentEpisode, "id" | "at" | "vector"> & { vector?: number[] },
): Promise<AgentEpisode> {
  await mkdir(agentDir(), { recursive: true });
  const vector = ep.vector ?? (await embedder.embed(ep.question));
  const row: AgentEpisode = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    question: ep.question,
    answer: ep.answer,
    unit: ep.unit ?? null,
    days: ep.days ?? null,
    nextMove: ep.nextMove ?? null,
    helpful: ep.helpful ?? null,
    vector,
  };
  await appendFile(episodesPath(), `${JSON.stringify(row)}\n`);
  rememberGraph({
    id: row.id,
    at: row.at,
    question: row.question,
    unit: row.unit,
    days: row.days,
    nextMove: row.nextMove,
  });
  const cloud = cloudClient();
  if (cloud) {
    void cloud
      .add([{ role: "user", content: row.question }, { role: "assistant", content: row.answer }], {
        userId: "pulse-ask",
        infer: false,
        metadata: { unit: row.unit, days: row.days, at: row.at },
      })
      .catch(() => {});
  }
  return row;
}

export async function recallSimilar(
  question: string,
  limit = 3,
): Promise<{ memories: RetrievedMemory[]; embedder: EmbedderKind }> {
  const cloud = cloudClient();
  if (cloud) {
    try {
      const found = await cloud.search(question, {
        topK: limit,
        filters: { userId: "pulse-ask" },
      });
      const rows = found.results ?? [];
      const memories = rows
        .map((r) => {
          const row = r as { memory?: string; score?: number; metadata?: { unit?: string; at?: string } };
          return {
            question: String(row.memory ?? ""),
            answer: String(row.memory ?? ""),
            unit: row.metadata?.unit ?? null,
            at: String(row.metadata?.at ?? ""),
            score: Number(row.score ?? 0),
          };
        })
        .filter((m) => m.question && m.score > 0.35);
      if (memories.length) return { memories, embedder: embedderKind() };
    } catch {
      /* fall through to local */
    }
  }
  const all = await loadLocal();
  const vector = await embedder.embed(question);
  const memories = all
    .map((e) => ({
      question: e.question,
      answer: e.answer,
      unit: e.unit,
      at: e.at,
      score: cosine(vector, e.vector.length === vector.length ? e.vector : embedSync(e.question)),
    }))
    .filter((e) => e.score > 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { memories, embedder: embedderKind() };
}

export async function daysHistoryForUnit(unit: string): Promise<number[]> {
  const fromGraph = daysFromGraph(unit);
  if (fromGraph.length) return fromGraph;
  const all = await loadLocal();
  return all
    .filter((e) => (e.unit ?? "").toLowerCase() === unit.toLowerCase() && typeof e.days === "number")
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((e) => e.days as number);
}
