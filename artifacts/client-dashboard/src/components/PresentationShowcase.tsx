import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// PresentationShowcase — an animated overlay panel that surfaces a real-app
// SCREENSHOT while the narrator references a section, with pulsing lime
// highlight rings over the relevant regions. Highlights are defined as
// FRACTIONAL rects (0..1 of the rendered image) so they scale with the panel.
//
// A showcase cycles through PHASES; each phase highlights one or more regions
// and cross-fades to the next after `hold` ms. Everything is keyed by a
// generation/step nonce upstream so it mounts/unmounts cleanly on step change.

const LIME = "#B4FF44";

/** Fractional rectangle over the image (0..1). */
export type ShotRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional caption shown beside the ring. */
  label?: string;
};

export type ShotPhase = {
  rects: ShotRect[];
  /** How long to hold this phase before cross-fading (ms). Default 2600. */
  hold?: number;
};

export type Showcase = {
  /** Imported image URL (Vite asset). */
  src: string;
  /** Short heading shown at the top of the panel. */
  heading: string;
  /** Aspect ratio (w/h) of the screenshot, so the panel reserves space. */
  ratio: number;
  /** Ordered highlight phases; the last one holds until the step advances. */
  phases: ShotPhase[];
};

function HighlightRing({ rect, delay }: { rect: ShotRect; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.35, delay }}
      className="pointer-events-none absolute"
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
      }}
    >
      {/* Pulsing lime ring/spotlight over the region. */}
      <motion.div
        animate={{
          boxShadow: [
            `0 0 0 2px ${LIME}, 0 0 0 9999px rgba(4,10,26,0.30), 0 0 18px rgba(180,255,68,0.55)`,
            `0 0 0 3px ${LIME}, 0 0 0 9999px rgba(4,10,26,0.30), 0 0 30px rgba(180,255,68,0.85)`,
            `0 0 0 2px ${LIME}, 0 0 0 9999px rgba(4,10,26,0.30), 0 0 18px rgba(180,255,68,0.55)`,
          ],
        }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        className="h-full w-full rounded-lg"
      />
      {rect.label && (
        <div
          className="absolute -top-6 left-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: LIME, color: "#08131f" }}
        >
          {rect.label}
        </div>
      )}
    </motion.div>
  );
}

export function PresentationShowcase({ showcase }: { showcase: Showcase }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const phases = showcase.phases;

  // Advance through phases; the LAST phase holds (no timer) until unmount.
  useEffect(() => {
    setPhaseIdx(0);
    if (phases.length <= 1) return;
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = () => {
      if (i >= phases.length - 1) return;
      const hold = phases[i]?.hold ?? 2600;
      const t = setTimeout(() => {
        i += 1;
        setPhaseIdx(i);
        schedule();
      }, hold);
      timers.push(t);
    };
    schedule();
    return () => timers.forEach(clearTimeout);
  }, [phases]);

  const activeRects = useMemo(() => phases[phaseIdx]?.rects ?? [], [phases, phaseIdx]);

  return (
    <motion.div
      data-testid="presentation-showcase"
      initial={{ opacity: 0, x: 60, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 240, damping: 26 }}
      className="pointer-events-none fixed left-1/2 top-[6vh] z-[88] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#0B1428] shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3.5 py-2">
        <Sparkle />
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/80">
          {showcase.heading}
        </span>
      </div>
      <div className="relative w-full" style={{ aspectRatio: String(showcase.ratio) }}>
        <img
          src={showcase.src}
          alt={showcase.heading}
          className="absolute inset-0 h-full w-full object-cover object-top"
          draggable={false}
        />
        <AnimatePresence mode="wait">
          <motion.div
            key={phaseIdx}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {activeRects.map((r, i) => (
              <HighlightRing key={i} rect={r} delay={i * 0.12} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function Sparkle() {
  return (
    <span className="relative flex h-2 w-2">
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
        style={{ background: LIME }}
      />
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: LIME }} />
    </span>
  );
}
