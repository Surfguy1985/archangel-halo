/**
 * OPTION A — "Map is just another lens."
 * The map becomes a fourth segment in the tab pill the client already uses.
 * One control, one mental model: everything on this board is a tab.
 */
import "./_group.css";
import { Bell, LayoutGrid, Map as MapIcon, Search } from "lucide-react";
import { MapCanvas, Header, RAILS, TONE } from "./_shared/bits";

export function TabLens() {
  const tabs = [
    { id: "work", label: "Work" },
    { id: "yours", label: "Yours" },
    { id: "map", label: "Map", icon: true },
    { id: "history", label: "History" },
  ];

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

      {/* The one and only navigation control. */}
      <div style={{ padding: "9px 12px", flexShrink: 0 }}>
        <div className="cmt-seg">
          {tabs.map((t) => (
            <button key={t.id} className="cmt-seg-item" data-on={t.id === "map"}>
              {t.icon && <MapIcon size={13} strokeWidth={2.4} />}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Map renders inline, in the same slot the board would occupy. */}
      <div style={{ flex: 1, position: "relative", margin: "0 12px 12px", borderRadius: 16, overflow: "hidden", border: "1px solid var(--cmd-line)" }}>
        <MapCanvas style={{ position: "absolute", inset: 0 }} />

        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 999,
            background: "rgba(7,16,30,0.82)",
            backdropFilter: "blur(12px)",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: TONE.lime }} />
          2 crews on site
        </div>

        <button
          className="cmt-chip"
          style={{ position: "absolute", top: 10, right: 10, background: "rgba(7,16,30,0.82)", backdropFilter: "blur(12px)" }}
        >
          <LayoutGrid size={12} /> Units
        </button>

        {/* Tapping a pin scrolls this tray; tapping a card flies the map to it. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "22px 10px 10px",
            display: "flex",
            gap: 8,
            overflowX: "auto",
            background: "linear-gradient(to top, rgba(7,16,30,0.9), rgba(7,16,30,0))",
          }}
        >
          {RAILS.flatMap((r) => r.cards).map((c) => (
            <div
              key={c.unit}
              className="cmt-card"
              style={{ padding: "8px 10px", minWidth: 138, flexShrink: 0, borderColor: c.tone === "amber" ? "rgba(255,179,64,0.5)" : undefined }}
            >
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TONE[c.tone] }}>
                {c.unit}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25 }}>{c.title}</div>
              <div style={{ fontSize: 10, color: "var(--cmd-mute)" }}>{c.meta}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
