/**
 * B4 — Weather, only when it costs you something.
 * No weather lens, no extra tab: the glance turns amber and one action appears
 * above the board. On a clear day this frame looks exactly like B1.
 */
import "./_group.css";
import { ChevronRight, CalendarClock } from "lucide-react";
import { Header, BoardBody } from "./_shared/bits";
import { PeekMap, StatusPill } from "./_shared/peek";
import { C } from "./_shared/lenses";

export function PeekWeather() {
  return (
    <div className="cmt">
      <Header />

      <div style={{ padding: "10px 12px 9px", flexShrink: 0 }}>
        <div className="cmt-seg">
          <button className="cmt-seg-item" data-on={true}>Work</button>
          <button className="cmt-seg-item">Yours</button>
          <button className="cmt-seg-item">History</button>
        </div>
      </div>

      <button
        style={{
          position: "relative",
          height: 132,
          margin: "0 12px",
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid rgba(255,179,64,0.45)",
          flexShrink: 0,
          padding: 0,
          background: "none",
          fontFamily: "inherit",
          color: "inherit",
          cursor: "pointer",
          boxShadow: "0 10px 28px rgba(6,12,28,0.35)",
        }}
      >
        <PeekMap weather />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            padding: 10,
            background: "linear-gradient(to top, rgba(6,12,26,0.66) 0%, rgba(6,12,26,0) 46%)",
          }}
        >
          <StatusPill tone={C.amber}>Rain 3:10p · 1 outdoor crew exposed</StatusPill>
          <div style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.72)", paddingBottom: 5 }}>
            Map <ChevronRight size={13} />
          </span>
        </div>
      </button>

      {/* One row, one decision. It disappears the moment it is answered. */}
      <div
        className="cmt-card"
        style={{ margin: "10px 12px 0", padding: "11px 12px", borderColor: "rgba(255,179,64,0.4)", flexShrink: 0 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CalendarClock size={14} style={{ color: C.amber, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 750, letterSpacing: "-0.01em" }}>Move Rojas Roofing to 6:30a tomorrow</div>
            <div style={{ fontSize: 11.5, color: C.mute }}>Dry window 6a–1p · saves a $680 re-mobilization</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
          <button
            style={{
              flex: 1,
              height: 34,
              border: 0,
              borderRadius: 11,
              background: C.lime,
              color: "#07101e",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Reschedule
          </button>
          <button className="cmt-chip" style={{ height: 34, padding: "0 14px" }}>Keep today</button>
        </div>
      </div>

      <BoardBody padTop={14} />
    </div>
  );
}
