import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Sparkles,
  Mic,
  Sun,
  Building2,
  ClipboardList,
  CalendarDays,
  Receipt,
  Users,
  Target,
  Package,
  Truck,
  FileUp,
  Bell,
  BookOpen,
  Link2,
  Settings as SettingsIcon,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Volume2,
  VolumeX,
  Check,
  GraduationCap,
  ChevronLeft,
  type LucideIcon,
} from "lucide-react";
import { tourChapters } from "@/lib/desktopTour";
import { useTourNarration } from "@/hooks/useTourNarration";

const ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Mic,
  Sun,
  Building2,
  ClipboardList,
  CalendarDays,
  Receipt,
  Users,
  Target,
  Package,
  Truck,
  FileUp,
  Bell,
  BookOpen,
  Link2,
  Settings: SettingsIcon,
};

const DONE_KEY = "halo_desktop_tour_done";

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function estimateMs(text: string): number {
  const words = text.trim().split(/\s+/).length;
  const ms = (words / 2.6) * 1000;
  return Math.min(24000, Math.max(3600, ms));
}

type Rect = { top: number; left: number; width: number; height: number };

const CALLOUT_W = 380;
const GAP = 18;

// Wait for a data-tour target to appear after navigation, then return its rect.
function findTarget(target: string | undefined, timeoutMs = 1400): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!target) return resolve(null);
    const start = performance.now();
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return resolve({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      }
      if (performance.now() - start > timeoutMs) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function calloutPosition(
  rect: Rect | null,
  placement: string | undefined,
): { top: number; left: number; arrow: string } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampTop = (t: number) => Math.max(GAP, Math.min(t, vh - 220 - GAP));
  const clampLeft = (l: number) => Math.max(GAP, Math.min(l, vw - CALLOUT_W - GAP));

  if (!rect || placement === "center") {
    return { top: Math.round(vh / 2 - 150), left: Math.round(vw / 2 - CALLOUT_W / 2), arrow: "none" };
  }

  switch (placement) {
    case "right":
      return {
        top: clampTop(rect.top + rect.height / 2 - 110),
        left: clampLeft(rect.left + rect.width + GAP),
        arrow: "left",
      };
    case "left":
      return {
        top: clampTop(rect.top + rect.height / 2 - 110),
        left: clampLeft(rect.left - CALLOUT_W - GAP),
        arrow: "right",
      };
    case "top":
      return {
        top: clampTop(rect.top - 240),
        left: clampLeft(rect.left + rect.width / 2 - CALLOUT_W / 2),
        arrow: "bottom",
      };
    case "bottom":
    default:
      return {
        top: clampTop(rect.top + rect.height + GAP),
        left: clampLeft(rect.left + rect.width / 2 - CALLOUT_W / 2),
        arrow: "top",
      };
  }
}

