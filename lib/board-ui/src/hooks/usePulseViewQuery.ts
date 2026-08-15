import { useCallback, useState } from "react";
import type { PulseRangePreset, PulseTileSort } from "@workspace/api-client-react";

/**
 * First GET must omit range/sort so the server applies `client_saved_views`.
 * Local override is set only after the user changes a chip — otherwise a
 * default `this_month` would wipe Last 30 on the next sort persist.
 */
export type PulseViewQuery = {
  range?: PulseRangePreset;
  sort?: PulseTileSort;
  from?: string;
  to?: string;
};

export function pulseViewPersistBody(
  q: PulseViewQuery,
  fallback?: PulseViewQuery | null,
): {
  range: PulseRangePreset;
  sort: PulseTileSort;
  from: string | null;
  to: string | null;
} {
  return {
    range: q.range ?? fallback?.range ?? "this_month",
    sort: q.sort ?? fallback?.sort ?? "vacancy_cost",
    from: q.from ?? fallback?.from ?? null,
    to: q.to ?? fallback?.to ?? null,
  };
}

export function idempotencyHeaders(): { "Idempotency-Key": string } {
  return { "Idempotency-Key": crypto.randomUUID() };
}

export function usePulseViewQuery() {
  const [override, setOverride] = useState<PulseViewQuery | null>(null);

  const commitRange = useCallback(
    (
      range: PulseRangePreset,
      from: string | undefined,
      to: string | undefined,
      sort: PulseTileSort,
    ): PulseViewQuery => {
      const next: PulseViewQuery = {
        range,
        sort,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      };
      setOverride(next);
      return next;
    },
    [],
  );

  const commitSort = useCallback((sort: PulseTileSort, current: PulseViewQuery): PulseViewQuery => {
    const next: PulseViewQuery = { ...current, sort };
    setOverride(next);
    return next;
  }, []);

  return {
    params: override ?? undefined,
    commitRange,
    commitSort,
  };
}
