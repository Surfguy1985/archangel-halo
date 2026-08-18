/**
 * Structured HALO answers — the contract that keeps chat replies scannable.
 *
 * The brain used to return one free-form `text` blob with an 8k token ceiling,
 * so it narrated the whole snapshot and its own **markdown** leaked to screen
 * as literal asterisks. Answers are now a short headline plus a bounded list
 * of fragment bullets, with long enumerations grouped and capped behind a
 * "+N more" expander. Every cap below is enforced HERE, server-side — the
 * prompt asks for brevity, this module guarantees it.
 *
 * Voice never reads bullets: `speech` is a separate conversational field.
 */

// ─── Caps (server-enforced — the prompt only asks) ───────────────────────────

export const ANSWER_MAX_HEADLINE_CHARS = 120;
export const ANSWER_MAX_BULLETS = 5;
export const ANSWER_MAX_BULLET_CHARS = 110;
export const ANSWER_MAX_GROUPS = 6;
export const ANSWER_MAX_GROUP_ITEMS = 5;
export const ANSWER_MAX_HIDDEN_ITEMS = 40;
export const ANSWER_MAX_SPEECH_CHARS = 320;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnswerBullet {
  /** A fragment, not a sentence pair. "Unit 111 — 5 days, no crew" */
  text: string;
  /** Entity name inside `text` the UI renders with emphasis. */
  emphasis?: string;
}

export interface AnswerGroup {
  /** Group heading — usually a property name. */
  label: string;
  /** Items shown inline. */
  items: string[];
  /** Items folded behind the "+N more" expander. */
  hidden?: string[];
}

export interface StructuredAnswer {
  /** One line. The decision or the count — never a paragraph. */
  headline: string;
  /** Short fragments. Capped; the overflow moves into `overflow`. */
  bullets: AnswerBullet[];
  /** Grouped enumerations (e.g. completed units by property). */
  groups?: AnswerGroup[];
  /** Bullets that did not fit, shown by the expander. */
  overflow?: string[];
  /** Conversational sentence(s) for voice / earpiece. Never bulleted. */
  speech: string;
}

// ─── Text hygiene ────────────────────────────────────────────────────────────

/**
 * Strip the markdown syntax models emit so it can never reach the screen as
 * literal characters. Emphasis is expressed structurally (`emphasis`), not
 * with asterisks.
 */
export function stripInlineMarkdown(input: string): string {
  return String(input ?? "")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:)!?]|$)/g, "$1$2")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop a leading markdown bullet / heading / numbering marker. */
function stripLeadingMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•‣–—]|#{1,6}|\d+[.)])\s+/, "").trim();
}

