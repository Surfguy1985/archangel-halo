import type { CSSProperties } from "react";
import type { CostToServeDocument, WorkSourceFilter } from "@workspace/api-client-react";
import { formatUsdCents } from "../pulse/formatUsdCents";

const INK = "#07101E";
const LIME = "#B4FF44";
const GOLD = "#E8C36A";
const HAIRLINE = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.58)";
const DISPLAY = '"Outfit", "Plus Jakarta Sans", sans-serif';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const FILTERS: Array<{ id: WorkSourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "in_house", label: "In-house" },
  { id: "third_party", label: "Third-party" },
];

export type CostToServeProps = {
  doc: CostToServeDocument | undefined;
  loading?: boolean;
  errorMessage?: string;
  workSource?: WorkSourceFilter;
  onWorkSource: (next: WorkSourceFilter) => void;
  homeHref?: { label: string; onClick: () => void };
};

function rateLabel(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function SideCard(props: { title: string; side: CostToServeDocument["rows"][number]["inHouse"] }) {
  return (
    <div style={{ flex: 1, minWidth: 160, padding: 16, border: `1px solid ${HAIRLINE}`, borderRadius: 16 }}>
      <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: MUTED, fontFamily: DISPLAY, fontWeight: 600 }}>
        {props.title}
      </p>
      <p style={{ margin: "12px 0 0", fontFamily: MONO, fontSize: 22, fontVariantNumeric: "tabular-nums", color: LIME }}>
        {formatUsdCents(props.side.costPerUnitCents)}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>cost per unit</p>
      <p style={{ margin: "16px 0 0", fontFamily: MONO, fontSize: 16, fontVariantNumeric: "tabular-nums" }}>
        {props.side.daysPerUnit == null ? "—" : props.side.daysPerUnit.toFixed(1)}
        <span style={{ color: MUTED, fontSize: 12 }}> days</span>
      </p>
      <p style={{ margin: "8px 0 0", fontFamily: MONO, fontSize: 16, fontVariantNumeric: "tabular-nums", color: GOLD }}>
        {rateLabel(props.side.reworkRateBps)}
        <span style={{ color: MUTED, fontSize: 12 }}> rework</span>
      </p>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: MUTED }}>{props.side.unitCount} units</p>
    </div>
  );
}

export function CostToServe(props: CostToServeProps) {
  const filter = props.workSource ?? props.doc?.workSource ?? "all";
  return (
    <div style={{ minHeight: "100dvh", background: INK, color: "#F4F7F2", fontFamily: BODY }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
      />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "20px 20px 64px" }}>
        {props.homeHref ? (
          <button type="button" onClick={props.homeHref.onClick} style={ghostBtn}>
            {props.homeHref.label}
          </button>
        ) : null}
        <p style={{ margin: "16px 0 0", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MUTED, fontFamily: DISPLAY, fontWeight: 600 }}>
          Portfolio
        </p>
        <h1 style={{ margin: "4px 0 8px", fontFamily: DISPLAY, fontSize: 22, fontWeight: 700 }}>
          {props.doc?.title ?? "How work gets done across the portfolio"}
        </h1>
        <p style={{ margin: "0 0 20px", color: MUTED, fontSize: 13, maxWidth: 620 }}>
          In-house and third-party make-ready on the same board, same evidence, same clock. Use this to show how work actually lands — not as a vendor scorecard.
        </p>
        <div role="tablist" aria-label="Work source" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => props.onWorkSource(f.id)}
                style={{
                  ...ghostBtn,
                  background: active ? LIME : "transparent",
                  color: active ? INK : "#F4F7F2",
                  borderColor: active ? LIME : HAIRLINE,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {props.loading && !props.doc ? (
          <p style={{ color: MUTED }}>Loading…</p>
        ) : props.errorMessage ? (
          <p role="alert" style={{ color: "#F07167" }}>{props.errorMessage}</p>
        ) : (props.doc?.rows.length ?? 0) === 0 ? (
          <p style={{ color: MUTED }}>No completed turns in this range yet.</p>
        ) : (
          props.doc!.rows.map((row) => (
            <section key={row.workType} style={{ marginBottom: 28 }}>
              <h2 style={{ fontFamily: DISPLAY, fontSize: 16, margin: "0 0 12px" }}>{row.workType}</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <SideCard title="In-house" side={row.inHouse} />
                <SideCard title="Third-party" side={row.thirdParty} />
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

const ghostBtn: CSSProperties = {
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 999,
  border: `1px solid ${HAIRLINE}`,
  background: "transparent",
  color: "#F4F7F2",
  fontFamily: BODY,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
