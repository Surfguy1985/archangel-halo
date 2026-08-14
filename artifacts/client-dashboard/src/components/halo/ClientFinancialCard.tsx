/**
 * ClientFinancialCard — financial summary lens.
 * Permission-gated: only renders if permissions includes 'invoices'.
 * Fetches from /client/:token/board/kpis.
 * NEVER shows individual line-item amounts, crew rates, or margins.
 */
import React from 'react';
import {
  useGetClientBoardKpis,
  getGetClientBoardKpisQueryKey,
} from '@workspace/api-client-react';
import { DollarSign, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

type Props = {
  token: string;
  permissions: string[];
};

function Num({ value, prefix = '$', color }: { value: number; prefix?: string; color?: string }) {
  return (
    <span className="text-[22px] font-bold tabular-nums" style={{ color: color ?? 'white' }}>
      {prefix}{value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
    </span>
  );
}

export function ClientFinancialCard({ token, permissions }: Props) {
  const hasPermission = permissions.includes('invoices') || permissions.includes('financial');

  const { data, isLoading, error } = useGetClientBoardKpis(token, {
    query: {
      queryKey: getGetClientBoardKpisQueryKey(token),
      enabled: hasPermission,
    },
  });

  if (!hasPermission) {
    return (
      <div className="bg-[#0C1B30] border border-white/7 rounded-2xl px-4 py-4 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <AlertCircle className="w-4 h-4 text-white/25 shrink-0" />
        <span className="text-[12.5px] text-white/40">Financial data is not enabled for this account.</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-[#0C1B30] border border-white/7 rounded-2xl px-4 py-5 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <Loader2 className="w-4 h-4 text-[#B4FF44]/50 animate-spin shrink-0" />
        <span className="text-[12.5px] text-white/38">Loading financial summary…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#0C1B30] border border-[#E11D48]/15 rounded-2xl px-4 py-4 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <AlertCircle className="w-4 h-4 text-[#E11D48]/60 shrink-0" />
        <span className="text-[12.5px] text-white/45">Financial data unavailable.</span>
      </div>
    );
  }

  const outstanding = data.invoicesOutstanding ?? 0;
  const overdue = data.invoicesOverdue ?? 0;
  const paid = data.paidLast30 ?? 0;
  const invoiced = outstanding + paid;

  return (
    <div className="bg-[#0C1B30] border border-white/7 rounded-2xl overflow-hidden mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
      <div className="px-4 pt-3.5 pb-2.5 border-b border-white/5 flex items-center gap-2">
        <DollarSign className="w-3 h-3 text-[#B4FF44]/50 shrink-0" />
        <span className="text-[9.5px] font-bold tracking-[0.2em] uppercase text-white/30">Financial Summary</span>
        <span className="ml-auto text-[10px] text-white/20">Last 30 days</span>
      </div>

      <div className="px-4 py-4 grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-[9.5px] font-bold tracking-[0.14em] uppercase text-white/25">Invoiced</div>
          <Num value={invoiced} />
          <div className="text-[10px] text-white/30">Total billed</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-[9.5px] font-bold tracking-[0.14em] uppercase text-[#22C55E]/50">Paid</div>
          <Num value={paid} color="#22C55E" />
          <div className="text-[10px] text-white/30">Received</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-[9.5px] font-bold tracking-[0.14em] uppercase"
            style={{ color: outstanding > 0 ? 'rgba(241,90,36,0.6)' : 'rgba(255,255,255,0.25)' }}>
            Outstanding
          </div>
          <Num value={outstanding} color={outstanding > 0 ? '#F15A24' : 'rgba(255,255,255,0.45)'} />
          <div className="text-[10px] text-white/30">Unpaid</div>
        </div>
      </div>

      {overdue > 0 && (
        <div className="mx-4 mb-4 px-3.5 py-2.5 rounded-xl bg-[#E11D48]/8 border border-[#E11D48]/15 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-[#E11D48]/70 shrink-0" />
          <span className="text-[12px] text-[#E11D48]/80">
            <span className="font-bold">${overdue.toLocaleString()}</span> is past due
          </span>
        </div>
      )}

      {outstanding === 0 && (
        <div className="mx-4 mb-4 px-3.5 py-2.5 rounded-xl bg-[#22C55E]/6 border border-[#22C55E]/12 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]/70 shrink-0" />
          <span className="text-[12px] text-[#22C55E]/75 font-medium">All invoices paid — you're up to date.</span>
        </div>
      )}

      <div className="px-4 pb-4 grid grid-cols-2 gap-2">
        <div className="bg-white/[0.028] border border-white/5 rounded-xl px-3 py-2.5">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/22 mb-0.5">Open Jobs</div>
          <div className="text-[18px] font-bold text-white/75 tabular-nums">{data.openJobs}</div>
        </div>
        {data.nextVisit && (
          <div className="bg-white/[0.028] border border-white/5 rounded-xl px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/22 mb-0.5">Next Visit</div>
            <div className="text-[12px] font-bold text-white/75">{data.nextVisit}</div>
          </div>
        )}
      </div>
    </div>
  );
}
