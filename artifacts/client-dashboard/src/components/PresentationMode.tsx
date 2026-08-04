import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Pause, Play, X, ChevronLeft, ChevronRight } from "lucide-react";
import { OfficeBoardPanel } from "./OfficeBoardPanel";

// Presentation Mode: an investor-grade, narrated INTERACTIVE SIMULCAST that
// walks the entire work lifecycle across BOTH boards — the live client board
// (behind the overlay) and the picture-in-picture "Office Board — live" panel.
// The UI actually opens cards and clicks buttons as the narrator speaks.
//
// Narration chain (kept from the original): pre-rendered ElevenLabs MP3 →
// SpeechSynthesis → reading timer, guarded by a generation nonce.
//
// Each step may carry:
//  - target: a data-testid to spotlight (string OR a resolver function that
//    returns a testid given a card getter — for dynamic testids like
//    rail-tile-<cardKey>).
//  - serverStep: a name from the demo server contract, fired ~2s in, exactly
//    once, through POST /api/presentation/demo/step (best-effort, try/catch).
//  - uiScript: an async choreography run after the server step — it dispatches
//    REAL clicks on data-testid elements with human-ish delays, awaiting
//    elements via waitFor(); it never hangs and skips gracefully so narration
//    always continues. All async work is guarded by the generation nonce.

const clipFiles = import.meta.glob("../assets/presentation/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function clipFor(index: number): string | null {
  const hit = Object.entries(clipFiles).find(([p]) => p.endsWith(`/step-${index}.mp3`));
  return hit ? hit[1] : null;
}

/** Get all board cards at call time (live). */
export type CardGetter = () => any[];

/** Context handed to resolvers / uiScripts. */
export type StepCtx = {
  getCards: CardGetter;
  /** True while this step is still the active generation. */
  alive: () => boolean;
  /** Fire the demo server step by name (best-effort). */
  server: (name: string) => Promise<void>;
  /** Open a card in the client detail dialog by cardKey (via board.tsx). */
  openCard: (cardKey: string) => void;
  /** Close any open card detail dialog. */
  closeCard: () => void;
  /** Open the Request Work wizard directly (bypasses the button's auth gate). */
  openRequest: () => void;
  /** Close the Request Work wizard. */
  closeRequest: () => void;
  /** Direct client card-action POST fallback (e.g. pay_method). */
  cardAction: (cardKey: string, data: Record<string, unknown>) => Promise<void>;
};

export type PresentationStep = {
  title: string;
  body: string;
  /** data-testid to spotlight, a resolver, or null to center. */
  target: string | ((ctx: StepCtx) => string | null) | null;
  /** Server-truth step fired ~2s in, once. */
  serverStep?: string;
  /** Async choreography run after the server step. */
  uiScript?: (ctx: StepCtx) => Promise<void>;
};

// --------------------------------------------------------------------------
// Small DOM helpers (all no-throw, all bounded — never hang the narration).
// --------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolve a data-testid element, polling up to timeoutMs. Null if never seen. */
async function waitFor(testid: string, timeoutMs = 4000): Promise<HTMLElement | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    if (el) return el;
    await sleep(120);
  }
  return null;
}

/** Click a testid element if present within timeout; returns true if clicked. */
async function clickTestid(testid: string, timeoutMs = 4000): Promise<boolean> {
  const el = await waitFor(testid, timeoutMs);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  await sleep(200);
  el.click();
  return true;
}

