/**
 * Structured answer renderer — headline + short bullets, never a prose wall.
 *
 * Two rules this component exists to enforce:
 *  1. Raw markdown syntax must NEVER reach the screen. Legacy answers (older
 *     persisted threads, the local cortex fallback) arrive as plain text and
 *     get normalized here before rendering.
 *  2. Long enumerations are grouped and capped by the server; this renders the
 *     "+N more" expander so the tail is reachable without dumping it inline.
 */

import { useMemo, useState } from "react";

export type AnswerBullet = { text: string; emphasis?: string };
export type AnswerGroup = { label: string; items: string[]; hidden?: string[] };
export type StructuredAnswer = {
  headline: string;
  bullets: AnswerBullet[];
  groups?: AnswerGroup[];
  overflow?: string[];
  speech?: string;
};

/** Strip markdown syntax a legacy answer may still carry. */
function stripMarkdown(s: string): string {
  return String(s ?? "")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:)!?]|$)/g, "$1$2")
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .trim();
}

/** Turn a legacy plain-text/markdown answer into the structured shape. */
export function normalizeLegacyAnswer(text: string): StructuredAnswer {
  const raw = String(text ?? "").trim();
  if (!raw) return { headline: "", bullets: [] };
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isBullet = (l: string) => /^(?:[-*•‣]|\d+[.)])\s+/.test(l);
  const bulletLines = lines.filter(isBullet);
  const proseLines = lines.filter((l) => !isBullet(l));

  if (bulletLines.length > 0) {
    return {
      headline: stripMarkdown(proseLines[0] ?? ""),
      bullets: bulletLines.map((l) => ({
        text: stripMarkdown(l.replace(/^(?:[-*•‣]|\d+[.)])\s+/, "")),
      })),
      overflow: proseLines.slice(1).map(stripMarkdown).filter(Boolean),
    };
  }

  const flat = stripMarkdown(lines.join(" "));
  const sentences = flat.split(/(?<=[.!?])\s+(?=[A-Z(“"'\d])/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length <= 1) return { headline: flat, bullets: [] };
  return {
    headline: sentences[0],
    bullets: sentences.slice(1, 6).map((s) => ({ text: s.replace(/\.$/, "") })),
    overflow: sentences.slice(6),
  };
}

/** Render a fragment with its entity name emphasised. */
function Fragment({ text, emphasis }: AnswerBullet) {
  const clean = stripMarkdown(text);
  if (!emphasis) return <>{clean}</>;
  const at = clean.indexOf(emphasis);
  if (at < 0) return <>{clean}</>;
  return (
    <>
      {clean.slice(0, at)}
      <span style={{ color: "rgba(255,255,255,0.95)", fontWeight: 600 }}>{emphasis}</span>
      {clean.slice(at + emphasis.length)}
    </>
  );
}

export function AnswerBody({
  answer,
  text,
  className = "",
}: {
  /** Structured answer from the server, when present. */
  answer?: StructuredAnswer | null;
  /** Legacy plain-text answer — used when `answer` is absent. */
  text?: string;
  className?: string;
}) {
  const a = useMemo<StructuredAnswer>(
    () => (answer && answer.headline ? answer : normalizeLegacyAnswer(text ?? "")),
    [answer, text],
  );
  const [expanded, setExpanded] = useState(false);

  const hiddenCount =
    (a.overflow?.length ?? 0) + (a.groups ?? []).reduce((s, g) => s + (g.hidden?.length ?? 0), 0);

  if (!a.headline && a.bullets.length === 0) return null;

  return (
    <div className={className}>
      {a.headline && (
        <p className="text-[14px] leading-[1.65]" style={{ color: "rgba(255,255,255,0.86)" }}>
          {stripMarkdown(a.headline)}
        </p>
      )}

      {a.bullets.length > 0 && (
        <ul className="mt-[9px] space-y-[6px]">
          {a.bullets.map((b, i) => (
            <li
              key={i}
              className="flex gap-[9px] text-[13.5px] leading-[1.55]"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              <span
                aria-hidden
                className="mt-[8px] w-[3px] h-[3px] rounded-full shrink-0"
                style={{ background: "rgba(180,255,68,0.45)" }}
              />
              <span>
                <Fragment {...b} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {(a.groups ?? []).length > 0 && (
        <div className="mt-[11px] space-y-[9px]">
          {a.groups!.map((g, i) => (
            <div key={i}>
              <div
                className="text-[9px] font-bold uppercase tracking-[0.16em]"
                style={{ color: "rgba(255,255,255,0.28)" }}
              >
                {stripMarkdown(g.label)}
              </div>
              <div className="mt-[5px] flex flex-wrap gap-[5px]">
                {[...g.items, ...(expanded ? (g.hidden ?? []) : [])].map((item, j) => (
                  <span
                    key={j}
                    className="text-[11.5px] px-[7px] py-[3px] rounded-[6px]"
                    style={{
                      color: "rgba(255,255,255,0.7)",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.07)",
                    }}
                  >
                    {stripMarkdown(item)}
                  </span>
                ))}
                {!expanded && (g.hidden?.length ?? 0) > 0 && (
                  <span className="text-[11.5px] px-[7px] py-[3px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                    +{g.hidden!.length} more
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && (a.overflow?.length ?? 0) > 0 && (
        <ul className="mt-[9px] space-y-[6px]">
          {a.overflow!.map((t, i) => (
            <li
              key={i}
              className="flex gap-[9px] text-[13.5px] leading-[1.55]"
              style={{ color: "rgba(255,255,255,0.58)" }}
            >
              <span
                aria-hidden
                className="mt-[8px] w-[3px] h-[3px] rounded-full shrink-0"
                style={{ background: "rgba(255,255,255,0.2)" }}
              />
              <span>{stripMarkdown(t)}</span>
            </li>
          ))}
        </ul>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-[9px] text-[11.5px] font-medium transition-colors active:scale-95"
          style={{ color: "rgba(255,255,255,0.38)" }}
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