export function GuidedTour({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { supported, speaking, play, stop, prime } = useTourNarration();
  const [, navigate] = useLocation();
  const [view, setView] = useState<"menu" | "player">("menu");
  const [ci, setCi] = useState(0);
  const [si, setSi] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [done, setDone] = useState<Set<string>>(() => loadDone());

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const totalMinutes = useMemo(() => {
    const words = tourChapters
      .flatMap((c) => c.steps)
      .reduce((n, s) => n + (s.title + " " + s.body).split(/\s+/).length, 0);
    return Math.max(1, Math.round(words / 150));
  }, []);

  const nextPos = useCallback((c: number, s: number) => {
    const chap = tourChapters[c];
    if (!chap) return null;
    if (s + 1 < chap.steps.length) return { c, s: s + 1 };
    if (c + 1 < tourChapters.length) return { c: c + 1, s: 0 };
    return null;
  }, []);

  const prevPos = useCallback((c: number, s: number) => {
    if (s - 1 >= 0) return { c, s: s - 1 };
    if (c - 1 >= 0) return { c: c - 1, s: tourChapters[c - 1].steps.length - 1 };
    return null;
  }, []);

  const chapter = tourChapters[ci];
  const step = chapter?.steps[si];

  // Navigate to the step's route and locate its spotlight target.
  // Keeps polling until the real element renders (slow API/route) instead of
  // giving up after a fixed window — otherwise the spotlight would stay
  // centered on pages that fetch data before painting the anchor.
  useEffect(() => {
    if (!open || view !== "player" || !step) return;
    let cancelled = false;
    let raf = 0;
    setRect(null);
    navigate(step.route);

    // Steps without a target (generic "page"/center) render a centered callout.
    if (!step.target) return () => { cancelled = true; };

    const target = step.target;
    const start = performance.now();
    const HARD_STOP_MS = 12000;

    const measure = (): boolean => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          if (!cancelled) {
            setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
          }
          return true;
        }
      }
      return false;
    };

    // Give the route a beat to start rendering, then poll until found.
    const startTimeout = setTimeout(() => {
      const tick = () => {
        if (cancelled) return;
        if (measure()) return; // found — resize/scroll effect keeps it aligned
        if (performance.now() - start > HARD_STOP_MS) return; // give up → centered
        raf = requestAnimationFrame(tick);
      };
      tick();
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(startTimeout);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, ci, si]);

  // Keep the spotlight aligned on resize/scroll.
  useEffect(() => {
    if (!open || view !== "player" || !step?.target) return;
    let cancelled = false;
    const target = step.target;
    const update = async () => {
      const found = await findTarget(target, 200);
      if (!cancelled) setRect(found);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, ci, si]);

  // Mark a chapter complete once its last step is reached.
  useEffect(() => {
    if (view !== "player") return;
    const chap = tourChapters[ci];
    if (!chap) return;
    if (si === chap.steps.length - 1 && !done.has(chap.id)) {
      setDone((prev) => {
        const next = new Set(prev);
        next.add(chap.id);
        try {
          localStorage.setItem(DONE_KEY, JSON.stringify([...next]));
        } catch {
          /* no-op */
        }
        return next;
      });
    }
  }, [view, ci, si, done]);

  // Narration + auto-advance engine.
  useEffect(() => {
    clearTimer();
    stop();
    if (!open || view !== "player" || !playing || !step) return;

    const advance = () => {
      const n = nextPos(ci, si);
      if (n) {
        setCi(n.c);
        setSi(n.s);
      } else {
        setPlaying(false);
      }
    };

    const stepKey = `${tourChapters[ci]?.id ?? ""}-${si}`;

    // Small delay so narration starts after the screen navigates in.
    const startDelay = setTimeout(() => {
      if (!muted) {
        play(stepKey, `${step.title}. ${step.body}`, {
          onEnd: advance,
          onError: () => {
            timerRef.current = setTimeout(advance, estimateMs(step.body));
          },
        });
      } else {
        timerRef.current = setTimeout(advance, estimateMs(step.body));
      }
    }, 420);

    return () => {
      clearTimeout(startDelay);
      clearTimer();
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, ci, si, playing, muted, supported]);

  // Reset when closed.
  useEffect(() => {
    if (!open) {
      clearTimer();
      stop();
      setPlaying(false);
      setView("menu");
      setRect(null);
    }
  }, [open, stop, clearTimer]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const startTour = () => {
    prime();
    setCi(0);
    setSi(0);
    setView("player");
    setPlaying(true);
  };

  const openChapter = (index: number) => {
    prime();
    setCi(index);
    setSi(0);
    setView("player");
    setPlaying(true);
  };

  const togglePlay = () => {
    if (!playing) prime();
    setPlaying((p) => !p);
  };

  const goNext = () => {
    prime();
    const n = nextPos(ci, si);
    if (n) {
      setCi(n.c);
      setSi(n.s);
    }
  };

  const goPrev = () => {
    prime();
    const p = prevPos(ci, si);
    if (p) {
      setCi(p.c);
      setSi(p.s);
    }
  };

  if (!open) return null;

  const isFirst = ci === 0 && si === 0;
  const isLast = !nextPos(ci, si);

  // ---- Lesson menu ----
  if (view === "menu") {
    return (
      <div className="fixed inset-0 z-[90] bg-[var(--paper)]/95 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
        <div className="w-full max-w-2xl max-h-[88vh] flex flex-col bg-card rounded-2xl border border-border shadow-[0_30px_80px_rgba(23,24,28,0.28)] overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full grid place-items-center bg-[var(--ink)]">
                <GraduationCap className="w-6 h-6 text-[var(--gold-light)]" strokeWidth={2} />
              </div>
              <div>
                <div className="font-display font-bold text-xl leading-none">HALO Academy</div>
                <div className="text-[13px] text-muted-foreground mt-1">Visual guided training</div>
              </div>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close training"
              className="w-9 h-9 rounded-full grid place-items-center bg-[var(--paper)] border border-border hover:bg-black/5 transition-colors"
            >
              <X className="w-[18px] h-[18px]" strokeWidth={2} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              A friendly voice walks a new hire through HALO, screen by screen — opening each real page
              and pointing out the exact buttons as it goes. Play the full tour or jump to any lesson.
            </p>

            <button
              onClick={startTour}
              className="w-full flex items-center gap-3 rounded-2xl bg-[var(--ink)] text-white p-4 shadow-[0_10px_30px_rgba(23,24,28,0.22)] hover:opacity-95 transition-opacity mb-5"
            >
              <div className="w-11 h-11 rounded-full grid place-items-center bg-[var(--gold)] shrink-0">
                <Play className="w-5 h-5 text-[var(--ink)] ml-0.5" fill="currentColor" strokeWidth={0} />
              </div>
              <div className="flex-1 text-left">
                <div className="font-display font-bold text-base">Play the full walkthrough</div>
                <div className="text-[13px] text-white/70 mt-0.5">
                  {tourChapters.length} lessons · about {totalMinutes} min
                </div>
              </div>
            </button>

            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.06em]">
                Lessons
              </div>
              <div className="text-xs text-muted-foreground">
                {done.size} of {tourChapters.length} done
              </div>
            </div>

            {!supported && (
              <div className="rounded-xl border border-border bg-[var(--paper)] p-3 text-[13px] text-muted-foreground mb-3 leading-relaxed">
                Voice narration isn't available on this browser, but the tour still opens each screen
                and shows you every step in text.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {tourChapters.map((chap, idx) => {
                const Icon = ICONS[chap.icon] ?? Sparkles;
                const isDone = done.has(chap.id);
                return (
                  <button
                    key={chap.id}
                    onClick={() => openChapter(idx)}
                    className="flex items-center gap-3 bg-[var(--paper)] border border-border rounded-xl p-3 hover:border-[var(--gold)]/40 hover:bg-[var(--gold-tint)]/40 transition-colors text-left"
                  >
                    <div className="relative w-10 h-10 rounded-full grid place-items-center bg-card border border-border shrink-0">
                      <Icon className="w-[19px] h-[19px] text-[var(--gold-dark)]" strokeWidth={1.9} />
                      {isDone && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-[17px] h-[17px] rounded-full grid place-items-center bg-[var(--gold)] border-2 border-[var(--paper)]">
                          <Check className="w-[9px] h-[9px] text-[var(--ink)]" strokeWidth={3.5} />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm leading-tight">{chap.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{chap.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Player (spotlight over the live app) ----
  const pos = calloutPosition(rect, step?.placement);
  const Icon = ICONS[chapter?.icon ?? ""] ?? Sparkles;

  return (
    <div className="fixed inset-0 z-[90] pointer-events-none">
      {/* Dim + spotlight cutout */}
      {rect && step?.placement !== "center" ? (
        <div
          className="absolute rounded-xl pointer-events-none transition-all duration-300 ease-out"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(17,18,20,0.62)",
            outline: "3px solid var(--gold)",
            outlineOffset: "2px",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(17,18,20,0.62)] pointer-events-none" />
      )}

      {/* Callout card */}
      <div
        className="absolute w-[380px] pointer-events-auto animate-in fade-in zoom-in-95 duration-200"
        style={{ top: pos.top, left: pos.left }}
      >
        <div className="relative bg-card rounded-2xl border border-border shadow-[0_24px_60px_rgba(23,24,28,0.4)] overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
            <div className="relative w-9 h-9 rounded-full grid place-items-center bg-[var(--ink)] shrink-0">
              {speaking && !muted && (
                <span className="absolute inset-0 rounded-full bg-[var(--gold)] opacity-30 animate-ping" />
              )}
              <Icon className="relative w-[18px] h-[18px] text-[var(--gold-light)]" strokeWidth={1.9} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10.5px] font-semibold text-[var(--gold-dark)] uppercase tracking-[0.08em]">
                Lesson {ci + 1} of {tourChapters.length} · {chapter?.title}
              </div>
            </div>
            <button
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Unmute narration" : "Mute narration"}
              className="w-8 h-8 rounded-full grid place-items-center bg-[var(--paper)] border border-border hover:bg-black/5 transition-colors shrink-0"
            >
              {muted || !supported ? (
                <VolumeX className="w-4 h-4 text-muted-foreground" strokeWidth={2} />
              ) : (
                <Volume2 className="w-4 h-4 text-[var(--gold-dark)]" strokeWidth={2} />
              )}
            </button>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close training"
              className="w-8 h-8 rounded-full grid place-items-center bg-[var(--paper)] border border-border hover:bg-black/5 transition-colors shrink-0"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-1 px-4 pb-3">
            {chapter?.steps.map((_, idx) => (
              <div
                key={idx}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  idx < si ? "bg-[var(--gold)]" : idx === si ? "bg-[var(--ink)]" : "bg-[rgba(23,24,28,0.12)]"
                }`}
              />
            ))}
          </div>

          {/* Body */}
          <div className="px-4 pb-4">
            <h2 className="font-display font-bold text-lg leading-tight mb-1.5">{step?.title}</h2>
            <p className="text-[14px] text-[var(--ink)]/80 leading-relaxed">{step?.body}</p>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border bg-[var(--paper)]">
            <button
              onClick={() => {
                stop();
                clearTimer();
                setPlaying(false);
                setView("menu");
              }}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-[var(--ink)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Lessons
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={goPrev}
                disabled={isFirst}
                aria-label="Previous step"
                className="w-9 h-9 rounded-full grid place-items-center bg-card border border-border hover:bg-black/5 transition-colors disabled:opacity-35"
              >
                <SkipBack className="w-4 h-4" strokeWidth={2} fill="currentColor" />
              </button>
              <button
                onClick={togglePlay}
                aria-label={playing ? "Pause" : "Play"}
                className="w-11 h-11 rounded-full grid place-items-center bg-[var(--gold)] shadow-[0_6px_18px_rgba(185,138,47,0.4)] hover:bg-[var(--gold-dark)] transition-colors"
              >
                {playing ? (
                  <Pause className="w-5 h-5 text-white" strokeWidth={0} fill="currentColor" />
                ) : (
                  <Play className="w-5 h-5 text-white ml-0.5" strokeWidth={0} fill="currentColor" />
                )}
              </button>
              <button
                onClick={goNext}
                disabled={isLast}
                aria-label="Next step"
                className="w-9 h-9 rounded-full grid place-items-center bg-card border border-border hover:bg-black/5 transition-colors disabled:opacity-35"
              >
                <SkipForward className="w-4 h-4" strokeWidth={2} fill="currentColor" />
              </button>
            </div>
          </div>

          {isLast && !playing && (
            <div className="text-center text-xs text-muted-foreground px-4 pb-3">
              You've reached the end. Use the arrows to review, or close to finish.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
