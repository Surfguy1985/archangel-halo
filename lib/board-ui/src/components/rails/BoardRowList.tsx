import React from 'react';
import { RAIL_DENSITY, ROW_SPINE, ROW_TOKENS, RAIL_TONES } from './railTokens';
import { railFor, plainStatus, toneFor, RAIL_ORDER, type RailKey } from './railMapping';

/**
 * BoardRowList — the office (compact) rendering of the same card contract
 * the client tiles read. One dense list: 3px status spine, object column
 * (title with scope/deadline beneath), owner, plain-phrase status, right-
 * aligned tabular amount. Square corners, hairline dividers, hover tint.
 *
 * Tokens come from railTokens via the density switch — change a token there
 * and both the client tiles and these rows update.
 */

export interface BoardRowModel {
  cardKey: string;
  rail: RailKey;
  title: string;
  subtitle: string | null;
  owner: string | null;
  status: string | null;
  tone: keyof typeof ROW_SPINE;
  amount: number | null;
  card: any;
}

const fmtMoney = (n: number) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

function ownerFor(card: any): string | null {
  return card?.crew?.name ?? card?.module?.crewName ?? card?.createdByName ?? null;
}

function subtitleFor(card: any): string | null {
  const parts: string[] = [];
  if (card.subtitle) parts.push(String(card.subtitle));
  else if (card.description) parts.push(String(card.description));
  if (card.dueOn) parts.push(`due ${card.dueOn}`);
  return parts.length ? parts.join(' · ') : null;
}

/** Project cards → row models, ordered by rail (Needs first) then position. */
export function mapCardsToRows(cards: any[] | undefined, rail?: RailKey | null): BoardRowModel[] {
  const withRail = (cards ?? []).map((card) => ({ card, rail: railFor(card) }));
  const filtered = rail ? withRail.filter((x) => x.rail === rail) : withRail;
  const order = new Map(RAIL_ORDER.map((r, i) => [r.key, i]));
  filtered.sort(
    (a, b) =>
      (order.get(a.rail)! - order.get(b.rail)!) ||
      ((a.card.position ?? 0) - (b.card.position ?? 0)),
  );
  return filtered.map(({ card, rail: r }) => ({
    cardKey: card.cardKey,
    rail: r,
    title: card.unitNo ? `${card.title} · Unit ${card.unitNo}` : String(card.title ?? ''),
    subtitle: subtitleFor(card),
    owner: ownerFor(card),
    status: plainStatus(card, r),
    tone: toneFor(card, r),
    amount: typeof card.amount === 'number' ? card.amount : null,
    card,
  }));
}

export function BoardRowList({
  rows,
  selectedKey,
  onOpen,
  onSelect,
  emptyMessage = 'No cards match this filter',
}: {
  rows: BoardRowModel[];
  selectedKey?: string | null;
  onOpen: (card: any) => void;
  onSelect?: (cardKey: string) => void;
  emptyMessage?: string;
}) {
  const d = RAIL_DENSITY.compact;
  if (rows.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-[13px] text-stone-400" data-testid="rows-empty">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div
      className={`w-full border-y border-stone-200 dark:border-stone-700 ${ROW_TOKENS.divider}`}
      role="list"
      data-testid="board-row-list"
    >
      {rows.map((r) => {
        const selected = r.cardKey === selectedKey;
        return (
          <button
            key={r.cardKey}
            type="button"
            role="listitem"
            /* Keyboard J/K must keep the selection visible on long lists. */
            ref={selected ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            aria-selected={selected || undefined}
            data-testid={`board-row-${r.cardKey}`}
            data-selected={selected || undefined}
            onClick={() => {
              onSelect?.(r.cardKey);
              onOpen(r.card);
            }}
            onMouseEnter={() => onSelect?.(r.cardKey)}
            className={`relative flex w-full items-center gap-4 rounded-none px-4 text-left ${ROW_TOKENS.height} ${
              selected ? ROW_TOKENS.selected : ROW_TOKENS.hover
            } transition-colors focus:outline-none`}
          >
            {/* 3px status spine */}
            <span className={`absolute inset-y-0 left-0 w-[3px] ${ROW_SPINE[r.tone]}`} aria-hidden />

            {/* Object: title + scope/deadline beneath. min-w-0 for containment. */}
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${d.title}`}>{r.title}</span>
              {r.subtitle && (
                <span className={`block truncate text-stone-500 dark:text-stone-400 ${d.subtitle}`}>
                  {r.subtitle}
                </span>
              )}
            </span>

            {/* Owner */}
            <span className={`hidden w-[130px] shrink-0 truncate sm:block ${ROW_TOKENS.owner}`}>
              {r.owner ?? '—'}
            </span>

            {/* Plain-phrase status */}
            <span className={`w-[110px] shrink-0 truncate text-[12px] font-semibold ${RAIL_TONES[r.tone].chip}`}>
              {r.status ?? ''}
            </span>

            {/* Amount, right-aligned tabular */}
            <span className={`w-[90px] shrink-0 ${ROW_TOKENS.amount}`}>
              {r.amount != null ? fmtMoney(r.amount) : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}
