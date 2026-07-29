import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play, X, ChevronLeft, ChevronRight } from "lucide-react";

// Voice-guided tour for the client dashboard board. Narration is pre-rendered
// ElevenLabs audio; if a clip is missing or playback is blocked, we fall back
// to the browser's SpeechSynthesis, then to a reading timer — same chain as
// the HALO desktop tour, guarded by a generation nonce so stale audio can't
// advance a step the user already left.

const clipFiles = import.meta.glob("../assets/dashboard-tour/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function clipFor(index: number): string | null {
  const hit = Object.entries(clipFiles).find(([p]) => p.endsWith(`/step-${index}.mp3`));
  return hit ? hit[1] : null;
}

export type DashboardTourStep = {
  title: string;
  body: string;
  /** data-testid attribute value to highlight, or null to center on the page. */
  target: string | null;
};

export const DASHBOARD_TOUR_STEPS: DashboardTourStep[] = [
  {
    title: "Welcome to your dashboard",
    body: "This is your live operations board. Every job, work request, and invoice for your property shows up here as a card — updated automatically by Archangel as work happens. Nothing to set up, nothing to chase.",
    target: null,
  },
  {
    title: "Work flows left to right",
    body: "The board reads like a story. New work requests and open jobs start in Requested, move to Scheduled once a crew is on the calendar, then In Progress while crews are on site, and finish in Done. Invoices live in the Billing column.",
    target: "lane-requested",
  },
  {
    title: "Cards update themselves",
    body: "When a crew checks in or a job wraps up, its card moves on its own — the Live badge up top means you're always looking at the current state. You can also drag your own cards between columns, just like Trello.",
    target: "lane-in_progress",
  },
  {
    title: "Tap a card for the full picture",
    body: "Every card opens into a detail view with descriptions, attachments, pay links, and actions. Invoice cards carry the PDF and a payment link right on them — one tap and you're there.",
    target: null,
  },
  {
    title: "Add your own cards",
    body: "Signed in? Use the plus button at the top of any column to add your own card — a reminder, a note for the crew, or work you want tracked. Guests can look around, but you'll need to sign in to make changes.",
    target: "lane-requested",
  },
  {
    title: "Maps, sign-in, and this tour",
    body: "Map View shows your units and live crew locations on a real map. Sign in from the top right to unlock editing. And if you ever want this walkthrough again, tap the headphones icon in the header. That's it — your board runs itself.",
    target: "button-map-view",
  },
];

export function DashboardTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  // Keep onClose behind a ref so parent re-renders (new inline closure each
  // time) can't retrigger mount-style effects — that caused a focus/scroll
  // update loop ("Maximum update depth exceeded") on mobile.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
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

  // Track the current step in a ref so advance() can decide "past the end →
  // close" OUTSIDE the setStep updater. Calling the parent's onClose inside
  // the updater triggers React's "cannot update a component while rendering
  // a different component" error.
  const stepRef = useRef(step);
  stepRef.current = step;

  const advance = useCallback(
    (dir: 1 | -1) => {
      stop();
      const n = stepRef.current + dir;
      if (n >= DASHBOARD_TOUR_STEPS.length) {
        onCloseRef.current();
        return;
      }
      setStep(Math.max(0, n));
      setPlaying(true);
    },
    [stop],
  );

  // Highlight geometry.
  useEffect(() => {
    const target = DASHBOARD_TOUR_STEPS[step]?.target;
    const el = target ? document.querySelector(`[data-testid="${target}"]`) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    const update = () =>
      setSpot((prev) => {
        const next = el ? el.getBoundingClientRect() : null;
        // Skip no-op updates — scroll/resize fire constantly on mobile and a
        // fresh DOMRect object every event forces endless re-renders.
        if (
          prev && next &&
          prev.top === next.top && prev.left === next.left &&
          prev.width === next.width && prev.height === next.height
        ) {
          return prev;
        }
        return next;
      });
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
    const s = DASHBOARD_TOUR_STEPS[step];
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
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
    // Mount-only: focus management must not rerun on parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = DASHBOARD_TOUR_STEPS[step];

  return (
    <div className="fixed inset-0 z-[80]" data-testid="dashboard-tour">
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
        className="absolute left-1/2 -translate-x-1/2 bottom-6 w-[min(480px,calc(100vw-24px))] rounded-2xl bg-card shadow-2xl border p-4 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-muted-foreground">
            <Headphones className="h-3.5 w-3.5 text-primary" />
            Guided tour · {step + 1} / {DASHBOARD_TOUR_STEPS.length}
          </div>
          <button onClick={() => { stop(); onClose(); }} data-testid="button-tour-close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 text-base font-bold text-foreground">{s.title}</div>
        <div className="mt-1 text-sm text-muted-foreground leading-relaxed">{s.body}</div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="h-9 w-9 grid place-items-center rounded-full bg-foreground text-background"
            data-testid="button-tour-play"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => advance(-1)}
            disabled={step === 0}
            className="h-9 px-3 rounded-full border text-sm font-medium text-foreground disabled:opacity-40 inline-flex items-center gap-1"
            data-testid="button-tour-back"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <button
            onClick={() => advance(1)}
            className="h-9 px-3 rounded-full bg-primary text-primary-foreground text-sm font-bold inline-flex items-center gap-1"
            data-testid="button-tour-next"
          >
            {step === DASHBOARD_TOUR_STEPS.length - 1 ? "Finish" : "Next"} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
