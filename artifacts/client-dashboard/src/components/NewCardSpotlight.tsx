import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight } from 'lucide-react';
import { ModuleMetrics, ModuleEvidence, ModuleDecision } from '@workspace/board-ui';

const seenKey = (token: string) => `halo_board_seen_cards_${token}`;

// In-memory fallback so private-mode/blocked-storage sessions still only see
// each popup once per page session instead of on every board refresh.
const memorySeen = new Map<string, Set<string>>();

function loadSeen(token: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(seenKey(token));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* fall through to memory */
  }
  return memorySeen.get(token) ?? null;
}

function saveSeen(token: string, keys: Set<string>) {
  memorySeen.set(token, new Set(keys));
  try {
    // Cap so localStorage never grows unbounded.
    localStorage.setItem(seenKey(token), JSON.stringify([...keys].slice(-400)));
  } catch {
    /* ignore — memory fallback covers this session */
  }
}

/**
 * Front-and-center popups for cards the viewer hasn't seen yet.
 * - First ever visit: only office-pushed cards still in their "Sent" stage
 *   pop (everything else baselines quietly).
 * - After that: any card that appears on the board and isn't in the local
 *   seen-set pops the next time the board opens or refreshes.
 * Fully interactive — invoice approve/pay works right inside the popup.
 */
export function NewCardSpotlight({
  token,
  cards,
  readOnly,
  onOpenDetails,
}: {
  token: string;
  cards: any[];
  readOnly: boolean;
  onOpenDetails: (card: any) => void;
}) {
  const [queue, setQueue] = useState<any[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!cards || cards.length === 0 || queue !== null) return;
    const seen = loadSeen(token);
    let fresh: any[];
    if (seen === null) {
      // First visit: baseline quietly, but still spotlight unactioned pushes.
      fresh = cards.filter(
        (c: any) => String(c.cardKey).startsWith('push:') && c.stageIndex === 0,
      );
      const baseline = new Set(cards.map((c: any) => String(c.cardKey)));
      for (const c of fresh) baseline.delete(String(c.cardKey));
      saveSeen(token, baseline);
    } else {
      fresh = cards.filter((c: any) => !seen.has(String(c.cardKey)));
    }
    // Pushed cards first — they're the ones the office wants front and center.
    fresh.sort((a: any, b: any) => {
      const ap = String(a.cardKey).startsWith('push:') ? 0 : 1;
      const bp = String(b.cardKey).startsWith('push:') ? 0 : 1;
      return ap - bp;
    });
    setQueue(fresh.slice(0, 8)); // never blast more than 8 popups
  }, [cards, token, queue]);

  const current = queue && index < queue.length ? queue[index] : null;

  const markSeen = (keys: string[]) => {
    const seen = loadSeen(token) ?? new Set<string>();
    for (const k of keys) seen.add(k);
    saveSeen(token, seen);
  };

  const advance = () => {
    if (!queue) return;
    if (current) markSeen([String(current.cardKey)]);
    setIndex((i) => i + 1);
  };

  const dismissAll = () => {
    if (queue) markSeen(queue.map((c: any) => String(c.cardKey)));
    setIndex(queue ? queue.length : 0);
  };

  const total = queue?.length ?? 0;
  const isPush = current ? String(current.cardKey).startsWith('push:') : false;

  const amountText = useMemo(() => {
    if (!current || typeof current.amount !== 'number') return null;
    return current.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }, [current]);

  if (!current) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismissAll(); }}>
      <DialogContent
        className="max-w-[420px] rounded-[24px] p-0 overflow-hidden border-0 shadow-[0_24px_80px_rgba(0,0,0,0.35)] gap-0 text-white"
        data-testid="new-card-spotlight"
      >
        <div className="bg-[#101C33] px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#B4FF44]">
            <Sparkles className="w-4 h-4" />
            <DialogTitle className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-[#B4FF44]">
              New on your board{total > 1 ? ` — ${index + 1} of ${total}` : ''}
            </DialogTitle>
          </div>
          {/* Dismissal uses the dialog's built-in close (top-right X), wired
              through onOpenChange → dismissAll. */}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={String(current.cardKey)}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
            className="px-5 pt-4 pb-5 bg-white text-[#1d1d1f]"
          >
            {isPush && (
              <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#6e6e73] mb-1.5">
                From Archangel
              </div>
            )}
            <div className="text-[19px] font-bold text-[#1d1d1f] leading-snug">{current.title}</div>
            {current.subtitle && !isPush && (
              <div className="text-[13px] text-[#6e6e73] mt-0.5">{current.subtitle}</div>
            )}
            {amountText && !current.module && (
              <div className="text-[15px] font-semibold text-[#1d1d1f] mt-1">{amountText}</div>
            )}
            {current.description && (
              <p className="text-[13px] text-[#3a3a3c] mt-2 leading-relaxed line-clamp-4">{current.description}</p>
            )}
            {current.module && (
              <div className="mt-3 space-y-2">
                <ModuleMetrics module={current.module} tint={{ bd: '#f5f5f7' }} />
                <ModuleEvidence module={current.module} tint={{ bg: '#fafafa', border: '#e8e8ed', hairline: '#e8e8ed', bd: '#e8e8ed' }} />
                <ModuleDecision cardKey={current.cardKey} token={token} module={current.module} readOnly={readOnly} tint={{ bd: '#e8e8ed' }} />
              </div>
            )}
            <div className="flex items-center gap-2 mt-5">
              <button
                type="button"
                data-testid="spotlight-details"
                onClick={() => {
                  markSeen([String(current.cardKey)]);
                  onOpenDetails(current);
                  dismissAll();
                }}
                className="h-[40px] px-4 rounded-[12px] bg-black/[0.05] text-[#1d1d1f] text-[13px] font-semibold hover:bg-black/[0.08] transition-colors"
              >
                View details
              </button>
              <button
                type="button"
                data-testid="spotlight-next"
                onClick={advance}
                className="flex-1 h-[40px] rounded-[12px] bg-[#B4FF44] text-[#101C33] text-[13px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-[#9EE622] transition-colors"
              >
                {index + 1 < total ? (<>Next <ArrowRight className="w-4 h-4" /></>) : 'Got it'}
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
