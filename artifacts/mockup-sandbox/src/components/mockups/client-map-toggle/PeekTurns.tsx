/**
 * B1c — Work in flight, nobody on site. Streets have nothing to say, so the
 * map halves and switches drawing: the unit plate, coloured by turn stage,
 * red-ringed where a unit is aging. The work rises with it.
 */
import "./_group.css";
import { Header } from "./_shared/bits";
import { StatusPill } from "./_shared/peek";
import { MapStage, WorkSheet } from "./_shared/mapFirst";
import { C } from "./_shared/lenses";

export function PeekTurns() {
  return (
    <div className="cmt">
      <Header />

      <MapStage presence="turns">
        <div style={{ position: "absolute", left: 12, bottom: 30, display: "flex", gap: 7 }}>
          <StatusPill tone={C.amber}>6 turns in flight</StatusPill>
          <StatusPill tone={C.red}>2 aging past 9d</StatusPill>
        </div>
      </MapStage>

      <WorkSheet />
    </div>
  );
}
