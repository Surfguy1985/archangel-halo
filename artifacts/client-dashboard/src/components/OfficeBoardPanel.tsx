import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';

// OfficeBoardPanel — a floating picture-in-picture mini-board shown ONLY during
// Presentation Mode. It polls the demo office-board projection every 2s and
// renders a compact mini board; cards GLIDE between mini-lanes (framer-motion
// layoutId per cardKey) when the poll shows a lane change, with a brief lime
// glow on newly-arrived cards. Manual /api URLs must be absolute.

const LIME = '#B4FF44';

type MiniCard = {
  cardKey: string;
  title: string;
  unit?: string | null;
  lane: string;
};

type MiniLane = {
  key: string;
  label: string;
  cards: MiniCard[];
};

// Friendly labels for whatever lane keys the projection returns. We render
// whatever comes back — this is only a display polish, never a filter.
const LANE_LABELS: Record<string, string> = {
  requested: 'Requested',
  inbox: 'Inbox',
  todo: 'To do',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  billing: 'Billing',
  done: 'Done',
};

// Preferred left→right order; unknown lanes append in first-seen order.
const LANE_ORDER = ['inbox', 'requested', 'todo', 'scheduled', 'in_progress', 'billing', 'done'];

function laneLabel(key: string): string {
  return LANE_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractUnit(card: any): string | null {
  const raw =
    card?.unitNo ?? card?.unit ?? card?.unitLabel ?? card?.module?.unitNo ?? null;
  if (raw != null && String(raw).trim()) return String(raw).trim();
  // Fall back to a "Unit NNN" match in the title.
  const m = String(card?.title ?? '').match(/unit\s*#?\s*(\w+)/i);
  return m ? m[1] : null;
}

/** Normalise the projection (several possible shapes) into ordered mini-lanes. */
function projectLanes(raw: any): MiniLane[] {
  if (!raw) return [];
  // The endpoint wraps the projection: { propertyName, dashboardUrl, board: {...} }.
  const data = raw.board && typeof raw.board === 'object' ? raw.board : raw;
  const byLane = new Map<string, MiniCard[]>();
  const pushCard = (laneKey: string, card: any) => {
    const key = String(card?.cardKey ?? card?.id ?? `${laneKey}:${byLane.get(laneKey)?.length ?? 0}`);
    const list = byLane.get(laneKey) ?? [];
    list.push({
      cardKey: key,
      title: String(card?.title ?? card?.name ?? 'Untitled'),
      unit: extractUnit(card),
      lane: laneKey,
    });
    byLane.set(laneKey, list);
  };

  // Shape A: { lanes: [{ key/id, cards: [...] }, ...] } — but the real
  // projection keeps lane DEFINITIONS in `lanes` and the cards in a flat
  // `cards` array, so also fold those in grouped by card.lane.
  if (Array.isArray(data.lanes)) {
    for (const lane of data.lanes) {
      const laneKey = String(lane?.key ?? lane?.id ?? lane?.lane ?? 'lane');
      const cards = Array.isArray(lane?.cards) ? lane.cards : [];
      byLane.set(laneKey, []);
      for (const c of cards) pushCard(laneKey, c);
    }
    if (Array.isArray(data.cards)) {
      for (const c of data.cards) {
        const laneKey = String(c?.lane ?? c?.laneKey ?? c?.status ?? 'requested');
        pushCard(laneKey, c);
      }
    }
  }
  // Shape B: { cards: [{ lane: 'x', ... }] } — group by card.lane.
  else if (Array.isArray(data.cards)) {
    for (const c of data.cards) {
      const laneKey = String(c?.lane ?? c?.laneKey ?? c?.status ?? 'requested');
      pushCard(laneKey, c);
    }
  }
  // Shape C: { requested: [...], done: [...] } — lane keys at the top level.
  else {
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) {
        byLane.set(k, []);
        for (const c of v as any[]) pushCard(k, c);
      }
    }
  }

  const keys = Array.from(byLane.keys());
  keys.sort((a, b) => {
    const ia = LANE_ORDER.indexOf(a);
    const ib = LANE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return keys.map((key) => ({ key, label: laneLabel(key), cards: byLane.get(key) ?? [] }));
}

export function OfficeBoardPanel({ token }: { token: string }) {
  const [data, setData] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Track which cardKeys have just arrived to a new lane so we can glow them.
  const [glowKeys, setGlowKeys] = useState<Set<string>>(new Set());
  const laneOfCard = useRef<Map<string, string>>(new Map());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/presentation/demo/office-board?token=${encodeURIComponent(token)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!stop && mounted.current) setData(json);
      } catch {
        // Poll is best-effort; the narration continues regardless.
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      stop = true;
      mounted.current = false;
      clearInterval(id);
    };
  }, [token]);

  const lanes = useMemo(() => projectLanes(data), [data]);

  // Detect lane changes / new arrivals → schedule a brief lime glow.
  useEffect(() => {
    const arrived: string[] = [];
    const nextMap = new Map<string, string>();
    for (const lane of lanes) {
      for (const c of lane.cards) {
        nextMap.set(c.cardKey, lane.key);
        const prev = laneOfCard.current.get(c.cardKey);
        if (prev !== undefined && prev !== lane.key) arrived.push(c.cardKey);
        else if (prev === undefined && laneOfCard.current.size > 0) arrived.push(c.cardKey);
      }
    }
    laneOfCard.current = nextMap;
    if (arrived.length) {
      setGlowKeys((prev) => {
        const s = new Set(prev);
        arrived.forEach((k) => s.add(k));
        return s;
      });
      const t = setTimeout(() => {
        setGlowKeys((prev) => {
          const s = new Set(prev);
          arrived.forEach((k) => s.delete(k));
          return s;
        });
      }, 1600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [lanes]);

  return (
    <motion.div
      data-testid="office-board-panel"
      initial={{ opacity: 0, scale: 0.85, y: -12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="fixed right-4 bottom-4 z-[86] w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-white/10 bg-[#0B1428] text-white shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: LIME }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: LIME }} />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/80">
            Office Board — Live
          </span>
        </div>
        <button
          type="button"
          data-testid="button-office-panel-collapse"
          onClick={() => setCollapsed((c) => !c)}
          className="grid h-6 w-6 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
        >
          {collapsed ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex gap-2 overflow-x-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {lanes.length === 0 ? (
                <div className="w-full py-8 text-center text-[11px] text-white/40">
                  Waiting for the office board…
                </div>
              ) : (
                lanes.map((lane) => (
                  <div
                    key={lane.key}
                    data-testid={`office-lane-${lane.key}`}
                    className="min-w-[104px] flex-1 shrink-0"
                  >
                    <div className="mb-1.5 flex items-center justify-between px-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">
                        {lane.label}
                      </span>
                      <span className="text-[9px] tabular-nums text-white/30">{lane.cards.length}</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {lane.cards.map((c) => {
                        const glow = glowKeys.has(c.cardKey);
                        return (
                          <motion.div
                            key={c.cardKey}
                            layout
                            layoutId={`office-card-${c.cardKey}`}
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                            animate={{
                              boxShadow: glow
                                ? `0 0 0 1.5px ${LIME}, 0 0 14px rgba(180,255,68,0.55)`
                                : '0 0 0 1px rgba(255,255,255,0.06)',
                            }}
                            className="rounded-lg bg-white/[0.06] px-2 py-1.5"
                          >
                            <div className="truncate text-[10px] font-semibold leading-tight text-white/90">
                              {c.title}
                            </div>
                            {c.unit && (
                              <span
                                className="mt-1 inline-block rounded-full px-1.5 py-0.5 text-[8px] font-bold"
                                style={{ background: 'rgba(180,255,68,0.16)', color: LIME }}
                              >
                                Unit {c.unit}
                              </span>
                            )}
                          </motion.div>
                        );
                      })}
                      {lane.cards.length === 0 && (
                        <div className="rounded-lg border border-dashed border-white/10 px-2 py-2 text-center text-[9px] text-white/25">
                          —
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
