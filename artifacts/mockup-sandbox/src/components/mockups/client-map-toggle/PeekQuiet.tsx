/**
 * B1d — Sunday, 7pm, nothing in flight. The map stops asking for the screen:
 * it recedes to a band with one honest line, and the work owns the phone.
 * Tapping the band still opens the full map.
 */
import "./_group.css";
import { Header } from "./_shared/bits";
import { MapStage, WorkSheet, QuietLine } from "./_shared/mapFirst";

export function PeekQuiet() {
  return (
    <div className="cmt">
      <Header />

      <MapStage presence="quiet">
        <QuietLine>No crews on site · next crew 7:00a Tue</QuietLine>
      </MapStage>

      <WorkSheet />
    </div>
  );
}
