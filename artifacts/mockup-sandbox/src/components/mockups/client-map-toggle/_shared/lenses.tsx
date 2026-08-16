/**
 * Five map LENSES for the client board — data + the map layer for each.
 * Every lens answers a different manager question, so each one draws the
 * property differently instead of re-skinning the same pin map.
 */
import { Activity, Building2, DollarSign, History, Globe2 } from "lucide-react";

export const C = {
  lime: "#b4ff44",
  blue: "#0a84ff",
  amber: "#ffb340",
  red: "#ff6b6b",
  mute: "rgba(210,224,255,0.55)",
  ink: "rgba(255,255,255,0.92)",
  night: "#07131f",
  mint: "#e8f6ef",
};

export type LensId = "radar" | "money" | "plate" | "replay" | "portfolio";

export const LENSES: { id: LensId; label: string; question: string; icon: typeof Activity }[] = [
  { id: "radar", label: "Live", question: "Who is on my property right now?", icon: Activity },
  { id: "money", label: "Money", question: "Where is my money sitting?", icon: DollarSign },
  { id: "plate", label: "Plate", question: "Which units are where in the turn?", icon: Building2 },
  { id: "replay", label: "Replay", question: "What actually happened today?", icon: History },
  { id: "portfolio", label: "All", question: "How are all my properties doing?", icon: Globe2 },
];

export const CREWS = [
  { id: "c1", name: "Marco R.", unit: "Unit 5000", x: 27, y: 34, on: "2h 14m", tone: C.lime, trade: "Carpet + paint" },
  { id: "c2", name: "Dee's crew", unit: "Unit 118", x: 58, y: 62, on: "48m", tone: C.blue, trade: "Turn clean" },
];

export const STAGES = [
  { id: "vacant", label: "Vacant", color: "rgba(148,170,205,0.75)" },
  { id: "walk", label: "Walk", color: C.blue },
  { id: "work", label: "In progress", color: C.lime },
  { id: "qc", label: "QC", color: C.amber },
  { id: "ready", label: "Rent ready", color: "#ffffff" },
] as const;

type Stage = (typeof STAGES)[number]["id"];
export const stageColor = (s: Stage) => STAGES.find((x) => x.id === s)!.color;

export const UNITS: { id: string; bldg: "A" | "B" | "C"; stage: Stage; days: number; dollars: number }[] = [
  { id: "101", bldg: "A", stage: "ready", days: 0, dollars: 0 },
  { id: "102", bldg: "A", stage: "ready", days: 0, dollars: 0 },
  { id: "104", bldg: "A", stage: "qc", days: 4, dollars: 1180 },
  { id: "108", bldg: "A", stage: "work", days: 2, dollars: 2480 },
  { id: "112", bldg: "A", stage: "walk", days: 1, dollars: 0 },
  { id: "118", bldg: "A", stage: "work", days: 3, dollars: 1640 },
  { id: "121", bldg: "A", stage: "vacant", days: 9, dollars: 0 },
  { id: "124", bldg: "A", stage: "ready", days: 0, dollars: 0 },
  { id: "203", bldg: "B", stage: "vacant", days: 12, dollars: 0 },
  { id: "206", bldg: "B", stage: "qc", days: 5, dollars: 940 },
  { id: "209", bldg: "B", stage: "work", days: 2, dollars: 3120 },
  { id: "214", bldg: "B", stage: "walk", days: 1, dollars: 0 },
  { id: "218", bldg: "B", stage: "ready", days: 0, dollars: 0 },
  { id: "222", bldg: "B", stage: "work", days: 6, dollars: 2210 },
  { id: "226", bldg: "B", stage: "vacant", days: 3, dollars: 0 },
  { id: "231", bldg: "B", stage: "ready", days: 0, dollars: 0 },
  { id: "502", bldg: "C", stage: "qc", days: 2, dollars: 760 },
  { id: "506", bldg: "C", stage: "work", days: 1, dollars: 4180 },
  { id: "511", bldg: "C", stage: "ready", days: 0, dollars: 0 },
  { id: "515", bldg: "C", stage: "vacant", days: 21, dollars: 0 },
  { id: "519", bldg: "C", stage: "walk", days: 1, dollars: 0 },
  { id: "523", bldg: "C", stage: "work", days: 4, dollars: 2480 },
  { id: "528", bldg: "C", stage: "ready", days: 0, dollars: 0 },
  { id: "5000", bldg: "C", stage: "work", days: 2, dollars: 5320 },
];

export const MONEY = [
  { label: "Awaiting your PO", value: 8420, tone: C.amber, x: 30, y: 30, r: 30 },
  { label: "Work in progress", value: 14680, tone: C.lime, x: 62, y: 52, r: 36 },
  { label: "Invoiced, unpaid", value: 5240, tone: C.blue, x: 40, y: 72, r: 22 },
];

