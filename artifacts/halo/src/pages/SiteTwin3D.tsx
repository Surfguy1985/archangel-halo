/**
 * Browser Site Twin — building-first live plate (no Unity required).
 * Canvas top-down twin fed by /api/properties/:id/building-ops.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute, Link } from "wouter";

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
  title: string;
  unitNo: string | null;
};
type Plate = {
  ok: boolean;
  propertyName?: string;
  site?: { lat: number; lng: number };
  summary?: { headline: string; onSite: number; liveJobs: number };
  buildings?: Building[];
  presence?: Presence[];
  heat?: { lat: number; lng: number; weight: number }[];
  byBuilding?: Record<string, number>;
};

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

export default function SiteTwin3D() {
  const [, params] = useRoute("/site-twin/:propertyId");
  const propertyId = params?.propertyId || "";
  const [plate, setPlate] = useState<Plate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const r = await fetch(`/api/properties/${propertyId}/building-ops`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setPlate(j);
      setErr(null);
    } catch (e: any) {
      setErr(e.message || "load failed");
    }
  }, [propertyId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !plate?.site || !plate.buildings) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    const origin = plate.site;
    const scale = 0.35;

    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, w, h);

    // heat
    for (const ht of plate.heat || []) {
      const p = project(ht.lat, ht.lng, origin, w, h, scale);
      const r = 8 + Math.min(ht.weight, 12) * 2;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, "rgba(255,80,40,0.45)");
      g.addColorStop(1, "rgba(255,80,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // buildings
    for (const b of plate.buildings) {
      const p = project(b.lat, b.lng, origin, w, h, scale);
      const active = focus === b.building;
      const crewN = plate.byBuilding?.[String(b.building)] || 0;
      ctx.fillStyle = active ? "#38bdf8" : crewN > 0 ? "#34d399" : "#334155";
      ctx.strokeStyle = active ? "#e0f2fe" : "#64748b";
      ctx.lineWidth = active ? 3 : 1;
      const s = 22;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(b.building), p.x, p.y + 4);
    }

    // crews
    for (const cr of plate.presence || []) {
      if (!cr.onSite || cr.lat == null || cr.lng == null) continue;
      const p = project(cr.lat, cr.lng, origin, w, h, scale);
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fef3c7";
      ctx.font = "10px system-ui";
      ctx.fillText(cr.crewName.split(" ")[0] || "?", p.x, p.y - 10);
    }

    // site center
    const o = project(origin.lat, origin.lng, origin, w, h, scale);
    ctx.strokeStyle = "#94a3b8";
    ctx.beginPath();
    ctx.arc(o.x, o.y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }, [plate, focus]);

  const densest = useMemo(() => {
    const entries = Object.entries(plate?.byBuilding || {}).sort((a, b) => b[1] - a[1]);
    return entries[0] ? Number(entries[0][0]) : null;
  }, [plate]);

  if (!propertyId) {
    return (
      <div className="p-6 text-sm text-slate-400">
        Open <code>/site-twin/PROPERTY_UUID</code>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">Site Twin</div>
          <div className="text-lg font-semibold">{plate?.propertyName || "Loading…"}</div>
          <div className="text-sm text-sky-300">{plate?.summary?.headline || err || "…"}</div>
        </div>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm hover:bg-slate-700"
            onClick={() => densest != null && setFocus(densest)}
          >
            Focus densest
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm hover:bg-slate-700"
            onClick={() => load()}
          >
            Refresh
          </button>
          <Link href="/pulse" className="px-3 py-1.5 rounded-lg bg-sky-600 text-sm">
            Pulse
          </Link>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <canvas
          ref={canvasRef}
          width={900}
          height={640}
          className="flex-1 max-w-full bg-slate-950 cursor-crosshair"
          onClick={(e) => {
            // click nearest building
            if (!plate?.buildings || !plate.site || !canvasRef.current) return;
            const rect = canvasRef.current.getBoundingClientRect();
            const mx = ((e.clientX - rect.left) / rect.width) * canvasRef.current.width;
            const my = ((e.clientY - rect.top) / rect.height) * canvasRef.current.height;
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
        <aside className="w-72 border-l border-slate-800 p-3 overflow-y-auto text-sm space-y-3">
          <div className="text-xs text-slate-500 uppercase">On site</div>
          {(plate?.presence || [])
            .filter((p) => p.onSite)
            .map((p) => (
              <div key={p.crewId} className="rounded-lg bg-slate-900 px-2 py-1.5">
                <div className="font-medium text-amber-200">{p.crewName}</div>
                <div className="text-slate-400 text-xs">{p.title}</div>
              </div>
            ))}
          {(plate?.presence || []).filter((p) => p.onSite).length === 0 && (
            <div className="text-slate-500">No crews on site</div>
          )}
          <div className="text-xs text-slate-500 uppercase pt-2">Buildings</div>
          <div className="grid grid-cols-4 gap-1">
            {(plate?.buildings || []).map((b) => (
              <button
                key={b.building}
                type="button"
                onClick={() => setFocus(b.building)}
                className={`rounded py-1 text-xs ${
                  focus === b.building ? "bg-sky-600" : "bg-slate-800 hover:bg-slate-700"
                }`}
              >
                {b.building}
              </button>
            ))}
          </div>
          {focus != null && (
            <div className="text-xs text-slate-400">
              Focus Building {focus}
              {plate?.byBuilding?.[String(focus)]
                ? ` · ${plate.byBuilding[String(focus)]} crew`
                : ""}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
