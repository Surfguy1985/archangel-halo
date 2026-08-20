/**
 * Unit detail drawer — one sheet, not a new page.
 * Property-safe only (status, photos, notes). No money.
 */
import { useQuery } from "@tanstack/react-query";
import { Camera, X } from "lucide-react";

type UnitDetail = {
  jobId: string;
  jobNo: string | null;
  unitNo: string | null;
  propertyName: string | null;
  propertyCity: string | null;
  status: string;
  statusLabel: string;
  updatedAt: string | null;
  notes: string | null;
  photos: Array<{ id: string; path: string; phase: string | null }>;
  money: false;
};

const statusColor: Record<string, string> = {
  blocked: "text-[#FF453A]",
  turning: "text-[#0A84FF]",
  waiting: "text-[#FFD60A]",
  done: "text-[#30D158]",
};

export function UnitPulseDrawer({
  jobId,
  onClose,
}: {
  jobId: string | null;
  onClose: () => void;
}) {
  const open = !!jobId;
  const q = useQuery({
    queryKey: ["pulse-unit", jobId],
    enabled: open,
    queryFn: async () => {
      const r = await fetch(`/api/pulse/unit/${jobId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load unit");
      return r.json() as Promise<UnitDetail>;
    },
  });

  if (!open) return null;
  const d = q.data;

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-[20px] border border-white/10 bg-[#1c1c1e] sm:rounded-[20px]"
      >
        <div className="flex items-start justify-between px-5 pb-2 pt-5">
          <div>
            <p className="text-[13px] font-medium text-white/40">
              {d?.propertyName || "Unit"}
            </p>
            <h2 className="mt-0.5 text-[22px] font-semibold tracking-tight text-white">
              {d?.unitNo ? `Unit ${d.unitNo}` : d?.jobNo || "Loading…"}
            </h2>
            {d && (
              <p className={`mt-1 text-[15px] font-medium ${statusColor[d.status] || "text-white/50"}`}>
                {d.statusLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 text-white/70"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-8 pt-2">
          {q.isLoading && <p className="py-8 text-center text-white/30">Loading…</p>}
          {q.isError && (
            <p className="py-8 text-center text-[#FF453A]/text-sm">Could not load unit</p>
          )}

          {d?.notes && (
            <p className="mb-4 rounded-[12px] bg-white/5 px-3 py-2.5 text-[14px] leading-snug text-white/70">
              {d.notes}
            </p>
          )}

          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-white/35">
            <Camera className="h-3.5 w-3.5" />
            Field proof
          </div>
          {d && d.photos.length === 0 && (
            <p className="text-[14px] text-white/30">No photos yet</p>
          )}
          {d && d.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {d.photos.map((ph) => (
                <div key={ph.id} className="aspect-square overflow-hidden rounded-[12px] bg-white/10">
                  <img
                    src={ph.path}
                    alt={ph.phase || "photo"}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0.2";
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {d?.updatedAt && (
            <p className="mt-6 text-center text-[11px] text-white/25">
              Updated {new Date(d.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default UnitPulseDrawer;
