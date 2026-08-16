/**
 * Shared chrome for the client-board map-toggle explorations.
 * Every variant renders the SAME data and the SAME board content —
 * only the way the client moves between board and map differs.
 */
import { Bell, ChevronRight, Search } from "lucide-react";

export const PROPERTY = { name: "Avalon Ridge", meta: "412 units · Dana Whitfield" };

export type Card = {
  unit: string;
  title: string;
  meta: string;
  tone: "lime" | "blue" | "amber" | "mute";
};

export const RAILS: { rail: string; count: number; cards: Card[] }[] = [
  {
    rail: "Needs you",
    count: 2,
    cards: [
      { unit: "Unit 523", title: "PO needed", meta: "Make Ready · $2,480", tone: "amber" },
      { unit: "Unit 118", title: "Walk ready to approve", meta: "9 items · 24 photos", tone: "lime" },
    ],
  },
  {
    rail: "In progress",
    count: 3,
    cards: [
      { unit: "Unit 5000", title: "Carpet + paint", meta: "Marco's crew · on site", tone: "blue" },
      { unit: "Unit 214", title: "Turn clean", meta: "Scheduled Aug 18", tone: "mute" },
    ],
  },
];

export const PINS = [
  { id: "p1", x: 26, y: 30, tone: "lime", label: "Unit 5000" },
  { id: "p2", x: 58, y: 22, tone: "blue", label: "Unit 523" },
  { id: "p3", x: 44, y: 58, tone: "lime", label: "Unit 118" },
  { id: "p4", x: 72, y: 66, tone: "amber", label: "Unit 214" },
] as const;

export const TONE: Record<string, string> = {
  lime: "#b4ff44",
  blue: "#0a84ff",
  amber: "#ffb340",
  mute: "rgba(210,224,255,0.55)",
};

/** Faux Apple-Maps-style tile field: mint ground, cream roads, live pins. */
export function MapCanvas({
  pins = true,
  labels = true,
  className = "",
  style,
}: {
  pins?: boolean;
  labels?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{ position: "relative", background: "#e8f6ef", overflow: "hidden", ...style }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <rect width="100" height="100" fill="#e8f6ef" />
        <rect x="6" y="10" width="26" height="20" fill="#dcefe3" rx="1.5" />
        <rect x="62" y="44" width="30" height="26" fill="#dcefe3" rx="1.5" />
        <rect x="14" y="66" width="22" height="18" fill="#d5ebdd" rx="1.5" />
        <g stroke="#fffdf5" strokeLinecap="round">
          <path d="M0 38 H100" strokeWidth="5" />
          <path d="M0 76 H100" strokeWidth="3.5" />
          <path d="M38 0 V100" strokeWidth="4.5" />
          <path d="M80 0 V100" strokeWidth="3" />
        </g>
        <g stroke="#c7ded1" strokeWidth="0.6">
          <path d="M0 20 H100" /><path d="M0 58 H100" /><path d="M18 0 V100" /><path d="M60 0 V100" />
        </g>
      </svg>
      {pins &&
        PINS.map((p) => (
          <div key={p.id} style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%,-100%)", textAlign: "center" }}>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: TONE[p.tone],
                border: "2.5px solid #fff",
                boxShadow: "0 4px 10px rgba(6,12,28,0.35)",
                margin: "0 auto",
              }}
            />
            {labels && (
              <span
                style={{
                  display: "inline-block",
                  marginTop: 3,
                  padding: "1px 5px",
                  borderRadius: 6,
                  background: "rgba(7,16,30,0.82)",
                  color: "#fff",
                  fontSize: 8.5,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {p.label}
              </span>
            )}
          </div>
        ))}
    </div>
  );
}

/** Dark 56px app header used by every variant. `right` slots in variant-specific controls. */
export function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "0 12px",
        height: 56,
        flexShrink: 0,
        borderBottom: "1px solid var(--cmd-line-soft)",
        background: "rgba(7,16,30,0.86)",
        backdropFilter: "blur(18px)",
      }}
    >
      <div className="cmt-mark" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 750, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{PROPERTY.name}</div>
        <div style={{ fontSize: 10, color: "var(--cmd-mute)", lineHeight: 1.3 }}>{PROPERTY.meta}</div>
      </div>
      {right ?? (
        <>
          <button className="cmt-chip" style={{ width: 30, padding: 0, justifyContent: "center" }} aria-label="Search">
            <Search size={13} />
          </button>
          <button className="cmt-chip" style={{ width: 30, padding: 0, justifyContent: "center" }} aria-label="Alerts">
            <Bell size={13} />
          </button>
        </>
      )}
    </header>
  );
}

export function BoardCard({ card }: { card: Card }) {
  return (
    <div className="cmt-card" style={{ padding: "10px 11px", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: TONE[card.tone] }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cmd-mute)" }}>
          {card.unit}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.25 }}>{card.title}</div>
        <div style={{ fontSize: 11, color: "var(--cmd-mute)" }}>{card.meta}</div>
      </div>
      <ChevronRight size={14} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
    </div>
  );
}

/** The scrolling board body — identical in every variant. */
export function BoardBody({ padTop = 10 }: { padTop?: number }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: `${padTop}px 12px 16px`, display: "grid", gap: 14 }}>
      {RAILS.map((r) => (
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
  );
}
