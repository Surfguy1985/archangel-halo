/**
 * Superpower 2 — Holt linear trend via zodiac-ts (StatsForecast / Hyndman family).
 * Vacant DAYS only. Never produces dollars.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { HoltSmoothing } = require("zodiac-ts") as {
  HoltSmoothing: new (data: number[], alpha: number, gamma: number) => {
    predict: (horizon: number) => Array<number | null>;
  };
};

export type HoltForecast = {
  method: "holt";
  extraDays: number;
  next: number;
  last: number;
  n: number;
};

function lastNumber(series: Array<number | null | undefined>): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const n = series[i];
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return null;
}

export function seriesForHolt(clock: number[], episodes: number[], current: number): number[] {
  const seq: number[] = [];
  for (const d of [...clock, ...episodes, current]) {
    if (!Number.isFinite(d) || d < 0) continue;
    if (seq[seq.length - 1] === d) continue;
    seq.push(d);
  }
  return seq.slice(-16);
}

export function holt(series: number[], horizon = 1, alpha = 0.4, beta = 0.6): HoltForecast | null {
  const y = series.filter((n) => Number.isFinite(n) && n >= 0);
  if (y.length < 2) return null;
  try {
    const model = new HoltSmoothing(y, alpha, beta);
    const fc = model.predict(Math.max(3, horizon + 2));
    const next = (typeof fc[y.length + 1] === "number" ? fc[y.length + 1] : lastNumber(fc)) as number | null;
    if (next == null) return null;
    const last = y[y.length - 1];
    return {
      method: "holt",
      extraDays: Math.max(0, Math.round(next - last)),
      next: Math.round(next * 10) / 10,
      last,
      n: y.length,
    };
  } catch {
    return null;
  }
}

/** Tomorrow’s vacant days if nobody acts — cortex already uses +1; Holt refines when we have history. */
export function slipDays(history: number[], current: number): { extraDays: number; method: "holt" | "plus-one" } {
  const f = holt([...history, current], 1);
  if (!f) return { extraDays: 1, method: "plus-one" };
  return { extraDays: Math.max(1, f.extraDays || 1), method: "holt" };
}
