/**
 * Map-first board chrome — with an EARNED map height.
 *
 * The map never takes two thirds of the screen by default; it takes as much
 * as it currently deserves:
 *   live   — crews on site        → 62%  (streets, pins, timers)
 *   turns  — work but nobody here → 34%  (unit plate: stages + aging)
 *   quiet  — nothing in flight    → 13%  (slim band, board owns the screen)
 * Same components, same drag gesture; only the resting detent changes.
 */
import { Layers2, LocateFixed, ChevronRight } from "lucide-react";
import { RAILS, BoardCard } from "./bits";
import { PeekMap, MapButton, Grabber } from "./peek";
import { C, UNITS, stageColor } from "./lenses";

export type Presence = "live" | "turns" | "quiet";

export const MAP_FRAC: Record<Presence, number> = { live: 0.62, turns: 0.34, quiet: 0.13 };

/** Compact unit plate — what the map shows when the work is real but nobody is on site. */
function PlateMini() {
  const bldgs: ("A" | "B" | "C")[] = ["A", "B", "C"];
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", gap: 8, padding: "12px 58px 12px 12px" }}>
      {bldgs.map((b) => (
        <div
          key={b}
          style={{
            flex: 1,
            borderRadius: 13,
            border: "1px solid rgba(140,180,235,0.16)",
            background: "rgba(10,23,41,0.72)",
            backdropFilter: "blur(6px)",
            padding: "7px 8px 8px",
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", color: C.mute, marginBottom: 6 }}>BLDG {b}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
            {UNITS.filter((u) => u.bldg === b).map((u) => (
              <div
                key={u.id}
                title={"Unit " + u.id}
                style={{
                  height: 22,
                  borderRadius: 5,
                  background: stageColor(u.stage),
                  opacity: u.stage === "vacant" ? 0.35 : 0.88,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 8.5,
                  fontWeight: 800,
                  color: u.stage === "ready" || u.stage === "work" ? "#07101e" : "rgba(255,255,255,0.92)",
                  boxShadow: u.days >= 9 ? "0 0 0 1.5px " + C.red : "none",
                }}
              >
                {u.id.slice(-3)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The map region. Height comes from presence; content follows it. */
export function MapStage({
  presence = "live",
  weather = false,
  frac: fracOverride,
  children,
}: {
  presence?: Presence;
  weather?: boolean;
  /** Only for the dragged states — presence decides the resting height. */
  frac?: number;
  children?: React.ReactNode;
}) {
  const frac = fracOverride ?? (weather ? 0.5 : MAP_FRAC[presence]);
  return (
    <div style={{ position: "relative", flex: `0 0 ${frac * 100}%`, minHeight: 0, overflow: "hidden" }}>
      <PeekMap labels={presence === "live"} big={presence === "live"} weather={weather} pins={presence !== "turns"} dim={presence === "quiet"} />
      {presence === "turns" && <PlateMini />}
      {presence !== "quiet" && (
        <div style={{ position: "absolute", top: 12, right: 12, display: "grid", gap: 8 }}>
          <MapButton label="Map layers"><Layers2 size={16} /></MapButton>
          <MapButton label="Recenter"><LocateFixed size={16} /></MapButton>
        </div>
      )}
      {children}
    </div>
  );
}

/** Quiet-day band: one honest line instead of an empty dark rectangle. */
export function QuietLine({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 14px 14px",
        background: "linear-gradient(to top, rgba(6,12,26,0.7) 0%, rgba(6,12,26,0.15) 70%)",
      }}
    >
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 650, color: "rgba(255,255,255,0.78)", letterSpacing: "-0.01em" }}>{children}</span>
      <ChevronRight size={15} style={{ color: "rgba(255,255,255,0.4)" }} />
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
        background: "rgba(7,16,30,0.97)",
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
