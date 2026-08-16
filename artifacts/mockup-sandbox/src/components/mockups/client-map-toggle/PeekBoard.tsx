/**
 * B1 — Map-first board. The property map is two thirds of the screen and the
 * work rides in a sheet over it. No map tab, no toggle: the map IS the page.
 */
import "./_group.css";
import { Header } from "./_shared/bits";
import { StatusPill } from "./_shared/peek";
import { MapStage, WorkSheet } from "./_shared/mapFirst";

export function PeekBoard() {
  return (
    <div className="cmt">
      <Header />

      <MapStage frac={0.62}>
        <div style={{ position: "absolute", left: 12, bottom: 32, display: "flex", gap: 7 }}>
          <StatusPill>2 crews on site</StatusPill>
          <StatusPill tone="rgba(210,224,255,0.55)">4 units live</StatusPill>
        </div>
      </MapStage>

      <WorkSheet />
    </div>
  );
}
