import { useEffect, useId, useState, type CSSProperties } from "react";
import type { BidComparisonDocument } from "@workspace/api-client-react";
import { formatUsdCents } from "../pulse/formatUsdCents";

const INK = "#07101E";
const LIME = "#B4FF44";
const GOLD = "#E8C36A";
const CORAL = "#F07167";
const HAIRLINE = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.58)";
const DISPLAY = '"Outfit", "Plus Jakarta Sans", sans-serif';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export type BidSubmitLine = {
  code: string;
  tier?: string | null;
  unitPriceCents: string;
};

export type BidSubmitInput = {
  vendorOrgId: string;
  earliestStartAt: string | null;
  promisedDays: number | null;
  lines: BidSubmitLine[];
};

export type BidBoardProps = {
  doc: BidComparisonDocument | undefined;
  loading?: boolean;
  errorMessage?: string;
  onAward?: (vendorOrgId: string) => void | Promise<void>;
  onInvite?: (vendorOrgIds: string[]) => void | Promise<void>;
  onSubmitBid?: (input: BidSubmitInput) => void | Promise<void>;
  homeHref?: { label: string; onClick: () => void };
};

function deltaChip(delta: string | null | undefined): { label: string; color: string } {
  if (delta == null) return { label: "—", color: MUTED };
  const n = BigInt(delta);
  if (n === 0n) return { label: "at schedule", color: LIME };
  const abs = n < 0n ? -n : n;
  const sign = n < 0n ? "−" : "+";
  return {
    label: `${sign}${formatUsdCents(abs.toString())}`,
    color: n < 0n ? LIME : CORAL,
  };
}

function contribution(
  component: number,
  weight: number,
  weights: BidComparisonDocument["weights"],
): number {
  const sum = weights.priceVsSchedule + weights.onTime + weights.rework + weights.capacity;
  if (sum <= 0) return 0;
  return Math.round((component * weight) / sum);
}

function civilDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function civilStamp(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

function civilYmd(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function addCivilDaysYmd(civilYmd: string, days: number): string {
  const [y, m, d] = civilYmd.split("-").map(Number);
  const utc = Date.UTC(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + days);
  const shifted = new Date(utc);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/** Midnight of a YYYY-MM-DD civil day in `timeZone`, as an ISO instant for the API. */
function zonedMidnightIso(civilYmd: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilYmd);
  if (!match) return new Date().toISOString();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetAt = (at: Date) => {
    const bag: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at)) {
      if (part.type !== "literal") bag[part.type] = part.value;
    }
    const asUtc = Date.UTC(
      Number(bag.year),
      Number(bag.month) - 1,
      Number(bag.day),
      Number(bag.hour),
      Number(bag.minute),
      Number(bag.second),
    );
    return asUtc - at.getTime();
  };
  let instant = new Date(utcGuess);
  instant = new Date(utcGuess - offsetAt(instant));
  instant = new Date(utcGuess - offsetAt(instant));
  return instant.toISOString();
}

