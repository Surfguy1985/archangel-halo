/**
 * B3 — The only place the map has options: one layers popover, Apple-Maps shaped.
 * Three ways to see the property, then how it looks. That is the whole control set.
 */
import "./_group.css";
import { useState } from "react";
import { Layers2, LocateFixed, Check } from "lucide-react";
import { C } from "./_shared/lenses";
import { PeekMap, MapButton } from "./_shared/peek";

const VIEWS = [
  { id: "live", label: "Live", sub: "Crews + GPS", tone: C.lime },
  { id: "turns", label: "Turns", sub: "Unit stages", tone: C.blue },
  { id: "money", label: "Money", sub: "$ in flight", tone: C.amber },
];

const STYLES = ["Night", "Daylight", "Mono"] as const;

function Thumb({ id, tone, on }: { id: string; tone: string; on: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        height: 52,
        borderRadius: 12,
        overflow: "hidden",
        background: "#0a1729",
        border: "2px solid " + (on ? C.lime : "transparent"),
        boxShadow: on ? "0 0 0 1px rgba(180,255,68,0.35)" : "none",
      }}
    >
      <svg viewBox="0 0 60 40" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <rect width="60" height="40" fill="#0a1729" />
        <g stroke="rgba(140,180,235,0.2)" strokeWidth="2">
          <path d="M0 16 H60" />
          <path d="M24 0 V40" />
        </g>
        {id === "live" && (
          <>
            <circle cx="16" cy="24" r="3.4" fill={tone} />
            <circle cx="40" cy="12" r="3.4" fill="#0a84ff" />
          </>
        )}
        {id === "turns" && (
          <g>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <rect key={i} x={6 + (i % 3) * 17} y={7 + Math.floor(i / 3) * 17} width="13" height="12" rx="2" fill={i % 3 === 0 ? tone : i % 3 === 1 ? "rgba(255,255,255,0.75)" : "#ffb340"} opacity="0.85" />
            ))}
          </g>
        )}
        {id === "money" && (
          <g>
            <circle cx="20" cy="20" r="11" fill={tone} opacity="0.35" />
            <circle cx="42" cy="16" r="7" fill="#b4ff44" opacity="0.35" />
          </g>
        )}
      </svg>
      {on && (
        <span
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: C.lime,
            color: "#07101e",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={11} strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

const LOOK: Record<string, string> = {
  Night: "contrast(112%) saturate(88%)",
  Daylight: "contrast(104%) saturate(120%) brightness(126%)",
  Mono: "contrast(118%) saturate(0%)",
};

export function PeekLayers() {
  const [view, setView] = useState("live");
  const [style, setStyle] = useState("Night");

  return (
    <div className="cmt">
      <PeekMap labels big filter={LOOK[style]} />
      <div style={{ position: "absolute", inset: 0, background: "rgba(4,9,20,0.45)" }} />

      <div style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "flex-start", padding: "14px 12px 0" }}>
        <button
          style={{
            height: 34,
            padding: "0 15px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(7,16,30,0.78)",
            backdropFilter: "blur(14px)",
            color: "rgba(255,255,255,0.92)",
            fontFamily: "inherit",
            fontSize: 13.5,
            fontWeight: 700,
          }}
        >
          Done
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: "grid", gap: 8 }}>
          <MapButton label="Map layers" active><Layers2 size={16} /></MapButton>
          <MapButton label="Recenter"><LocateFixed size={16} /></MapButton>
        </div>
      </div>

      {/* The popover, anchored under the layers button. */}
      <div
        style={{
          position: "relative",
          zIndex: 4,
          margin: "10px 12px 0",
          padding: "13px 13px 15px",
          borderRadius: 20,
          background: "rgba(9,18,33,0.95)",
          backdropFilter: "blur(28px)",
          border: "1px solid var(--cmd-line)",
          boxShadow: "0 22px 50px rgba(4,9,20,0.62)",
        }}
      >
        <div style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 10 }}>Choose map</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              style={{ padding: 0, border: 0, background: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
            >
              <Thumb id={v.id} tone={v.tone} on={view === v.id} />
              <div style={{ fontSize: 12.5, fontWeight: 750, color: view === v.id ? C.lime : "rgba(255,255,255,0.9)", marginTop: 5 }}>{v.label}</div>
              <div style={{ fontSize: 10.5, color: C.mute }}>{v.sub}</div>
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: "var(--cmd-line-soft)", margin: "14px 0 12px" }} />

        <div style={{ fontSize: 12.5, fontWeight: 750, color: "rgba(255,255,255,0.86)", marginBottom: 8 }}>Appearance</div>
        <div className="cmt-seg" style={{ marginBottom: 12 }}>
          {STYLES.map((s) => (
            <button key={s} className="cmt-seg-item" data-on={style === s} onClick={() => setStyle(s)}>
              {s}
            </button>
          ))}
        </div>

        <p style={{ margin: "2px 2px 0", fontSize: 11, color: C.mute, lineHeight: 1.45 }}>
          Daylight lifts contrast for bright sun on a job site. Remembered on this device.
        </p>
      </div>

      <div style={{ flex: 1 }} />
    </div>
  );
}
