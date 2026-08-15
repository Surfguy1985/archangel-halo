import { useId, useState } from "react";
import { describeArc } from "./polar";
import { actorLabel, formatStageClock, ownerLabel } from "./clock";
import type { TurnRingDocument, TurnRingArcDocument } from "@workspace/api-client-react";

const GOLD = "#E8C36A";
const CORAL = "#F07167";
const MUTED = "rgba(255,255,255,0.28)";
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';

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

export function TurnRing(props: {
  ring: TurnRingDocument;
  size: 44 | 120 | 280;
  /** 44px cards put the unit number in the ring. 280px holds days vacant. */
  center?: "daysVacant" | "unit";
  unitNumber?: string;
  interactive?: boolean;
  onArcSelect?: (arc: TurnRingArcDocument) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<TurnRingArcDocument | null>(null);
  const [pinned, setPinned] = useState<TurnRingArcDocument | null>(null);
  const size = props.size;
  const interactive = props.interactive ?? size === 280;
  const centerMode = props.center ?? (size === 44 && props.unitNumber ? "unit" : "daysVacant");
  const cx = size / 2;
  const cy = size / 2;
  const metrics =
    size === 44
      ? { r: 16, stroke: 5, font: 11, unitFont: 10, over: 4, rework: 4, coral: 1.5, dash: "3 3" }
      : size === 120
        ? { r: 44, stroke: 10, font: 22, unitFont: 16, over: 7, rework: 7, coral: 2, dash: "5 5" }
        : { r: 104, stroke: 18, font: 42, unitFont: 28, over: 12, rework: 10, coral: 3, dash: "8 7" };
  const { r, stroke } = metrics;
  const hatchId = `tr-hatch-${uid}`;
  const tip = pinned ?? hover;

  const centerText =
    centerMode === "unit" ? (props.unitNumber ?? String(props.ring.daysVacant)) : String(props.ring.daysVacant);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={
          centerMode === "unit"
            ? `Unit ${centerText}, ${props.ring.daysVacant} days vacant`
            : `${props.ring.daysVacant} days vacant`
        }
      >
        <defs>
          <pattern
            id={hatchId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke={GOLD} strokeWidth="2" />
          </pattern>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        {props.ring.arcs.map((arc, i) => {
          const d = describeArc(cx, cy, r, arc.startDeg, arc.endDeg);
          if (!d) return null;
          const isClient = arc.owner === "client";
          const outlineClient = size === 44 && isClient && !arc.predicted;
          const strokePaint = arc.predicted
            ? MUTED
            : outlineClient
              ? GOLD
              : isClient
                ? `url(#${hatchId})`
                : GOLD;
          const title = [
            STAGE_LABEL[arc.stage] ?? arc.stage,
            arc.predicted ? "predicted remaining" : formatStageClock(arc.durationMs),
            arc.predicted ? null : ownerLabel(arc.owner),
            arc.actorId ? actorLabel(arc.actorId) : null,
            arc.visitIndex > 0 ? "rework" : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <g key={`${arc.stage}-${arc.visitIndex}-${i}`}>
              {arc.overP75 ? (
                <path
                  d={describeArc(cx, cy, r + metrics.over, arc.startDeg, arc.endDeg)}
                  fill="none"
                  stroke={CORAL}
                  strokeWidth={metrics.coral}
                  strokeLinecap="round"
                />
              ) : null}
              {arc.visitIndex > 0 ? (
                <path
                  d={describeArc(cx, cy, r - metrics.rework, arc.startDeg, arc.endDeg)}
                  fill="none"
                  stroke={GOLD}
                  strokeWidth={size === 44 ? 2 : size === 120 ? 4 : 6}
                  strokeLinecap="round"
                />
              ) : null}
              {outlineClient ? (
                <path
                  d={describeArc(cx, cy, r - 2, arc.startDeg, arc.endDeg)}
                  fill="none"
                  stroke={GOLD}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              ) : null}
              <path
                d={d}
                fill="none"
                stroke={strokePaint}
                strokeWidth={outlineClient ? 1.5 : stroke}
                strokeLinecap="round"
                strokeDasharray={arc.predicted ? metrics.dash : undefined}
                style={{ cursor: interactive ? "pointer" : "inherit" }}
                pointerEvents={interactive ? "auto" : "none"}
                onMouseEnter={interactive ? () => setHover(arc) : undefined}
                onMouseLeave={interactive ? () => setHover(null) : undefined}
                onClick={
                  interactive
                    ? (e) => {
                        e.stopPropagation();
                        setPinned((cur) =>
                          cur && cur.stage === arc.stage && cur.visitIndex === arc.visitIndex ? null : arc,
                        );
                        props.onArcSelect?.(arc);
                      }
                    : undefined
                }
              >
                <title>{title}</title>
              </path>
            </g>
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontFamily: centerMode === "unit" ? BODY : MONO,
            fontWeight: 700,
            fontSize: centerMode === "unit" ? metrics.unitFont : metrics.font,
            letterSpacing: "-0.04em",
            color: "#F4F7F2",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {centerText}
        </span>
        {size !== 44 ? (
          <span style={{ fontFamily: BODY, fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 6 }}>
            days vacant
          </span>
        ) : null}
      </div>
      {size === 280 && tip ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: -8,
            transform: "translateY(100%)",
            padding: "10px 12px",
            borderRadius: 12,
            background: "#0C1626",
            border: "1px solid rgba(255,255,255,0.12)",
            fontFamily: BODY,
            fontSize: 13,
            color: "#F4F7F2",
            zIndex: 2,
          }}
        >
          <strong>{STAGE_LABEL[tip.stage] ?? tip.stage}</strong>
          {tip.visitIndex > 0 ? " · rework" : ""}
          <div style={{ marginTop: 4, color: "rgba(255,255,255,0.7)", fontFamily: MONO, fontSize: 12 }}>
            {tip.predicted ? "predicted remaining" : formatStageClock(tip.durationMs)}
          </div>
          <div style={{ marginTop: 2, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
            {tip.predicted ? "forecast" : ownerLabel(tip.owner)}
            {" · "}
            {tip.predicted ? "—" : `acted by ${actorLabel(tip.actorId)}`}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function confidenceGlyph(confidence: string | null): string {
  if (confidence === "high") return "●";
  if (confidence === "medium") return "◐";
  if (confidence === "low") return "○";
  return "";
}
