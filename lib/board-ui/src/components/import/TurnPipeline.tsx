import { useMemo, useState, type CSSProperties } from "react";
import type { PipelineDocument } from "@workspace/api-client-react";
import { formatUsdCents } from "../pulse/formatUsdCents";
import { VirtualList } from "../virtual/VirtualList";

const INK = "#07101E";
const LIME = "#B4FF44";
const GOLD = "#E8C36A";
const CORAL = "#F07167";
const HAIRLINE = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.58)";
const DISPLAY = '"Outfit", "Plus Jakarta Sans", sans-serif';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const TRADES = ["paint", "flooring", "clean", "drywall", "hvac", "punch"] as const;

export type TurnPipelineProps = {
  doc: PipelineDocument | undefined;
  loading?: boolean;
  errorMessage?: string;
  onHold?: (turnId: string) => void | Promise<void>;
  onConfirm?: (bundleId: string) => void | Promise<void>;
  homeHref?: { label: string; onClick: () => void };
};

function crunchFill(ratio: number, crunch: boolean): string {
  if (!crunch) return "rgba(180,255,68,0.16)";
  if (ratio >= 1.5) return "rgba(240,113,103,0.45)";
  return "rgba(232,195,106,0.35)";
}

function weekLabel(civil: string): string {
  const [y, m, d] = civil.split("-").map(Number);
  const utc = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(utc);
}