export const REPLAY_EVENTS = [
  { t: 8, at: "8:04a", label: "Marco arrived", unit: "5000", tone: C.lime },
  { t: 26, at: "9:31a", label: "12 before photos", unit: "5000", tone: C.blue },
  { t: 44, at: "11:02a", label: "Walk submitted", unit: "118", tone: C.amber },
  { t: 62, at: "1:15p", label: "Dee arrived", unit: "118", tone: C.lime },
  { t: 81, at: "3:40p", label: "Unit 523 marked QC", unit: "523", tone: C.amber },
];

export const PROPERTIES = [
  { name: "Avalon Ridge", x: 30, y: 26, pct: 0.72, live: 4, risk: "2 POs", tone: C.lime },
  { name: "Bellmore Flats", x: 66, y: 34, pct: 0.41, live: 2, risk: "1 aging", tone: C.amber },
  { name: "Cedar Point", x: 44, y: 58, pct: 0.93, live: 1, risk: "clear", tone: C.lime },
  { name: "Dovewood", x: 72, y: 74, pct: 0.18, live: 0, risk: "no crew", tone: C.red },
];

export const money = (n: number) => "$" + n.toLocaleString();

/* ------------------------------------------------------------------ */
/* Map layers                                                          */
/* ------------------------------------------------------------------ */

function Roads({ dark }: { dark?: boolean }) {
  const road = dark ? "rgba(140,180,235,0.16)" : "#fffdf5";
  const minor = dark ? "rgba(140,180,235,0.08)" : "#c7ded1";
  const block = dark ? "rgba(120,165,225,0.07)" : "#dcefe3";
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <rect width="100" height="100" fill={dark ? C.night : C.mint} />
      <rect x="6" y="8" width="26" height="20" fill={block} rx="1.5" />
      <rect x="62" y="42" width="30" height="26" fill={block} rx="1.5" />
      <rect x="12" y="64" width="24" height="20" fill={block} rx="1.5" />
      <g stroke={road} strokeLinecap="round">
        <path d="M0 38 H100" strokeWidth="5" />
        <path d="M0 76 H100" strokeWidth="3.5" />
        <path d="M38 0 V100" strokeWidth="4.5" />
        <path d="M80 0 V100" strokeWidth="3" />
      </g>
      <g stroke={minor} strokeWidth="0.6">
        <path d="M0 20 H100" /><path d="M0 58 H100" /><path d="M18 0 V100" /><path d="M60 0 V100" />
      </g>
    </svg>
  );
}

