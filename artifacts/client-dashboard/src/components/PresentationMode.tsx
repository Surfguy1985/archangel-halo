import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Pause, Play, X, ChevronLeft, ChevronRight } from "lucide-react";

// Presentation Mode: an investor-grade, narrated walkthrough of the live
// client board. Same narration chain as DashboardTour (pre-rendered
// ElevenLabs MP3 → SpeechSynthesis → reading timer, guarded by a generation
// nonce), plus per-step live actions — the board actually moves a card while
// the narrator explains it, driven through the office API so the audience
// watches the real SSE pipeline do its thing.

const clipFiles = import.meta.glob("../assets/presentation/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function clipFor(index: number): string | null {
  const hit = Object.entries(clipFiles).find(([p]) => p.endsWith(`/step-${index}.mp3`));
  return hit ? hit[1] : null;
}

export type PresentationStep = {
  title: string;
  body: string;
  /** data-testid to spotlight, or null to center. */
  target: string | null;
  /** Live action fired when the step starts. */
  action?: "move-demo-card-scheduled" | "move-demo-card-in-progress";
};

export const PRESENTATION_STEPS: PresentationStep[] = [
  {
    title: "Welcome to HALO",
    body: "This is HALO — the operations platform that gives property managers one live board for every job, crew, and dollar on their property. What you're looking at right now is a real, working dashboard — every card, invoice, and crew on this screen is live demo data. Let's walk through it.",
    target: null,
  },
  {
    title: "Your board is a story, left to right",
    body: "The board reads in five rails: Needs you, In progress, Requested, Done, and Paid. Anything waiting on the owner is always first on screen. New work starts in Requested, moves through In progress while crews are on site, then lands in Done and Paid. One glance tells you the state of your entire property.",
    target: "rail-requested",
  },
  {
    title: "Every card is a sealed waybill",
    body: "Each card carries a tracking code and a strip of six lights — like a package in transit. As real work happens, the lights turn on one by one: sealed, routed, delivered, opened, in review, settled. The cards are color-coded by service — blue for maintenance, orange for billing, green for leasing — so you can read the board from across the room.",
    target: "rail-requested",
  },
  {
    title: "Watch the board move — live",
    body: "Right now, our office is approving the courtyard landscaping job. Keep your eyes on the card... There it goes — from Requested to Scheduled, on its own, the moment the office acted. No refresh, no email chain. Every person looking at this board sees the same truth within a second.",
    target: "rail-in_progress",
    action: "move-demo-card-scheduled",
  },
  {
    title: "Cards move themselves",
    body: "And it works both ways. When the office schedules, reprioritizes, or marks work handled, the card slides to its new rail on its own — and when you approve or pay from a card, their board updates the same instant. Nothing to drag, nothing to refresh.",
    target: "rail-in_progress",
  },
  {
    title: "Pay invoices in two taps",
    body: "Here's the part your accounting team will love. When work is done, the invoice lands on the board as a card — with the PDF, the amount, the due date, and a live pay link all attached. Review it, tap pay, done. No portals, no logins, no lost paperwork. HALO's books reconcile automatically behind the scenes.",
    target: "rail-needs_you",
  },
  {
    title: "Communicate right on the work",
    body: "Every card is also a conversation. Open one and leave a comment — the office is notified instantly and answers in the same thread, attached to the exact job you're talking about. No more digging through email to find which unit that message was about.",
    target: "rail-in_progress",
  },
  {
    title: "See your crews live",
    body: "This card is a live window to your site. Marco's paint crew is checked in at Unit 204 right now — and the Map view shows every crew's position on a real map, updated as they check in and out. You always know who is on your property, and where.",
    target: "button-map-view",
  },
  {
    title: "Before and after, on every job",
    body: "Crews document their work as they go. Those photos land right on the board as a card — you can see the drywall damage and the finished eggshell wall without leaving your seat. Proof of work, attached to the work.",
    target: "lane-requested",
  },
  {
    title: "Units, Hub, and instant search",
    body: "The Units view gives you a health map of every unit on the property. The Hub holds your documents and guides. And command-K search finds any card, invoice, or job in a keystroke. Everything about your property, three taps away or less.",
    target: "button-site-map",
  },
  {
    title: "This board runs itself",
    body: "Everything you just saw happened on live software — cards raised automatically as work happened, invoices that carry their own pay links, crews on a live map, and a board that keeps every stakeholder looking at the same truth. That's HALO. Welcome aboard.",
    target: null,
  },
];

