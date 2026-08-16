import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Send } from "lucide-react";
import { clipAsk, type AskCard } from "./askMedia";
import { inventGuard, reasonAsk, type AskCitation, type AskMemory, type AskStep } from "./askReason";
import { pulseStarters, type GuideAction, type GuideContext } from "./pulseGuideBrain";

type Turn = {
  role: "user" | "guide";
  text: string;
  cards?: AskCard[];
  why?: string[];
  citations?: AskCitation[];
  steps?: AskStep[];
  /** Set when the server ask didn't land — the answer below is the board's own read. */
  note?: string | null;
};

export function PulseGuide(props: {
  context: GuideContext;
  askUrl?: string | null;
  onAction: (action: GuideAction) => void;
  pendingAsk?: string | null;
  onPendingConsumed?: () => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<Turn[]>([]);
  const [followUps, setFollowUps] = useState<string[]>(() => pulseStarters(props.context));
  const [zoom, setZoom] = useState<{ src: string; title: string } | null>(null);
  const [liveSteps, setLiveSteps] = useState<AskStep[]>([]);
  const [shown, setShown] = useState(0);
  const memory = useRef<AskMemory>({});
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [thread, busy, shown]);

  useEffect(() => {
    if (!busy || liveSteps.length === 0) return;
    setShown(1);
    const t = window.setInterval(() => {
      setShown((n) => {
        if (n >= liveSteps.length) {
          window.clearInterval(t);
          return n;
        }
        return n + 1;
      });
    }, 240);
    return () => window.clearInterval(t);
  }, [busy, liveSteps]);

  const run = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setThread((t) => [...t, { role: "user", text: q }]);
    const local = reasonAsk(q, props.context, memory.current);
    memory.current = local.memory;
    for (const action of local.actions) props.onAction(action);
    setFollowUps(local.followUps ?? pulseStarters(props.context));
    setLiveSteps(local.steps);
    setShown(0);
    setBusy(true);
    let answer = local.answer;
    let why = local.why;
    let citations = local.citations;
    // When the server ask fails we still show the board-local packet, but we
    // say so — silently serving the canned answer reads as "the guide got
    // dumb" and hides real outages (expired session, Pulse flag off, 500).
    let serverNote: string | null = null;
    if (props.askUrl) {
      try {
        const history = [...thread, { role: "user" as const, text: q }].slice(-8);
        const res = await fetch(props.askUrl, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            focus: local.focus,
            history: history.map((m) => ({
              role: m.role === "guide" ? "assistant" : "user",
              content: m.text,
            })),
          }),
        });
        if (res.ok) {
          const body = (await res.json()) as {
            answer?: string;
            why?: string[];
            citations?: AskCitation[];
            followUps?: string[];
          };
          const next = body.answer?.trim() ? clipAsk(body.answer.trim(), 4) : "";
          if (next) {
            if (inventGuard(next, props.context)) answer = next;
            // The guard compares against the units this board has loaded, so a
            // real server answer about a unit outside that slice trips it. Keep
            // the local packet, but never pretend it came from HALO.
            else serverNote = "Showing this board's read — HALO's answer referenced units this view hasn't loaded.";
          }
          if (body.why?.length) why = body.why.slice(0, 4);
          if (body.citations?.length) {
            citations = body.citations
              .filter((c) => c.label && c.detail)
              .slice(0, 4)
              .map((c, i) => ({ id: c.id || `c${i}`, label: c.label, detail: c.detail }));
          }
          if (body.followUps?.length) setFollowUps(body.followUps.slice(0, 3));
        } else {
          serverNote =
            res.status === 401 || res.status === 403
              ? "Sign in again to get HALO's full answer — this is the board's own read."
              : res.status === 404
                ? "HALO's portfolio brain is switched off for this board — this is the board's own read."
                : `HALO couldn't answer (${res.status}) — this is the board's own read.`;
        }
      } catch {
        serverNote = "Couldn't reach HALO — this is the board's own read, from data already loaded.";
      }
    }
    setThread((t) => [
      ...t,
      {
        role: "guide",
        text: answer,
        cards: local.cards,
        why,
        citations,
        steps: local.steps,
        note: serverNote,
      },
    ]);
    setBusy(false);
    setLiveSteps([]);
  };

  useEffect(() => {
    if (!props.pendingAsk) return;
    const q = props.pendingAsk;
    props.onPendingConsumed?.();
    void run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingAsk]);

  const chips = thread.length === 0 ? pulseStarters(props.context) : followUps;

  return (
    <div className="cb-guide">
      {thread.length === 0 ? (
        <>
          <p className="cb-guide-help">Ask anything on this board. I’ll rank it, cite the clock, and show proof.</p>
          <div className="cb-guide-starters">
            {chips.map((s) => (
              <button key={s} type="button" className="cb-chip" onClick={() => void run(s)}>
                {s}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="cb-guide-thread">
          {thread.map((m, i) =>
            m.role === "user" ? (
              <p key={`u-${i}`} className="cb-guide-msg user">
                {m.text}
              </p>
            ) : (
              <GuideTurnView
                key={`g-${i}`}
                turn={m}
                onAction={props.onAction}
                onZoom={(src, title) => setZoom({ src, title })}
              />
            ),
          )}
          {busy ? (
            <div className="cb-ask-think" aria-live="polite">
              <span className="cb-ask-think-kicker">
                <Loader2 size={12} className="cb-spin" /> Reasoning
              </span>
              <ol>
                {liveSteps.slice(0, Math.max(shown, 1)).map((s) => (
                  <li key={s.id}>{s.label}</li>
                ))}
              </ol>
            </div>
          ) : null}
          {!busy && followUps.length > 0 ? (
            <div className="cb-guide-starters">
              {followUps.map((s) => (
                <button key={s} type="button" className="cb-chip" onClick={() => void run(s)}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <div ref={bottom} />
        </div>
      )}
      <form
        className="cb-guide-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(input);
        }}
      >
        <label className="cb-guide-field">
          <span className="sr-only">Ask the board</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask why, compare sites, name a unit…"
            aria-label="Ask this board"
          />
        </label>
        <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
          <Send size={14} />
        </button>
      </form>
      {zoom ? (
        <button type="button" className="cb-ask-zoom" onClick={() => setZoom(null)} aria-label="Close photo">
          <img src={zoom.src} alt={zoom.title} />
          <span>{zoom.title}</span>
        </button>
      ) : null}
    </div>
  );
}

function GuideTurnView(props: {
  turn: Turn;
  onAction: (action: GuideAction) => void;
  onZoom: (src: string, title: string) => void;
}) {
  const { turn } = props;
  const [open, setOpen] = useState(false);
  const [cite, setCite] = useState<string | null>(null);
  return (
    <div className="cb-ask-turn">
      {turn.steps && turn.steps.length > 0 ? (
        <button type="button" className="cb-ask-why-toggle" onClick={() => setOpen((v) => !v)}>
          <span>How I ranked this</span>
          <ChevronDown size={14} data-open={open ? "true" : "false"} />
        </button>
      ) : null}
      {open && turn.steps ? (
        <ol className="cb-ask-steps">
          {turn.steps.map((s) => (
            <li key={s.id}>{s.label}</li>
          ))}
        </ol>
      ) : null}
      {turn.note ? (
        <p className="cb-ask-note" role="status">
          {turn.note}
        </p>
      ) : null}
      <p className="cb-guide-msg guide">{turn.text}</p>
      {open && turn.why && turn.why.length > 0 ? (
        <ul className="cb-ask-why">
          {turn.why.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {turn.citations && turn.citations.length > 0 ? (
        <div className="cb-ask-cites">
          {turn.citations.map((c) => (
            <button
              key={c.id}
              type="button"
              className="cb-ask-cite"
              data-on={cite === c.id ? "true" : "false"}
              onClick={() => setCite((id) => (id === c.id ? null : c.id))}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
      {cite ? (
        <p className="cb-ask-cite-detail">{turn.citations?.find((c) => c.id === cite)?.detail}</p>
      ) : null}
      {turn.cards && turn.cards.length > 0 ? (
        <div className="cb-ask-cards">
          {turn.cards.map((card) => (
            <AskMediaCard
              key={card.id}
              card={card}
              onOpen={() => {
                if (card.action) props.onAction(card.action);
              }}
              onZoom={props.onZoom}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AskMediaCard(props: {
  card: AskCard;
  onOpen: () => void;
  onZoom: (src: string, title: string) => void;
}) {
  const { card } = props;
  return (
    <button
      type="button"
      className={`cb-ask-card kind-${card.kind}`}
      onClick={() => {
        if (card.kind === "photo" && card.src) props.onZoom(card.src, card.title);
        else if (card.kind === "pair" && card.after) props.onZoom(card.after, card.title);
        else if (card.kind === "map" && card.src) props.onZoom(card.src, card.title);
        props.onOpen();
      }}
    >
      {card.kind === "pair" ? (
        <span className="cb-ask-pair">
          {card.before ? <img src={card.before} alt="" /> : <i>Before</i>}
          {card.after ? <img src={card.after} alt="" /> : <i>After</i>}
        </span>
      ) : card.src ? (
        <img src={card.src} alt="" />
      ) : (
        <i className="cb-ask-ph" />
      )}
      <strong>{card.title}</strong>
      <em>{card.caption}</em>
    </button>
  );
}
