/**
 * B1 — Map-first board, crews on site. The map earns two thirds of the screen
 * because there is something moving on it: pins, names, live timers.
 */
import "./_group.css";
import { Header } from "./_shared/bits";
import { StatusPill } from "./_shared/peek";
import { MapStage, WorkSheet } from "./_shared/mapFirst";

export function PeekBoard() {
  return (
    <div className="cmt">
      <Header />

      <MapStage presence="live">
        <div style={{ position: "absolute", left: 12, bottom: 32, display: "flex", gap: 7 }}>
          <StatusPill>2 crews on site</StatusPill>
          <StatusPill tone="rgba(210,224,255,0.55)">4 units live</StatusPill>
        </div>
      </MapStage>

      <WorkSheet />
    </div>
  );
}
