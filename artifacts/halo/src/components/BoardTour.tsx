import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play, X, ChevronLeft, ChevronRight } from "lucide-react";

// Voice-guided tour for the client board. Narration is pre-rendered ElevenLabs
// audio; if a clip is missing or playback is blocked, we fall back to the
// browser's SpeechSynthesis, then to a reading timer — same chain as the
// desktop tour, guarded by a generation nonce so stale audio can't advance
// a step the user already left.

const clipFiles = import.meta.glob("../assets/board-tour/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function clipFor(index: number): string | null {
  const hit = Object.entries(clipFiles).find(([p]) => p.endsWith(`/step-${index}.mp3`));
  return hit ? hit[1] : null;
}

export type BoardTourStep = {
  title: string;
  body: string;
  /** data-tour attribute value to highlight, or null to center on the page. */
  target: string | null;
};

export const BOARD_TOUR_STEPS: BoardTourStep[] = [
  {
    title: "Welcome to your board",
    body: "Everything we send you — invoices, payment links, job recaps, and live crew trackers — lands here automatically as a card. Nothing to set up, nothing to chase.",
    target: null,
  },
  {
    title: "New cards arrive here",
    body: "New cards arrive in the From Archangel column. Each one tells you what it is, what it's about, and what — if anything — we need from you.",
    target: "column-inbox",
  },
  {
    title: "Everything is attached",
    body: "Every card comes prepopulated. Pay links, invoice PDFs, recaps, and live trackers are attached right on the card — one tap and you're there.",
    target: "column-inbox",
  },
  {
    title: "Work it like Trello",
    body: "Tap Accept to move a card to your to-do list, Start when you're on it, and Mark done when it's finished. Invoice and payment cards even complete themselves the moment payment clears.",
    target: "column-todo",
  },
  {
    title: "Watch jobs live",
    body: "When we share a live job tracker, its card opens a live page with GPS check-ins on a real map, crew photos, and work notes — all updating in real time while the crew is on site.",
    target: null,
  },
  {
    title: "Connect your own board",
    body: "Already run your own board? Tap Connect your board and paste a webhook from Trello, Slack, or Zapier. From then on, every card we raise is pushed to your system automatically. That's it — your board runs itself.",
    target: "button-webhook",
  },
];

export function BoardTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const genRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spot, setSpot] = useState<DOMRect | null>(null);

  const stop = useCallback(() => {
    genRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const advance = useCallback(
    (dir: 1 | -1) => {
      stop();
      setStep((s) => {
        const n = s + dir;
        if (n >= BOARD_TOUR_STEPS.length) {
          onClose();
          return s;
        }
        return Math.max(0, n);
      });
      setPlaying(true);
    },
    [onClose, stop],
  );

  // Highlight geometry.
  useEffect(() => {
    const target = BOARD_TOUR_STEPS[step]?.target;
    const el = target ? document.querySelector(`[data-testid="${target}"]`) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const update = () => setSpot(el ? el.getBoundingClientRect() : null);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  // Narration with fallback chain and nonce guard.
  useEffect(() => {
    if (!playing) {
      stop();
      return;
    }
    genRef.current += 1;
    const gen = genRef.current;
    const s = BOARD_TOUR_STEPS[step];
    const finish = () => {
      if (genRef.current === gen) advance(1);
    };
    const speakFallback = () => {
      if (genRef.current !== gen) return;
      const synth = window.speechSynthesis;
      if (synth) {
        const u = new SpeechSynthesisUtterance(`${s.title}. ${s.body}`);
        u.rate = 0.98;
        u.onend = () => {
          if (genRef.current === gen) finish();
        };
        u.onerror = () => {
          if (genRef.current === gen) startTimer();
        };
        synth.cancel();
        synth.speak(u);
      } else {
        startTimer();
      }
    };
    const startTimer = () => {
      const ms = Math.max(4500, (s.title.length + s.body.length) * 55);
      timerRef.current = setTimeout(finish, ms);
    };
    const url = clipFor(step);
    if (url) {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = finish;
      audio.onerror = speakFallback;
      audio.play().catch(speakFallback);
    } else {
      speakFallback();
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, playing]);

  // Dialog semantics: ESC closes, focus moves in on open and restores on close.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stop();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose, stop]);

  const s = BOARD_TOUR_STEPS[step];

  return (
    <div className="fixed inset-0 z-[80]" data-testid="board-tour">
      {/* Dim everything except the highlighted target. */}
      <div
        className="absolute inset-0 transition-all duration-300"
        style={
          spot
            ? {
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                borderRadius: 16,
                left: spot.left - 8,
                top: spot.top - 8,
                width: spot.width + 16,
                height: spot.height + 16,
                position: "absolute",
                pointerEvents: "none",
              }
            : { background: "rgba(0,0,0,0.55)", pointerEvents: "none" }
        }
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Guided tour — ${s.title}`}
        tabIndex={-1}
        className="absolute left-1/2 -translate-x-1/2 bottom-6 w-[min(480px,calc(100vw-24px))] rounded-2xl bg-white shadow-2xl border border-neutral-200 p-4 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-neutral-400">
            <Headphones className="h-3.5 w-3.5 text-[#7CB518]" />
            Guided tour · {step + 1} / {BOARD_TOUR_STEPS.length}
          </div>
          <button onClick={() => { stop(); onClose(); }} data-testid="button-tour-close" className="text-neutral-400 hover:text-neutral-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 text-base font-bold">{s.title}</div>
        <div className="mt-1 text-sm text-neutral-600 leading-relaxed">{s.body}</div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="h-9 w-9 grid place-items-center rounded-full bg-black text-white"
            data-testid="button-tour-play"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => advance(-1)}
            disabled={step === 0}
            className="h-9 px-3 rounded-full border border-neutral-200 text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1"
            data-testid="button-tour-back"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <button
            onClick={() => advance(1)}
            className="h-9 px-3 rounded-full bg-[#B4FF44] text-black text-sm font-bold inline-flex items-center gap-1"
            data-testid="button-tour-next"
          >
            {step === BOARD_TOUR_STEPS.length - 1 ? "Finish" : "Next"} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
