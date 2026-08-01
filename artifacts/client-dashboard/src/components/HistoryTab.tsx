import {
  useGetClientBoardHistory,
  getGetClientBoardHistoryQueryKey,
  useRestoreClientBoardCard,
  getGetClientBoardQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Download, CheckCircle2, DollarSign, Archive, RotateCcw } from 'lucide-react';
import { useState } from 'react';

// Cleared-card history: everything the client trashes off the board lands
// here, grouped by the day it was cleared, with a one-tap CSV export.

const STATUS_META: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  completed: { label: 'Completed', className: 'bg-[#34C759]/10 text-[#248A3D]', Icon: CheckCircle2 },
  paid: { label: 'Paid', className: 'bg-[#007AFF]/10 text-[#0062CC]', Icon: DollarSign },
  cleared: { label: 'Cleared', className: 'bg-[#8E8E93]/10 text-[#6e6e73]', Icon: Archive },
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function HistoryTab({ token, canRestore = false }: { token: string; canRestore?: boolean }) {
  const { data, isLoading } = useGetClientBoardHistory(token, {
    query: { queryKey: getGetClientBoardHistoryQueryKey(token) },
  });
  const [exporting, setExporting] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const restoreMutation = useRestoreClientBoardCard();

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    try {
      await restoreMutation.mutateAsync({ token, id });
      // Card is back on the board — refresh both the history list and board.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetClientBoardHistoryQueryKey(token) }),
        queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) }),
      ]);
    } finally {
      setRestoringId(null);
    }
  };

  const entries = data?.entries ?? [];

  const handleExport = async () => {
    setExporting(true);
    try {
      // Manual /api URLs must be absolute — never BASE_URL-prefixed.
      const res = await fetch(`/api/client/${token}/board/history.csv`, { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'board-history.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#8E8E93]" />
      </div>
    );
  }

  // Group by cleared date (local)
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = new Date(e.clearedAt).toDateString();
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const totalPaid = entries.reduce((s, e) => s + e.amountPaid, 0);

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5" data-testid="history-tab">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[17px] font-bold text-[#1d1d1f]">Cleared cards</h2>
            <p className="text-[12px] font-medium text-[#6e6e73]">
              {entries.length} card{entries.length === 1 ? '' : 's'} · {money(totalPaid)} paid
            </p>
          </div>
          <button
            data-testid="button-export-history"
            onClick={handleExport}
            disabled={exporting || entries.length === 0}
            className="flex h-9 items-center gap-2 rounded-[10px] bg-[#1d1d1f] px-3.5 text-[13px] font-semibold text-white hover:bg-black transition-colors disabled:opacity-40"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export CSV
          </button>
        </div>

        {entries.length === 0 && (
          <div className="rounded-[14px] border border-dashed border-black/10 bg-white p-8 text-center">
            <Archive className="mx-auto h-6 w-6 text-[#c7c7cc]" />
            <p className="mt-2 text-[13px] font-medium text-[#6e6e73]">
              Nothing cleared yet. Tap the trash icon on any card to move it here.
            </p>
          </div>
        )}

        {[...groups.entries()].map(([day, list]) => (
          <div key={day} className="mb-6">
            <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[#8E8E93]">
              {dayLabel(list[0]!.clearedAt)}
            </h3>
            <div className="overflow-hidden rounded-[14px] border border-black/[0.06] bg-white divide-y divide-black/[0.05]">
              {list.map((e) => {
                const meta = STATUS_META[e.status] ?? STATUS_META.cleared!;
                return (
                  <div key={e.id} className="flex items-start gap-3 p-3.5" data-testid={`history-entry-${e.id}`}>
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.className}`}>
                      <meta.Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold text-[#1d1d1f]">{e.title}</p>
                        {e.amountPaid > 0 && (
                          <span className="shrink-0 text-[13px] font-bold text-[#1d1d1f]">{money(e.amountPaid)}</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-[#6e6e73]">
                        <span className={`rounded-full px-1.5 py-px font-semibold ${meta.className}`}>{meta.label}</span>
                        {e.unitLabel && <span>Unit {e.unitLabel}</span>}
                        {e.jobLabel && <span>{e.jobLabel}</span>}
                        <span>{e.frequency === 'recurring' ? 'Recurring' : 'One time'}</span>
                        {e.restoredAt && (
                          <span className="rounded-full bg-[#AF52DE]/10 px-1.5 py-px font-semibold text-[#8944AB]">
                            Restored
                          </span>
                        )}
                      </div>
                      {e.summary && (
                        <p className="mt-1 line-clamp-2 text-[12px] text-[#6e6e73]">{e.summary}</p>
                      )}
                    </div>
                    {canRestore && !e.restoredAt && (
                      <button
                        data-testid={`button-restore-${e.id}`}
                        onClick={() => handleRestore(e.id)}
                        disabled={restoringId !== null}
                        className="mt-0.5 flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border border-black/10 bg-white px-2.5 text-[12px] font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors disabled:opacity-40"
                      >
                        {restoringId === e.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" strokeWidth={2.5} />
                        )}
                        Restore
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