/** Select a native <select data-testid="select-request-service"> option by fuzzy text. */
async function selectServiceByText(needles: string[]): Promise<boolean> {
  const sel = (await waitFor("select-request-service", 2500)) as HTMLSelectElement | null;
  if (!sel) return false;
  const opt = Array.from(sel.options).find((o) => {
    const t = o.textContent?.toLowerCase() ?? "";
    return needles.some((n) => t.includes(n));
  });
  if (!opt) return false;
  sel.value = opt.value;
  // React listens on the native change event via its synthetic system.
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/** Pick Unit 204 in the wizard — a roster chip if present, else type it in. */
async function pickUnit204(): Promise<void> {
  const chip = document.querySelector<HTMLElement>('[data-testid="unit-chip-204"]');
  if (chip) {
    chip.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(150);
    chip.click();
    return;
  }
  // No roster chip — reveal the "add a new unit" field and type 204.
  const clickedNew = await clickTestid("button-new-unit", 1200);
  if (clickedNew) {
    const input = (await waitFor("input-new-unit", 1500)) as HTMLInputElement | null;
    if (input) {
      setNativeInputValue(input, "204");
      await sleep(150);
      await clickTestid("button-add-new-unit", 1200);
      return;
    }
  }
  // Fallback: the plain typed-unit input (no roster available).
  const plain = document.querySelector<HTMLInputElement>('[data-testid="input-request-unit"]');
  if (plain) {
    setNativeInputValue(plain, "204");
    plain.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }
}

/**
 * If a sign-in dialog popped (guest tried a gated action), close it so no
 * orphan dialog is left over the presentation. Best-effort, never throws.
 */
async function dismissLoginDialog(): Promise<void> {
  const loginMarker = document.querySelector('[data-testid="link-login-team"]');
  if (!loginMarker) return;
  // Escape closes the Radix dialog; retry once.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(250);
  if (document.querySelector('[data-testid="link-login-team"]')) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(250);
  }
}

