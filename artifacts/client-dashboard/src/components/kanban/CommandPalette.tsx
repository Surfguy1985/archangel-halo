import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClientBoardCardView } from '@workspace/api-client-react';
import { Search, CornerDownLeft } from 'lucide-react';
import { specFor } from './templateSpec';
import { cardCode } from './BoardCard';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  cards: ClientBoardCardView[];
  lanes: { key: string; label: string }[];
  onSelectCard: (card: ClientBoardCardView) => void;
}

/**
 * ⌘K command palette for the client board. Token-AND matching across
 * card code, title, template, unit and assignee; arrows + Enter open
 * the card detail dialog, Escape closes.
 */
export function CommandPalette({ open, onClose, cards, lanes, onSelectCard }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const laneLabel = useMemo(() => {
    const m: Record<string, string> = {};
    lanes.forEach((l) => { m[l.key] = l.label; });
    return m;
  }, [lanes]);

  // Pre-compute a searchable haystack per card.
  const indexed = useMemo(
    () =>
      cards.map((card) => {
        const spec = specFor(card.template);
        const code = cardCode(card, spec);
        const haystack = [
          code,
          card.cardKey,
          card.title,
          card.template,
          spec.name,
          spec.categoryLabel,
          card.unitNo,
          card.subtitle,
          card.crew?.name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return { card, code, spec, haystack };
      }),
    [cards],
  );

  const results = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return indexed.slice(0, 12);
    return indexed
      .filter(({ haystack }) => tokens.every((t) => haystack.includes(t)))
      .slice(0, 12);
  }, [indexed, query]);

  // Reset state each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the active row visible while arrowing.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const pick = (card: ClientBoardCardView) => {
    onClose();
    onSelectCard(card);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIndex];
      if (r) pick(r.card);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-[#101c33]/40 backdrop-blur-[2px] pt-[12vh] px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="command-palette"
    >
      <div
        className="w-full max-w-[620px] bg-white rounded-[16px] shadow-[0_24px_60px_rgba(16,28,51,0.35)] border border-black/10 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 h-[52px] border-b border-black/5">
          <Search className="h-4 w-4 text-[#96948B] shrink-0" />
          <input
            ref={inputRef}
            data-testid="input-command-palette"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cards by id, title, unit, or crew…"
            className="flex-1 h-full bg-transparent outline-none text-[14px] font-[600] text-[#101c33] placeholder:text-[#96948B] placeholder:font-[500]"
          />
          <kbd className="shrink-0 rounded-[6px] border border-black/10 bg-[#F4F2EC] px-1.5 py-[2px] text-[10px] font-[700] text-[#96948B]">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] font-[700] text-[#101c33]">No matching cards</p>
              <p className="text-[11px] font-[500] text-[#96948B] mt-1">
                Try a card id, title, unit number, or crew name.
              </p>
            </div>
          ) : (
            results.map(({ card, code, spec }, i) => (
              <button
                key={card.cardKey}
                data-index={i}
                data-testid={`palette-result-${card.cardKey}`}
                onClick={() => pick(card)}
                onMouseMove={() => setActiveIndex(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === activeIndex ? 'bg-[#F4F2EC]' : 'bg-transparent'
                }`}
              >
                <span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: spec.accent }} />
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[10px] font-[700] text-[#6E6C63] shrink-0">{code}</span>
                    <span className="text-[13px] font-[700] text-[#101c33] truncate">{card.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10.5px] font-[600] text-[#96948B] min-w-0">
                    <span className="truncate">{spec.name}</span>
                    {card.unitNo && <span className="shrink-0">· {card.unitNo}</span>}
                    {card.crew?.name && <span className="truncate">· {card.crew.name}</span>}
                    <span className="shrink-0">· {laneLabel[card.lane] ?? card.lane}</span>
                  </div>
                </div>
                {i === activeIndex && (
                  <CornerDownLeft className="h-3.5 w-3.5 text-[#96948B] shrink-0" />
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 px-4 h-[34px] border-t border-black/5 bg-[#FBFAF7] text-[10px] font-[600] text-[#96948B]">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <div className="flex-1" />
          <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
