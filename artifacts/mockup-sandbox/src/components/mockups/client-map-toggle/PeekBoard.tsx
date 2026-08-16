/**
 * B1 — The board, unchanged, with a live glance where the eye already lands.
 * No new tab, no toggle, no mode. Tap the glance to open the map.
 */
import "./_group.css";
import { ChevronRight } from "lucide-react";
import { Header, BoardBody } from "./_shared/bits";
import { PeekMap, StatusPill } from "./_shared/peek";

export function PeekBoard() {
  return (
    <div className="cmt">
      <Header />

      {/* The board's own tabs stay exactly as they are. */}
      <div style={{ padding: "10px 12px 9px", flexShrink: 0 }}>
        <div className="cmt-seg">
          <button className="cmt-seg-item" data-on={true}>Work</button>
          <button className="cmt-seg-item">Yours</button>
          <button className="cmt-seg-item">History</button>
        </div>
      </div>

      {/* The glance. The whole card is the button. */}
      <button
        style={{
          position: "relative",
          height: 132,
          margin: "0 12px",
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid var(--cmd-line)",
          flexShrink: 0,
          padding: 0,
          background: "none",
          fontFamily: "inherit",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
          boxShadow: "0 10px 28px rgba(6,12,28,0.35)",
        }}
      >
        <PeekMap />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            padding: 10,
            background: "linear-gradient(to top, rgba(6,12,26,0.62) 0%, rgba(6,12,26,0) 46%)",
          }}
        >
          <StatusPill>2 crews on site</StatusPill>
          <div style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.72)", paddingBottom: 5 }}>
            Map <ChevronRight size={13} />
          </span>
        </div>
      </button>

      <BoardBody padTop={14} />
    </div>
  );
}