/** Set a controlled input's value so React's onChange fires (native setter + input event). */
function setNativeInputValue(input: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The card module's discriminator is `module.type` (photos|tracker|summary|flags|invoice…). */
function moduleType(c: any): string {
  return String(c?.module?.type ?? "").toLowerCase();
}
function titleOf(c: any): string {
  return String(c?.title ?? "").toLowerCase();
}

/** Find the lifecycle "Make Ready" / Unit 204 job card. */
function findJobCard(getCards: CardGetter): any | null {
  const cards = getCards() || [];
  const isJob = (c: any) => String(c?.cardKey ?? "").startsWith("job:");
  // Prefer the make-ready job explicitly, then any 204 job card.
  return (
    cards.find((c: any) => isJob(c) && titleOf(c).includes("make ready")) ??
    cards.find((c: any) => isJob(c) && titleOf(c).includes("204")) ??
    cards.find((c: any) => isJob(c) && String(c?.unitNo ?? c?.module?.unitNo ?? "") === "204") ??
    null
  );
}

/** Find the lifecycle tracker card (Unit 204 make ready). */
function findTrackerCard(getCards: CardGetter): any | null {
  const cards = getCards() || [];
  return (
    cards.find((c: any) => moduleType(c) === "tracker" && titleOf(c).includes("make ready")) ??
    cards.find((c: any) => moduleType(c) === "tracker" && titleOf(c).includes("204")) ??
    cards.find((c: any) => moduleType(c) === "tracker") ??
    null
  );
}

/** Find the lifecycle before/after photos card (Unit 204 make ready). */
function findPhotosCard(getCards: CardGetter): any | null {
  const cards = getCards() || [];
  return (
    cards.find((c: any) => moduleType(c) === "photos" && titleOf(c).includes("make ready")) ??
    cards.find((c: any) => moduleType(c) === "photos" && titleOf(c).includes("204")) ??
    cards.find((c: any) => moduleType(c) === "photos") ??
    null
  );
}

/** Find the summary card (Unit 204 make ready). */
function findSummaryCard(getCards: CardGetter): any | null {
  const cards = getCards() || [];
  return (
    cards.find((c: any) => moduleType(c) === "summary" && titleOf(c).includes("204")) ??
    cards.find((c: any) => moduleType(c) === "summary") ??
    null
  );
}

/** Find the flags ("out of scope") card. */
function findFlagsCard(getCards: CardGetter): any | null {
  const cards = getCards() || [];
  return (
    cards.find((c: any) => moduleType(c) === "flags") ??
    cards.find((c: any) => titleOf(c).includes("flag")) ??
    null
  );
}

/** Find the lifecycle invoice card — prefer the PO-2044 / Unit 204 make-ready invoice. */
function findInvoiceCard(getCards: CardGetter): any | null {
  const cards = getCards() || [];
  const invoices = cards.filter((c: any) => moduleType(c) === "invoice");
  return (
    invoices.find((c: any) => String(c?.module?.poNumber ?? "") === "PO-2044") ??
    invoices.find((c: any) =>
      (c?.module?.lineItems ?? []).some((li: any) => String(li?.unitNo ?? "") === "204"),
    ) ??
    invoices.find((c: any) => c?.module?.canApprove) ??
    invoices[0] ??
    null
  );
}

// --------------------------------------------------------------------------
// The lifecycle story.
// NOTE: `title:` at line start is counted by check-demo-narration.ts — every
// step has exactly one, and there are no other line-start `title:` keys inside
// this array literal. Step count MUST equal the number of step-N.mp3 files.
// --------------------------------------------------------------------------

export const PRESENTATION_STEPS: PresentationStep[] = [
  {
    title: "Two boards, one job",
    body: "Welcome to HALO. What you're watching is live — the client's board fills the screen, and up in the corner is the office's board, the exact same job seen from the other side. Every move you're about to see happens on real software, in real time, on both boards at once. Let's run one job end to end.",
    target: null,
  },
  {
    title: "Color tells you everything",
    body: "The board reads left to right, and every card is color-coded by type. Lime means money or anything that needs you — approvals and invoices. Blue means work in motion — crews, schedules, jobs on site. One glance across the room and you know exactly where your attention is owed.",
    target: "rail-requested",
  },
  {
    title: "Requesting the work",
    body: "It starts with a request. We open the request form, choose Unit 204, and pick Make Ready from the price book. Watch the line items populate straight from your negotiated rates — no guessing, no back-and-forth. We send it, and the card lands in Requested on PO 2044.",
    target: "button-rails-request",
    serverStep: "request_created",
    uiScript: async (ctx) => {
      // Open the wizard DIRECTLY (the button is auth-gated and would show the
      // login dialog for a guest viewer). Then visibly walk it and close
      // WITHOUT submitting — the serverStep is the canonical source of truth.
      ctx.openRequest();
      const shown = await waitFor("wizard-step-what", 3500);
      if (shown && ctx.alive()) {
        // Choose the "Make Ready" service so the price-book line items appear.
        await selectServiceByText(["make ready", "make-ready", "makeready"]);
        await sleep(700);
        if (!ctx.alive()) { ctx.closeRequest(); return; }
        // Pick Unit 204 — a roster chip if present, else type it in.
        await pickUnit204();
        await sleep(1500); // "choose Unit 204 / Make Ready"
        if (!ctx.alive()) { ctx.closeRequest(); return; }
        await clickTestid("wizard-next", 2000);
        await waitFor("wizard-step-when", 3000);
        await sleep(1600); // "price-book line items populate from your rates"
        if (!ctx.alive()) { ctx.closeRequest(); return; }
        await clickTestid("wizard-next", 2000);
        await waitFor("wizard-step-confirm", 3000);
        await sleep(1300);
      }
      // Close WITHOUT submitting.
      ctx.closeRequest();
      await sleep(500);
      if (!ctx.alive()) return;
      // Fire the canonical request AFTER the visual walkthrough — the card
      // then lands in Requested and the board refetches immediately.
      await ctx.server("request_created");
    },
  },
  {
    title: "It hits the office board",
    body: "The instant we sent that, it appeared on the office board — top right. There it is in the office inbox, glowing. No email, no phone call. The office already has the request, the unit, the PO, and the budget in front of them.",
    target: "office-board-panel",
  },
  {
    title: "The office approves",
    body: "The office reviews it and approves. Watch the card move on their board — approval turns a request into a real job. That single action fans out to everyone looking, on both sides, within a second.",
    target: "office-board-panel",
    serverStep: "office_accept",
  },
  {
    title: "Crew and schedule",
    body: "Now the job is scheduled and a crew is assigned for today. On the client board the card glides into In progress, carrying the schedule, the crew, and a summary of the work. And if anything changes, the client can raise a change order right here — one tap, fully documented.",
    target: (ctx) => {
      const card = findJobCard(ctx.getCards);
      return card ? `rail-tile-${card.cardKey}` : "rail-in_progress";
    },
    serverStep: "assign_schedule",
    uiScript: async (ctx) => {
      await ctx.server("assign_schedule");
      await sleep(2200); // let the card settle into In progress
      if (!ctx.alive()) return;
      const card = findJobCard(ctx.getCards);
      if (card) {
        const clicked = await clickTestid(`rail-tile-${card.cardKey}`, 3000);
        if (clicked) {
          await sleep(1800); // read the schedule + crew + summary
          if (!ctx.alive()) return;
          // Point out the change-order button.
          await waitFor("button-change-order", 1500);
          await sleep(1400);
          ctx.closeCard();
        }
      }
    },
  },
  {
    title: "Day of — live on site",
    body: "On the day of the work, a live tracker card appears with a map thumbnail — you can see the crew is checked in at the property, right now. We open it for a beat: this is where the work is happening, live, without a single phone call to the office.",
    target: (ctx) => {
      const t = findTrackerCard(ctx.getCards);
      return t ? `rail-tile-${t.cardKey}` : "rail-in_progress";
    },
    serverStep: "tracker_live",
    uiScript: async (ctx) => {
      await ctx.server("tracker_live");
      await sleep(2600); // let the tracker card land and the board refetch
      if (!ctx.alive()) return;
      const t = findTrackerCard(ctx.getCards);
      if (t) {
        const clicked = await clickTestid(`rail-tile-${t.cardKey}`, 3500);
        if (clicked) {
          await sleep(2600); // dwell on the live tracker detail
          if (!ctx.alive()) { ctx.closeCard(); return; }
          ctx.closeCard();
        }
      }
    },
  },
  {
    title: "Before and after",
    body: "As the crew works, they document it. Those photos land right on the board — the drywall damage before, the finished eggshell wall after. Proof of work, attached to the work itself, so the client never has to ask what they're paying for.",
    target: (ctx) => {
      const p = findPhotosCard(ctx.getCards);
      return p ? `rail-tile-${p.cardKey}` : "rail-in_progress";
    },
    serverStep: "photos",
    uiScript: async (ctx) => {
      await ctx.server("photos");
      await sleep(2600);
      if (!ctx.alive()) return;
      const p = findPhotosCard(ctx.getCards);
      if (p) {
        const clicked = await clickTestid(`rail-tile-${p.cardKey}`, 3500);
        if (clicked) {
          await sleep(2800); // dwell on the before/after gallery
          if (!ctx.alive()) { ctx.closeCard(); return; }
          ctx.closeCard();
        }
      }
    },
  },
  {
    title: "The summary — and two flags",
    body: "When the work wraps, a summary card posts the recap. And notice the two flagged discoveries — out-of-scope items the crew found on site. They're surfaced right here, so nothing shows up as a surprise line on the invoice. Transparency, built in.",
    target: (ctx) => {
      const s = findSummaryCard(ctx.getCards) ?? findFlagsCard(ctx.getCards);
      return s ? `rail-tile-${s.cardKey}` : "rail-in_progress";
    },
    serverStep: "summary_flags",
    uiScript: async (ctx) => {
      await ctx.server("summary_flags");
      await sleep(2600);
      if (!ctx.alive()) return;
      const s = findSummaryCard(ctx.getCards);
      if (s) {
        const clicked = await clickTestid(`rail-tile-${s.cardKey}`, 3500);
        if (clicked) {
          await sleep(2800); // dwell on the recap + the two flagged items
          if (!ctx.alive()) { ctx.closeCard(); return; }
          ctx.closeCard();
        }
      }
    },
  },
  {
    title: "The invoice arrives",
    body: "Now the invoice. It arrives on the board as a card — the amount, the PDF, the due date, all attached, all checked against the budget you approved. No portal, no login, no chasing paperwork through email.",
    target: (ctx) => {
      const card = findInvoiceCard(ctx.getCards);
      return card ? `rail-tile-${card.cardKey}` : "rail-needs_you";
    },
    serverStep: "invoice_sent",
  },
  {
    title: "Approve and pay",
    body: "Here's the part your accounting team will love. Open the invoice, approve it, and choose how to pay — we'll mail a check. Two taps, done. The books reconcile automatically behind the scenes.",
    target: (ctx) => {
      const card = findInvoiceCard(ctx.getCards);
      return card ? `rail-tile-${card.cardKey}` : "rail-needs_you";
    },
    uiScript: async (ctx) => {
      const card = findInvoiceCard(ctx.getCards);
      if (!card) return;
      const opened = await clickTestid(`rail-tile-${card.cardKey}`, 3500);
      if (!opened) return;
      await waitFor("invoice-approve-pay", 3000);
      await sleep(1000);
      if (!ctx.alive()) { ctx.closeCard(); return; }
      // Reveal the approve button so viewers see the real action affordance.
      const approveBtn = await waitFor("button-invoice-approve", 2000);
      approveBtn?.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(1200);
      if (!ctx.alive()) { ctx.closeCard(); return; }
      // Attempt the REAL approve → pay-by-check click path. The demo board is
      // viewed anonymously, so the mutation is blocked (a sign-in prompt would
      // appear); we detect that and dismiss it so no orphan dialog is left,
      // then continue — the office_receipt step is the canonical completion.
      approveBtn?.click();
      await sleep(1000);
      if (!ctx.alive()) { ctx.closeCard(); return; }
      await dismissLoginDialog();
      // If approval actually landed (authenticated future demo), pay by check.
      const payBtn = await waitFor("button-invoice-pay-check", 1500);
      if (payBtn) {
        payBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(800);
        payBtn.click();
        await sleep(800);
        await dismissLoginDialog();
        // Best-effort direct action too (no-op / 401 for a guest).
        try {
          await ctx.cardAction(card.cardKey, { action: "pay_method", method: "check" });
        } catch {
          /* narration continues regardless */
        }
      }
      await sleep(1200);
      if (!ctx.alive()) { ctx.closeCard(); return; }
      ctx.closeCard();
    },
  },
  {
    title: "The office gets the receipt",
    body: "And the loop closes. On the office board, a card drops into Done: check approved, Unit 204, issued Net 30. The office knows they've been paid the same instant the client acts. Nobody had to send a single message.",
    target: "office-board-panel",
    serverStep: "office_receipt",
  },
  {
    title: "Both boards, one truth",
    body: "Step back and look at both boards together. One job — requested, approved, scheduled, worked, documented, invoiced, and paid — and both sides watched the exact same truth unfold, live, from opposite ends. That is HALO.",
    target: null,
  },
  {
    title: "Run it again",
    body: "That's the whole lifecycle, start to finish, on live software — no refresh, no email chain, no lost paperwork. Close this to return to the board, or replay it any time from the presentation link. Welcome aboard.",
    target: null,
  },
];

export function PresentationMode({
  onClose,
  token,
  getCards,
  onOpenCard,
  onCloseCard,
  onServerStep,
  onOpenRequest,
  onCloseRequest,
}: {
  onClose: () => void;
  /** The board token — must equal the demo dashboardToken for server steps to fire. */
  token: string;
  /** Live getter for the current board cards. */
  getCards: CardGetter;
  /** Open the client card detail dialog by cardKey. */
  onOpenCard?: (cardKey: string) => void;
  /** Close the client card detail dialog. */
  onCloseCard?: () => void;
  /** Called after each successful server step so the board can refetch now. */
  onServerStep?: () => void;
  /** Open the Request Work wizard directly (bypasses the button's auth gate). */
  onOpenRequest?: () => void;
  /** Close the Request Work wizard. */
  onCloseRequest?: () => void;
}) {
  const [step, setStep] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const getCardsRef = useRef(getCards);
  getCardsRef.current = getCards;
  const onOpenCardRef = useRef(onOpenCard);
  onOpenCardRef.current = onOpenCard;
  const onCloseCardRef = useRef(onCloseCard);
  onCloseCardRef.current = onCloseCard;
  const onOpenRequestRef = useRef(onOpenRequest);
  onOpenRequestRef.current = onOpenRequest;
  const onCloseRequestRef = useRef(onCloseRequest);
  onCloseRequestRef.current = onCloseRequest;

  const [playing, setPlaying] = useState(true);
  const genRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spot, setSpot] = useState<DOMRect | null>(null);
  const firedSteps = useRef(new Set<number>());
  // Demo-token match guard: only fire server steps when the demo dashboardToken
  // equals this board's token. Cached once per mount.
  const demoTokenOk = useRef<boolean | null>(null);
  const demoTokenPromise = useRef<Promise<boolean> | null>(null);

  const ensureDemoToken = useCallback(async (): Promise<boolean> => {
    if (demoTokenOk.current !== null) return demoTokenOk.current;
    if (!demoTokenPromise.current) {
      demoTokenPromise.current = (async () => {
        try {
          const state = await fetch(
            `/api/presentation/demo?token=${encodeURIComponent(token)}`,
          ).then((r) => r.json());
          const ok = !!state?.active && !!state?.matches;
          demoTokenOk.current = ok;
          return ok;
        } catch {
          demoTokenOk.current = false;
          return false;
        }
      })();
    }
    return demoTokenPromise.current;
  }, [token]);

  const onServerStepRef = useRef(onServerStep);
  onServerStepRef.current = onServerStep;

  const fireServerStep = useCallback(
    async (name: string) => {
      try {
        const ok = await ensureDemoToken();
        if (!ok) return;
        await fetch("/api/presentation/demo/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, step: name }),
        });
        // The client board query does NOT auto-refetch on a server-side change,
        // so the card the narrator just described would never appear. Force an
        // immediate refetch, then a couple of follow-ups to catch the async
        // projection settling — this is what makes the board visibly react.
        onServerStepRef.current?.();
        setTimeout(() => onServerStepRef.current?.(), 700);
        setTimeout(() => onServerStepRef.current?.(), 1600);
      } catch {
        // Narration always continues even if the server step fails.
      }
    },
    [ensureDemoToken, token],
  );

  const cardAction = useCallback(
    async (cardKey: string, data: Record<string, unknown>) => {
      await fetch(`/api/client/${token}/board/cards/${cardKey}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    [token],
  );

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

  // Build the choreography context for the current generation.
  const makeCtx = useCallback(
    (gen: number): StepCtx => ({
      getCards: () => getCardsRef.current(),
      alive: () => genRef.current === gen,
      server: (name: string) => fireServerStep(name),
      openCard: (cardKey: string) => onOpenCardRef.current?.(cardKey),
      closeCard: () => onCloseCardRef.current?.(),
      openRequest: () => onOpenRequestRef.current?.(),
      closeRequest: () => onCloseRequestRef.current?.(),
      cardAction,
    }),
    [cardAction, fireServerStep],
  );

  // Fire the step's serverStep + uiScript once, ~2s in so the narrator sets it
  // up first. If a step has a uiScript, the uiScript owns the serverStep call
  // (it decides ordering); otherwise we fire the bare serverStep here.
  useEffect(() => {
    const s = PRESENTATION_STEPS[step];
    if (!s || firedSteps.current.has(step)) return;
    firedSteps.current.add(step);
    const gen = genRef.current;
    const t = setTimeout(async () => {
      if (genRef.current !== gen) return;
      const ctx = makeCtx(gen);
      if (s.uiScript) {
        try {
          await s.uiScript(ctx);
        } catch {
          /* choreography is best-effort */
        }
      } else if (s.serverStep) {
        await fireServerStep(s.serverStep);
      }
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Resolve the step's spotlight target (string or resolver).
  const resolveTarget = useCallback(
    (s: PresentationStep | undefined): string | null => {
      if (!s) return null;
      if (typeof s.target === "function") {
        try {
          return s.target(makeCtx(genRef.current));
        } catch {
          return null;
        }
      }
      return s.target;
    },
    [makeCtx],
  );

  // Highlight geometry — re-resolves the target periodically because dynamic
  // testids (rail-tile-<cardKey>) may not exist until the server step lands.
  useEffect(() => {
    const s = PRESENTATION_STEPS[step];
    let raf = 0;
    const compute = () => {
      const target = resolveTarget(s);
      const el = target ? document.querySelector(`[data-testid="${target}"]`) : null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      setSpot((prev) => {
        const next = el ? el.getBoundingClientRect() : null;
        if (
          prev && next &&
          prev.top === next.top && prev.left === next.left &&
          prev.width === next.width && prev.height === next.height
        ) {
          return prev;
        }
        if (!prev && !next) return prev;
        return next;
      });
    };
    compute();
    // Re-resolve a few times so late-appearing cards get spotlighted.
    const reResolve = setInterval(compute, 700);
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearInterval(reResolve);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step, resolveTarget]);

  // Narration: MP3 → SpeechSynthesis → timer, nonce-guarded. Auto-advance is
  // delayed enough that the uiScript choreography can finish before we move on.
  useEffect(() => {
    if (!playing) {
      stop();
      return;
    }
    genRef.current += 1;
    const gen = genRef.current;
    const s = PRESENTATION_STEPS[step];
    // Give scripted steps a floor of dwell time so the choreography completes.
    const scriptFloorMs = s.uiScript ? 9000 : 0;
    const finish = () => {
      if (genRef.current === gen) advance(1);
    };
    const finishAfterFloor = (spentMs: number) => {
      const remain = Math.max(0, scriptFloorMs - spentMs);
      if (remain === 0) return finish();
      timerRef.current = setTimeout(() => {
        if (genRef.current === gen) finish();
      }, remain);
    };
    const startedAt = Date.now();
    const speakFallback = () => {
      if (genRef.current !== gen) return;
      const synth = window.speechSynthesis;
      if (synth) {
        const u = new SpeechSynthesisUtterance(`${s.title}. ${s.body}`);
        u.rate = 0.98;
        u.onend = () => {
          if (genRef.current === gen) finishAfterFloor(Date.now() - startedAt);
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
      const ms = Math.max(4500, (s.title.length + s.body.length) * 55, scriptFloorMs);
      timerRef.current = setTimeout(finish, ms);
    };
    const url = clipFor(step);
    if (url) {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => finishAfterFloor(Date.now() - startedAt);
      audio.onerror = speakFallback;
      audio.play().catch(speakFallback);
    } else {
      speakFallback();
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, playing]);

  // Dialog semantics + Escape close.
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

      {/* Picture-in-picture office board — shown only during presentation. */}
      <OfficeBoardPanel token={token} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Presentation — ${s.title}`}
        tabIndex={-1}
        className="absolute left-4 sm:left-6 bottom-6 w-[min(480px,calc(100vw-24px))] rounded-2xl bg-[#0B1428] text-white shadow-2xl border border-white/10 p-4 outline-none"
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
