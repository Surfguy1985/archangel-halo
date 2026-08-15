import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  PropertyTurnBoardDocument,
  TurnBoardGroupBy,
  TurnDetailDocument,
  TurnActionDocument,
  TurnRingArcDocument,
  TurnEvidenceDocument,
  TurnVerifyDocument,
  TurnScopeDocument,
  WorkSourceFilter,
} from "@workspace/api-client-react";
import { useBoardEvents } from "../../hooks/useBoardEvents";
import { TurnRing, confidenceGlyph } from "./TurnRing";
import { actorLabel, formatStageClock, ownerLabel } from "./clock";
import { EvidenceLedger, type EvidenceRecordVariant } from "./EvidenceLedger";
import { ScopeCompliance, type ScopeComplianceProps } from "./ScopeCompliance";

const INK = "#07101E";
const LIME = "#B4FF44";
const GOLD = "#E8C36A";
const CORAL = "#F07167";
const HAIRLINE = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.58)";
const DISPLAY = '"Outfit", "Plus Jakarta Sans", sans-serif';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const SOURCES: Array<{ id: WorkSourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "in_house", label: "In-house" },
  { id: "third_party", label: "Third-party" },
];

const GROUPS: Array<{ id: TurnBoardGroupBy; label: string }> = [
  { id: "stage", label: "By stage" },
  { id: "work_source", label: "By source" },
  { id: "vendor", label: "By vendor" },
];

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
  }).format(new Date(iso));
}

const STAGE_LABEL: Record<string, string> = {
  notice: "Notice",
  vacated: "Vacated",
  walk: "Walk",
  scoped: "Scoped",
  pending_approval: "Waiting on you",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  qc: "QC",
  rework: "Rework",
  ready: "Ready",
};

export type TurnBoardProps = {
  board: PropertyTurnBoardDocument | undefined;
  detail: TurnDetailDocument | undefined;
  streamUrl: string | null;
  onRefetch: () => void;
  onGroupBy: (groupBy: TurnBoardGroupBy) => void;
  workSource?: WorkSourceFilter;
  onWorkSourceChange?: (next: WorkSourceFilter) => void;
  onOpenTurn: (turnId: string) => void;
  onCloseDetail: () => void;
  onAction: (action: TurnActionDocument["id"]) => void | Promise<void>;
  evidence?: TurnEvidenceDocument;
  verify?: TurnVerifyDocument;
  onDownloadRecord?: (variant: EvidenceRecordVariant) => void | Promise<void>;
  onVerify?: () => void | Promise<void>;
  evidenceLoading?: boolean;
  scope?: TurnScopeDocument;
  scopeLoading?: boolean;
  onAddScopeLine?: ScopeComplianceProps["onAddLine"];
  onCreateInvoice?: ScopeComplianceProps["onInvoice"];
  onVarianceRequest?: ScopeComplianceProps["onVarianceRequest"];
  onVarianceDecide?: ScopeComplianceProps["onVarianceDecide"];
  onExportInvoice?: ScopeComplianceProps["onExport"];
  onCreateBidRequest?: ScopeComplianceProps["onCreateBidRequest"];
  onOpenBidBoard?: ScopeComplianceProps["onOpenBidBoard"];
  isLoading?: boolean;
  errorMessage?: string;
  homeHref?: { label: string; onClick: () => void };
};

