import { useState, type CSSProperties } from "react";
import type { TurnScopeDocument, VarianceRequestDocument } from "@workspace/api-client-react";
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

export type ScopeComplianceProps = {
  scope: TurnScopeDocument | undefined;
  loading?: boolean;
  onAddLine: (input: { description: string; code: string; qty: number; unitPriceCents: string }) => void | Promise<void>;
  onInvoice: () => void | Promise<void>;
  onVarianceRequest: (scopeLineId: string, reason: string) => void | Promise<void>;
  onVarianceDecide: (varianceId: string, decision: "approved" | "rejected") => void | Promise<void>;
  onExport: (format: "pdf" | "csv" | "json") => void;
  bidRequestId?: string | null;
  onCreateBidRequest?: () => void | Promise<void>;
  onOpenBidBoard?: () => void;
};

export function ScopeCompliance(props: ScopeComplianceProps) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("Marble counter upgrade");
  const [code, setCode] = useState("MARBLE-UP");
  const [price, setPrice] = useState("89000");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scope = props.scope;

  if (props.loading && !scope) return <p style={{ color: MUTED, fontSize: 13 }}>Loading scope…</p>;
  if (!scope) return <p style={{ color: MUTED, fontSize: 13 }}>No scope on this turn yet.</p>;

  const run = (key: string, fn: () => void | Promise<void>) => {
    setError(null);
    setBusy(key);
    void Promise.resolve(fn())
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : "That did not go through.";
        setError(message);
      })
      .finally(() => setBusy(null));
  };

  return (
    <div data-testid="scope-compliance">
      <button type="button" onClick={() => setOpen((v) => !v)} style={badgeBtn}>
        {scope.badge}
      </button>
      {open ? (
        <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
          {scope.lines.map((line) => (
            <li key={line.id} style={{ padding: "10px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{line.description}</span>
                <span style={{ fontFamily: MONO, fontSize: 12 }}>{formatUsdCents(line.extendedCents)}</span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: MUTED, fontFamily: MONO }}>
                {line.code ?? "no code"} {line.tier ? `· ${line.tier}` : ""} · {line.compliance.replace("_", " ")}
                {line.scheduleCode ? ` · schedule ${line.scheduleCode}` : ""}
              </p>
              {line.compliance === "off_schedule" || line.compliance === "variance_pending" ? (
                <div style={{ marginTop: 8 }}>
                  <input
                    aria-label={`Reason for ${line.description}`}
                    placeholder="Why this line is needed"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={input}
                  />
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => run(`var-${line.id}`, () => props.onVarianceRequest(line.id, reason))}
                    style={{ ...ghostBtn, marginTop: 8 }}
                  >
                    Request variance
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {scope.variances.filter((v) => v.status === "pending").map((v) => (
        <VarianceCard
          key={v.id}
          variance={v}
          busy={Boolean(busy)}
          onDecide={(d) => run(`dec-${v.id}`, () => props.onVarianceDecide(v.id, d))}
        />
      ))}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <input aria-label="Line description" value={desc} onChange={(e) => setDesc(e.target.value)} style={input} />
        <input aria-label="Price-list code" value={code} onChange={(e) => setCode(e.target.value)} style={input} />
        <input aria-label="Unit price in cents" value={price} onChange={(e) => setPrice(e.target.value)} style={input} />
        <button
          type="button"
          disabled={!scope.scopeId || Boolean(busy)}
          onClick={() =>
            run("add", () =>
              props.onAddLine({ description: desc, code, qty: 1, unitPriceCents: price.replace(/\D/g, "") || "0" }),
            )
          }
          style={ghostBtn}
        >
          Add line not on the schedule
        </button>
        <button
          type="button"
          disabled={!scope.scopeId || Boolean(busy)}
          onClick={() => run("inv", () => props.onInvoice())}
          style={primaryBtn}
        >
          {busy === "inv" ? "Checking…" : "Create invoice"}
        </button>
        {props.onCreateBidRequest && !scope.bidRequestId ? (
          <button
            type="button"
            disabled={!scope.scopeId || Boolean(busy)}
            onClick={() => run("bid", () => props.onCreateBidRequest?.())}
            style={ghostBtn}
          >
            Put out to bid
          </button>
        ) : null}
        {props.onOpenBidBoard && scope.bidRequestId ? (
          <button type="button" onClick={() => props.onOpenBidBoard?.()} style={ghostBtn}>
            Compare bids
          </button>
        ) : null}
        {scope.invoice ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["pdf", "csv", "json"] as const).map((fmt) => (
              <button key={fmt} type="button" onClick={() => props.onExport(fmt)} style={ghostBtn}>
                Export {fmt.toUpperCase()}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" style={{ color: CORAL, fontSize: 13, marginTop: 12 }}>
          {error}
        </p>
      ) : null}
      {scope.blockingMessage && !error ? (
        <p style={{ color: GOLD, fontSize: 13, marginTop: 12 }}>{scope.blockingMessage}</p>
      ) : null}
    </div>
  );
}

function VarianceCard(props: {
  variance: VarianceRequestDocument;
  busy: boolean;
  onDecide: (d: "approved" | "rejected") => void;
}) {
  const v = props.variance;
  return (
    <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: `1px solid ${GOLD}` }}>
      <p style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 600 }}>Variance request</p>
      <p style={{ margin: "6px 0 0", fontSize: 13 }}>{v.reason}</p>
      <p style={{ margin: "6px 0 0", fontSize: 12, color: MUTED }}>
        Requested {formatUsdCents(v.requestedUnitPriceCents)}
        {v.scheduleUnitPriceCents ? ` vs schedule ${formatUsdCents(v.scheduleUnitPriceCents)}` : ""}
        {v.nearestScheduleDescription ? ` · nearest ${v.nearestScheduleDescription}` : ""}
      </p>
      {v.photoUrls?.length ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {v.photoUrls.map((src) => (
            <img key={src} src={src} alt="Attached evidence" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8 }} />
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" disabled={props.busy} onClick={() => props.onDecide("approved")} style={primaryBtn}>
          Approve
        </button>
        <button type="button" disabled={props.busy} onClick={() => props.onDecide("rejected")} style={ghostBtn}>
          Reject
        </button>
      </div>
    </div>
  );
}

const input: CSSProperties = {
  minHeight: 44,
  borderRadius: 10,
  border: `1px solid ${HAIRLINE}`,
  background: "rgba(255,255,255,0.04)",
  color: "#F4F7F2",
  padding: "0 12px",
  fontFamily: BODY,
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

const primaryBtn: CSSProperties = { ...ghostBtn, background: LIME, color: INK, borderColor: LIME, width: "100%" };

const badgeBtn: CSSProperties = {
  ...ghostBtn,
  width: "100%",
  textAlign: "left",
  borderColor: GOLD,
  color: GOLD,
  whiteSpace: "normal",
  lineHeight: 1.4,
  padding: "10px 14px",
  minHeight: 44,
};
