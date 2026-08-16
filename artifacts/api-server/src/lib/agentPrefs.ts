/**
 * Preference memory — this PM's mornings, not a second vacancy clock.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./agentPaths";

export type AgentPrefs = {
  photos: number;
  needsYou: number;
  brief: number;
  preferPhotos: boolean;
  startWith: "needs_you" | "brief" | "photos" | null;
};

const EMPTY: AgentPrefs = {
  photos: 0,
  needsYou: 0,
  brief: 0,
  preferPhotos: false,
  startWith: null,
};

function prefsPath(): string {
  return join(agentDir(), "prefs.json");
}

export function loadPrefs(): AgentPrefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), "utf8")) as Partial<AgentPrefs>;
    return { ...EMPTY, ...raw };
  } catch {
    return { ...EMPTY };
  }
}

export function noteIntent(intent?: string | null): AgentPrefs {
  const p = loadPrefs();
  if (intent === "photos") p.photos += 1;
  if (intent === "needs_you" || intent === "next") p.needsYou += 1;
  if (intent === "brief") p.brief += 1;
  p.preferPhotos = p.photos >= 2;
  const ranked = [
    ["needs_you", p.needsYou] as const,
    ["brief", p.brief] as const,
    ["photos", p.photos] as const,
  ].sort((a, b) => b[1] - a[1]);
  p.startWith = ranked[0][1] >= 2 ? ranked[0][0] : p.startWith;
  mkdirSync(agentDir(), { recursive: true });
  writeFileSync(prefsPath(), JSON.stringify(p));
  return p;
}

export function prefFollowUps(prefs: AgentPrefs, unit?: string | null): string[] {
  const u = unit ? ` ${unit}` : "";
  const out: string[] = [];
  if (prefs.startWith === "needs_you") out.push("What do you need from me?");
  if (prefs.startWith === "brief") out.push("What's on fire?");
  if (prefs.preferPhotos) out.push(`Show before and after${u}`.trim());
  return out.slice(0, 2);
}
