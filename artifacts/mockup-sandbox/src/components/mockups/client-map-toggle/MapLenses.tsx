/**
 * HALO client board — the MAP LENS DIAL.
 *
 * One surface, five lenses. The dial on the right edge doesn't re-skin a map:
 * each lens redraws the property AND swaps the dock beneath it, because each
 * one answers a different manager's question. Tap the dial to move between them.
 */
import { useState } from "react";
import "./_group.css";
import { Bell, ChevronRight, MessageSquare, Phone, Search, SlidersHorizontal } from "lucide-react";
import {
  C,
  CREWS,
  LENSES,
  MONEY,
  MapMoney,
  MapPlate,
  MapPortfolio,
  MapRadar,
  MapReplay,
  PROPERTIES,
  REPLAY_EVENTS,
  STAGES,
  UNITS,
  money,
  type LensId,
} from "./_shared/lenses";

const HEADLINE: Record<LensId, { title: string; sub: string }> = {
  radar: { title: "Avalon Ridge", sub: "2 crews on site · 4 units live" },
  money: { title: "Avalon Ridge", sub: money(28340) + " in flight · 2 need you" },
  plate: { title: "Avalon Ridge", sub: "24 units · 9 in turn · 3 aging" },
  replay: { title: "Today at Avalon", sub: "Tue Aug 18 · 5 events · 6h 12m on site" },
  portfolio: { title: "Your portfolio", sub: "4 properties · 7 crews · 1 at risk" },
};

