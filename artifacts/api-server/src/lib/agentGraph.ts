/**
 * Superpower 3b — Graphiti-shaped temporal graph (graphology).
 * Nodes: units, mornings. Edges carry validAt so vacant-day history is ordered.
 * No Neo4j. File-backed next to Mem0.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MultiDirectedGraph } from "graphology";
import { agentDir } from "./agentPaths";

type NodeAttr = { kind: "unit" | "morning"; label: string };
type EdgeAttr = {
  kind: "ASKED" | "VACANT" | "WAITING";
  at: string;
  validAt: string;
  days?: number;
  question?: string;
};

function graphPath(): string {
  return join(agentDir(), "graph.json");
}

function load(): MultiDirectedGraph<NodeAttr, EdgeAttr> {
  const g = new MultiDirectedGraph<NodeAttr, EdgeAttr>();
  try {
    const raw = JSON.parse(readFileSync(graphPath(), "utf8")) as Parameters<typeof g.import>[0];
    g.import(raw);
  } catch {
    /* empty graph */
  }
  return g;
}

function save(g: MultiDirectedGraph<NodeAttr, EdgeAttr>): void {
  mkdirSync(agentDir(), { recursive: true });
  writeFileSync(graphPath(), JSON.stringify(g.export()));
}

function unitKey(unit: string): string {
  return `unit:${unit.toLowerCase()}`;
}

export function rememberGraph(ep: {
  id: string;
  at: string;
  question: string;
  unit?: string | null;
  days?: number | null;
  nextMove?: string | null;
}): void {
  const g = load();
  const morning = `morning:${ep.id}`;
  if (!g.hasNode(morning)) g.addNode(morning, { kind: "morning", label: ep.question });
  if (ep.unit) {
    const u = unitKey(ep.unit);
    if (!g.hasNode(u)) g.addNode(u, { kind: "unit", label: ep.unit });
    g.addEdge(morning, u, { kind: "ASKED", at: ep.at, validAt: ep.at, question: ep.question });
    if (typeof ep.days === "number") {
      g.addEdge(u, morning, { kind: "VACANT", at: ep.at, validAt: ep.at, days: ep.days });
    }
    if (ep.nextMove) {
      g.addEdge(morning, u, { kind: "WAITING", at: ep.at, validAt: ep.at, question: ep.nextMove });
    }
  }
  save(g);
}

export function daysFromGraph(unit: string): number[] {
  const g = load();
  const u = unitKey(unit);
  if (!g.hasNode(u)) return [];
  return g
    .edges()
    .map((e) => ({ key: e, attr: g.getEdgeAttributes(e) }))
    .filter((e) => e.attr.kind === "VACANT" && (g.source(e.key) === u || g.target(e.key) === u) && typeof e.attr.days === "number")
    .sort((a, b) => a.attr.validAt.localeCompare(b.attr.validAt))
    .map((e) => e.attr.days as number);
}

export function factsForUnit(unit: string): string[] {
  const g = load();
  const u = unitKey(unit);
  if (!g.hasNode(u)) return [];
  const days = daysFromGraph(unit);
  const last = days[days.length - 1];
  const facts: string[] = [];
  if (last != null) facts.push(`${unit} vacant-day trail: ${days.join(" → ")} (Graphiti clock, days only).`);
  return facts.slice(0, 2);
}