export function TurnBoard(props: TurnBoardProps) {
  const live = useBoardEvents(props.streamUrl, props.onRefetch, "turn");
  const board = props.board;
  const zone = board?.timezone ?? "UTC";
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [focusArc, setFocusArc] = useState<string | null>(null);

  const cardsByLane = useMemo(() => {
    const map = new Map<string, NonNullable<typeof board>["cards"]>();
    for (const card of board?.cards ?? []) {
      const list = map.get(card.laneKey) ?? [];
      list.push(card);
      map.set(card.laneKey, list);
    }
    return map;
  }, [board]);

  useEffect(() => {
    setActionError(null);
    setFocusArc(null);
  }, [props.detail?.turnId]);

  useEffect(() => {
    if (!props.detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) props.onCloseDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.detail, props.onCloseDetail]);

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
      <div style={{ padding: "20px 20px 0" }}>
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          {props.homeHref ? (
            <button type="button" onClick={props.homeHref.onClick} style={ghostBtn}>
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
              Turn Ring
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
              {board?.propertyName ?? "Property"}
            </h1>
          </div>
          <div role="tablist" aria-label="Group cards" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {GROUPS.map((g) => {
              const active = (board?.groupBy ?? "stage") === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => props.onGroupBy(g.id)}
                  style={{
                    ...chipBtn,
                    background: active ? LIME : "transparent",
                    color: active ? INK : "#F4F7F2",
                    borderColor: active ? LIME : HAIRLINE,
                  }}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
          {props.onWorkSourceChange ? (
            <div role="tablist" aria-label="Work source" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {SOURCES.map((s) => {
                const active = (props.workSource ?? "all") === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => props.onWorkSourceChange?.(s.id)}
                    style={{
                      ...chipBtn,
                      background: active ? LIME : "transparent",
                      color: active ? INK : "#F4F7F2",
                      borderColor: active ? LIME : HAIRLINE,
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <span style={livePill} aria-live="polite">
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
        {props.errorMessage ? <p style={{ color: CORAL, fontSize: 14 }}>{props.errorMessage}</p> : null}
        {props.isLoading && !board ? <p style={{ color: MUTED }}>Loading turns…</p> : null}
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          padding: "0 20px 32px",
          alignItems: "flex-start",
        }}
      >
        {(board?.lanes ?? []).map((lane) => {
          const cards = cardsByLane.get(lane.key) ?? [];
          return (
            <section
              key={lane.key}
              aria-label={lane.label}
              style={{
                minWidth: 220,
                width: 220,
                flexShrink: 0,
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 16,
                padding: 10,
              }}
            >
              <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, minHeight: 32 }}>
                {lane.owner ? (
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: lane.owner === "client" ? "transparent" : GOLD,
                      border: `1.5px solid ${GOLD}`,
                    }}
                  />
                ) : null}
                <span style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 600 }}>{lane.label}</span>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 11, color: MUTED }}>
                  {cards.length}
                </span>
              </header>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cards.map((card) => (
                  <button
                    key={card.turnId}
                    type="button"
                    draggable={false}
                    onClick={() => props.onOpenTurn(card.turnId)}
                    style={cardBtn}
                  >
                    <TurnRing
                      ring={card.ring}
                      size={44}
                      center="unit"
                      unitNumber={card.unitNumber}
                      interactive={false}
                    />
                    <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 22,
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          letterSpacing: "-0.04em",
                          lineHeight: 1,
                        }}
                      >
                        {card.daysVacant}
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                        days vacant · {card.bedrooms} bd
                      </p>
                      <span style={sourceChip}>
                        {card.workSource === "in_house" ? "In-house" : card.vendorName ?? "Vendor"}
                      </span>
                      {card.ring.predictedReadyAt ? (
                        <p style={{ margin: "6px 0 0", fontSize: 11, color: MUTED }}>
                          Ready {civilDate(card.ring.predictedReadyAt, zone)}{" "}
                          {confidenceGlyph(card.ring.confidence)}
                        </p>
                      ) : null}
                      {card.isStalled ? (
                        <p style={{ margin: "4px 0 0", fontSize: 11, color: CORAL, fontWeight: 600 }}>Stalled</p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {props.detail ? (
        <>
          <button
            type="button"
            aria-label="Close unit detail"
            onClick={props.onCloseDetail}
            style={{
              position: "fixed",
              inset: 0,
              border: 0,
              padding: 0,
              background: "rgba(7,16,30,0.62)",
              zIndex: 19,
              cursor: "pointer",
            }}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Unit ${props.detail.unitNumber}`}
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              width: "min(560px, 100vw)",
              height: "100dvh",
              background: "#0A1220",
              borderLeft: `1px solid ${HAIRLINE}`,
              overflowY: "auto",
              padding: 24,
              zIndex: 20,
            }}
          >
            <button type="button" onClick={props.onCloseDetail} style={{ ...ghostBtn, marginBottom: 16 }}>
              Close
            </button>
            <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MUTED }}>
              Unit {props.detail.unitNumber}
            </p>
            <h2 style={{ margin: "4px 0 20px", fontFamily: DISPLAY, fontSize: 24, fontWeight: 700 }}>
              {props.detail.propertyName}
            </h2>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
              <TurnRing
                ring={props.detail.ring}
                size={280}
                center="daysVacant"
                interactive
                onArcSelect={(arc) => setFocusArc(arcKey(arc))}
              />
            </div>
            {props.detail.ring.predictedReadyAt ? (
              <p style={{ textAlign: "center", color: MUTED, fontSize: 13, marginTop: 20, marginBottom: 24 }}>
                Ready {civilDate(props.detail.ring.predictedReadyAt, zone)}{" "}
                {confidenceGlyph(props.detail.ring.confidence)}
              </p>
            ) : null}

            <h3 style={sectionH}>Stage clock</h3>
            <StageBand
              detail={props.detail}
              zone={zone}
              focusKey={focusArc}
              onFocus={setFocusArc}
            />

            <h3 style={sectionH}>Evidence</h3>
            {props.onDownloadRecord ? (
              <EvidenceLedger
                evidence={props.evidence}
                verify={props.verify}
                loading={props.evidenceLoading}
                onDownloadRecord={props.onDownloadRecord}
                onVerify={props.onVerify}
              />
            ) : (
              <p style={{ color: MUTED, fontSize: 13 }}>{props.detail.evidencePlaceholder}</p>
            )}
            <h3 style={sectionH}>Scope and pricing</h3>
            {props.onCreateInvoice && props.onAddScopeLine && props.onVarianceRequest && props.onVarianceDecide && props.onExportInvoice ? (
              <ScopeCompliance
                scope={props.scope}
                loading={props.scopeLoading}
                onAddLine={props.onAddScopeLine}
                onInvoice={props.onCreateInvoice}
                onVarianceRequest={props.onVarianceRequest}
                onVarianceDecide={props.onVarianceDecide}
                onExport={props.onExportInvoice}
                bidRequestId={props.scope?.bidRequestId}
                onCreateBidRequest={props.onCreateBidRequest}
                onOpenBidBoard={props.onOpenBidBoard}
              />
            ) : (
              <p style={{ color: MUTED, fontSize: 13 }}>{props.detail.scopePlaceholder}</p>
            )}

            <h3 style={sectionH}>Activity</h3>
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {props.detail.activity.map((item) => (
                <li key={item.id} style={{ padding: "8px 0", borderBottom: `1px solid ${HAIRLINE}`, fontSize: 13 }}>
                  <span style={{ color: MUTED, fontFamily: MONO, fontSize: 11 }}>
                    {civilStamp(item.at, zone)}
                  </span>
                  <div>{item.summary}</div>
                </li>
              ))}
            </ol>

            {actionError ? (
              <p role="alert" style={{ color: CORAL, fontSize: 13, marginTop: 24 }}>
                {actionError}
              </p>
            ) : null}

            {props.detail.actions.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 24 }}>
                {props.detail.actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={actionPending}
                    onClick={() => {
                      setActionError(null);
                      setActionPending(true);
                      void Promise.resolve(props.onAction(action.id))
                        .catch((err: unknown) => {
                          const message =
                            err instanceof Error && err.message
                              ? err.message.replace(/^HTTP \d+ [^:]+:\s*/, "")
                              : "That action did not go through.";
                          setActionError(message);
                        })
                        .finally(() => setActionPending(false));
                    }}
                    style={{
                      ...chipBtn,
                      background: LIME,
                      color: INK,
                      borderColor: LIME,
                      width: "100%",
                      opacity: actionPending ? 0.7 : 1,
                    }}
                  >
                    {actionPending ? "Working…" : action.label}
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ color: MUTED, fontSize: 13, marginTop: 24 }}>No client action on this stage.</p>
            )}
          </aside>
        </>
      ) : null}
    </div>
  );
}

function arcKey(arc: Pick<TurnRingArcDocument, "stage" | "visitIndex" | "predicted">): string {
  return `${arc.stage}:${arc.visitIndex}:${arc.predicted ? "p" : "e"}`;
}

function StageBand(props: {
  detail: TurnDetailDocument;
  zone: string;
  focusKey: string | null;
  onFocus: (key: string) => void;
}) {
  const total = Math.max(1, props.detail.bandDurationMs + props.detail.ring.remainingPredictedMs);
  const segments = [
    ...props.detail.band.map((row) => ({
      key: `${row.stage}:${row.visitIndex}:e`,
      width: row.durationMs / total,
      owner: row.owner,
      predicted: false,
      rework: row.visitIndex > 0,
      label: STAGE_LABEL[row.stage] ?? row.stage,
    })),
    ...(props.detail.ring.remainingPredictedMs > 0
      ? [
          {
            key: "ready:0:p",
            width: props.detail.ring.remainingPredictedMs / total,
            owner: "shared" as const,
            predicted: true,
            rework: false,
            label: "Predicted",
          },
        ]
      : []),
  ];

  return (
    <div>
      <div
        role="img"
        aria-label="Stage timeline"
        style={{
          display: "flex",
          height: 16,
          borderRadius: 999,
          overflow: "hidden",
          background: "rgba(255,255,255,0.06)",
          marginBottom: 16,
        }}
      >
        {segments.map((seg) => (
          <button
            key={seg.key}
            type="button"
            title={seg.label}
            onClick={() => props.onFocus(seg.key)}
            style={{
              flex: `${Math.max(seg.width, 0.012)} 1 0`,
              minWidth: 4,
              height: "100%",
              border: 0,
              padding: 0,
              cursor: "pointer",
              background: seg.predicted
                ? `repeating-linear-gradient(90deg, ${MUTED}, ${MUTED} 4px, transparent 4px, transparent 8px)`
                : seg.owner === "client"
                  ? `repeating-linear-gradient(35deg, ${GOLD}, ${GOLD} 1px, transparent 1px, transparent 4px)`
                  : GOLD,
              boxShadow: props.focusKey === seg.key ? `inset 0 0 0 2px ${LIME}` : undefined,
              opacity: seg.rework ? 1 : 0.92,
            }}
          />
        ))}
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {props.detail.band.map((row, i) => {
          const key = `${row.stage}:${row.visitIndex}:e`;
          const focused = props.focusKey === key;
          return (
            <li
              key={`${row.stage}-${row.visitIndex}-${i}`}
              style={{
                padding: "12px 8px",
                borderBottom: `1px solid ${HAIRLINE}`,
                background: row.owner === "client" ? "rgba(232,195,106,0.08)" : focused ? "rgba(180,255,68,0.06)" : "transparent",
                boxShadow: focused ? `inset 3px 0 0 ${LIME}` : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontWeight: 600 }}>
                  {STAGE_LABEL[row.stage] ?? row.stage}
                  {row.visitIndex > 0 ? " · rework" : ""}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 12 }}>{row.durationLabel}</span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: MUTED }}>
                {civilStamp(row.enteredAt, props.zone)}
                {" → "}
                {row.exitedAt ? civilStamp(row.exitedAt, props.zone) : "now"}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                {ownerLabel(row.owner)} · acted by {actorLabel(row.actorId)}
              </p>
              {row.clientOwnedLabel ? (
                <p style={{ margin: "6px 0 0", fontSize: 13, color: GOLD, fontWeight: 600 }}>
                  {row.clientOwnedLabel}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p style={{ margin: "12px 0 0", fontSize: 11, color: MUTED, fontFamily: MONO }}>
        Clock {formatStageClock(props.detail.bandDurationMs)} · {props.detail.daysVacant} days vacant
      </p>
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

const ghostBtn: CSSProperties = { ...chipBtn };

const livePill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minHeight: 44,
  padding: "0 12px",
  border: `1px solid ${HAIRLINE}`,
  background: "transparent",
  borderRadius: 999,
  fontSize: 12,
  color: MUTED,
};

const sourceChip: CSSProperties = {
  display: "inline-block",
  marginTop: 6,
  padding: "2px 8px",
  borderRadius: 999,
  border: `1px solid ${GOLD}`,
  color: GOLD,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const cardBtn: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  width: "100%",
  padding: 10,
  borderRadius: 12,
  border: `1px solid ${HAIRLINE}`,
  background: "rgba(7,16,30,0.6)",
  color: "#F4F7F2",
  cursor: "pointer",
  textAlign: "left",
};

const sectionH: CSSProperties = {
  fontFamily: DISPLAY,
  fontSize: 13,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: MUTED,
  margin: "28px 0 8px",
};
