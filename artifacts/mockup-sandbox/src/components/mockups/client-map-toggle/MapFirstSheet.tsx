/**
 * OPTION C — "Map first, board on a sheet." (the iOS Maps / Zillow model)
 * The map IS the page. The board rides a draggable sheet over it: flick down
 * for the map, flick up for the full board. No toggle button at all.
 */
import "./_group.css";
import { Bell, Crosshair, Search } from "lucide-react";
import { MapCanvas, PROPERTY, RAILS, BoardCard, TONE } from "./_shared/bits";

export function MapFirstSheet() {
  return (
    <div className="cmt">
      {/* Full-bleed map behind everything. */}
      <MapCanvas style={{ position: "absolute", inset: 0 }} />

      {/* Floating translucent header instead of a solid bar. */}
      <header
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: 9,
          margin: "10px 12px 0",
          padding: "8px 10px",
          borderRadius: 16,
          background: "rgba(7,16,30,0.82)",
          backdropFilter: "blur(18px)",
          border: "1px solid var(--cmd-line)",
          flexShrink: 0,
        }}
      >
        <div className="cmt-mark" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 750, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{PROPERTY.name}</div>
          <div style={{ fontSize: 10, color: "var(--cmd-mute)" }}>2 crews on site · 4 units live</div>
        </div>
        <button className="cmt-chip" style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }} aria-label="Search">
          <Search size={12} />
        </button>
        <button className="cmt-chip" style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }} aria-label="Alerts">
          <Bell size={12} />
        </button>
      </header>

      <div style={{ flex: 1 }} />

      <button
        className="cmt-chip"
        style={{ position: "absolute", right: 14, bottom: 372, zIndex: 2, width: 34, height: 34, padding: 0, justifyContent: "center", borderRadius: 999, background: "rgba(7,16,30,0.85)", backdropFilter: "blur(12px)" }}
        aria-label="Recenter"
      >
        <Crosshair size={14} />
      </button>

      {/* The board sheet — three detents: peek (88px) · half (shown) · full. */}
      <section
        style={{
          position: "relative",
          zIndex: 3,
          height: 356,
          flexShrink: 0,
          background: "rgba(7,16,30,0.92)",
          backdropFilter: "blur(24px)",
          borderTop: "1px solid var(--cmd-line)",
          borderRadius: "22px 22px 0 0",
          boxShadow: "0 -18px 48px rgba(6,12,28,0.55)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "8px 0 4px", display: "flex", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.28)" }} />
        </div>

        <div style={{ padding: "2px 12px 8px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 750, letterSpacing: "-0.01em" }}>Your board</div>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#07101e", background: TONE.amber, borderRadius: 999, padding: "2px 7px" }}>2 need you</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cmd-mute)" }}>3 in progress</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 14px", display: "grid", gap: 12 }}>
          {RAILS.map((r) => (
            <div key={r.rail} style={{ display: "grid", gap: 7 }}>
              <h3 style={{ fontSize: 11, fontWeight: 750, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--cmd-mute)", margin: 0 }}>
                {r.rail}
              </h3>
              {r.cards.map((c) => (
                <BoardCard key={c.unit} card={c} />
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
