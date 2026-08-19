import { Map, LayoutGrid } from "lucide-react";
import { usePortal, type ViewMode } from "../lib/portalContext";
export function MapBoardToggle({ value, onChange, className = "" }: { value?: ViewMode; onChange?: (m: ViewMode) => void; className?: string }) {
  const portal = usePortal();
  const mode = value ?? portal.viewMode;
  const setMode = onChange ?? portal.setViewMode;
  return (
    <div className={`inline-flex rounded-xl border border-white/10 bg-white/5 p-0.5 ${className}`} role="group">
      <button type="button" onClick={() => setMode("map")} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${mode === "map" ? "bg-[#B4FF44] text-black" : "text-white/55 hover:text-white"}`}>
        <Map className="h-3.5 w-3.5" /> Map
      </button>
      <button type="button" onClick={() => setMode("board")} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${mode === "board" ? "bg-[#B4FF44] text-black" : "text-white/55 hover:text-white"}`}>
        <LayoutGrid className="h-3.5 w-3.5" /> Board
      </button>
    </div>
  );
}
export default MapBoardToggle;
