import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Mic,
  Sun,
  Building2,
  ClipboardList,
  CalendarDays,
  Receipt,
  Wallet,
  GitBranch,
  Users,
  ShieldCheck,
  Package,
  FileUp,
  BarChart3,
  BookOpen,
  Landmark,
  Link2,
  Settings as SettingsIcon,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  X,
  Volume2,
  VolumeX,
  Check,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import { trainingChapters } from "@/lib/trainingContent";
import { useSpeech } from "@/hooks/useSpeech";

const ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Mic,
  Sun,
  Building2,
  ClipboardList,
  CalendarDays,
  Receipt,
  Wallet,
  GitBranch,
  Users,
  ShieldCheck,
  Package,
  FileUp,
  BarChart3,
  BookOpen,
  Landmark,
  Link2,
  Settings: SettingsIcon,
};

const DONE_KEY = "halo_training_done";

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
  return Math.min(22000, Math.max(3200, ms));
}

export function TrainingCenter({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { supported, speaking, speak, cancel, prime } = useSpeech();
  const [view, setView] = useState<"menu" | "player">("menu");
  const [ci, setCi] = useState(0);
  const [si, setSi] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [done, setDone] = useState<Set<string>>(() => loadDone());

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const totalSteps = useMemo(
    () => trainingChapters.reduce((n, c) => n + c.steps.length, 0),
    [],
  );
  const totalMinutes = useMemo(() => {
    const words = trainingChapters
      .flatMap((c) => c.steps)
      .reduce((n, s) => n + (s.title + " " + s.body).split(/\s+/).length, 0);
    return Math.max(1, Math.round(words / 150));
  }, []);

  const nextPos = useCallback((c: number, s: number) => {
    const chap = trainingChapters[c];
    if (!chap) return null;
    if (s + 1 < chap.steps.length) return { c, s: s + 1 };
    if (c + 1 < trainingChapters.length) return { c: c + 1, s: 0 };
    return null;
  }, []);

  const prevPos = useCallback((c: number, s: number) => {
    if (s - 1 >= 0) return { c, s: s - 1 };
    if (c - 1 >= 0) return { c: c - 1, s: trainingChapters[c - 1].steps.length - 1 };
    return null;
  }, []);

  // Mark a chapter complete once its last step is reached.
  useEffect(() => {
    if (view !== "player") return;
    const chap = trainingChapters[ci];
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
    cancel();
    if (!open || view !== "player" || !playing) return;
    const step = trainingChapters[ci]?.steps[si];
    if (!step) return;

    const advance = () => {
      const n = nextPos(ci, si);
      if (n) {
        setCi(n.c);
        setSi(n.s);
      } else {
        setPlaying(false);
      }
    };

    if (!muted && supported) {
      speak(`${step.title}. ${step.body}`, {
        onEnd: advance,
        onError: () => {
          timerRef.current = setTimeout(advance, estimateMs(step.body));
        },
      });
    } else {
      timerRef.current = setTimeout(advance, estimateMs(step.body));
    }

    return () => {
      clearTimer();
      cancel();
    };
  }, [open, view, ci, si, playing, muted, supported, speak, cancel, nextPos, clearTimer]);

  // Stop everything when the overlay closes.
  useEffect(() => {
    if (!open) {
      clearTimer();
      cancel();
      setPlaying(false);
      setView("menu");
    }
  }, [open, cancel, clearTimer]);

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

  const chapter = trainingChapters[ci];
  const step = chapter?.steps[si];
  const isFirst = ci === 0 && si === 0;
  const isLast = !nextPos(ci, si);

  return (
    <div className="fixed inset-0 z-[80] bg-[var(--paper)] flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
      {view === "menu" ? (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-[18px] pt-[16px] pb-[10px] shrink-0">
            <div className="flex items-center gap-[10px]">
              <div className="w-[38px] h-[38px] rounded-full grid place-items-center bg-[var(--ink)]">
                <GraduationCap className="w-[20px] h-[20px] text-[var(--gold-light)]" strokeWidth={2} />
              </div>
              <div>
                <div className="font-display font-bold text-[18px] leading-none">HALO Academy</div>
                <div className="text-[12px] text-muted-foreground mt-[3px]">Guided training</div>
              </div>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close training"
              className="w-[36px] h-[36px] rounded-full grid place-items-center bg-card border border-border transition-transform active:scale-95"
            >
              <X className="w-[18px] h-[18px]" strokeWidth={2} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-[18px] pb-[30px]">
            <p className="text-[13.5px] text-muted-foreground leading-[1.55] mb-[16px]">
              A friendly voice walks you through every part of HALO, one feature at a time. Play the
              full tour or jump to any lesson.
            </p>

            {/* Full tour button */}
            <button
              onClick={startTour}
              className="w-full flex items-center gap-[13px] rounded-[16px] bg-[var(--ink)] text-white p-[16px] shadow-[0_10px_30px_rgba(23,24,28,0.22)] transition-transform active:scale-[0.99] mb-[8px]"
            >
              <div className="w-[42px] h-[42px] rounded-full grid place-items-center bg-[var(--gold)] shrink-0">
                <Play className="w-[19px] h-[19px] text-[var(--ink)] ml-[2px]" fill="currentColor" strokeWidth={0} />
              </div>
              <div className="flex-1 text-left">
                <div className="font-display font-bold text-[15.5px]">Play the full walkthrough</div>
                <div className="text-[12.5px] text-white/70 mt-[2px]">
                  {trainingChapters.length} lessons · about {totalMinutes} min
                </div>
              </div>
            </button>

            {/* Voice availability / progress */}
            <div className="flex items-center justify-between px-[2px] mt-[14px] mb-[10px]">
              <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
                Lessons
              </div>
              <div className="text-[12px] text-muted-foreground">
                {done.size} of {trainingChapters.length} done
              </div>
            </div>

            {!supported && (
              <div className="rounded-[12px] border border-border bg-card p-[12px] text-[12.5px] text-muted-foreground mb-[10px] leading-[1.5]">
                Voice narration isn't available on this browser, but you can still read each step and
                move through the tour.
              </div>
            )}

            {/* Chapter list */}
            <div className="flex flex-col gap-[9px]">
              {trainingChapters.map((chap, idx) => {
                const Icon = ICONS[chap.icon] ?? Sparkles;
                const isDone = done.has(chap.id);
                return (
                  <button
                    key={chap.id}
                    onClick={() => openChapter(idx)}
                    className="flex items-center gap-[13px] bg-card border border-border rounded-[14px] p-[12px_13px] shadow-[var(--shadow)] transition-transform active:scale-[0.98] text-left"
                  >
                    <div className="relative w-[40px] h-[40px] rounded-full grid place-items-center bg-[var(--paper)] border border-border shrink-0">
                      <Icon className="w-[19px] h-[19px] text-[var(--gold-dark)]" strokeWidth={1.9} />
                      {isDone && (
                        <div className="absolute -bottom-[3px] -right-[3px] w-[17px] h-[17px] rounded-full grid place-items-center bg-[var(--gold)] border-2 border-[var(--paper)]">
                          <Check className="w-[9px] h-[9px] text-[var(--ink)]" strokeWidth={3.5} />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-[14.5px] leading-tight">
                        {chap.title}
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-[2px] truncate">
                        {chap.sub}
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      {chap.steps.length} steps
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Player header */}
          <div className="flex items-center justify-between px-[14px] pt-[14px] pb-[8px] shrink-0">
            <button
              onClick={() => {
                cancel();
                clearTimer();
                setPlaying(false);
                setView("menu");
              }}
              aria-label="Back to lessons"
              className="w-[36px] h-[36px] rounded-full grid place-items-center bg-card border border-border transition-transform active:scale-95"
            >
              <ChevronLeft className="w-[19px] h-[19px]" strokeWidth={2} />
            </button>
            <div className="flex-1 px-[10px] min-w-0 text-center">
              <div className="text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
                Lesson {ci + 1} of {trainingChapters.length}
              </div>
              <div className="font-display font-bold text-[14px] truncate">{chapter?.title}</div>
            </div>
            <div className="flex items-center gap-[8px]">
              <button
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute narration" : "Mute narration"}
                className="w-[36px] h-[36px] rounded-full grid place-items-center bg-card border border-border transition-transform active:scale-95"
              >
                {muted || !supported ? (
                  <VolumeX className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={2} />
                ) : (
                  <Volume2 className="w-[18px] h-[18px] text-[var(--gold-dark)]" strokeWidth={2} />
                )}
              </button>
              <button
                onClick={() => onOpenChange(false)}
                aria-label="Close training"
                className="w-[36px] h-[36px] rounded-full grid place-items-center bg-card border border-border transition-transform active:scale-95"
              >
                <X className="w-[18px] h-[18px]" strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Step progress dots */}
          <div className="flex items-center gap-[5px] px-[20px] pt-[6px] pb-[4px] shrink-0">
            {chapter?.steps.map((_, idx) => (
              <div
                key={idx}
                className={`h-[3.5px] flex-1 rounded-full transition-colors ${
                  idx < si
                    ? "bg-[var(--gold)]"
                    : idx === si
                      ? "bg-[var(--ink)]"
                      : "bg-[rgba(23,24,28,0.12)]"
                }`}
              />
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-[24px] flex flex-col items-center justify-center text-center">
            {/* Halo ring */}
            <div className="relative w-[112px] h-[112px] grid place-items-center mb-[22px] shrink-0">
              {speaking && !muted && (
                <>
                  <span className="absolute inset-0 rounded-full bg-[var(--gold)] opacity-20 animate-ping" />
                  <span className="absolute inset-[10px] rounded-full bg-[var(--gold)] opacity-25 animate-pulse" />
                </>
              )}
              <div className="relative w-[86px] h-[86px] rounded-full grid place-items-center bg-[var(--ink)] shadow-[0_10px_30px_rgba(23,24,28,0.25)]">
                <div className="absolute -top-[7px] w-[52px] h-[16px] rounded-full border-[3px] border-[var(--gold)]" />
                {(() => {
                  const Icon = ICONS[chapter?.icon ?? ""] ?? Sparkles;
                  return <Icon className="w-[30px] h-[30px] text-[var(--gold-light)]" strokeWidth={1.8} />;
                })()}
              </div>
            </div>

            <div className="text-[11.5px] font-semibold text-[var(--gold-dark)] uppercase tracking-[0.08em] mb-[8px]">
              Step {si + 1} of {chapter?.steps.length}
            </div>
            <h2 className="font-display font-bold text-[21px] leading-[1.15] mb-[12px] max-w-[440px]">
              {step?.title}
            </h2>
            <p className="text-[15.5px] text-[var(--ink)]/80 leading-[1.6] max-w-[440px] pb-[20px]">
              {step?.body}
            </p>
          </div>

          {/* Controls */}
          <div className="shrink-0 px-[24px] pt-[10px] pb-[calc(24px+env(safe-area-inset-bottom))] border-t border-border bg-card">
            <div className="flex items-center justify-center gap-[26px] pt-[14px]">
              <button
                onClick={goPrev}
                disabled={isFirst}
                aria-label="Previous step"
                className="w-[52px] h-[52px] rounded-full grid place-items-center bg-[var(--paper)] border border-border transition-transform active:scale-95 disabled:opacity-35"
              >
                <SkipBack className="w-[20px] h-[20px]" strokeWidth={2} fill="currentColor" />
              </button>
              <button
                onClick={togglePlay}
                aria-label={playing ? "Pause" : "Play"}
                className="w-[68px] h-[68px] rounded-full grid place-items-center bg-[var(--gold)] shadow-[0_8px_24px_rgba(185,138,47,0.4)] transition-transform active:scale-95"
              >
                {playing ? (
                  <Pause className="w-[26px] h-[26px] text-[var(--ink)]" strokeWidth={0} fill="currentColor" />
                ) : (
                  <Play className="w-[26px] h-[26px] text-[var(--ink)] ml-[3px]" strokeWidth={0} fill="currentColor" />
                )}
              </button>
              <button
                onClick={goNext}
                disabled={isLast}
                aria-label="Next step"
                className="w-[52px] h-[52px] rounded-full grid place-items-center bg-[var(--paper)] border border-border transition-transform active:scale-95 disabled:opacity-35"
              >
                <SkipForward className="w-[20px] h-[20px]" strokeWidth={2} fill="currentColor" />
              </button>
            </div>
            {isLast && !playing && (
              <div className="text-center text-[12.5px] text-muted-foreground mt-[14px]">
                You've reached the end. Tap the arrows to review, or close to finish.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
