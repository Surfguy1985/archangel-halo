/**
 * Browser Site Twin — building-first live plate (no Unity required).
 * /site-twin or /site-twin/:propertyId
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute, Link, useLocation } from "wouter";

type Building = {
  building: number;
  label: string;
  lat: number;
  lng: number;
  unitCount: number;
};
type Presence = {
  crewId: string;
  crewName: string;
  lat: number | null;
  lng: number | null;
  onSite: boolean;
  building: number | null;
  buildingLabel?: string | null;
  title: string;
  unitNo: string | null;
  source?: "live" | "demo";
  demo?: boolean;
  fresh?: boolean;
  at?: string | null;
  trade?: string | null;
};
type Plate = {
  ok: boolean;
  propertyName?: string;
  site?: { lat: number; lng: number };
  summary?: { headline: string; onSite: number; liveJobs: number; demoActive?: boolean };
  buildings?: Building[];
  presence?: Presence[];
  heat?: { lat: number; lng: number; weight: number }[];
  byBuilding?: Record<string, number>;
  demo?: { active: boolean; presentationOnly?: boolean };
};
type PropRow = { id: string; name: string; city?: string | null };

function project(
  lat: number,
  lng: number,
  origin: { lat: number; lng: number },
  w: number,
  h: number,
  scale: number
) {
  const dLat = lat - origin.lat;
  const dLng = lng - origin.lng;
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  const x = w / 2 + dLng * 111320 * cos * scale;
  const y = h / 2 - dLat * 111320 * scale;
  return { x, y };
}

function isDemoPresence(p: Presence): boolean {
  return p.demo === true || p.source === "demo" || p.crewId.startsWith("demo:");
}

function readTwinDemoQuery(): boolean {
  if (typeof window === "undefined") return false;
  const v = (new URLSearchParams(window.location.search).get("demo") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "thornbury" || v === "on";
}

function writeTwinDemoQuery(on: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (on) url.searchParams.set("demo", "1");
  else url.searchParams.delete("demo");
  window.history.replaceState(window.history.state, "", url);
}

export default function SiteTwin3D() {
  const [, params] = useRoute("/site-twin/:propertyId");
  const [, setLocation] = useLocation();
  const propertyId = params?.propertyId || "";
  const [plate, setPlate] = useState<Plate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [propsList, setPropsList] = useState<PropRow[]>([]);
  const [demo, setDemo] = useState(() => readTwinDemoQuery());
  const [focusCrew, setFocusCrew] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tick = useRef(0);

  useEffect(() => {
    if (propertyId) return;
    (async () => {
      try {
        const r = await fetch("/api/properties");
        const j = await r.json();
        const list = Array.isArray(j) ? j : j.properties || j.items || [];
        setPropsList(
          list.map((p: any) => ({
            id: p.id || p.propertyId,
            name: p.name || p.propertyName || "Property",
            city: p.city || null,
          })).filter((p: PropRow) => p.id)
        );
      } catch (e: any) {
        setErr(e.message || "Could not list properties");
      }
    })();
  }, [propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const qs = demo ? "?demo=1" : "";
      const r = await fetch(`/api/properties/${propertyId}/building-ops${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setPlate(j);
      setErr(null);
    } catch (e: any) {
      setErr(e.message || "load failed");
    }
  }, [propertyId, demo]);

  useEffect(() => {
    if (!propertyId) return;
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load, propertyId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      setDemo((v) => {
        const next = !v;
        writeTwinDemoQuery(next);
        return next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !plate?.site || !plate.buildings) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const origin = plate.site;
    const scale = 0.35;
    let raf = 0;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = () => {
      tick.current += 1;
      const w = c.width;
      const h = c.height;
      ctx.fillStyle = "#0B0D0C";
      ctx.fillRect(0, 0, w, h);
      const vg = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
      vg.addColorStop(0, "rgba(180,255,68,0.05)");
      vg.addColorStop(1, "rgba(11,13,12,0)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(180,255,68,0.06)";
      ctx.lineWidth = 1;
      for (let x = 40; x < w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 40; y < h; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      for (const ht of plate.heat || []) {
        const p = project(ht.lat, ht.lng, origin, w, h, scale);
        const r = 10 + Math.min(ht.weight, 12) * 2;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, "rgba(255,107,90,0.35)");
        g.addColorStop(1, "rgba(255,107,90,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.textAlign = "center";
      for (const b of plate.buildings) {
        const p = project(b.lat, b.lng, origin, w, h, scale);
        const active = focus === b.building;
        const crewN = plate.byBuilding?.[String(b.building)] || 0;
        ctx.fillStyle = active ? "#B4FF44" : crewN > 0 ? "rgba(180,255,68,0.55)" : "#1F2320";
        ctx.strokeStyle = active ? "#F4F4F0" : "rgba(180,255,68,0.35)";
        ctx.lineWidth = active ? 2.5 : 1;
        const s = active ? 26 : 22;
        ctx.beginPath();
        ctx.roundRect?.(p.x - s / 2, p.y - s / 2, s, s, 6);
        if (!ctx.roundRect) ctx.rect(p.x - s / 2, p.y - s / 2, s, s);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = active || crewN > 0 ? "#1A1C1A" : "#F4F4F0";
        ctx.font = "700 11px Outfit, system-ui";
        ctx.fillText(String(b.building), p.x, p.y + 4);
      }

      const pulse = reduced ? 1 : 1 + Math.sin(tick.current / 18) * 0.12;
      for (const cr of plate.presence || []) {
        if (!cr.onSite || cr.lat == null || cr.lng == null) continue;
        const p = project(cr.lat, cr.lng, origin, w, h, scale);
        const mock = isDemoPresence(cr);
        const selected = focusCrew === cr.crewId || (cr.building != null && focus === cr.building);
        if (mock) {
          ctx.fillStyle = "#E879F9";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 9);
          ctx.lineTo(p.x + 8, p.y);
          ctx.lineTo(p.x, p.y + 9);
          ctx.lineTo(p.x - 8, p.y);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#F5D0FE";
          ctx.font = "800 8px IBM Plex Mono, ui-monospace";
          ctx.fillText("DEMO", p.x, p.y - 14);
          ctx.font = "700 11px Outfit, system-ui";
          ctx.fillText(cr.crewName.split(" ")[0] || "?", p.x, p.y + 20);
        } else {
          if (cr.fresh !== false) {
            ctx.strokeStyle = `rgba(180,255,68,${0.55 * (2 - pulse)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 10 * pulse, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.fillStyle = selected ? "#F4F4F0" : "#B4FF44";
          ctx.beginPath();
          ctx.arc(p.x, p.y, selected ? 8 : 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#B4FF44";
          ctx.font = "700 11px Outfit, system-ui";
          ctx.fillText(cr.crewName.split(" ")[0] || "?", p.x, p.y - 14);
        }
      }

      const o = project(origin.lat, origin.lng, origin, w, h, scale);
      ctx.strokeStyle = "#B4FF44";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [plate, focus, focusCrew]);

  const densest = useMemo(() => {
    const entries = Object.entries(plate?.byBuilding || {}).sort((a, b) => b[1] - a[1]);
    return entries[0] ? Number(entries[0][0]) : null;
  }, [plate]);
  const demoOn = demo || !!plate?.demo?.active || !!plate?.summary?.demoActive;

  // Picker
  if (!propertyId) {
    return (
      <div className="twin3d">
        <div className="twin3d-hud" style={{ maxWidth: 560, margin: "0 auto", width: "100%" }}>
          <div>
            <div className="twin3d-kicker">Site Twin</div>
            <h1>Choose a property</h1>
            <p className="twin3d-sub">Live building plate · crew presence · heat. Same payload Unity reads.</p>
          </div>
        </div>
        <div style={{ maxWidth: 560, margin: "0 auto", width: "100%", padding: 22 }}>
          {err && <div className="twin3d-card" style={{ color: "#FF6B5A" }}>{err}</div>}
          <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {propsList.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="twin3d-card"
                  style={{ width: "100%", textAlign: "left", cursor: "pointer", color: "inherit" }}
                  onClick={() => setLocation(`/site-twin/${p.id}`)}
                >
                  <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 18 }}>{p.name}</div>
                  {p.city && <div className="twin3d-sub">{p.city}</div>}
                </button>
              </li>
            ))}
            {propsList.length === 0 && !err && <div className="twin3d-sub">Loading properties…</div>}
          </ul>
          <Link href="/pulse" className="twin3d-kicker" style={{ display: "inline-block", marginTop: 18 }}>
            ← Pulse
          </Link>
        </div>
      </div>
    );
  }

  const onSite = (plate?.presence || []).filter((p) => p.onSite);
  const liveN = onSite.filter((p) => !isDemoPresence(p)).length;
  const demoN = onSite.filter(isDemoPresence).length;

  return (
    <div className={`twin3d${demoOn ? " is-demo" : ""}`}>
      <header className="twin3d-hud">
        <div>
          <div className="twin3d-kicker">{demoOn ? "Site Twin · DEMO WALKTHROUGH" : "Site Twin · LIVE"}</div>
          <h1>{plate?.propertyName || "Loading…"}</h1>
          <p className="twin3d-sub">{plate?.summary?.headline || err || "Acquiring plate…"}</p>
        </div>
        <div className="twin3d-actions">
          <button
            type="button"
            className={demo ? "on" : ""}
            aria-pressed={demo}
            onClick={() => {
              setDemo((v) => {
                const next = !v;
                writeTwinDemoQuery(next);
                return next;
              });
            }}
          >
            {demo ? "Hide demo" : "Thornbury demo"}
          </button>
          <button type="button" onClick={() => densest != null && setFocus(densest)}>
            Densest {densest ?? "—"}
          </button>
          <button type="button" onClick={() => load()}>Refresh</button>
          <Link href="/site-twin">Switch</Link>
          <Link href={`/pulse?propertyId=${propertyId}`} className="pulse">Pulse</Link>
        </div>
      </header>

      <div className="twin3d-body">
        <canvas
          ref={canvasRef}
          width={1100}
          height={720}
          onClick={(e) => {
            if (!plate?.buildings || !plate.site || !canvasRef.current) return;
            const rect = canvasRef.current.getBoundingClientRect();
            const mx = ((e.clientX - rect.left) / rect.width) * canvasRef.current.width;
            const my = ((e.clientY - rect.top) / rect.height) * canvasRef.current.height;
            let bestCrew: Presence | null = null;
            let bestCrewD = Infinity;
            for (const cr of plate.presence || []) {
              if (cr.lat == null || cr.lng == null) continue;
              const p = project(cr.lat, cr.lng, plate.site, canvasRef.current.width, canvasRef.current.height, 0.35);
              const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
              if (d < bestCrewD) {
                bestCrewD = d;
                bestCrew = cr;
              }
            }
            if (bestCrew && bestCrewD < 28 * 28) {
              setFocusCrew(bestCrew.crewId);
              if (bestCrew.building != null) setFocus(bestCrew.building);
              return;
            }
            let best: Building | null = null;
            let bestD = Infinity;
            for (const b of plate.buildings) {
              const p = project(b.lat, b.lng, plate.site, canvasRef.current.width, canvasRef.current.height, 0.35);
              const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
              if (d < bestD) {
                bestD = d;
                best = b;
              }
            }
            if (best && bestD < 40 * 40) setFocus(best.building);
          }}
        />
        <aside className="twin3d-aside">
          <div style={{ display: "flex", gap: 8, fontSize: 11, fontWeight: 700 }}>
            <span className="twin3d-card live">Live GPS {liveN}</span>
            {demoOn && <span className="twin3d-card demo">MOCK {demoN}</span>}
          </div>
          {demoOn && (
            <div className="twin3d-card demo">
              Mock pins are presentation only — not check-ins or GPS history. Live GPS still wins.
            </div>
          )}
          <div className="twin3d-kicker">On site</div>
          {onSite.map((p) => {
            const mock = isDemoPresence(p);
            return (
              <div key={p.crewId} className={`twin3d-card ${mock ? "demo" : "live"}`}>
                <button
                  type="button"
                  onClick={() => {
                    setFocusCrew(p.crewId);
                    if (p.building != null) setFocus(p.building);
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{mock ? "DEMO · " : ""}{p.crewName}</div>
                  <div className="twin3d-sub">{p.title}</div>
                </button>
              </div>
            );
          })}
          {onSite.length === 0 && <div className="twin3d-sub">No crews on site</div>}
          <div className="twin3d-kicker" style={{ paddingTop: 8 }}>Buildings</div>
          <div className="twin3d-grid">
            {(plate?.buildings || []).map((b) => (
              <button
                key={b.building}
                type="button"
                onClick={() => setFocus(b.building)}
                className={focus === b.building ? "on" : ""}
              >
                {b.building}
              </button>
            ))}
          </div>
          {focus != null && (
            <div className="twin3d-sub">
              Focus Building {focus}
              {plate?.byBuilding?.[String(focus)] ? ` · ${plate.byBuilding[String(focus)]} crew` : ""}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
