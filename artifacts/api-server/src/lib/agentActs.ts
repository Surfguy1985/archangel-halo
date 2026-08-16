/**
 * Durable HITL queue — persist a sign-off nudge until the PM accepts or dismisses.
 * Does not write invoices, close turns, or fire autopilot.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./agentPaths";

export type QueuedAct = {
  id: string;
  label: string;
  unit?: string | null;
  open?: "attention" | "turns" | "crew";
  hitl: true;
  status: "queued" | "dismissed" | "cleared";
  at: string;
};

function actsPath(): string {
  return join(agentDir(), "acts.json");
}

function load(): QueuedAct[] {
  try {
    const raw = JSON.parse(readFileSync(actsPath(), "utf8")) as QueuedAct[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(rows: QueuedAct[]): void {
  mkdirSync(agentDir(), { recursive: true });
  writeFileSync(actsPath(), JSON.stringify(rows.slice(-40)));
}

export function queueAct(act: { id: string; label: string; unit?: string | null; open?: QueuedAct["open"] }): QueuedAct {
  const rows = load().filter((a) => a.status === "queued" && a.id !== act.id);
  const row: QueuedAct = {
    id: act.id,
    label: act.label,
    unit: act.unit ?? null,
    open: act.open,
    hitl: true,
    status: "queued",
    at: new Date().toISOString(),
  };
  rows.push(row);
  save(rows);
  return row;
}

export function dismissAct(id: string): void {
  save(
    load().map((a) => (a.id === id || (id && a.unit === id) ? { ...a, status: "dismissed" as const } : a)),
  );
}

export function pendingActs(unit?: string | null): QueuedAct[] {
  return load().filter((a) => a.status === "queued" && (!unit || !a.unit || a.unit === unit));
}

/** When the wait is gone from cortex, the nudge is done. */
export function clearActsNotIn(units: Set<string>): void {
  save(
    load().map((a) =>
      a.status === "queued" && a.unit && !units.has(a.unit) ? { ...a, status: "cleared" as const } : a,
    ),
  );
}
