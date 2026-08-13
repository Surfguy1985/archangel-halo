/**
 * Desktop KanbanPanel — right-side slide-over showing the job board.
 */
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useListJobBoard, getListJobBoardQueryKey } from "@workspace/api-client-react";
import { X, ClipboardList, Loader2 } from "lucide-react";

const COLUMNS = [
  { key: "open",     label: "Open",        statuses: ["active", "reopened"],     accent: "#F59E0B" },
  { key: "progress", label: "In Progress", statuses: ["filled", "in_progress"],  accent: "#3B82F6" },
  { key: "done",     label: "Done",        statuses: ["completed", "done"],       accent: "#22C55E" },
];

export function KanbanPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: jobs, isLoading } = useListJobBoard({
    query: { queryKey: getListJobBoardQueryKey(), refetchInterval: 10_000, enabled: open },
  });
  const jobList = (jobs ?? []) as any[];

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[560px] flex flex-col p-0 border-none"
        style={{ background: "#080D17", boxShadow: "-1px 0 0 rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[#6366F1]/15 border border-[#6366F1]/25 grid place-items-center">
              <ClipboardList className="w-3.5 h-3.5 text-[#6366F1]" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-white/92">Job Board</div>
              <div className="text-[11px] text-white/35">{isLoading ? "Loading…" : `${jobList.length} jobs`}</div>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/[0.06] grid place-items-center text-white/40 hover:text-white/70 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-white/25" />
            <span className="text-[12px] text-white/30">Fetching jobs…</span>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {COLUMNS.map(col => {
              const colJobs = jobList.filter(j => col.statuses.includes((j.boardStatus ?? j.status ?? "").toLowerCase()));
              return (
                <div key={col.key} className="flex-1 flex flex-col border-r border-white/[0.05] last:border-0">
                  <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/[0.05] shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: col.accent }} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/50">{col.label}</span>
                    <span className="ml-auto text-[9.5px] font-bold tabular-nums" style={{ color: col.accent, opacity: 0.65 }}>{colJobs.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
                    {colJobs.length === 0 && <div className="text-[11px] text-white/18 text-center py-5">—</div>}
                    {colJobs.map(j => (
                      <div key={j.id} className="rounded-[9px] px-2.5 py-2.5 border border-white/[0.06]" style={{ background: "rgba(255,255,255,0.025)" }}>
                        <div className="text-[11.5px] font-medium text-white/75 leading-snug truncate">
                          {j.unitLabel ? `${j.unitLabel}${j.propertyName ? ` · ${j.propertyName}` : ""}` : (j.propertyName ?? "Job")}
                        </div>
                        {j.crewName && <div className="text-[10px] text-white/30 truncate mt-0.5">{j.crewName}</div>}
                        {j.scheduledDate && (
                          <div className="text-[9.5px] text-white/20 mt-0.5">
                            {new Date(j.scheduledDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
