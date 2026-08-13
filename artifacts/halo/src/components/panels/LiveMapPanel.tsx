/**
 * LiveMapPanel — full-screen dark slide-up showing live crew status & GPS.
 * Summoned from the chat composer, returns user to the same conversation on close.
 */
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  useListCrews,
  useListProperties,
  getListCrewsQueryKey,
} from "@workspace/api-client-react";
import { X, MapPin, Clock, Loader2, Radio } from "lucide-react";

function statusColor(crew: any): { dot: string; label: string } {
  const s = (crew.checkinStatus ?? crew.status ?? "").toLowerCase();
  if (s === "checked_in" || s === "on_site" || s === "active")
    return { dot: "bg-[#22C55E]", label: "On site" };
  if (s === "dispatched" || s === "en_route")
    return { dot: "bg-[#3B82F6] animate-pulse", label: "En route" };
  return { dot: "bg-white/20", label: "Available" };
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diff < 2) return "just now";
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  return `${h}h ago`;
}

export function LiveMapPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: crews, isLoading } = useListCrews({
    query: { queryKey: getListCrewsQueryKey(), refetchInterval: 15_000, enabled: open },
  });

  const onSite = (crews ?? []).filter((c: any) => {
    const s = (c.checkinStatus ?? c.status ?? "").toLowerCase();
    return s === "checked_in" || s === "on_site" || s === "active";
  });
  const available = (crews ?? []).filter((c: any) => {
    const s = (c.checkinStatus ?? c.status ?? "").toLowerCase();
    return s !== "checked_in" && s !== "on_site" && s !== "active";
  });

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
            <div className="w-7 h-7 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/25 grid place-items-center">
              <Radio className="w-3.5 h-3.5 text-[#22C55E]" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-white/92">Live Map</div>
              <div className="text-[11px] text-white/35">
                {isLoading ? "Loading…" : `${onSite.length} on site · ${available.length} available`}
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {isLoading && (
            <div className="flex items-center justify-center py-16 gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-white/25" />
              <span className="text-[12.5px] text-white/30">Fetching crew status…</span>
            </div>
          )}

          {!isLoading && (crews ?? []).length === 0 && (
            <div className="flex flex-col items-center py-16 gap-2">
              <MapPin className="w-8 h-8 text-white/15" />
              <span className="text-[13px] text-white/35">No crews on record</span>
            </div>
          )}

          {/* On-site section */}
          {onSite.length > 0 && (
            <div>
              <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#22C55E]/60 mb-2 px-1">
                On Site · {onSite.length}
              </div>
              {onSite.map((crew: any) => (
                <CrewRow key={crew.id} crew={crew} />
              ))}
            </div>
          )}

          {/* Available section */}
          {available.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/25 mb-2 px-1">
                Available · {available.length}
              </div>
              {available.map((crew: any) => (
                <CrewRow key={crew.id} crew={crew} />
              ))}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="px-5 py-3 border-t border-white/[0.04] shrink-0">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-white/20" />
            <span className="text-[10.5px] text-white/25">Updates every 15 seconds</span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CrewRow({ crew }: { crew: any }) {
  const { dot, label } = statusColor(crew);
  const initials = (crew.name ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex items-center gap-3 py-3 border-b border-white/[0.04] last:border-0">
      {/* Avatar */}
      <div className="w-9 h-9 rounded-full bg-white/[0.07] border border-white/10 grid place-items-center shrink-0 relative">
        {crew.selfiePath ? (
          <img src={`/api/storage${crew.selfiePath}`} alt={crew.name} className="w-full h-full rounded-full object-cover" />
        ) : (
          <span className="text-[11px] font-bold text-white/50">{initials}</span>
        )}
        <div className={`absolute -bottom-[2px] -right-[2px] w-2.5 h-2.5 rounded-full border-[1.5px] border-[#080D17] ${dot}`} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-medium text-white/85 leading-none mb-0.5 truncate">{crew.name}</div>
        <div className="text-[11.5px] text-white/35 truncate">
          {crew.checkedInPropertyName ?? crew.propertyName ?? crew.services?.join(", ") ?? "—"}
        </div>
      </div>

      {/* Status + time */}
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-[11px] text-white/40">{label}</span>
        {crew.lastCheckinAt && (
          <span className="text-[10px] text-white/22">{timeAgo(crew.lastCheckinAt)}</span>
        )}
      </div>
    </div>
  );
}
