/**
 * KanbanPanel — full-screen dark slide-up showing the job board in 3 columns.
 * Summoned from the chat composer, returns user to the same conversation on close.
 */
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  useListJobBoard,
  getListJobBoardQueryKey,
} from "@workspace/api-client-react";
import { X, ClipboardList, Loader2, Circle } from "lucide-react";

const COLUMNS: Array<{ key: string; label: string; statuses: string[]; accent: string }> = [
  { key: "open",     label: "Open",        statuses: ["active", "reopened"],      accent: "#F59E0B" },
  { key: "progress", label: "In Progress",  statuses: ["filled", "in_progress"],   accent: "#3B82F6" },
  { key: "done",     label: "Done",         statuses: ["completed", "done"],        accent: "#22C55E" },
];

export function KanbanPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: jobs, isLoading } = useListJobBoard({
    query: { queryKey: getListJobBoardQueryKey(), refetchInterval: 10_000, enabled: open },
  });

  const jobList = (jobs ?? []) as any[];
  const totalJobs = jobList.length;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="bottom"
        className="h-[92dvh] flex flex-col p-0 rounded-t-[20px] border-none"
        style={{ background: "#080D17", boxShadow: "0 -1px 0 rgba(255,255,255,0.07)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[#6366F1]/15 border border-[#6366F1]/25 grid place-items-center">
              <ClipboardList className="w-3.5 h-3.5 text-[#6366F1]" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-white/92">Job Board</div>
              <div className="text-[11px] text-white/35">
                {isLoading ? "Loading…" : `${totalJobs} job${totalJobs !== 1 ? "s" : ""} across all properties`}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 grid place-items-center text-white/40 hover:text-white/70 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-white/25" />
            <span className="text-[12.5px] text-white/30">Fetching jobs…</span>
          </div>
        )}

        {!isLoading && (
          <div className="flex-1 flex gap-0 overflow-hidden">
            {COLUMNS.map((col) => {
              const colJobs = jobList.filter((j: any) =>
                col.statuses.includes((j.boardStatus ?? j.status ?? "").toLowerCase())
              );
              return (
                <div key={col.key} className="flex-1 flex flex-col border-r border-white/[0.05] last:border-0 overflow-hidden">
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-3 py-3 border-b border-white/[0.05] shrink-0">
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: col.accent }}
                    />
                    <span className="text-[11px] font-semibold text-white/55 uppercase tracking-[0.1em]">
                      {col.label}
                    </span>
                    <span
                      className="ml-auto text-[10px] font-bold tabular-nums"
                      style={{ color: col.accent, opacity: 0.7 }}
                    >
                      {colJobs.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
                    {colJobs.length === 0 && (
                      <div className="text-[11.5px] text-white/20 text-center py-6">—</div>
                    )}
                    {colJobs.map((job: any) => (
                      <JobCard key={job.id} job={job} accent={col.accent} />
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

function JobCard({ job, accent }: { job: any; accent: string }) {
  const title = job.unitLabel
    ? `${job.unitLabel}${job.propertyName ? ` · ${job.propertyName}` : ""}`
    : (job.propertyName ?? "Job");
  const crew = job.crewName ?? job.crewLeaderName ?? null;

  return (
    <div
      className="rounded-[10px] px-2.5 py-2.5 border border-white/[0.06]"
      style={{ background: "rgba(255,255,255,0.025)" }}
    >
      <div className="text-[11.5px] font-medium text-white/78 leading-snug mb-1 truncate">
        {title}
      </div>
      {crew && (
        <div className="text-[10.5px] text-white/35 truncate">{crew}</div>
      )}
      {job.scheduledDate && (
        <div className="text-[10px] text-white/22 mt-0.5">
          {new Date(job.scheduledDate + "T12:00:00").toLocaleDateString("en-US", {
            month: "short", day: "numeric",
          })}
        </div>
      )}
    </div>
  );
}
