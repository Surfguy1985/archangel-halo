/**
 * Native mirror of the crew-link instructions gate.
 *
 * The wording is NEVER kept here — it is fetched from the server so the text
 * stored with an acceptance is provably the text the crew read. This module
 * only tracks whether the gate has been passed on THIS app launch, which is
 * the native equivalent of the web's per-visit sessionStorage flag: a fresh
 * open shows the gate again, a screen change mid-shift does not.
 */

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;

export type InstructionsLang = 'en' | 'es';

export type CrewInstructionsCopy = {
  lang: InstructionsLang;
  kicker: string;
  title: string;
  intro: string;
  requirements: { title: string; body: string }[];
  warning: string;
  agreeLabel: string;
  agreeCheckbox: string;
  footnote: string;
  otherLangLabel: string;
};

export type InstructionsPayload = {
  version: string;
  ttlHours: number;
  copy: Record<InstructionsLang, CrewInstructionsCopy>;
  crewName?: string | null;
};

// Module scope, so it resets on every cold start of the app.
let ackedThisLaunch = false;

export function instructionsAcked(): boolean {
  return ackedThisLaunch;
}

export function markInstructionsAcked(): void {
  ackedThisLaunch = true;
}

/** Called when the server refuses an action with `instructions_required`. */
export function clearInstructionsAck(): void {
  ackedThisLaunch = false;
}

export function isInstructionsRequired(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; data?: { code?: string } };
  return e.status === 428 || e.data?.code === 'instructions_required';
}

function url(token: string): string {
  return `https://${DOMAIN}/api/portal/${token}/instructions`;
}

export async function fetchCrewInstructions(token: string): Promise<InstructionsPayload> {
  const res = await fetch(url(token));
  if (!res.ok) throw new Error(`instructions ${res.status}`);
  return (await res.json()) as InstructionsPayload;
}

export async function acceptCrewInstructions(token: string, lang: InstructionsLang): Promise<void> {
  const res = await fetch(url(token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The crew is resolved from the token server-side.
    body: JSON.stringify({ lang, linkKind: 'app' }),
  });
  if (!res.ok) throw new Error(`instructions accept ${res.status}`);
  markInstructionsAcked();
}
