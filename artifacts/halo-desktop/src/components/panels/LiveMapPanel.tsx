/**
 * Desktop LiveMapPanel — right-side slide-over showing live crew status.
 */
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  useListCrews,
  getListCrewsQueryKey,
} from "@workspace/api-client-react";
import { X, Radio, Loader2, MapPin, Clock } from "lucide-react";

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
  return `${Math.floor(diff / 60)}h ago`;
}

export function LiveMapPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: crews, isLoading } = useListCrews({
    query: { queryKey: getListCrewsQueryKey(), refetchInterval: 15_000, enabled: open },
  });

  const onSite = (crews ?? []).filter((c: any) => {
    const s = (c.checkinStatus ?? c.status ?? "").toLowerCase();
    return ["checked_in", "on_site", "active"].includes(s);
  });
  const available = (crews ?? []).filter((c: any) => {
    const s = (c.checkinStatus ?? c.status ?? "").toLowerCase();
    return !["checked_in", "on_site", "active"].includes(s);
  });

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[400px] flex flex-col p-0 border-none"
        style={{ background: "#080D17", boxShadow: "-1px 0 0 rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/25 grid place-items-center">
              <Radio className="w-3.5 h-3.5 text-[#22C55E]" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-white/92">Live Map</div>
              <div className="text-[11px] text-white/35">
                {isLoading ? "Loading…" : `${onSite.length} on site · ${available.length} available`}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/[0.06] grid place-items-center text-white/40 hover:text-white/70 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12 gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-white/25" />
              <span className="text-[12px] text-white/30">Fetching crew status…</span>
            </div>
          )}
          {!isLoading && (crews ?? []).length === 0 && (
            <div className="flex flex-col items-center py-12 gap-2">
              <MapPin className="w-7 h-7 text-white/15" />
              <span className="text-[12px] text-white/30">No crews on record</span>
            </div>
          )}
          {onSite.length > 0 && (
            <div className="mb-4">
              <div className="text-[9.5px] font-bold tracking-[0.18em] uppercase text-[#22C55E]/55 mb-2 px-1">On Site · {onSite.length}</div>
              {onSite.map((c: any) => <CrewRow key={c.id} crew={c} />)}
            </div>
          )}
          {available.length > 0 && (
            <div>
              <div className="text-[9.5px] font-bold tracking-[0.18em] uppercase text-white/22 mb-2 px-1">Available · {available.length}</div>
              {available.map((c: any) => <CrewRow key={c.id} crew={c} />)}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.04] shrink-0">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-white/20" />
            <span className="text-[10px] text-white/22">Updates every 15 seconds</span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CrewRow({ crew }: { crew: any }) {
  const { dot, label } = statusColor(crew);
  const initials = (crew.name ?? "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="w-8 h-8 rounded-full bg-white/[0.07] border border-white/10 grid place-items-center shrink-0 relative">
        {crew.selfiePath
          ? <img src={`/api/storage${crew.selfiePath}`} alt={crew.name} className="w-full h-full rounded-full object-cover" />
          : <span className="text-[10px] font-bold text-white/50">{initials}</span>}
        <div className={`absolute -bottom-[2px] -right-[2px] w-2 h-2 rounded-full border-[1.5px] border-[#080D17] ${dot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-white/82 truncate">{crew.name}</div>
        <div className="text-[11px] text-white/32 truncate">{crew.checkedInPropertyName ?? crew.propertyName ?? "—"}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[10.5px] text-white/38">{label}</div>
        {crew.lastCheckinAt && <div className="text-[9.5px] text-white/20">{timeAgo(crew.lastCheckinAt)}</div>}
      </div>
    </div>
  );
}
