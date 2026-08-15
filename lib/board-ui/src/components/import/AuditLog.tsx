import type { CSSProperties } from "react";
import type { PortfolioAuditDocument } from "@workspace/api-client-react";
import { VirtualList } from "../virtual/VirtualList";

const INK = "#07101E";
const LIME = "#B4FF44";
const HAIRLINE = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.58)";
const DISPLAY = '"Outfit", "Plus Jakarta Sans", sans-serif';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export type AuditLogProps = {
  doc: PortfolioAuditDocument | undefined;
  loading?: boolean;
  errorMessage?: string;
  entityType: string;
  actorId: string;
  from: string;
  to: string;
  onEntityType: (next: string) => void;
  onActorId: (next: string) => void;
  onFrom: (next: string) => void;
  onTo: (next: string) => void;
  onExport: () => void;
  homeHref?: { label: string; onClick: () => void };
};

export function AuditLog(props: AuditLogProps) {
  const entries = props.doc?.entries ?? [];
  return (
    <div style={{ minHeight: "100dvh", background: INK, color: "#F4F7F2", fontFamily: BODY }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
      />
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 20px 64px" }}>
        {props.homeHref ? (
          <button type="button" onClick={props.homeHref.onClick} style={ghostBtn}>
            {props.homeHref.label}
          </button>
        ) : null}
        <p
          style={{
            margin: "16px 0 0",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: MUTED,
            fontFamily: DISPLAY,
            fontWeight: 600,
          }}
        >
          Security
        </p>
        <h1 style={{ margin: "4px 0 8px", fontFamily: DISPLAY, fontSize: 22, fontWeight: 700 }}>
          Audit log
        </h1>
        <p style={{ margin: "0 0 20px", color: MUTED, fontSize: 13, maxWidth: 620 }}>
          Append-only. Filter by entity, actor, or window, then export CSV. Regional managers cannot
          open this screen.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20, alignItems: "end" }}>
          <label style={dateLabel}>
            Entity
            <input
              value={props.entityType}
              onChange={(e) => props.onEntityType(e.target.value)}
              placeholder="evidence"
              style={inputStyle}
            />
          </label>
          <label style={dateLabel}>
            Actor
            <input
              value={props.actorId}
              onChange={(e) => props.onActorId(e.target.value)}
              placeholder="office"
              style={inputStyle}
            />
          </label>
          <label style={dateLabel}>
            From
            <input
              type="date"
              value={props.from}
              onChange={(e) => props.onFrom(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={dateLabel}>
            To
            <input
              type="date"
              value={props.to}
              onChange={(e) => props.onTo(e.target.value)}
              style={inputStyle}
            />
          </label>
          <button type="button" onClick={props.onExport} style={{ ...ghostBtn, borderColor: LIME, color: LIME }}>
            Export CSV
          </button>
        </div>
        {props.loading && !props.doc ? (
          <p style={{ color: MUTED }}>Loading…</p>
        ) : props.errorMessage ? (
          <p role="alert" style={{ color: "#F07167" }}>
            {props.errorMessage}
          </p>
        ) : entries.length === 0 ? (
          <p style={{ color: MUTED }}>No audit events in this window.</p>
        ) : (
          <div style={{ overflowX: "auto", border: `1px solid ${HAIRLINE}`, borderRadius: 16 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr 0.9fr 1.2fr 1.3fr",
                padding: "12px 14px",
                color: MUTED,
                fontFamily: DISPLAY,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontSize: 11,
                borderBottom: `1px solid ${HAIRLINE}`,
              }}
            >
              {["When", "Actor", "Entity", "Id", "Action"].map((h) => (
                <span key={h}>{h}</span>
              ))}
            </div>
            <VirtualList
              items={entries}
              estimateSize={44}
              maxHeight={640}
              getKey={(row) => row.id}
              renderItem={(row) => (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1fr 0.9fr 1.2fr 1.3fr",
                    fontFamily: MONO,
                    fontSize: 12,
                    borderBottom: `1px solid ${HAIRLINE}`,
                  }}
                >
                  <span style={cell}>{row.occurredAt}</span>
                  <span style={cell}>{row.actorId ?? "—"}</span>
                  <span style={cell}>{row.entityType}</span>
                  <span style={cell}>{row.entityId}</span>
                  <span style={{ ...cell, color: LIME }}>{row.action}</span>
                </div>
              )}
            />
          </div>
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

const dateLabel: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: MUTED,
  fontFamily: DISPLAY,
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  minHeight: 44,
  minWidth: 140,
  padding: "0 12px",
  borderRadius: 12,
  border: `1px solid ${HAIRLINE}`,
  background: "rgba(255,255,255,0.04)",
  color: "#F4F7F2",
  fontFamily: BODY,
  fontSize: 13,
};

const cell: CSSProperties = {
  padding: "10px 14px",
  borderBottom: `1px solid ${HAIRLINE}`,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
