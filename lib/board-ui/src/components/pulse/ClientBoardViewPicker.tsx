import type { CSSProperties } from "react";

export const CAF_REGIONAL_TOKEN = "caf-regional";
export const CAF_PALOMA_TOKEN = "caf-paloma";

const NAVY = "#0F1B2D";
const LIME = "#B4FF44";
const GOLD = "#C9A227";
const PAPER = "#F7F8F4";
const MUTED = "#5C6B7A";
const LINE = "rgba(15, 27, 45, 0.10)";
const DISPLAY = '"Outfit", "Plus Jakarta Sans", sans-serif';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';

export type ClientBoardViewPickerProps = {
  onRegional: () => void;
  onProperty: () => void;
};

export function ClientBoardViewPicker(props: ClientBoardViewPickerProps) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: PAPER,
        color: NAVY,
        fontFamily: BODY,
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
      />
      <header
        style={{
          height: 58,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 16px",
          background: NAVY,
          color: "#F4F4F0",
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: LIME,
            color: NAVY,
            fontFamily: DISPLAY,
            fontWeight: 800,
            fontSize: 16,
            display: "grid",
            placeItems: "center",
          }}
        >
          C
        </span>
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8496AE",
            }}
          >
            Client Board
          </p>
          <h1
            style={{
              margin: 0,
              fontFamily: DISPLAY,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.03em",
            }}
          >
            Choose a view
          </h1>
        </div>
      </header>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px 64px" }}>
        <p style={{ margin: "0 0 28px", color: MUTED, fontSize: 15, lineHeight: 1.5 }}>
          Password-free for now. Regional sees every community and can add more.
          Property sees Paloma Creek only.
        </p>
        <div style={{ display: "grid", gap: 16 }}>
          <ViewCard
            kicker="Regional"
            title="North Region"
            body="Full picture by property — vacancy, delays, bids, pipeline. Add communities that are not on this portfolio yet."
            accent={LIME}
            onClick={props.onRegional}
          />
          <ViewCard
            kicker="Property"
            title="Paloma Creek"
            body="This community only. Turns, evidence, and invoices for Paloma — not Desert Sage or the rest of the region."
            accent={GOLD}
            onClick={props.onProperty}
          />
        </div>
      </div>
    </div>
  );
}

function ViewCard(props: {
  kicker: string;
  title: string;
  body: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={props.onClick} style={cardBtn}>
      <span
        style={{
          display: "inline-flex",
          minHeight: 28,
          padding: "0 10px",
          alignItems: "center",
          borderRadius: 999,
          border: `1px solid ${props.accent}`,
          background: props.accent === LIME ? "rgba(180,255,68,0.28)" : "transparent",
          color: NAVY,
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontFamily: DISPLAY,
          fontWeight: 600,
        }}
      >
        {props.kicker}
      </span>
      <span
        style={{
          display: "block",
          marginTop: 12,
          fontFamily: DISPLAY,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          textAlign: "left",
        }}
      >
        {props.title}
      </span>
      <span
        style={{
          display: "block",
          marginTop: 8,
          color: MUTED,
          fontSize: 14,
          lineHeight: 1.45,
          textAlign: "left",
        }}
      >
        {props.body}
      </span>
    </button>
  );
}

const cardBtn: CSSProperties = {
  display: "block",
  width: "100%",
  padding: 24,
  borderRadius: 20,
  border: `1px solid ${LINE}`,
  background: "#fff",
  color: NAVY,
  cursor: "pointer",
  textAlign: "left",
  minHeight: 44,
  boxShadow: "0 18px 40px rgba(15, 27, 45, 0.08)",
};