export function PresentationMode({
  onClose,
  onDemoAction,
}: {
  onClose: () => void;
  onDemoAction?: (action: NonNullable<PresentationStep["action"]>) => void;
}) {
  const [step, setStep] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onDemoActionRef = useRef(onDemoAction);
  onDemoActionRef.current = onDemoAction;
  const [playing, setPlaying] = useState(true);
  const genRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spot, setSpot] = useState<DOMRect | null>(null);
  const firedActions = useRef(new Set<number>());

  const stop = useCallback(() => {
    genRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const stepRef = useRef(step);
  stepRef.current = step;

  const advance = useCallback(
    (dir: 1 | -1) => {
      stop();
      const n = stepRef.current + dir;
      if (n >= PRESENTATION_STEPS.length) {
        onCloseRef.current();
        return;
      }
      setStep(Math.max(0, n));
      setPlaying(true);
    },
    [stop],
  );

  // Fire the step's live action once, ~2.5s in so the narrator sets it up first.
  useEffect(() => {
    const s = PRESENTATION_STEPS[step];
    if (!s?.action || firedActions.current.has(step)) return;
    firedActions.current.add(step);
    const t = setTimeout(() => onDemoActionRef.current?.(s.action!), 2500);
    return () => clearTimeout(t);
  }, [step]);

  // Highlight geometry (same no-op-skip pattern as DashboardTour).
  useEffect(() => {
    const target = PRESENTATION_STEPS[step]?.target;
    const el = target ? document.querySelector(`[data-testid="${target}"]`) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    const update = () =>
      setSpot((prev) => {
        const next = el ? el.getBoundingClientRect() : null;
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

  // Narration: MP3 → SpeechSynthesis → timer, nonce-guarded.
  useEffect(() => {
    if (!playing) {
      stop();
      return;
    }
    genRef.current += 1;
    const gen = genRef.current;
    const s = PRESENTATION_STEPS[step];
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

  // Dialog semantics.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = PRESENTATION_STEPS[step];

  return (
    <div className="fixed inset-0 z-[80]" data-testid="presentation-mode">
      <div
        className="absolute inset-0 transition-all duration-300"
        style={
          spot
            ? {
                boxShadow: "0 0 0 9999px rgba(4,10,26,0.62)",
                borderRadius: 16,
                left: spot.left - 8,
                top: spot.top - 8,
                width: spot.width + 16,
                height: spot.height + 16,
                position: "absolute",
                pointerEvents: "none",
                outline: "2px solid #B4FF44",
                outlineOffset: 2,
              }
            : { background: "rgba(4,10,26,0.62)", pointerEvents: "none" }
        }
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Presentation — ${s.title}`}
        tabIndex={-1}
        className="absolute left-1/2 -translate-x-1/2 bottom-6 w-[min(520px,calc(100vw-24px))] rounded-2xl bg-[#0B1428] text-white shadow-2xl border border-white/10 p-4 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-[#B4FF44]">
            <Sparkles className="h-3.5 w-3.5" />
            Presentation · {step + 1} / {PRESENTATION_STEPS.length}
          </div>
          <button
            onClick={() => { stop(); onClose(); }}
            data-testid="button-presentation-close"
            className="text-white/50 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 text-base font-bold">{s.title}</div>
        <div className="mt-1 text-sm text-white/70 leading-relaxed">{s.body}</div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="h-9 w-9 grid place-items-center rounded-full bg-[#B4FF44] text-black"
            data-testid="button-presentation-play"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => advance(-1)}
            disabled={step === 0}
            className="h-9 px-3 rounded-full border border-white/20 text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1"
            data-testid="button-presentation-back"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <button
            onClick={() => advance(1)}
            className="h-9 px-3 rounded-full bg-[#B4FF44] text-black text-sm font-bold inline-flex items-center gap-1"
            data-testid="button-presentation-next"
          >
            {step === PRESENTATION_STEPS.length - 1 ? "Finish" : "Next"} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
