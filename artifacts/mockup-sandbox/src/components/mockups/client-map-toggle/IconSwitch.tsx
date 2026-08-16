/**
 * OPTION D — "One capsule, three views."
 * Replaces today's scattered Map / Units / Live-map buttons with a single
 * icon capsule in the header. Board, Map and Units swap in place, and the
 * tab pill stays free for the lenses it was built for.
 */
import "./_group.css";
import { Columns3, LayoutGrid, Map as MapIcon, Search } from "lucide-react";
import { MapCanvas, Header, RAILS, TONE } from "./_shared/bits";

function Capsule() {
  const views = [
    { id: "board", icon: Columns3, label: "Board" },
    { id: "map", icon: MapIcon, label: "Map" },
    { id: "units", icon: LayoutGrid, label: "Units" },
  ];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid var(--cmd-line-soft)",
      }}
    >
      {views.map((v) => {
        const on = v.id === "map";
        return (
          <button
            key={v.id}
            aria-label={v.label}
            aria-pressed={on}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              height: 28,
              padding: on ? "0 11px" : "0 8px",
              border: 0,
              borderRadius: 999,
              background: on ? "var(--cmd-lime)" : "transparent",
              color: on ? "#07101e" : "rgba(255,255,255,0.6)",
              fontFamily: "inherit",
              fontSize: 11.5,
              fontWeight: 750,
            }}
          >
            <v.icon size={13} strokeWidth={2.4} />
            {on && v.label}
          </button>
        );
      })}
    </div>
  );
}

export function IconSwitch() {
  return (
    <div className="cmt">
      <Header
        right={
          <>
            <button className="cmt-chip" style={{ width: 28, padding: 0, justifyContent: "center" }} aria-label="Search">
              <Search size={13} />
            </button>
            <Capsule />
          </>
        }
      />

      {/* Same lens tabs as today — the capsule decides HOW you look, tabs decide WHAT. */}
      <div style={{ padding: "9px 12px", flexShrink: 0 }}>
        <div className="cmt-seg">
          <button className="cmt-seg-item" data-on={true}>Work</button>
          <button className="cmt-seg-item">Yours</button>
          <button className="cmt-seg-item">History</button>
        </div>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <MapCanvas style={{ position: "absolute", inset: 0 }} />

        <div
          style={{
            position: "absolute",
            top: 10,
            left: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 999,
            background: "rgba(7,16,30,0.82)",
            backdropFilter: "blur(12px)",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: TONE.lime }} />
          Work · 4 units live
        </div>
      </div>

      {/* Slim persistent dock so the board is never more than a glance away. */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--cmd-line)",
          background: "rgba(7,16,30,0.92)",
          padding: "9px 12px 12px",
          display: "flex",
          gap: 8,
          overflowX: "auto",
        }}
      >
        {RAILS.flatMap((r) => r.cards).slice(0, 3).map((c) => (
          <div key={c.unit} className="cmt-card" style={{ padding: "8px 10px", minWidth: 132, flexShrink: 0 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TONE[c.tone] }}>
              {c.unit}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25 }}>{c.title}</div>
            <div style={{ fontSize: 10, color: "var(--cmd-mute)" }}>{c.meta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
