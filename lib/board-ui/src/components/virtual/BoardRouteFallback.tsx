import type { CSSProperties } from "react";

const INK = "#07101E";
const HAIRLINE = "rgba(255,255,255,0.10)";
const LIME_GLOW = "rgba(180,255,68,0.12)";

const bar = (width: number, height: number, extra?: CSSProperties): CSSProperties => ({
  width,
  height,
  borderRadius: 8,
  background: "rgba(255,255,255,0.08)",
  ...extra,
});

/** Navy full-viewport skeleton matching Pulse / board layout — no content shift. */
export function BoardRouteFallback() {
  return (
    <div
      style={{ minHeight: "100dvh", background: INK, color: "#F4F7F2" }}
      aria-busy="true"
      aria-label="Loading"
    >
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 20px 64px" }}>
        <div style={bar(72, 12)} />
        <div style={bar(220, 22, { marginTop: 8 })} />
        <div style={bar(280, 84, { marginTop: 16, background: LIME_GLOW, borderRadius: 12 })} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
            marginTop: 28,
          }}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              style={{
                minHeight: 140,
                borderRadius: 16,
                border: `1px solid ${HAIRLINE}`,
                background: "rgba(255,255,255,0.03)",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