function formatHoldExpiry(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function TurnPipeline(props: TurnPipelineProps) {
  const [picked, setPicked] = useState<{ propertyId: string; weekStart: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const doc = props.doc;

  const run = (key: string, fn: () => void | Promise<void>) => {
    setLocalError(null);
    setBusy(key);
    void Promise.resolve(fn())
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : "That did not go through.";
        setLocalError(message);
      })
      .finally(() => setBusy(null));
  };

  const listed = useMemo(() => {
    if (!doc || !picked) return [];
    const idx = doc.weekStarts.indexOf(picked.weekStart);
    const next = idx >= 0 ? doc.weekStarts[idx + 1] : undefined;
    return doc.units.filter((u) => {
      if (u.propertyId !== picked.propertyId) return false;
      if (u.vacateCivil < picked.weekStart) return false;
      if (next && u.vacateCivil >= next) return false;
      if (!next && idx !== doc.weekStarts.length - 1) return false;
      return idx >= 0;
    });
  }, [doc, picked]);

  const prestaging = (doc?.units ?? []).filter((u) => u.kind === "scheduled");

  return (
    <div style={{ minHeight: "100dvh", background: INK, color: "#F4F7F2", fontFamily: BODY }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
      />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 20px 80px" }}>
        {props.homeHref ? (
          <button type="button" onClick={props.homeHref.onClick} style={ghostBtn}>
            {props.homeHref.label}
          </button>
        ) : null}
        <p style={{ margin: "16px 0 0", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MUTED, fontFamily: DISPLAY, fontWeight: 600 }}>
          Pipeline
        </p>
        <h1 style={{ margin: "4px 0 8px", fontFamily: DISPLAY, fontSize: 22, fontWeight: 700 }}>
          {doc?.title ?? "Turn pipeline"}
        </h1>
        <p style={{ margin: "0 0 12px", color: MUTED, fontSize: 13, maxWidth: 720 }}>
          Next 13 weeks. Cells are units expected to vacate. Gold/coral means forecast demand beats declared capacity.
        </p>
        <button type="button" onClick={() => setMethodOpen((o) => !o)} style={{ ...ghostBtn, marginBottom: 20 }}>
          {methodOpen ? "Hide method" : "How this forecast is built"}
        </button>
        {methodOpen && doc ? (
          <p role="note" style={{ margin: "0 0 20px", fontSize: 13, color: GOLD, maxWidth: 760, lineHeight: 1.5 }}>
            {doc.method} On-schedule conversion this book: {(doc.conversionRate * 100).toFixed(0)}%. Zone {doc.timezone}.
          </p>
        ) : null}

        {props.loading && !doc ? <p style={{ color: MUTED }}>Loading…</p> : null}
        {props.errorMessage || localError ? (
          <p role="alert" style={{ color: CORAL }}>
            {props.errorMessage ?? localError}
          </p>
        ) : null}

        {doc && doc.weekStarts.length > 0 ? (
          <div style={{ overflowX: "auto", marginBottom: 32 }}>
            <table style={{ borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: INK, zIndex: 1 }}>Property</th>
                  {doc.weekStarts.map((w) => (
                    <th key={w} style={th}>
                      {weekLabel(w)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doc.properties.map((p) => (
                  <tr key={p.propertyId}>
                    <td style={{ ...td, position: "sticky", left: 0, background: INK, zIndex: 1, fontWeight: 600 }}>{p.name}</td>
                    {doc.weekStarts.map((w) => {
                      const cell = doc.cells.find((c) => c.propertyId === p.propertyId && c.weekStart === w);
                      const on = picked?.propertyId === p.propertyId && picked.weekStart === w;
                      return (
                        <td key={w} style={{ ...td, padding: 4 }}>
                          <button
                            type="button"
                            onClick={() => setPicked({ propertyId: p.propertyId, weekStart: w })}
                            style={{
                              minHeight: 44,
                              minWidth: 44,
                              width: "100%",
                              border: on ? `1px solid ${LIME}` : `1px solid ${HAIRLINE}`,
                              borderRadius: 10,
                              background: crunchFill(cell?.ratio ?? 0, cell?.crunch ?? false),
                              color: "#F4F7F2",
                              fontFamily: MONO,
                              fontVariantNumeric: "tabular-nums",
                              cursor: "pointer",
                            }}
                          >
                            {cell?.units ?? 0}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {picked && doc ? (
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontFamily: DISPLAY, fontSize: 16, margin: "0 0 8px" }}>
              {doc.properties.find((p) => p.propertyId === picked.propertyId)?.name} · week of {weekLabel(picked.weekStart)}
            </h2>
            {listed.length === 0 ? (
              <p style={{ color: MUTED }}>No units land in this week.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                <VirtualList
                  items={listed}
                  estimateSize={64}
                  gap={8}
                  maxHeight={560}
                  style={{ display: "grid", gap: 8 }}
                  getKey={(u) => u.turnId}
                  renderItem={(u) => (
                    <li style={{ padding: 12, border: `1px solid ${HAIRLINE}`, borderRadius: 12, listStyle: "none" }}>
                      <span style={{ fontWeight: 600 }}>Unit {u.unitNumber}</span>
                      <span style={{ color: MUTED, fontFamily: MONO, fontSize: 12, marginLeft: 8 }}>
                        {u.kind} · {u.confidence} · vacate {u.vacateCivil}
                        {u.predictedReadyCivil ? ` · ready ${u.predictedReadyCivil}` : ""}
                      </span>
                    </li>
                  )}
                />
              </ul>
            )}
          </section>
        ) : null}

        {doc ? (
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontFamily: DISPLAY, fontSize: 16, margin: "0 0 8px" }}>Capacity heatmap</h2>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: MUTED }}>
              Projected demand units / declared capacity. Above 1.0 is a crunch.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `120px repeat(${doc.weekStarts.length}, minmax(44px, 1fr))`,
                gap: 4,
                overflowX: "auto",
              }}
            >
              <div />
              {doc.weekStarts.map((w) => (
                <div key={w} style={{ ...th, textAlign: "center", borderBottom: "none" }}>
                  {weekLabel(w)}
                </div>
              ))}
              {TRADES.map((trade) => (
                <HeatRow key={trade} trade={trade} doc={doc} />
              ))}
            </div>
          </section>
        ) : null}

        {doc ? (
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontFamily: DISPLAY, fontSize: 16, margin: "0 0 8px" }}>Projected spend</h2>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: MUTED }}>{doc.method}</p>
            <div style={{ display: "grid", gap: 12 }}>
              {doc.spend.map((row) => (
                <div key={row.label} style={{ padding: 16, border: `1px solid ${HAIRLINE}`, borderRadius: 16 }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{row.label}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
                    {row.horizons.map((h) => (
                      <div key={h.days}>
                        <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED }}>
                          {h.days} days
                        </p>
                        <p style={{ margin: "6px 0 0", fontFamily: MONO, fontVariantNumeric: "tabular-nums", color: GOLD }}>
                          {formatUsdCents(h.lowCents)} – {formatUsdCents(h.highCents)}
                        </p>
                        <p style={{ margin: "4px 0 0", fontFamily: MONO, fontSize: 12, color: MUTED }}>
                          mid {formatUsdCents(h.midCents)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 16, margin: "0 0 8px" }}>Pre-staging</h2>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: MUTED }}>
            Known vacates inside the horizon. Hold crew capacity writes a soft reservation that expires if you do not confirm.
          </p>
          {prestaging.length === 0 ? (
            <p style={{ color: MUTED }}>No scheduled vacates in the next 13 weeks.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              <VirtualList
                items={prestaging}
                estimateSize={72}
                gap={8}
                maxHeight={560}
                style={{ display: "grid", gap: 8 }}
                getKey={(u) => u.turnId}
                renderItem={(u) => (
                  <li style={{ padding: 12, border: `1px solid ${HAIRLINE}`, borderRadius: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between", listStyle: "none" }}>
                  <span>
                    <span style={{ fontWeight: 600 }}>Unit {u.unitNumber}</span>
                    <span style={{ color: MUTED, fontSize: 12, marginLeft: 8, fontFamily: MONO }}>
                      vacate {u.vacateCivil}
                      {u.scopeId ? " · draft scope ready" : ""}
                      {u.holdStatus !== "none" ? ` · ${u.holdStatus}` : ""}
                      {u.holdStatus === "held" && u.holdExpiresAt && doc
                        ? ` · expires ${formatHoldExpiry(u.holdExpiresAt, doc.timezone)}`
                        : ""}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: 8 }}>
                    {u.holdStatus === "none" && props.onHold ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => run(`hold-${u.turnId}`, () => props.onHold!(u.turnId))}
                        style={primaryBtn}
                      >
                        Hold crew capacity
                      </button>
                    ) : null}
                    {u.holdStatus === "held" && u.holdBundleId && props.onConfirm ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => run(`ok-${u.holdBundleId}`, () => props.onConfirm!(u.holdBundleId!))}
                        style={primaryBtn}
                      >
                        Confirm hold
                      </button>
                    ) : null}
                  </span>
                </li>
                )}
              />
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function HeatRow(props: { trade: (typeof TRADES)[number]; doc: PipelineDocument }) {
  return (
    <>
      <div style={{ ...td, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED, fontFamily: DISPLAY }}>
        {props.trade}
      </div>
      {props.doc.weekStarts.map((w) => {
        const cell = props.doc.heatmap.find((h) => h.trade === props.trade && h.weekStart === w);
        return (
          <div
            key={w}
            style={{
              minHeight: 44,
              borderRadius: 8,
              background: crunchFill(cell?.ratio ?? 0, cell?.crunch ?? false),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: MONO,
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {(cell?.ratio ?? 0).toFixed(1)}
          </div>
        );
      })}
    </>
  );
}

const th: CSSProperties = {
  padding: "8px 6px",
  borderBottom: `1px solid ${HAIRLINE}`,
  fontFamily: DISPLAY,
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: MUTED,
  fontWeight: 600,
};

const td: CSSProperties = {
  padding: "8px 6px",
  borderBottom: `1px solid ${HAIRLINE}`,
  fontSize: 13,
};

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

const primaryBtn: CSSProperties = {
  ...ghostBtn,
  background: LIME,
  color: INK,
  borderColor: LIME,
};