function Dock({ lens }: { lens: LensId }) {
  const shell: React.CSSProperties = {
    position: "relative",
    zIndex: 3,
    flexShrink: 0,
    background: "rgba(7,16,30,0.93)",
    backdropFilter: "blur(22px)",
    borderTop: "1px solid var(--cmd-line)",
    borderRadius: "20px 20px 0 0",
    boxShadow: "0 -16px 40px rgba(6,12,28,0.5)",
    padding: "11px 12px 14px",
  };
  const capTitle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: C.mute,
    margin: "0 0 8px",
  };

  if (lens === "radar") {
    return (
      <div style={shell}>
        <div style={capTitle}>On site now</div>
        <div className="cmt-scroll" style={{ display: "flex", gap: 9 }}>
          {CREWS.map((c) => (
            <div key={c.id} className="cmt-card" style={{ minWidth: 208, flexShrink: 0, padding: "10px 11px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 999, background: c.tone + "26", border: "1px solid " + c.tone, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, color: c.tone }}>
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 750, lineHeight: 1.2 }}>{c.name}</div>
                  <div style={{ fontSize: 10.5, color: C.mute }}>{c.unit} · {c.trade}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: c.tone }}>{c.on}</div>
                  <div style={{ fontSize: 8.5, color: C.mute, letterSpacing: "0.06em" }}>ON SITE</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                <button className="cmt-chip" style={{ flex: 1, justifyContent: "center", height: 28 }}><MessageSquare size={11} /> Message</button>
                <button className="cmt-chip" style={{ width: 34, justifyContent: "center", height: 28, padding: 0 }} aria-label="Call"><Phone size={11} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (lens === "money") {
    const total = MONEY.reduce((s, m) => s + m.value, 0);
    return (
      <div style={shell}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 9 }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em" }}>{money(total)}</span>
          <span style={{ fontSize: 11, color: C.mute, fontWeight: 650 }}>in flight at this property</span>
        </div>
        <div style={{ display: "grid", gap: 7 }}>
          {MONEY.map((m) => (
            <div key={m.label} style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: m.tone }} />
                <span style={{ flex: 1, fontWeight: 650 }}>{m.label}</span>
                <span style={{ fontWeight: 800 }}>{money(m.value)}</span>
              </div>
              <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                <div style={{ width: (m.value / total) * 100 + "%", height: "100%", borderRadius: 999, background: m.tone }} />
              </div>
            </div>
          ))}
        </div>
        <button
          style={{
            marginTop: 11,
            width: "100%",
            height: 40,
            border: 0,
            borderRadius: 13,
            background: C.lime,
            color: "#07101e",
            fontFamily: "inherit",
            fontSize: 13.5,
            fontWeight: 800,
            boxShadow: "0 10px 26px rgba(180,255,68,0.26)",
          }}
        >
          Approve 2 POs · {money(8420)}
        </button>
      </div>
    );
  }

  if (lens === "plate") {
    const counts = STAGES.map((s) => ({ ...s, n: UNITS.filter((u) => u.stage === s.id).length }));
    const aging = UNITS.filter((u) => u.days >= 9);
    return (
      <div style={shell}>
        <div style={capTitle}>Turn ladder · tap to filter the plate</div>
        <div className="cmt-scroll" style={{ display: "flex", gap: 6 }}>
          {counts.map((s) => (
            <div
              key={s.id}
              className="cmt-card"
              style={{ flex: "1 0 auto", minWidth: 62, padding: "7px 8px", textAlign: "center", borderColor: s.id === "work" ? C.lime + "88" : undefined }}
            >
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em", color: s.color }}>{s.n}</div>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: C.mute, whiteSpace: "nowrap" }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div className="cmt-card" style={{ marginTop: 9, padding: "9px 11px", display: "flex", alignItems: "center", gap: 9, borderColor: "rgba(255,107,107,0.45)" }}>
          <span style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: C.red }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 750 }}>{aging.length} units aging past 9 days</div>
            <div style={{ fontSize: 10.5, color: C.mute }}>{aging.map((u) => u.id).join(" · ")} — vacant, no crew assigned</div>
          </div>
          <ChevronRight size={14} style={{ color: "rgba(255,255,255,0.35)" }} />
        </div>
      </div>
    );
  }

  if (lens === "replay") {
    return (
      <div style={shell}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute }}>7a</span>
          <div style={{ position: "relative", flex: 1, height: 26 }}>
            <div style={{ position: "absolute", top: 11, left: 0, right: 0, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.08)" }} />
            <div style={{ position: "absolute", top: 11, left: 0, width: "62%", height: 4, borderRadius: 999, background: C.lime }} />
            {REPLAY_EVENTS.map((e) => (
              <span key={e.at} style={{ position: "absolute", top: 8, left: e.t + "%", width: 3, height: 10, borderRadius: 2, background: e.tone, opacity: e.t <= 62 ? 1 : 0.4 }} />
            ))}
            <span style={{ position: "absolute", top: 4, left: "62%", transform: "translateX(-50%)", width: 18, height: 18, borderRadius: 999, background: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,0.5)" }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute }}>7p</span>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {REPLAY_EVENTS.slice(1, 4).map((e) => (
            <div key={e.at} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 10.5, fontWeight: 750, color: C.mute, width: 44 }}>{e.at}</span>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: e.tone }} />
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 650 }}>{e.label}</span>
              <span style={{ fontSize: 10.5, color: C.mute }}>Unit {e.unit}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={capTitle}>Ranked by what needs you</div>
      <div className="cmt-scroll" style={{ display: "flex", gap: 9 }}>
        {[...PROPERTIES].sort((a, b) => a.pct - b.pct).map((p) => (
          <div key={p.name} className="cmt-card" style={{ minWidth: 150, flexShrink: 0, padding: "10px 11px", borderColor: p.tone === C.red ? "rgba(255,107,107,0.5)" : undefined }}>
            <div style={{ fontSize: 12.5, fontWeight: 750, lineHeight: 1.2 }}>{p.name}</div>
            <div style={{ fontSize: 10.5, color: C.mute, marginBottom: 7 }}>{p.live} live · {p.risk}</div>
            <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
              <div style={{ width: p.pct * 100 + "%", height: "100%", borderRadius: 999, background: p.tone }} />
            </div>
            <div style={{ marginTop: 5, fontSize: 10, fontWeight: 700, color: p.tone }}>{Math.round(p.pct * 100)}% turns done</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MapLenses({ initial = "radar" }: { initial?: LensId }) {
  const [lens, setLens] = useState<LensId>(initial);
  const meta = LENSES.find((l) => l.id === lens)!;
  const head = HEADLINE[lens];

  return (
    <div className="cmt">
      {/* Map layer — a different drawing of the property per lens. */}
      {lens === "radar" && <MapRadar />}
      {lens === "money" && <MapMoney />}
      {lens === "plate" && <MapPlate />}
      {lens === "replay" && <MapReplay />}
      {lens === "portfolio" && <MapPortfolio />}

      {/* Floating glass header. */}
      <header
        style={{
          position: "relative",
          zIndex: 3,
          display: "flex",
          alignItems: "center",
          gap: 9,
          margin: "10px 12px 0",
          padding: "8px 10px",
          borderRadius: 16,
          background: "rgba(7,16,30,0.8)",
          backdropFilter: "blur(20px)",
          border: "1px solid var(--cmd-line)",
          flexShrink: 0,
        }}
      >
        <div className="cmt-mark" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 750, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{head.title}</div>
          <div style={{ fontSize: 10, color: C.mute, lineHeight: 1.35 }}>{head.sub}</div>
        </div>
        <button className="cmt-chip" style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }} aria-label="Search"><Search size={12} /></button>
        <button className="cmt-chip" style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }} aria-label="Alerts"><Bell size={12} /></button>
      </header>

      {/* The question this lens answers — tells a manager why to be here. */}
      <div
        style={{
          position: "relative",
          zIndex: 3,
          alignSelf: "flex-start",
          margin: "9px 0 0 12px",
          padding: "4px 10px",
          borderRadius: 999,
          background: "rgba(180,255,68,0.12)",
          border: "1px solid rgba(180,255,68,0.34)",
          color: C.lime,
          fontSize: 10.5,
          fontWeight: 750,
          flexShrink: 0,
        }}
      >
        {meta.question}
      </div>

      {/* The dial. Five lenses, thumb-reachable, never covering the board. */}
      <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", zIndex: 4, display: "flex", alignItems: "center", gap: 7 }}>
        <div className="cmt-dial">
          {LENSES.map((l) => (
            <button key={l.id} data-on={l.id === lens} onClick={() => setLens(l.id)} title={l.label} aria-label={l.label}>
              <l.icon size={16} strokeWidth={2.3} />
            </button>
          ))}
          <span style={{ height: 1, background: "rgba(170,200,255,0.18)", margin: "1px 6px" }} />
          <button title="Layers" aria-label="Layers"><SlidersHorizontal size={15} strokeWidth={2.3} /></button>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <Dock lens={lens} />
    </div>
  );
}
