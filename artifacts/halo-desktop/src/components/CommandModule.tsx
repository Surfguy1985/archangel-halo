/**
 * CommandModule — a small floating HALO chat window that lives over the map.
 *
 * - Draggable by its title bar (pointer events), clamped inside the viewport.
 * - Position persisted in localStorage; re-clamped on mount and on resize so it
 *   never ends up off-screen.
 * - Hidden state is session-only: on EVERY page load the module appears again,
 *   centered.  A dismissed pill / nav button brings it back.
 * - The chat inside is the REAL HALO chat (HaloCommand in `compact` mode) — not
 *   a re-implementation.
 *
 * Stacking: the Leaflet map + Property Pulse HUD use an isolated stage with
 * z-index up to ~1100.  This module renders fixed to the viewport at z-index
 * 3000 so it always sits above the map and its floating panels.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import HaloCommand from "@/pages/HaloCommand";

const POS_KEY = "halo_command_module_pos_v1";
const HIDDEN_KEY = "halo_command_module_hidden";

const W = 380;
const H = 520;
const MARGIN = 12;

type Pos = { x: number; y: number };

function centered(): Pos {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  return {
    x: Math.max(MARGIN, Math.round((vw - W) / 2)),
    y: Math.max(MARGIN, Math.round((vh - H) / 2)),
  };
}

function clamp(pos: Pos): Pos {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const maxX = Math.max(MARGIN, vw - W - MARGIN);
  const maxY = Math.max(MARGIN, vh - H - MARGIN);
  return {
    x: Math.min(Math.max(MARGIN, pos.x), maxX),
    y: Math.min(Math.max(MARGIN, pos.y), maxY),
  };
}

function loadPos(): Pos {
  // The module must appear CENTERED on every page load, so the *initial*
  // position is always centered.  The saved position is only reapplied once
  // the user drags it (savePos), keeping "small but always on screen".
  return clamp(centered());
}

function savePos(pos: Pos) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

export function CommandModule({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pos, setPos] = useState<Pos>(loadPos);
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef<{ ox: number; oy: number } | null>(null);

  // Re-clamp on window resize so the module never ends up off-screen.
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Re-center + re-clamp whenever the module is (re)opened.
  useEffect(() => {
    if (open) {
      const next = clamp(centered());
      posRef.current = next;
      setPos(next);
    }
  }, [open]);

  const onDragMove = useCallback((e: ReactPointerEvent) => {
    if (!drag.current) return;
    const next = clamp({ x: e.clientX - drag.current.ox, y: e.clientY - drag.current.oy });
    posRef.current = next;
    setPos(next);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="HALO command"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: W,
        height: H,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: "calc(100vh - 24px)",
        zIndex: 3000,
        display: "flex",
        flexDirection: "column",
        borderRadius: 18,
        overflow: "hidden",
        background: "#07101E",
        border: "1px solid rgba(255,255,255,0.09)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)",
      }}
    >
      {/* Title bar — drag handle */}
      <header
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { ox: e.clientX - posRef.current.x, oy: e.clientY - posRef.current.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={onDragMove}
        onPointerUp={(e) => {
          if (!drag.current) return;
          drag.current = null;
          savePos(posRef.current);
          try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          cursor: "grab",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.02)",
          flexShrink: 0,
          touchAction: "none",
        }}
      >
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: "50%", background: "#B4FF44", boxShadow: "0 0 8px rgba(180,255,68,0.7)" }}
        />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", color: "rgba(255,255,255,0.85)" }}>HALO</span>
        <span style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(180,255,68,0.55)", marginTop: 1 }}>
          Command
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide HALO command"
          title="Hide"
          style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.4)", background: "transparent", border: "none", cursor: "pointer" }}
        >
          <X size={16} />
        </button>
      </header>

      {/* Real HALO chat, thread + composer only */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <HaloCommand compact />
      </div>
    </div>
  );
}
