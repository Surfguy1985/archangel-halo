import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type JobLike = {
  id: string; jobNo?: string | null; boardStatus?: string | null; status?: string | null;
  unit?: string | null; address?: string | null; propertyName?: string | null;
};

const COLUMNS: { id: string; label: string; match: (j: JobLike) => boolean }[] = [
  { id: "new", label: "New", match: (j) => ["new", "intake", "scheduled"].includes((j.boardStatus || j.status || "").toLowerCase()) },
  { id: "in_progress", label: "In Progress", match: (j) => ["in_progress", "dispatched", "on_site", "active"].includes((j.boardStatus || j.status || "").toLowerCase()) },
  { id: "review", label: "Review", match: (j) => ["review", "qa", "pending_review"].includes((j.boardStatus || j.status || "").toLowerCase()) },
  { id: "billing", label: "Billing", match: (j) => ["billing", "invoiced"].includes((j.boardStatus || j.status || "").toLowerCase()) },
  { id: "done", label: "Done", match: (j) => ["complete", "completed", "done", "closed"].includes((j.boardStatus || j.status || "").toLowerCase()) },
];

export function PortalBoardView({ jobs, canEdit, onOpenJob }: { jobs: JobLike[]; canEdit: boolean; onOpenJob?: (id: string) => void }) {
  const qc = useQueryClient();
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const columns = useMemo(() => {
    const used = new Set<string>();
    return COLUMNS.map((col) => {
      const items = jobs.filter((j) => {
        if (used.has(j.id)) return false;
        if (col.match(j)) { used.add(j.id); return true; }
        return false;
      });
      return { ...col, items };
    });
  }, [jobs]);

  async function moveJob(jobId: string, boardStatus: string) {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardStatus }),
      });
      if (!res.ok) {
        await fetch(`/api/jobs/${jobId}/board-status`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ boardStatus }),
        });
      }
      await qc.invalidateQueries();
    } finally {
      setBusy(false);
      setDragId(null);
    }
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {columns.map((col) => (
        <div key={col.id} className="flex min-w-[220px] flex-1 flex-col rounded-xl border border-white/10 bg-black/30"
          onDragOver={(e) => { if (canEdit) e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/job-id") || dragId;
            if (id && canEdit) void moveJob(id, col.id === "done" ? "completed" : col.id);
          }}>
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-white/70">{col.label}</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50">{col.items.length}</span>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
            {col.items.map((j) => (
              <button key={j.id} type="button" draggable={canEdit}
                onDragStart={(e) => { setDragId(j.id); e.dataTransfer.setData("text/job-id", j.id); }}
                onClick={() => onOpenJob?.(j.id)}
                className="rounded-lg border border-white/10 bg-white/5 p-2.5 text-left transition hover:border-[#B4FF44]/40 hover:bg-white/10">
                <div className="text-xs font-semibold text-[#B4FF44]">{j.jobNo || j.id.slice(0, 8)}</div>
                <div className="mt-0.5 text-sm text-white">{j.propertyName || j.address || "Job"}</div>
                {j.unit && <div className="mt-0.5 text-[11px] text-white/45">Unit {j.unit}</div>}
              </button>
            ))}
            {col.items.length === 0 && <p className="px-1 py-6 text-center text-[11px] text-white/25">Drop jobs here</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
export default PortalBoardView;