function centsToDollarInput(cents: string): string {
  let value: bigint;
  try {
    value = BigInt(cents);
  } catch {
    return "0.00";
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

function dollarInputToCents(raw: string): string {
  const trimmed = raw.trim().replace(/[$,]/g, "");
  if (!trimmed) return "0";
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw, fracRaw = ""] = body.split(".");
  const whole = (wholeRaw.replace(/\D/g, "") || "0").replace(/^0+(?=\d)/, "");
  const frac = (fracRaw.replace(/\D/g, "") + "00").slice(0, 2);
  return `${negative ? "-" : ""}${whole}${frac}`;
}

function lineKey(code: string, tier: string | null | undefined): string {
  return `${code}::${tier ?? ""}`;
}

export function BidBoard(props: BidBoardProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [openScore, setOpenScore] = useState<string | null>(null);
  const [draftVendorId, setDraftVendorId] = useState<string | null>(null);
  const [dollarByLine, setDollarByLine] = useState<Record<string, string>>({});
  const [startCivil, setStartCivil] = useState("");
  const [promised, setPromised] = useState("7");
  const doc = props.doc;
  const vendors = doc?.vendors ?? [];
  const eligible = doc?.eligibleVendors ?? [];
  const open = doc?.status === "open";
  const zone = doc?.timezone || "UTC";
  const submittedCount = vendors.filter((v) => v.submitted).length;

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

  const togglePick = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openDraft = (vendorOrgId: string) => {
    if (!doc) return;
    const next: Record<string, string> = {};
    for (const line of doc.lines) {
      next[lineKey(line.code, line.tier)] = centsToDollarInput(line.scheduleUnitPriceCents);
    }
    setDollarByLine(next);
    setStartCivil(addCivilDaysYmd(civilYmd(new Date().toISOString(), zone), 1));
    setPromised("7");
    setDraftVendorId(vendorOrgId);
  };

  const draftVendor = vendors.find((v) => v.vendorOrgId === draftVendorId);

  return (
    <div style={{ minHeight: "100dvh", background: INK, color: "#F4F7F2", fontFamily: BODY }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
      />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 20px 80px" }}>
        {props.homeHref ? (
          <button type="button" onClick={props.homeHref.onClick} style={ghostBtn}>
            {props.homeHref.label}
          </button>
        ) : null}
        <p style={{ margin: "16px 0 0", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MUTED, fontFamily: DISPLAY, fontWeight: 600 }}>
          Bid board
        </p>
        <h1 style={{ margin: "4px 0 8px", fontFamily: DISPLAY, fontSize: 22, fontWeight: 700 }}>
          {doc?.title ?? "Vendor-neutral comparison"}
        </h1>
        <p style={{ margin: "0 0 8px", color: MUTED, fontSize: 13, maxWidth: 720 }}>
          Every line is a price-item code from this property’s schedule. Invite competitors — a single-vendor board is not a product.
        </p>
        {doc ? (
          <p style={{ margin: "0 0 20px", fontSize: 12, color: MUTED, fontFamily: MONO }}>
            Weights (open): price {doc.weights.priceVsSchedule}% · on-time {doc.weights.onTime}% · rework {doc.weights.rework}% ·
            capacity {doc.weights.capacity}% · schedule {formatUsdCents(doc.scheduleTotalCents)} · due {civilStamp(doc.dueAt, zone)}
          </p>
        ) : null}

        {props.loading && !doc ? <p style={{ color: MUTED }}>Loading…</p> : null}
        {props.errorMessage || localError ? (
          <p role="alert" style={{ color: CORAL }}>
            {props.errorMessage ?? localError}
          </p>
        ) : null}

        {vendors.length === 1 || (open && submittedCount === 1) ? (
          <p role="status" style={{ color: CORAL, fontSize: 13, marginBottom: 16 }}>
            Only one vendor has a bid in. Add a competitor before you award — a single-vendor board is not a product.
          </p>
        ) : null}

        {open && props.onInvite && eligible.length > 0 ? (
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: "0 0 10px", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, fontFamily: DISPLAY, fontWeight: 600 }}>
              Invite competitors
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {eligible.map((v) => {
                const on = picked.includes(v.vendorOrgId);
                return (
                  <button
                    key={v.vendorOrgId}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePick(v.vendorOrgId)}
                    style={{
                      ...ghostBtn,
                      borderColor: on ? LIME : HAIRLINE,
                      background: on ? "rgba(180,255,68,0.12)" : "transparent",
                      color: on ? LIME : "#F4F7F2",
                    }}
                  >
                    {v.vendorName}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={Boolean(busy) || picked.length === 0}
              onClick={() =>
                run("invite", async () => {
                  await props.onInvite!(picked);
                  setPicked([]);
                })
              }
              style={primaryBtn}
            >
              {picked.length <= 1 ? "Invite selected" : `Invite ${picked.length} vendors`}
            </button>
          </div>
        ) : null}

        {!doc || vendors.length === 0 ? (
          <p style={{ color: MUTED }}>Invite at least two vendors so every line can be compared.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: INK, zIndex: 1 }}>
                    Line
                  </th>
                  {vendors.map((v) => (
                    <th key={v.vendorOrgId} style={th}>
                      {v.vendorName}
                      {v.awarded ? <span style={{ color: LIME, display: "block", fontSize: 11 }}>Awarded</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((line) => (
                  <tr key={`${line.code}::${line.tier ?? ""}`}>
                    <td style={{ ...td, position: "sticky", left: 0, background: INK, zIndex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{line.description}</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>
                        {line.code}
                        {line.tier ? ` · ${line.tier}` : ""} · qty {line.qty} · sched{" "}
                        {formatUsdCents(line.scheduleUnitPriceCents)}
                      </div>
                    </td>
                    {line.cells.map((cell) => {
                      const chip = deltaChip(cell.deltaCents);
                      return (
                        <td key={cell.vendorOrgId} style={{ ...td, textAlign: "right" }}>
                          <div style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                            {cell.unitPriceCents ? formatUsdCents(cell.unitPriceCents) : "—"}
                          </div>
                          <div style={{ fontSize: 11, color: chip.color, fontFamily: MONO }}>{chip.label}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...td, position: "sticky", left: 0, background: INK, fontWeight: 700 }}>Total</td>
                  {vendors.map((v) => (
                    <td key={v.vendorOrgId} style={{ ...td, textAlign: "right", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                      {v.submitted ? formatUsdCents(v.totalCents) : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={{ ...td, position: "sticky", left: 0, background: INK }}>Earliest start</td>
                  {vendors.map((v) => (
                    <td key={v.vendorOrgId} style={{ ...td, textAlign: "right", fontSize: 12, color: MUTED }}>
                      {v.earliestStartAt ? civilDate(v.earliestStartAt, zone) : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={{ ...td, position: "sticky", left: 0, background: INK }}>Promised days</td>
                  {vendors.map((v) => (
                    <td key={v.vendorOrgId} style={{ ...td, textAlign: "right", fontFamily: MONO }}>
                      {v.promisedDays ?? "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={{ ...td, position: "sticky", left: 0, background: INK }}>Score</td>
                  {vendors.map((v) => (
                    <td key={v.vendorOrgId} style={{ ...td, textAlign: "right", position: "relative" }}>
                      {v.submitted ? (
                        <ScoreHover
                          vendor={v}
                          weights={doc.weights}
                          open={openScore === v.vendorOrgId}
                          onOpen={() => setOpenScore(v.vendorOrgId)}
                          onClose={() => setOpenScore((cur) => (cur === v.vendorOrgId ? null : cur))}
                        />
                      ) : (
                        <span style={{ color: MUTED }}>—</span>
                      )}
                    </td>
                  ))}
                </tr>
                {open && (props.onAward || props.onSubmitBid) ? (
                  <tr>
                    <td style={{ ...td, position: "sticky", left: 0, background: INK }} />
                    {vendors.map((v) => (
                      <td key={v.vendorOrgId} style={{ ...td, textAlign: "right" }}>
                        {v.submitted ? (
                          props.onAward ? (
                            <button
                              type="button"
                              disabled={Boolean(busy) || submittedCount < 2}
                              onClick={() => run(`award-${v.vendorOrgId}`, () => props.onAward!(v.vendorOrgId))}
                              style={primaryBtn}
                            >
                              Award
                            </button>
                          ) : (
                            <span style={{ color: LIME, fontSize: 12 }}>In</span>
                          )
                        ) : props.onSubmitBid ? (
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => openDraft(v.vendorOrgId)}
                            style={ghostBtn}
                          >
                            Enter bid
                          </button>
                        ) : (
                          <span style={{ color: MUTED, fontSize: 12 }}>Waiting</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tfoot>
            </table>
          </div>
        )}

        {open && draftVendor && props.onSubmitBid && doc ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const days = Number.parseInt(promised, 10);
              run("submit", async () => {
                await props.onSubmitBid!({
                  vendorOrgId: draftVendor.vendorOrgId,
                  earliestStartAt: startCivil ? zonedMidnightIso(startCivil, zone) : null,
                  promisedDays: Number.isFinite(days) && days > 0 ? days : null,
                  lines: doc.lines.map((line) => ({
                    code: line.code,
                    tier: line.tier,
                    unitPriceCents: dollarInputToCents(dollarByLine[lineKey(line.code, line.tier)] ?? "0"),
                  })),
                });
                setDraftVendorId(null);
              });
            }}
            style={{
              marginTop: 28,
              padding: 20,
              borderRadius: 16,
              border: `1px solid ${HAIRLINE}`,
              background: "#0C1829",
            }}
          >
            <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MUTED, fontFamily: DISPLAY, fontWeight: 600 }}>
              Submit bid
            </p>
            <h2 style={{ margin: "0 0 16px", fontFamily: DISPLAY, fontSize: 18, fontWeight: 700 }}>
              {draftVendor.vendorName}
            </h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: MUTED }}>
              Prices start at the property schedule. Change a line, then send. Qty is locked.
            </p>
            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              {doc.lines.map((line) => {
                const key = lineKey(line.code, line.tier);
                return (
                  <label key={key} style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 12, alignItems: "center" }}>
                    <span>
                      <span style={{ display: "block", fontWeight: 600, fontSize: 13 }}>{line.description}</span>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>
                        {line.code}
                        {line.tier ? ` · ${line.tier}` : ""} · schedule {formatUsdCents(line.scheduleUnitPriceCents)}
                      </span>
                    </span>
                    <input
                      aria-label={`${line.description} unit price`}
                      inputMode="decimal"
                      value={dollarByLine[key] ?? ""}
                      onChange={(e) => setDollarByLine((prev) => ({ ...prev, [key]: e.target.value }))}
                      style={{ ...input, textAlign: "right", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}
                    />
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: MUTED }}>
                Earliest start ({zone})
                <input
                  type="date"
                  value={startCivil}
                  onChange={(e) => setStartCivil(e.target.value)}
                  style={input}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: MUTED }}>
                Promised days
                <input
                  inputMode="numeric"
                  value={promised}
                  onChange={(e) => setPromised(e.target.value)}
                  style={{ ...input, width: 120, fontFamily: MONO }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" disabled={Boolean(busy)} style={primaryBtn}>
                {busy === "submit" ? "Sending…" : "Submit bid"}
              </button>
              <button type="button" onClick={() => setDraftVendorId(null)} style={ghostBtn}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function ScoreHover(props: {
  vendor: BidComparisonDocument["vendors"][number];
  weights: BidComparisonDocument["weights"];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const panelId = useId();
  const v = props.vendor;
  const w = props.weights;
  const rows = [
    { label: "Price vs schedule", component: v.components.priceVsSchedule, weight: w.priceVsSchedule },
    { label: "On-time (90d)", component: v.components.onTime, weight: w.onTime },
    { label: "Rework inverted", component: v.components.rework, weight: w.rework },
    { label: "Capacity", component: v.components.capacity, weight: w.capacity },
  ];

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  return (
    <div
      style={{ display: "inline-block", position: "relative" }}
      onMouseEnter={props.onOpen}
      onMouseLeave={props.onClose}
    >
      <button
        type="button"
        aria-expanded={props.open}
        aria-controls={panelId}
        onClick={() => (props.open ? props.onClose() : props.onOpen())}
        onFocus={props.onOpen}
        style={{
          minHeight: 44,
          minWidth: 44,
          padding: "0 8px",
          border: "none",
          background: "transparent",
          color: GOLD,
          fontFamily: MONO,
          fontSize: 18,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
        }}
      >
        {v.score}
      </button>
      {props.open ? (
        <div
          id={panelId}
          role="tooltip"
          style={{
            position: "absolute",
            right: 0,
            bottom: "100%",
            marginBottom: 8,
            width: 280,
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${HAIRLINE}`,
            background: "#0C1829",
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
            textAlign: "left",
            zIndex: 4,
            color: "#F4F7F2",
          }}
        >
          <p style={{ margin: "0 0 8px", fontFamily: DISPLAY, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED }}>
            Score makeup · {v.vendorName}
          </p>
          {rows.map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: MUTED }}>
                {row.label} · {row.weight}%
              </span>
              <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                {row.component} → {contribution(row.component, row.weight, w)}
              </span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${HAIRLINE}`, fontWeight: 700 }}>
            <span>Composite</span>
            <span style={{ fontFamily: MONO, color: GOLD }}>{v.score}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const th: CSSProperties = {
  padding: "10px 12px",
  borderBottom: `1px solid ${HAIRLINE}`,
  fontFamily: DISPLAY,
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: MUTED,
  fontWeight: 600,
};

const td: CSSProperties = {
  padding: "12px",
  borderBottom: `1px solid ${HAIRLINE}`,
  verticalAlign: "top",
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

const input: CSSProperties = {
  minHeight: 44,
  padding: "0 12px",
  borderRadius: 10,
  border: `1px solid ${HAIRLINE}`,
  background: INK,
  color: "#F4F7F2",
  fontFamily: BODY,
  fontSize: 14,
};