/** LIVE — night map, pulsing crew radar, breathing GPS trail. */
export function MapRadar() {
  return (
    <div style={{ position: "absolute", inset: 0, background: C.night, overflow: "hidden" }}>
      <Roads dark />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <path className="cmt-trail" d="M14 82 C 22 70, 20 48, 27 34" fill="none" stroke={C.lime} strokeWidth="0.8" strokeDasharray="2 3" opacity="0.75" />
        <path className="cmt-trail" d="M86 88 C 70 82, 62 72, 58 62" fill="none" stroke={C.blue} strokeWidth="0.8" strokeDasharray="2 3" opacity="0.7" />
      </svg>
      {CREWS.map((c) => (
        <div key={c.id} style={{ position: "absolute", left: c.x + "%", top: c.y + "%", transform: "translate(-50%,-50%)" }}>
          <span className="cmt-ping" style={{ position: "absolute", inset: -8, borderRadius: 999, border: "1.5px solid " + c.tone, display: "block" }} />
          <span className="cmt-ping" style={{ position: "absolute", inset: -8, borderRadius: 999, border: "1.5px solid " + c.tone, display: "block", animationDelay: "1.3s" }} />
          <div style={{ width: 15, height: 15, borderRadius: 999, background: c.tone, border: "2.5px solid rgba(7,19,31,0.9)", boxShadow: "0 0 18px " + c.tone }} />
          <div
            style={{
              position: "absolute",
              top: 20,
              left: "50%",
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
              padding: "2px 7px",
              borderRadius: 7,
              background: "rgba(7,16,30,0.88)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            {c.unit} · <span style={{ color: c.tone }}>{c.on}</span>
          </div>
        </div>
      ))}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 70% at 50% 100%, rgba(180,255,68,0.09), transparent 60%)", pointerEvents: "none" }} />
    </div>
  );
}

/** MONEY — heat blobs sized and coloured by dollars in flight. */
export function MapMoney() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#08131f", overflow: "hidden" }}>
      <Roads dark />
      {MONEY.map((m) => (
        <div key={m.label} style={{ position: "absolute", left: m.x + "%", top: m.y + "%", transform: "translate(-50%,-50%)" }}>
          <div
            className="cmt-breathe"
            style={{
              width: m.r * 4,
              height: m.r * 4,
              borderRadius: 999,
              background: "radial-gradient(circle, " + m.tone + "55 0%, " + m.tone + "18 45%, transparent 70%)",
            }}
          />
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.03em", color: m.tone, textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
                {money(m.value)}
              </div>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "rgba(255,255,255,0.72)" }}>
                {m.label}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** PLATE — the site plan. No roads: buildings and unit boxes by turn stage. */
export function MapPlate() {
  const bldgs: ("A" | "B" | "C")[] = ["A", "B", "C"];
  return (
    <div style={{ position: "absolute", inset: 0, background: "#08131f", overflow: "auto", padding: "106px 58px 14px 12px" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "linear-gradient(rgba(140,180,235,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(140,180,235,0.07) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div style={{ position: "relative", display: "grid", gap: 10 }}>
        {bldgs.map((b) => {
          const units = UNITS.filter((u) => u.bldg === b);
          return (
            <div key={b} style={{ borderRadius: 14, border: "1px solid rgba(170,200,255,0.18)", background: "rgba(12,25,42,0.72)", padding: "9px 10px 11px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: C.ink }}>BLDG {b}</span>
                <span style={{ flex: 1, height: 1, background: "rgba(170,200,255,0.16)" }} />
                <span style={{ fontSize: 9.5, fontWeight: 700, color: C.mute }}>{units.filter((u) => u.stage !== "ready").length} open</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {units.map((u) => {
                  const col = stageColor(u.stage);
                  const solid = u.stage === "work" || u.stage === "qc";
                  return (
                    <div
                      key={u.id}
                      style={{
                        aspectRatio: "1.35",
                        borderRadius: 9,
                        border: "1px solid " + col + (solid ? "" : "66"),
                        background: solid ? col + "22" : "rgba(255,255,255,0.03)",
                        boxShadow: solid ? "0 0 14px " + col + "33" : "none",
                        display: "grid",
                        placeItems: "center",
                        gap: 1,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 750, color: u.stage === "ready" ? "rgba(255,255,255,0.55)" : C.ink }}>{u.id}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, color: col }}>{u.stage === "ready" ? "ready" : u.days + "d"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** REPLAY — the day rewound: partially drawn trails and ghosted stops. */
export function MapReplay({ pct = 0.62 }: { pct?: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#081522", overflow: "hidden" }}>
      <Roads dark />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <path d="M12 88 C 24 74, 20 50, 30 36 C 40 24, 56 30, 60 46 C 64 60, 52 68, 44 78" fill="none" stroke="rgba(180,255,68,0.18)" strokeWidth="1.4" />
        <path
          d="M12 88 C 24 74, 20 50, 30 36 C 40 24, 56 30, 60 46 C 64 60, 52 68, 44 78"
          fill="none"
          stroke={C.lime}
          strokeWidth="1.6"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={pct * 100 + " 100"}
        />
      </svg>
      {[
        { x: 30, y: 36, at: "8:04a", done: true },
        { x: 60, y: 46, at: "11:02a", done: true },
        { x: 44, y: 78, at: "3:40p", done: false },
      ].map((s) => (
        <div key={s.at} style={{ position: "absolute", left: s.x + "%", top: s.y + "%", transform: "translate(-50%,-50%)", textAlign: "center", opacity: s.done ? 1 : 0.38 }}>
          <div style={{ width: 11, height: 11, borderRadius: 999, background: s.done ? C.lime : "transparent", border: "2px solid " + C.lime, boxShadow: s.done ? "0 0 14px rgba(180,255,68,0.6)" : "none", margin: "0 auto" }} />
          <span style={{ display: "inline-block", marginTop: 3, padding: "1px 5px", borderRadius: 6, background: "rgba(7,16,30,0.85)", fontSize: 8.5, fontWeight: 700 }}>{s.at}</span>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "4px 12px",
          borderRadius: 999,
          background: "rgba(180,255,68,0.14)",
          border: "1px solid rgba(180,255,68,0.4)",
          color: C.lime,
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "-0.01em",
        }}
      >
        1:15 PM
      </div>
    </div>
  );
}

/** ALL — portfolio constellation: one ring gauge per property. */
export function MapPortfolio() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#07121e", overflow: "hidden" }}>
      <Roads dark />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <g stroke="rgba(170,200,255,0.18)" strokeWidth="0.4" strokeDasharray="1.5 2">
          <path d="M30 26 L66 34" /><path d="M66 34 L44 58" /><path d="M44 58 L72 74" /><path d="M30 26 L44 58" />
        </g>
      </svg>
      {PROPERTIES.map((p) => {
        const R = 15.5;
        const circ = 2 * Math.PI * R;
        return (
          <div key={p.name} style={{ position: "absolute", left: p.x + "%", top: p.y + "%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
            <div style={{ position: "relative", width: 44, height: 44 }}>
              <svg viewBox="0 0 40 40" style={{ width: 44, height: 44, transform: "rotate(-90deg)" }}>
                <circle cx="20" cy="20" r={R} fill="rgba(7,16,30,0.82)" stroke="rgba(255,255,255,0.14)" strokeWidth="3" />
                <circle cx="20" cy="20" r={R} fill="none" stroke={p.tone} strokeWidth="3" strokeLinecap="round" strokeDasharray={p.pct * circ + " " + circ} />
              </svg>
              <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, color: C.ink }}>
                {Math.round(p.pct * 100)}
              </span>
            </div>
            <span style={{ display: "inline-block", marginTop: 2, padding: "1px 6px", borderRadius: 6, background: "rgba(7,16,30,0.86)", fontSize: 8.5, fontWeight: 700, whiteSpace: "nowrap" }}>
              {p.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
