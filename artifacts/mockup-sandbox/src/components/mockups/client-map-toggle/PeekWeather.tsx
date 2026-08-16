/**
 * B4 — Weather, only when it costs you something.
 * Same map-first page: the storm draws on the map the manager is already
 * watching, and one action rides at the top of the sheet. Clear day = B1.
 */
import "./_group.css";
import { CalendarClock } from "lucide-react";
import { Header } from "./_shared/bits";
import { StatusPill } from "./_shared/peek";
import { MapStage, WorkSheet } from "./_shared/mapFirst";
import { C } from "./_shared/lenses";

function RainMove() {
  return (
    <div
      className="cmt-card"
      style={{ margin: "0 12px 12px", padding: "11px 12px", borderColor: "rgba(255,179,64,0.4)", flexShrink: 0 }}
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
  );
}

export function PeekWeather() {
  return (
    <div className="cmt">
      <Header />

      <MapStage frac={0.5} weather>
        <div style={{ position: "absolute", left: 12, bottom: 32 }}>
          <StatusPill tone={C.amber}>Rain 3:10p · 1 outdoor crew exposed</StatusPill>
        </div>
      </MapStage>

      <WorkSheet lead={<RainMove />} />
    </div>
  );
}
