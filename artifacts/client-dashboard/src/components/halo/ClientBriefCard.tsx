/**
 * ClientBriefCard — inline client morning brief lens.
 * Fetches from GET /client/:token/briefing and renders prioritised items.
 * Client-safe: no margins, no crew economics, no admin controls.
 */
import React from 'react';
import {
  useGetClientBriefing,
  type ClientBriefItem,
} from '@workspace/api-client-react';
import { AlertCircle, Clock, Loader2, CheckCircle2, Sparkles } from 'lucide-react';

const CATEGORY_COLORS: Record<string, string> = {
  'Move-in Risk': '#E11D48',
  'Requests': '#F59E0B',
  'Invoices': '#6366F1',
  'Crew Activity': '#22C55E',
  'Upcoming Work': '#3B82F6',
};

function tierBadge(tier: string) {
  if (tier === 'now') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#E11D48]/12 text-[#E11D48]/85 border border-[#E11D48]/20">NOW</span>;
  if (tier === 'today') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#F59E0B]/12 text-[#F59E0B]/85 border border-[#F59E0B]/20">TODAY</span>;
  return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-white/5 text-white/35 border border-white/8">WEEK</span>;
}

const FINANCIAL_CATEGORIES = new Set(['Invoices']);

type Props = {
  token: string;
  topN?: number;
  permissions: string[];
  onAsk: (query: string) => void;
};

export function ClientBriefCard({ token, topN = 5, permissions, onAsk }: Props) {
  const hasFinancialAccess = permissions.includes('invoices') || permissions.includes('financial');
  const { data, isLoading, error } = useGetClientBriefing(token);

  if (isLoading) {
    return (
      <div className="bg-[#0C1B30] border border-white/7 rounded-2xl px-4 py-5 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <Loader2 className="w-4 h-4 text-[#B4FF44]/50 animate-spin shrink-0" />
        <span className="text-[12.5px] text-white/38">Loading your brief…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#0C1B30] border border-[#E11D48]/15 rounded-2xl px-4 py-4 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <AlertCircle className="w-4 h-4 text-[#E11D48]/60 shrink-0" />
        <span className="text-[12.5px] text-white/45">Brief unavailable right now.</span>
      </div>
    );
  }

  // Strip invoice-category items entirely for viewers without financial access;
  // amounts on remaining items are also hidden below.
  const items = (data.items ?? [])
    .filter(item => hasFinancialAccess || !FINANCIAL_CATEGORIES.has(item.category))
    .slice(0, topN);

  if (items.length === 0) {
    return (
      <div className="bg-[#0C1B30] border border-[#22C55E]/15 rounded-2xl px-4 py-4 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <CheckCircle2 className="w-4 h-4 text-[#22C55E]/70 shrink-0" />
        <span className="text-[12.5px] text-white/55">All clear — no urgent items for your property today.</span>
      </div>
    );
  }

  return (
    <div className="bg-[#0C1B30] border border-white/7 rounded-2xl overflow-hidden mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
      <div className="px-4 pt-3.5 pb-2 border-b border-white/5 flex items-center gap-2">
        <Clock className="w-3 h-3 text-[#B4FF44]/50 shrink-0" />
        <span className="text-[9.5px] font-bold tracking-[0.2em] uppercase text-white/30">Morning Brief</span>
        <span className="ml-auto text-[10px] text-white/20">{data.propertyName}</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {items.map((item: ClientBriefItem, i: number) => {
          const color = CATEGORY_COLORS[item.category] ?? '#B4FF44';
          const urgentHighlight = item.urgency >= 80;
          return (
            <div key={i}
              className={`px-4 py-3.5 flex items-start gap-3 ${urgentHighlight ? 'bg-[#E11D48]/[0.028]' : ''}`}>
              <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  {tierBadge(item.tier)}
                  <span className="text-[9.5px] font-semibold tracking-[0.08em] uppercase"
                    style={{ color: `${color}99` }}>{item.category}</span>
                </div>
                <div className="text-[13px] font-semibold text-white/80 leading-snug">{item.title}</div>
                <div className="text-[11.5px] text-white/38 mt-0.5 leading-snug">{item.body}</div>
                {hasFinancialAccess && item.amount != null && item.amount > 0 && (
                  <div className="text-[11px] text-white/30 mt-0.5 tabular-nums">${item.amount.toLocaleString()}</div>
                )}
              </div>
              <button
                onClick={() => onAsk(`Tell me more about: ${item.title}`)}
                className="shrink-0 flex items-center gap-1 text-[10.5px] text-[#B4FF44]/40 hover:text-[#B4FF44]/70 transition-colors px-1.5 py-1 rounded-lg hover:bg-[#B4FF44]/5 active:scale-[0.95]">
                <Sparkles className="w-2.5 h-2.5" />Ask
              </button>
            </div>
          );
        })}
      </div>
      {items.length < (data.items?.length ?? 0) && (
        <button
          onClick={() => onAsk("What are all the items in my property brief today?")}
          className="w-full py-2.5 text-[11px] text-[#B4FF44]/40 hover:text-[#B4FF44]/65 transition-colors border-t border-white/5 text-center">
          See all {data.items.length} items →
        </button>
      )}
    </div>
  );
}
