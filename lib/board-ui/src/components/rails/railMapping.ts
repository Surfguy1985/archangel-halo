import type { RailTone } from './railTokens';

/**
 * Rail mapping — projects the existing client-board card contract (lanes +
 * needsAction + modules) into the five fixed rails from the Halo master
 * spec. Pure adapter: the server contract, office mirror, and drag gates on
 * other surfaces are untouched.
 */

export type RailKey = 'needs_you' | 'in_progress' | 'requested' | 'done' | 'paid';

export const RAIL_ORDER: Array<{ key: RailKey; label: string; empty: string }> = [
  { key: 'requested', label: 'Requested', empty: 'No open requests' },
  { key: 'in_progress', label: 'In progress', empty: 'Nothing in motion right now' },
  { key: 'done', label: 'Done', empty: 'Nothing recently finished' },
  { key: 'paid', label: 'Billing', empty: 'No billing activity yet' },
  // Alerts sits AFTER Billing: past-due invoices and anything else waiting on
  // the viewer lands here, in red.
  { key: 'needs_you', label: 'Alerts', empty: 'No alerts — you\u2019re all caught up' },
];

export interface RailTileModel {
  cardKey: string;
  title: string;
  subtitle: string | null;
  chip: string | null;
  tone: RailTone;
  artworkUrl: string | null;
  accent: boolean;
  unread: number;
  card: any;
}

const fmtMoney = (n: number) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

function moduleStatus(card: any): string {
  return String(card?.module?.status ?? '').toLowerCase();
}

function isMoneyCard(card: any): boolean {
  const t = String(card?.template ?? '');
  return t.includes('invoice') || t.includes('payment') || card?.module?.type === 'invoice';
}

/** Client reported payment from their board — "payment on its way". */
export function clientPaidPending(card: any): boolean {
  return !!card?.module?.clientPaidAt && moduleStatus(card) !== 'paid';
}

export function railFor(card: any): RailKey {
  if (moduleStatus(card) === 'paid') return 'paid';
  // "Payment on its way" sits in Billing, not Alerts, even if past due.
  if (clientPaidPending(card)) return 'paid';
  if (card.needsAction && !card.snoozedUntil) return 'needs_you';
  switch (card.lane) {
    case 'requested':
      return 'requested';
    case 'scheduled':
    case 'in_progress':
      return 'in_progress';
    case 'done':
      return 'done';
    case 'billing':
      // Invoices wait in Billing (max 24h server-side, then needsAction flips
      // them into Alerts as past due).
      return 'paid';
    default:
      return 'requested';
  }
}

/** Plain phrase, present tense — never an internal enum. */
export function plainStatus(card: any, rail: RailKey): string | null {
  if (card.priority === 'urgent') return 'Emergency';
  if (rail === 'paid') {
    if (moduleStatus(card) === 'paid') return 'Paid';
    if (clientPaidPending(card)) return 'Payment on its way';
    return isMoneyCard(card) ? 'Awaiting payment' : 'Billing';
  }
  if (rail === 'needs_you') {
    if (isMoneyCard(card)) return 'Past due';
    return 'Needs you';
  }
  if (card.crew?.onSite) return 'Crew on site';
  if (rail === 'in_progress') {
    if (card.lane === 'scheduled') return 'Scheduled';
    if (card.lane === 'billing') return 'Being processed';
    return 'In progress';
  }
  if (rail === 'requested') {
    return String(card.status ?? '').toLowerCase() === 'declined' ? 'Declined' : 'Requested';
  }
  if (rail === 'done') return 'Done';
  return null;
}

export function toneFor(card: any, rail: RailKey): RailTone {
  if (card.priority === 'urgent') return 'warning';
  if (rail === 'needs_you') return 'action';
  if (rail === 'done' || rail === 'paid') return 'done';
  return 'active';
}

export function tileFor(card: any): RailTileModel {
  const rail = railFor(card);
  const isMoney = typeof card.amount === 'number' && card.amount !== 0;
  const unitTitle = card.unitNo ? `Unit ${card.unitNo}` : null;
  const title = isMoney ? fmtMoney(card.amount) : unitTitle ?? String(card.title ?? 'Card');
  // When the title was replaced by the amount/unit, the original title
  // becomes the second line so nothing is lost.
  const subtitle =
    (isMoney || (unitTitle && card.title)) && card.title !== title
      ? String(card.title)
      : card.subtitle
        ? String(card.subtitle)
        : null;
  return {
    cardKey: String(card.cardKey),
    title,
    subtitle,
    chip: plainStatus(card, rail),
    tone: toneFor(card, rail),
    artworkUrl: card.photos?.[0]?.url ?? null,
    accent: rail === 'needs_you',
    unread: Number(card.unreadComments ?? 0),
    card,
  };
}

export function mapCardsToRails(cards: any[]): Record<RailKey, RailTileModel[]> {
  const rails: Record<RailKey, RailTileModel[]> = {
    needs_you: [],
    in_progress: [],
    requested: [],
    done: [],
    paid: [],
  };
  for (const card of cards ?? []) {
    if (card.snoozedUntil && new Date(card.snoozedUntil).getTime() > Date.now()) continue;
    rails[railFor(card)].push(tileFor(card));
  }
  // Stable ordering: board position, pushed cards (-1) float to the front.
  for (const key of Object.keys(rails) as RailKey[]) {
    rails[key].sort((a, b) => (a.card.position ?? 0) - (b.card.position ?? 0));
  }
  return rails;
}
