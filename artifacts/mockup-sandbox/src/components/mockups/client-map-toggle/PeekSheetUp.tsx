/**
 * B1b — Same page, sheet pulled up. Drag the grabber and the work takes over;
 * the map stays alive behind it. One gesture between "watch the property" and
 * "work the board" — no navigation, nothing reloads.
 */
import "./_group.css";
import { Header } from "./_shared/bits";
import { StatusPill } from "./_shared/peek";
import { MapStage, WorkSheet } from "./_shared/mapFirst";

export function PeekSheetUp() {
  return (
    <div className="cmt">
      <Header />

      <MapStage frac={0.26}>
        <div style={{ position: "absolute", left: 12, bottom: 30 }}>
          <StatusPill>2 crews on site</StatusPill>
        </div>
      </MapStage>

      <WorkSheet />
    </div>
  );
}
