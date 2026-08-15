import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type {
  PortfolioAttentionDocument,
  PortfolioPulseDocument,
  PulseRangePreset,
  PulseTileSort,
} from "@workspace/api-client-react";
import { useBoardEvents } from "../../hooks/useBoardEvents";
import { formatUsdCents, signedUsdCents } from "./formatUsdCents";

const INK = "#07101E";
const LIME = "#B4FF44";
const GOLD = "#E8C36A";
const CORAL = "#F07167";
const HAIRLINE = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.58)";
const DISPLAY = '"Outfit", "Plus Jakarta Sans", sans-serif';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export type PortfolioPulseProps = {
  pulse: PortfolioPulseDocument | undefined;
  attention: PortfolioAttentionDocument | undefined;
  streamUrl: string | null;
  onRefetch: () => void;
  onTileClick: (propertyId: string) => void;
  onAttentionClick: (href: string) => void;
  onRangeChange: (range: PulseRangePreset, from?: string, to?: string) => void;
  onSortChange: (sort: PulseTileSort) => void;
  isLoading?: boolean;
  errorMessage?: string;
  homeHref?: { label: string; onClick: () => void };
  portfolios?: Array<{ id: string; name: string }>;
  selectedPortfolioId?: string;
  onPortfolioChange?: (id: string) => void;
};

const RANGES: Array<{ id: PulseRangePreset; label: string }> = [
  { id: "this_month", label: "This month" },
  { id: "last_30", label: "Last 30" },
  { id: "qtd", label: "QTD" },
  { id: "custom", label: "Custom" },
];

const SORTS: Array<{ id: PulseTileSort; label: string }> = [
  { id: "vacancy_cost", label: "Vacancy $" },
  { id: "turn_days", label: "Turn days" },
  { id: "units_in_turn", label: "Units in turn" },
  { id: "name", label: "Name" },
];

const STATUS_COLOR: Record<string, string> = {
  on_target: LIME,
  drifting: GOLD,
  at_risk: CORAL,
};

