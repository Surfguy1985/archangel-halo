/**
 * OPTION B — "Map as a peek strip."
 * A short live map band sits above the board at all times. Nothing to toggle
 * to see where crews are; drag the handle (or tap Expand) for the full map.
 */
import "./_group.css";
import { Bell, ChevronsUpDown, Maximize2, Search } from "lucide-react";
import { MapCanvas, Header, BoardBody, TONE } from "./_shared/bits";

export function PeekStrip() {
  return (
    <div className="cmt">
      <Header
        right={
          <>
            <button className="cmt-chip" style={{ width: 30, padding: 0, justifyContent: "center" }} aria-label="Search">
              <Search size={13} />
            </button>
            <button className="cmt-chip" style={{ width: 30, padding: 0, justifyContent: "center" }} aria-label="Alerts">
              <Bell size={13} />
            </button>
          </>
        }
      />

      {/* Board tabs stay exactly as they are — the map is not a tab here. */}
      <div style={{ padding: "9px 12px 8px", flexShrink: 0 }}>
        <div className="cmt-seg">
          <button className="cmt-seg-item" data-on={true}>Work</button>
          <button className="cmt-seg-item">Yours</button>
          <button className="cmt-seg-item">History</button>
        </div>
      </div>

      {/* Always-on map band. */}
      <div style={{ position: "relative", height: 148, margin: "0 12px", borderRadius: 16, overflow: "hidden", border: "1px solid var(--cmd-line)", flexShrink: 0 }}>
        <MapCanvas labels={false} style={{ position: "absolute", inset: 0 }} />

        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 9px",
            borderRadius: 999,
            background: "rgba(7,16,30,0.82)",
            backdropFilter: "blur(12px)",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: TONE.lime }} />
          2 crews on site · 4 units live
        </div>

        <button
          className="cmt-chip"
          style={{ position: "absolute", top: 8, right: 8, height: 26, background: "rgba(7,16,30,0.82)", backdropFilter: "blur(12px)" }}
        >
          <Maximize2 size={11} /> Expand
        </button>

        {/* Drag handle — pull down for full-screen map, push up to collapse to a 6px sliver. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            height: 26,
            paddingBottom: 5,
            background: "linear-gradient(to top, rgba(7,16,30,0.75), rgba(7,16,30,0))",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.8)", fontSize: 9.5, fontWeight: 700 }}>
            <ChevronsUpDown size={11} /> DRAG FOR FULL MAP
          </div>
        </div>
      </div>

      <BoardBody padTop={12} />
    </div>
  );
}
