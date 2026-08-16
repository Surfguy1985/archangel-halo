/**
 * B2 — The glance, opened. A standard iOS sheet over a full map:
 * grabber, one list of who is actually on the property, nothing else.
 */
import "./_group.css";
import { Layers2, LocateFixed, MessageCircle, ChevronRight } from "lucide-react";
import { CREWS, C } from "./_shared/lenses";
import { PeekMap, MapButton, Grabber } from "./_shared/peek";

export function PeekMapFull() {
  return (
    <div className="cmt">
      <PeekMap labels big />

      {/* Floating chrome — Done on the left, map controls on the right. */}
      <div style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "flex-start", padding: "14px 12px 0" }}>
        <button
          style={{
            height: 34,
            padding: "0 15px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(7,16,30,0.78)",
            backdropFilter: "blur(14px)",
            color: "rgba(255,255,255,0.92)",
            fontFamily: "inherit",
            fontSize: 13.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Done
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: "grid", gap: 8 }}>
          <MapButton label="Map layers"><Layers2 size={16} /></MapButton>
          <MapButton label="Recenter"><LocateFixed size={16} /></MapButton>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* Medium-detent sheet: who is here, and how to reach them. */}
      <div
        style={{
          position: "relative",
          zIndex: 3,
          flexShrink: 0,
          background: "rgba(7,16,30,0.94)",
          backdropFilter: "blur(26px)",
          borderTop: "1px solid var(--cmd-line-soft)",
          borderRadius: "22px 22px 0 0",
          boxShadow: "0 -16px 44px rgba(6,12,28,0.6)",
          padding: "0 14px 16px",
        }}
      >
        <Grabber />
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, margin: "2px 0 10px" }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: "-0.03em" }}>On site now</h2>
          <span style={{ fontSize: 12, color: C.mute, fontWeight: 600 }}>updated 2m ago</span>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {CREWS.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.07)",
                  border: "1.5px solid " + c.tone,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: c.tone,
                  flexShrink: 0,
                }}
              >
                {c.name[0]}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-0.01em" }}>{c.name}</div>
                <div style={{ fontSize: 12, color: C.mute }}>
                  {c.unit} · {c.trade} · {c.on}
                </div>
              </div>
              <button className="cmt-chip" style={{ width: 32, height: 32, padding: 0, justifyContent: "center", borderRadius: 999 }} aria-label={"Message " + c.name}>
                <MessageCircle size={14} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: "var(--cmd-line-soft)", margin: "12px 0 10px" }} />

        {/* One quiet way back into the work — no second board. */}
        <button
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: 0,
            border: 0,
            background: "none",
            color: "inherit",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          <span style={{ flex: 1, textAlign: "left", fontSize: 13.5, fontWeight: 700 }}>4 units live · 2 need you</span>
          <ChevronRight size={16} style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
      </div>
    </div>
  );
}