/** Truncate on a word boundary with an ellipsis. */
export function clampText(input: string, max: number): string {
  const s = stripInlineMarkdown(input);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:—-]+$/, "")}…`;
}

/** Bullets are fragments — one clause, no trailing period, no sentence pairs. */
function toFragment(input: string, max = ANSWER_MAX_BULLET_CHARS): string {
  let s = stripInlineMarkdown(stripLeadingMarker(String(input ?? "")));
  // Two sentences in one bullet is a paragraph in disguise — keep the first.
  const split = s.match(/^(.{12,}?[.!?])\s+[A-Z(]/);
  if (split) s = split[1];
  s = s.replace(/\s*\.\s*$/, "");
  return clampText(s, max);
}

// ─── Legacy plain text → structured ──────────────────────────────────────────

/**
 * Normalize a legacy free-form answer (plain text or markdown) into the
 * structured shape. Used for the cortex fallback, for older persisted
 * messages, and whenever the model ignores the schema.
 */
export function plainTextToStructured(text: string): StructuredAnswer {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return { headline: "No answer available.", bullets: [], speech: "I don't have an answer for that right now." };
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const bulletLines = lines.filter((l) => /^\s*(?:[-*•‣]|\d+[.)])\s+/.test(l));
  const proseLines = lines.filter((l) => !/^\s*(?:[-*•‣]|\d+[.)])\s+/.test(l));

  if (bulletLines.length > 0) {
    const headline = clampText(proseLines[0] ?? "Here's what I have.", ANSWER_MAX_HEADLINE_CHARS);
    return capStructured({
      headline,
      bullets: bulletLines.map((l) => ({ text: toFragment(l) })),
      speech: sentencesFrom(raw),
    });
  }

  // One prose blob: first sentence is the headline, the rest become bullets.
  const sentences = splitSentences(stripInlineMarkdown(raw));
  const headline = clampText(sentences[0] ?? raw, ANSWER_MAX_HEADLINE_CHARS);
  const bullets = sentences.slice(1).map((s) => ({ text: toFragment(s) })).filter((b) => b.text.length > 1);
  return capStructured({ headline, bullets, speech: sentencesFrom(raw) });
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(“"'\d])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A conversational rendering — what voice should say. */
function sentencesFrom(text: string): string {
  const flat = stripInlineMarkdown(
    String(text ?? "")
      .split(/\r?\n/)
      .map(stripLeadingMarker)
      .filter(Boolean)
      .join(". "),
  ).replace(/\.\s*\./g, ".");
  return clampText(flat, ANSWER_MAX_SPEECH_CHARS);
}

// ─── Caps ────────────────────────────────────────────────────────────────────

/** Apply every server-side cap. Safe to call on already-capped answers. */
export function capStructured(answer: StructuredAnswer): StructuredAnswer {
  const headline = clampText(answer.headline || "Here's what I have.", ANSWER_MAX_HEADLINE_CHARS);

  const allBullets: AnswerBullet[] = [];
  for (const b of answer.bullets ?? []) {
    const text = toFragment(b?.text ?? "");
    if (!text) continue;
    const emphasis = b?.emphasis ? stripInlineMarkdown(b.emphasis) : undefined;
    // Emphasis is only meaningful when it actually appears in the fragment.
    allBullets.push(emphasis && text.includes(emphasis) ? { text, emphasis } : { text });
  }

  const bullets = allBullets.slice(0, ANSWER_MAX_BULLETS);
  const overflowFromBullets = allBullets.slice(ANSWER_MAX_BULLETS).map((b) => b.text);
  const overflow = [...overflowFromBullets, ...(answer.overflow ?? []).map((s) => toFragment(s))]
    .filter(Boolean)
    .slice(0, ANSWER_MAX_HIDDEN_ITEMS);

  const groups = (answer.groups ?? [])
    .slice(0, ANSWER_MAX_GROUPS)
    .map((g) => {
      const label = clampText(g?.label ?? "", 48);
      const all = [...(g?.items ?? []), ...(g?.hidden ?? [])]
        .map((i) => toFragment(i, 72))
        .filter(Boolean);
      const items = all.slice(0, ANSWER_MAX_GROUP_ITEMS);
      const hidden = all.slice(ANSWER_MAX_GROUP_ITEMS, ANSWER_MAX_GROUP_ITEMS + ANSWER_MAX_HIDDEN_ITEMS);
      return hidden.length ? { label, items, hidden } : { label, items };
    })
    .filter((g) => g.items.length > 0);

  const speech = clampText(
    answer.speech?.trim() ||
      [headline, ...bullets.slice(0, 2).map((b) => b.text)].filter(Boolean).join(". "),
    ANSWER_MAX_SPEECH_CHARS,
  );

  return {
    headline,
    bullets,
    ...(groups.length ? { groups } : {}),
    ...(overflow.length ? { overflow } : {}),
    speech,
  };
}

/**
 * Accept whatever the model returned and produce a valid StructuredAnswer.
 * Falls back to parsing `text` when the model ignored the structured fields.
 */
export function normalizeAnswer(
  raw: Partial<StructuredAnswer> | null | undefined,
  legacyText?: string,
): StructuredAnswer {
  const hasStructure =
    typeof raw?.headline === "string" && raw.headline.trim().length > 0;
  if (!hasStructure) return plainTextToStructured(legacyText ?? "");

  const base = capStructured({
    headline: raw!.headline!,
    bullets: Array.isArray(raw!.bullets) ? raw!.bullets : [],
    groups: Array.isArray(raw!.groups) ? raw!.groups : undefined,
    overflow: Array.isArray(raw!.overflow) ? raw!.overflow : undefined,
    speech: typeof raw!.speech === "string" ? raw!.speech : "",
  });

  // A headline with no bullets and no groups is just a sentence — if the model
  // also sent a longer legacy `text`, mine it for the bullets it skipped.
  if (base.bullets.length === 0 && !base.groups && legacyText && legacyText.trim().length > base.headline.length + 40) {
    const mined = plainTextToStructured(legacyText);
    if (mined.bullets.length > 0) {
      return capStructured({ ...mined, headline: base.headline, speech: base.speech });
    }
  }
  return base;
}

/**
 * Flatten a structured answer back to plain text — used for conversation
 * history, persisted message content, and any surface that only takes a
 * string. Never emits markdown syntax.
 */
export function structuredToPlainText(a: StructuredAnswer): string {
  const parts: string[] = [a.headline];
  for (const b of a.bullets) parts.push(`• ${b.text}`);
  for (const g of a.groups ?? []) {
    parts.push(`${g.label}: ${g.items.join(", ")}${g.hidden?.length ? ` (+${g.hidden.length} more)` : ""}`);
  }
  if (a.overflow?.length) parts.push(`+${a.overflow.length} more`);
  return parts.join("\n");
}

/**
 * Group a long enumeration by a key so "40 completed units" never dumps 40
 * lines. Returns capped groups plus the number that were folded away.
 */
export function groupEnumeration<T>(
  rows: T[],
  keyOf: (row: T) => string,
  labelOf: (row: T) => string,
): { groups: AnswerGroup[]; hiddenCount: number } {
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    const key = keyOf(row) || "Other";
    const list = byKey.get(key) ?? [];
    list.push(labelOf(row));
    byKey.set(key, list);
  }
  const entries = [...byKey.entries()].sort((a, b) => b[1].length - a[1].length);
  const shown = entries.slice(0, ANSWER_MAX_GROUPS);
  const droppedGroups = entries.slice(ANSWER_MAX_GROUPS);
  let hiddenCount = droppedGroups.reduce((s, [, v]) => s + v.length, 0);
  const groups: AnswerGroup[] = shown.map(([label, items]) => {
    const visible = items.slice(0, ANSWER_MAX_GROUP_ITEMS);
    const hidden = items.slice(ANSWER_MAX_GROUP_ITEMS);
    hiddenCount += Math.max(0, hidden.length - ANSWER_MAX_HIDDEN_ITEMS);
    return hidden.length
      ? { label, items: visible, hidden: hidden.slice(0, ANSWER_MAX_HIDDEN_ITEMS) }
      : { label, items: visible };
  });
  return { groups, hiddenCount };
}
