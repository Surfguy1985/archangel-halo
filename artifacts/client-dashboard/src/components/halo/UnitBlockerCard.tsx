/**
 * UnitBlockerCard — shows what's preventing a unit from being ready.
 * Derives blockers from board card data (checklist items, change order, invoice status, crew checkout).
 * "Request update" CTA sends a message to the office via concierge.
 */
import React, { useState } from 'react';
import { type ClientBoardCardView } from '@workspace/api-client-react';
import { AlertCircle, CheckSquare, FileText, RefreshCw, Users, CheckCircle2, Loader2 } from 'lucide-react';

type Blocker = {
  icon: typeof AlertCircle;
  iconColor: string;
  label: string;
};

type Props = {
  unitLabel: string;
  cards: ClientBoardCardView[];
  token: string;
  permissions: string[];
  onAsk: (q: string) => void;
};

export function UnitBlockerCard({ unitLabel, cards, token, permissions, onAsk }: Props) {
  const hasFinancialAccess = permissions.includes('invoices') || permissions.includes('financial');
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);

  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const card = cards.find(c => c.unitNo && norm(c.unitNo) === norm(unitLabel))
    ?? cards.find(c => c.title.toLowerCase().includes(norm(unitLabel)));

  const blockers: Blocker[] = [];

  if (card) {
    // Open checklist items
    const openItems = (card.checklist ?? []).filter(i => !i.done);
    if (openItems.length > 0) {
      blockers.push({
        icon: CheckSquare,
        iconColor: '#F59E0B',
        label: `${openItems.length} checklist item${openItems.length !== 1 ? 's' : ''} not completed`,
      });
    }

    // Pending change order
    if (card.changeOrder) {
      blockers.push({
        icon: RefreshCw,
        iconColor: '#6366F1',
        label: 'Change order awaiting office review',
      });
    }

    // Crew not checked out (on site)
    if (card.crew?.onSite) {
      blockers.push({
        icon: Users,
        iconColor: '#3B82F6',
        label: `${card.crew.name.split(' ')[0]} still on site — not yet checked out`,
      });
    }

    // Invoice not paid — only surfaced when viewer has financial access
    if (hasFinancialAccess && card.amount != null && card.amount > 0 && card.lane !== 'done') {
      blockers.push({
        icon: FileText,
        iconColor: '#E11D48',
        label: `Invoice of $${card.amount.toLocaleString()} outstanding`,
      });
    }

    // Lane-level blocks
    if (card.lane === 'alerts') {
      blockers.push({
        icon: AlertCircle,
        iconColor: '#E11D48',
        label: 'Card is in alert status — action required',
      });
    }
  }

  const handleRequestUpdate = async () => {
    setRequesting(true);
    try {
      const resp = await fetch(`/api/client/${token}/concierge`, {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: `Please provide an update on Unit ${unitLabel} — when will it be ready?` }),
      });
      if (resp.ok) {
        // Drain the SSE stream so the server completes the request, then mark done.
        const reader = resp.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
          }
          // Look for a non-empty assistant reply; even an empty stream is a successful send.
          void buf;
        }
        setRequested(true);
      } else {
        // Non-2xx response — surface via Ask button instead
        onAsk(`Please provide an update on Unit ${unitLabel} — when will it be ready?`);
      }
    } catch {
      // Network error — fall back to ask
      onAsk(`Please provide an update on Unit ${unitLabel} — when will it be ready?`);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="bg-[#0C1B30] border border-white/7 rounded-2xl overflow-hidden mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
      <div className="px-4 pt-3.5 pb-2.5 border-b border-white/5 flex items-center gap-2">
        <AlertCircle className="w-3 h-3 text-[#E11D48]/60 shrink-0" />
        <span className="text-[9.5px] font-bold tracking-[0.2em] uppercase text-white/30">Unit {unitLabel} — Blockers</span>
      </div>

      {!card ? (
        <div className="px-4 py-4">
          <p className="text-[12.5px] text-white/40">No active work found for Unit {unitLabel}.</p>
        </div>
      ) : blockers.length === 0 ? (
        <div className="px-4 py-4 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-[#22C55E]/70 shrink-0" />
          <span className="text-[12.5px] text-white/55">No blockers found — Unit {unitLabel} is on track.</span>
        </div>
      ) : (
        <ol className="px-4 py-3 space-y-2.5">
          {blockers.map((b, i) => {
            const Icon = b.icon;
            return (
              <li key={i} className="flex items-start gap-3">
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                  <span className="text-[9.5px] font-bold text-white/22 w-3 text-right">{i + 1}.</span>
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: b.iconColor }} />
                </div>
                <span className="text-[12.5px] text-white/70 leading-snug">{b.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="px-4 pb-4 flex gap-2 border-t border-white/[0.04] pt-3">
        {requested ? (
          <div className="flex items-center gap-1.5 text-[11.5px] text-[#22C55E]/75 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Update request sent to office
          </div>
        ) : (
          <button onClick={handleRequestUpdate} disabled={requesting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-[#0A0F1A] text-[11.5px] font-bold hover:bg-white/92 active:scale-[0.97] transition-all disabled:opacity-50">
            {requesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Request update
          </button>
        )}
        <button onClick={() => onAsk(`What's the full status of Unit ${unitLabel}?`)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/8 text-white/45 text-[11.5px] font-bold hover:text-white/70 hover:bg-white/8 active:scale-[0.97] transition-all">
          Ask Halo One
        </button>
      </div>
    </div>
  );
}
