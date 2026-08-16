/**
 * Map-first board chrome: the property map owns two thirds of the screen,
 * the work sits in a sheet that slides over it. Apple's Maps/Find My model —
 * the map is the page, the list is a detent, and nothing is a "mode".
 */
import { Layers2, LocateFixed } from "lucide-react";
import { RAILS, BoardCard } from "./bits";
import { PeekMap, MapButton, Grabber } from "./peek";

/** The map region. `frac` is how much of the screen the map keeps. */
export function MapStage({ frac = 0.62, weather = false, children }: { frac?: number; weather?: boolean; children?: React.ReactNode }) {
  return (
    <div style={{ position: "relative", flex: `0 0 ${frac * 100}%`, minHeight: 0, overflow: "hidden" }}>
      <PeekMap labels big weather={weather} />
      <div style={{ position: "absolute", top: 12, right: 12, display: "grid", gap: 8 }}>
        <MapButton label="Map layers"><Layers2 size={16} /></MapButton>
        <MapButton label="Recenter"><LocateFixed size={16} /></MapButton>
      </div>
      {children}
    </div>
  );
}

/** The work sheet. Overlaps the map so the map reads as the surface beneath. */
export function WorkSheet({
  tab = "Work",
  lead,
  rails = RAILS,
  scroll = true,
}: {
  tab?: string;
  lead?: React.ReactNode;
  rails?: typeof RAILS;
  scroll?: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 3,
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        marginTop: -20,
        background: "rgba(7,16,30,0.94)",
        backdropFilter: "blur(26px)",
        borderTop: "1px solid var(--cmd-line-soft)",
        borderRadius: "22px 22px 0 0",
        boxShadow: "0 -18px 46px rgba(4,9,20,0.6)",
      }}
    >
      <Grabber />
      <div style={{ padding: "2px 12px 10px", flexShrink: 0 }}>
        <div className="cmt-seg">
          {["Work", "Yours", "History"].map((t) => (
            <button key={t} className="cmt-seg-item" data-on={t === tab}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {lead}
      <div style={{ flex: 1, minHeight: 0, overflowY: scroll ? "auto" : "hidden", padding: "2px 12px 16px", display: "grid", gap: 14, alignContent: "start" }}>
        {rails.map((r) => (
          <section key={r.rail} style={{ display: "grid", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <h3 style={{ fontSize: 11.5, fontWeight: 750, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--cmd-mute)", margin: 0 }}>
                {r.rail}
              </h3>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#07101e", background: "var(--cmd-lime)", borderRadius: 999, padding: "1px 6px" }}>
                {r.count}
              </span>
            </div>
            {r.cards.map((c) => (
              <BoardCard key={c.unit} card={c} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
