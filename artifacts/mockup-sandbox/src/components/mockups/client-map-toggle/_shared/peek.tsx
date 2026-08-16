/**
 * OPTION B, refined — "the map is a glance, not a mode."
 *
 * Apple-review notes driving these pieces:
 *  - The board stays the content. The map never becomes a tab, a mode, or a rail.
 *  - One tap target (the glance itself), one sheet, one layers button. No dial.
 *  - Colour is information: lime = on site, blue = second crew, amber = needs you.
 *  - Chrome is glass over the map, never a bar stealing height from the board.
 */
import { C, CREWS } from "./lenses";

export const PROPERTY = { name: "Avalon Ridge", meta: "412 units · Dana Whitfield" };

/** Night streets — quiet enough to sit under a board without shouting. */
function Streets() {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="pk-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1729" />
          <stop offset="100%" stopColor="#06101c" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#pk-sky)" />
      <g fill="rgba(120,165,225,0.08)">
        <rect x="6" y="10" width="26" height="19" rx="1.5" />
        <rect x="62" y="42" width="30" height="26" rx="1.5" />
        <rect x="12" y="66" width="24" height="19" rx="1.5" />
      </g>
      <g stroke="rgba(140,180,235,0.15)" strokeLinecap="round">
        <path d="M0 38 H100" strokeWidth="5" />
        <path d="M0 78 H100" strokeWidth="3.2" />
        <path d="M38 0 V100" strokeWidth="4.4" />
        <path d="M82 0 V100" strokeWidth="2.8" />
      </g>
      <g stroke="rgba(140,180,235,0.07)" strokeWidth="0.6">
        <path d="M0 20 H100" />
        <path d="M0 58 H100" />
        <path d="M18 0 V100" />
        <path d="M62 0 V100" />
      </g>
    </svg>
  );
}

/** A crew, exactly as Find My draws a person: dot, soft ring, optional name. */
function CrewPin({ crew, label, big }: { crew: (typeof CREWS)[number]; label?: boolean; big?: boolean }) {
  const d = big ? 15 : 11;
  return (
    <div style={{ position: "absolute", left: crew.x + "%", top: crew.y + "%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
      <div style={{ position: "relative", width: d, height: d, margin: "0 auto" }}>
        <span
          className="cmt-ping"
          style={{ position: "absolute", inset: -d, borderRadius: 999, border: "1.5px solid " + crew.tone, opacity: 0.5 }}
        />
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 999,
            background: crew.tone,
            border: "2px solid rgba(255,255,255,0.92)",
            boxShadow: "0 3px 10px rgba(6,12,28,0.5)",
          }}
        />
      </div>
      {label && (
        <span
          style={{
            display: "inline-block",
            marginTop: 5,
            padding: "2px 7px",
            borderRadius: 7,
            background: "rgba(7,16,30,0.85)",
            backdropFilter: "blur(10px)",
            fontSize: 9.5,
            fontWeight: 700,
            whiteSpace: "nowrap",
            color: "rgba(255,255,255,0.92)",
          }}
        >
          {crew.name} · {crew.on}
        </span>
      )}
    </div>
  );
}

/** The map itself. Same drawing at every size — only the labels change. */
export function PeekMap({
  labels = false,
  big = false,
  weather = false,
  filter,
}: {
  labels?: boolean;
  big?: boolean;
  weather?: boolean;
  filter?: string;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, filter }}>
      <Streets />
      {weather && (
        <>
          <div
            className="cmt-drift"
            style={{
              position: "absolute",
              left: "-18%",
              top: "-24%",
              width: "86%",
              height: "96%",
              borderRadius: "50%",
              background: "radial-gradient(circle at 60% 60%, rgba(122,165,225,0.42), rgba(122,165,225,0) 70%)",
            }}
          />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            <path d="M58 -6 C 46 24, 62 52, 44 106" fill="none" stroke="rgba(159,198,255,0.75)" strokeWidth="1.2" strokeDasharray="3 3" />
          </svg>
        </>
      )}
      {CREWS.map((c) => (
        <CrewPin key={c.id} crew={c} label={labels} big={big} />
      ))}
    </div>
  );
}

/** Glass pill used for the one status line on the glance. */
export function StatusPill({ tone = C.lime, children, style }: { tone?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        background: "rgba(7,16,30,0.72)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(255,255,255,0.1)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "-0.01em",
        ...style,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: tone, boxShadow: "0 0 8px " + tone }} />
      {children}
    </div>
  );
}

export function Grabber() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "7px 0 5px" }}>
      <span style={{ width: 36, height: 5, borderRadius: 999, background: "rgba(255,255,255,0.22)" }} />
    </div>
  );
}

/** Circular map control, the size Apple Maps uses (44pt tap target). */
export function MapButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      style={{
        width: 38,
        height: 38,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid rgba(255,255,255,0.12)",
        background: active ? C.lime : "rgba(7,16,30,0.78)",
        color: active ? "#07101e" : "rgba(255,255,255,0.9)",
        backdropFilter: "blur(14px)",
        boxShadow: "0 6px 18px rgba(6,12,28,0.45)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