export function PortfolioPulse(props: PortfolioPulseProps) {
  const reduceMotion = useReducedMotion();
  const live = useBoardEvents(props.streamUrl, props.onRefetch, "pulse");
  const pulse = props.pulse;
  const [customFrom, setCustomFrom] = useState(pulse?.from ?? "");
  const [customTo, setCustomTo] = useState(pulse?.to ?? "");

  useEffect(() => {
    if (pulse?.from) setCustomFrom(pulse.from);
    if (pulse?.to) setCustomTo(pulse.to);
  }, [pulse?.from, pulse?.to]);

  const portfolioMedian = pulse?.supporting.medianTurnDays ?? null;
  const delta = pulse?.headline.vacancyCostDeltaCents ?? "0";
  const deltaUp = !delta.startsWith("-") && delta !== "0";

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: INK,
        color: "#F4F7F2",
        fontFamily: BODY,
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
      />
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "20px 20px 64px",
        }}
      >
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            marginBottom: 28,
          }}
        >
          {props.homeHref ? (
            <button
              type="button"
              onClick={props.homeHref.onClick}
              style={ghostBtn}
            >
              {props.homeHref.label}
            </button>
          ) : null}
          <div style={{ flex: 1, minWidth: 160 }}>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: MUTED,
                fontFamily: DISPLAY,
                fontWeight: 600,
              }}
            >
              Portfolio Pulse
            </p>
            <h1
              style={{
                margin: "4px 0 0",
                fontFamily: DISPLAY,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.03em",
              }}
            >
              {pulse?.portfolioName ?? "Portfolio"}
            </h1>
          </div>
          {props.portfolios && props.portfolios.length > 1 && props.onPortfolioChange ? (
            <label style={{ ...dateLabel, minWidth: 180 }}>
              Portfolio
              <select
                aria-label="Portfolio"
                value={props.selectedPortfolioId ?? pulse?.portfolioId ?? ""}
                onChange={(e) => props.onPortfolioChange?.(e.target.value)}
                style={{ ...dateInput, minHeight: 44 }}
              >
                {props.portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minHeight: 44,
              padding: "0 12px",
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 999,
              fontSize: 12,
              color: MUTED,
            }}
            aria-live="polite"
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: live === "live" ? LIME : MUTED,
              }}
            />
            {live === "live" ? "Live" : live === "reconnecting" ? "Reconnecting" : "Idle"}
          </span>
        </header>

        <div
          role="tablist"
          aria-label="Date range"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}
        >
          {RANGES.map((r) => {
            const active = pulse?.range === r.id;
            return (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => props.onRangeChange(r.id, customFrom, customTo)}
                style={{
                  ...chipBtn,
                  background: active ? LIME : "transparent",
                  color: active ? INK : "#F4F7F2",
                  borderColor: active ? LIME : HAIRLINE,
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {pulse?.range === "custom" ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <label style={dateLabel}>
              From
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={dateInput}
              />
            </label>
            <label style={dateLabel}>
              To
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={dateInput}
              />
            </label>
            <button
              type="button"
              style={chipBtn}
              onClick={() => props.onRangeChange("custom", customFrom, customTo)}
            >
              Apply
            </button>
          </div>
        ) : null}

        {props.isLoading && !pulse ? (
          <p style={{ color: MUTED }}>Loading portfolio…</p>
        ) : null}
        {props.errorMessage ? (
          <p style={{ color: CORAL }}>{props.errorMessage}</p>
        ) : null}

        <section aria-label="Vacancy cost" style={{ margin: "8px 0 28px" }}>
          <TweenCents
            cents={pulse?.headline.vacancyCostCents ?? "0"}
            reduceMotion={!!reduceMotion}
          />
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 14,
              color: MUTED,
              maxWidth: 420,
            }}
          >
            {pulse?.headline.label ?? "rent lost to vacancy days this month"}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 14 }}>
            <span style={{ color: deltaUp ? CORAL : LIME, fontVariantNumeric: "tabular-nums", fontFamily: MONO }}>
              {signedUsdCents(delta)}
            </span>
            <span style={{ color: MUTED }}> {pulse?.headline.priorLabel ?? "last month, same day"}</span>
          </p>
        </section>

        <section
          aria-label="Supporting figures"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            borderTop: `1px solid ${HAIRLINE}`,
            borderBottom: `1px solid ${HAIRLINE}`,
            marginBottom: 28,
          }}
        >
          <QuietStat
            label="Units in turn"
            value={String(pulse?.supporting.unitsInTurn ?? "—")}
          />
          <QuietStat
            label="Median turn days"
            value={
              pulse?.supporting.medianTurnDays == null
                ? "—"
                : `${pulse.supporting.medianTurnDays}`
            }
            hint={`vs ${pulse?.supporting.targetTurnDays ?? "—"} target`}
            border
          />
          <QuietStat
            label="Predicted late this week"
            value={String(pulse?.supporting.predictedLateThisWeek ?? "—")}
            border
          />
        </section>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <p
            style={{
              margin: 0,
              flex: 1,
              fontFamily: DISPLAY,
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            Properties
          </p>
          {SORTS.map((s) => {
            const active = pulse?.sort === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => props.onSortChange(s.id)}
                style={{
                  ...chipBtn,
                  minHeight: 44,
                  background: active ? "rgba(180,255,68,0.14)" : "transparent",
                  borderColor: active ? LIME : HAIRLINE,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {(pulse?.tiles ?? []).map((tile) => (
            <button
              key={tile.propertyId}
              type="button"
              onClick={() => props.onTileClick(tile.propertyId)}
              style={{
                textAlign: "left",
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 16,
                padding: 16,
                minHeight: 44,
                color: "inherit",
                cursor: "pointer",
                boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontFamily: DISPLAY,
                      fontWeight: 600,
                      fontSize: 16,
                    }}
                  >
                    {tile.name}
                  </p>
                  <p style={{ margin: "4px 0 0", color: MUTED, fontSize: 12 }}>
                    {tile.unitCount} units · {tile.unitsInTurn} in turn
                  </p>
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: MUTED,
                    minHeight: 44,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: STATUS_COLOR[tile.status] ?? LIME,
                    }}
                  />
                  {tile.statusLabel}
                </span>
              </div>
              <Sparkline values={tile.sparkline} />
              <HairlineBar
                median={tile.medianTurnDays}
                portfolioMedian={portfolioMedian}
              />
              <p
                style={{
                  margin: "12px 0 0",
                  fontFamily: MONO,
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                {formatUsdCents(tile.vacancyCostCents)}
              </p>
              <p style={{ margin: "2px 0 0", color: MUTED, fontSize: 12 }}>
                Vacancy this window
                {tile.medianTurnDays != null ? ` · ${tile.medianTurnDays} day median` : ""}
              </p>
            </button>
          ))}
        </div>

        <section style={{ marginTop: 36 }}>
          <h2
            style={{
              fontFamily: DISPLAY,
              fontSize: 16,
              fontWeight: 600,
              margin: "0 0 12px",
            }}
          >
            Needs you
          </h2>
          {(props.attention?.groups ?? []).length === 0 ? (
            <p style={{ color: MUTED, margin: 0 }}>All clear — nothing stalled or waiting.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {props.attention!.groups.map((group) => (
                <div
                  key={group.kind}
                  style={{
                    border: `1px solid ${HAIRLINE}`,
                    borderRadius: 16,
                    padding: 16,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontFamily: DISPLAY,
                      fontWeight: 600,
                    }}
                  >
                    {group.title}
                  </p>
                  <p style={{ margin: "4px 0 12px", color: MUTED, fontSize: 13 }}>
                    {group.summary}
                  </p>
                  {group.items.map((item) => (
                    <button
                      key={item.turnId}
                      type="button"
                      onClick={() => props.onAttentionClick(item.href)}
                      style={{
                        ...ghostBtn,
                        width: "100%",
                        justifyContent: "space-between",
                        marginBottom: 6,
                      }}
                    >
                      <span>
                        {item.propertyName} · {item.unitNumber}
                      </span>
                      <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                        {item.days}d
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <style>{`
        @media (max-width: 720px) {
          [aria-label="Supporting figures"] { grid-template-columns: 1fr !important; }
        }
        button:focus-visible { outline: 2px solid ${LIME}; outline-offset: 3px; }
      `}</style>
    </div>
  );
}

function QuietStat(props: { label: string; value: string; hint?: string; border?: boolean }) {
  return (
    <div
      style={{
        padding: "16px 12px",
        borderLeft: props.border ? `1px solid ${HAIRLINE}` : "none",
      }}
    >
      <p style={{ margin: 0, color: MUTED, fontSize: 12 }}>{props.label}</p>
      <p
        style={{
          margin: "6px 0 0",
          fontFamily: MONO,
          fontVariantNumeric: "tabular-nums",
          fontSize: 22,
          fontWeight: 600,
        }}
      >
        {props.value}
      </p>
      {props.hint ? (
        <p style={{ margin: "4px 0 0", color: MUTED, fontSize: 12 }}>{props.hint}</p>
      ) : null}
    </div>
  );
}

function TweenCents(props: { cents: string; reduceMotion: boolean }) {
  const target = useMemo(() => {
    try {
      return BigInt(props.cents);
    } catch {
      return 0n;
    }
  }, [props.cents]);
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (props.reduceMotion || shown === target) {
      setShown(target);
      return;
    }
    const from = shown;
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 300);
      const mixed = from + BigInt(Math.round(Number(target - from) * t));
      setShown(mixed);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally only re-run when the cents string changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cents, props.reduceMotion]);

  return (
    <AnimatePresence mode="wait">
      <motion.p
        key={props.cents}
        initial={props.reduceMotion ? false : { opacity: 0.55 }}
        animate={{ opacity: 1 }}
        style={{
          margin: 0,
          fontFamily: MONO,
          fontVariantNumeric: "tabular-nums",
          fontSize: "clamp(40px, 9vw, 84px)",
          fontWeight: 600,
          letterSpacing: "-0.04em",
          color: LIME,
          lineHeight: 0.95,
        }}
      >
        {formatUsdCents(shown.toString())}
      </motion.p>
    </AnimatePresence>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 240;
  const h = 36;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - (v / max) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ marginTop: 12 }}>
      <polyline fill="none" stroke={LIME} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

function HairlineBar(props: { median: number | null; portfolioMedian: number | null }) {
  const { median, portfolioMedian } = props;
  const pct =
    median != null && portfolioMedian && portfolioMedian > 0
      ? Math.min(100, (median / (portfolioMedian * 2)) * 100)
      : 0;
  return (
    <div
      style={{
        position: "relative",
        height: 6,
        marginTop: 12,
        background: "rgba(255,255,255,0.08)",
        borderRadius: 99,
      }}
      aria-label="Median turn days versus portfolio"
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -2,
          width: 1,
          height: 10,
          background: "rgba(255,255,255,0.45)",
        }}
      />
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: LIME,
          borderRadius: 99,
        }}
      />
    </div>
  );
}

const chipBtn: CSSProperties = {
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

const ghostBtn: CSSProperties = {
  ...chipBtn,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const dateLabel: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: MUTED,
};

const dateInput: CSSProperties = {
  minHeight: 44,
  padding: "0 10px",
  borderRadius: 10,
  border: `1px solid ${HAIRLINE}`,
  background: "transparent",
  color: "#F4F7F2",
  fontFamily: BODY,
};
