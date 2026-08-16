import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import {
  interpretPulseQuestion,
  type GuideAction,
  type GuideContext,
} from "./pulseGuideBrain";

const STARTERS = [
  "What's happening today?",
  "Where's the crew?",
  "Show before and after photos",
  "Open the board",
];

export function PulseGuide(props: {
  context: GuideContext;
  askUrl?: string | null;
  onAction: (action: GuideAction) => void;
  pendingAsk?: string | null;
  onPendingConsumed?: () => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<Array<{ role: "user" | "guide"; text: string }>>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [thread, busy]);

  const run = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setThread((t) => [...t, { role: "user", text: q }]);
    const local = interpretPulseQuestion(q, props.context);
    for (const action of local.actions) props.onAction(action);
    setBusy(true);
    let answer = local.answer;
    if (props.askUrl) {
      try {
        const res = await fetch(props.askUrl, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q }),
        });
        if (res.ok) {
          const body = (await res.json()) as { answer?: string };
          if (body.answer?.trim()) answer = body.answer.trim();
        }
      } catch {
        /* keep local */
      }
    }
    setThread((t) => [...t, { role: "guide", text: answer }]);
    setBusy(false);
  };

  useEffect(() => {
    if (!props.pendingAsk) return;
    const q = props.pendingAsk;
    props.onPendingConsumed?.();
    void run(q);
    // One-shot handoff from the header field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingAsk]);

  return (
    <div className="cb-guide">
      <p className="cb-guide-help">
        Ask about a community, a unit, vacancy, photos, or who’s on site. I’ll open the matching
        view from today’s numbers.
      </p>
      {thread.length === 0 ? (
        <div className="cb-guide-starters">
          {STARTERS.map((s) => (
            <button key={s} type="button" className="cb-chip" onClick={() => void run(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : (
        <div className="cb-guide-thread">
          {thread.map((m, i) => (
            <p key={`${m.role}-${i}`} className={`cb-guide-msg ${m.role}`}>
              {m.text}
            </p>
          ))}
          {busy ? (
            <p className="cb-guide-msg guide">
              <Loader2 size={14} className="cb-spin" /> Looking…
            </p>
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
            placeholder="Ask this board…"
            aria-label="Ask this board"
          />
        </label>
        <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
