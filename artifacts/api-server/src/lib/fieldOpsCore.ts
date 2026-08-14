/**
 * Field Presence + Earpiece + Morning Watch — pure copy and intent.
 * No I/O. Spoken lines stay short enough for an AirPod.
 */

export type EarpieceKind = "wake" | "next" | "go" | "skip" | "fix" | "tell" | "stop" | "command" | "noise";

export type EarpieceIntent = {
  kind: EarpieceKind;
  /** Text to send into HALO Command when this is a real turn. */
  command: string | null;
};

export type FieldJobSnap = {
  jobNo: string;
  unitNo?: string | null;
  category?: string | null;
  crewLeaderName?: string | null;
  status: string;
};

export type FieldCrewSnap = {
  name: string;
  todayStatus?: string | null;
};

export type PresenceBrief = {
  spoken: string;
  prompt: string;
  nextLine: string;
};

export type WatchBrief = {
  spoken: string;
  prompt: string;
};

const WAKE = /^(?:hey\s+)?(?:halo|jarvis)\b[,.]?\s*/i;

export function stripWake(raw: string): string {
  return raw.trim().replace(WAKE, "").trim();
}

export function detectEarpieceIntent(raw: string): EarpieceIntent {
  const text = stripWake(raw).replace(/\s+/g, " ").trim();
  if (text.length < 2) return { kind: "noise", command: null };
  const lower = text.toLowerCase().replace(/[?.!]/g, "");

  if (/^(stop|hang up|end|sleep|goodbye|good night|shut up)$/.test(lower) || /\b(end earpiece|stop listening)\b/.test(lower)) {
    return { kind: "stop", command: null };
  }
  if (/^(skip|later|not now|hold on|wait)$/.test(lower)) {
    return { kind: "skip", command: null };
  }
  if (/^(go|do it|start|yes|run it|make it so)$/.test(lower)) {
    return { kind: "go", command: text };
  }
  if (/^(next|what's next|whats next|next one|keep going)$/.test(lower)) {
    return { kind: "next", command: "What's the next move on this site?" };
  }
  if (/\b(fix this|punch this|this unit|open a job here)\b/.test(lower)) {
    return { kind: "fix", command: text };
  }
  if (/\b(tell them|tell the pm|text the pm|notify the pm|send the recap|tell the crew)\b/.test(lower)) {
    return { kind: "tell", command: text };
  }
  if (/^(halo|jarvis)$/.test(lower)) {
    return { kind: "wake", command: null };
  }
  return { kind: "command", command: text };
}

export function buildPresenceBrief(opts: {
  propertyName: string;
  jobs: FieldJobSnap[];
  crewsOnSite: FieldCrewSnap[];
  overdueInvoices: number;
}): PresenceBrief {
  const site = opts.propertyName.trim() || "this site";
  const uncrewed = opts.jobs.filter((j) => !j.crewLeaderName);
  const first = opts.jobs[0];
  const unit = first?.unitNo ? ` Unit ${first.unitNo}` : "";
  const crew = opts.crewsOnSite[0]?.name.split(/\s+/)[0];

  const bits: string[] = [`You're at ${site}.`];
  if (opts.jobs.length === 0) bits.push("No open turns.");
  else bits.push(`${opts.jobs.length} open turn${opts.jobs.length === 1 ? "" : "s"}.`);
  if (uncrewed[0]) {
    bits.push(`${uncrewed[0].unitNo ? `Unit ${uncrewed[0].unitNo}` : uncrewed[0].jobNo} is uncrewed.`);
  } else if (first) {
    bits.push(`${first.jobNo}${unit}${first.crewLeaderName ? ` with ${first.crewLeaderName.split(/\s+/)[0]}` : ""}.`);
  }
  if (crew) bits.push(`${crew} is on site.`);
  if (opts.overdueInvoices > 0) bits.push(`${opts.overdueInvoices} invoice${opts.overdueInvoices === 1 ? "" : "s"} waiting.`);
  bits.push("Say go, next, or skip.");

  const spoken = bits.join(" ");
  const prompt = [
    `I'm on site at ${site}.`,
    opts.jobs.length ? `Open jobs: ${opts.jobs.slice(0, 4).map((j) => `${j.jobNo}${j.unitNo ? ` unit ${j.unitNo}` : ""}`).join(", ")}.` : "No open jobs.",
    uncrewed.length ? `${uncrewed.length} uncrewed.` : "",
    "Run the next move. Do not ask me to pick a menu.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    spoken,
    prompt,
    nextLine: first
      ? `Next is ${first.jobNo}${unit}. ${first.category || "Turn"}.`
      : "Nothing queued. Say fix this to open a job.",
  };
}

export function buildMorningWatch(opts: {
  hour: number;
  pendingTitles: string[];
  doneTitles: string[];
}): WatchBrief | null {
  if (opts.hour < 5 || opts.hour > 11) return null;
  const pending = opts.pendingTitles.filter(Boolean).slice(0, 4);
  const done = opts.doneTitles.filter(Boolean).slice(0, 3);
  if (pending.length === 0 && done.length === 0) return null;

  const spokenParts = ["Morning Watch."];
  if (done.length) spokenParts.push(`Overnight I ${done.length === 1 ? "handled" : "handled"} ${done.join("; ")}.`);
  if (pending.length) spokenParts.push(`${pending.length} still need a tap: ${pending.join("; ")}.`);
  else spokenParts.push("Nothing waiting.");
  spokenParts.push("Say go to run the first one, or skip.");

  const prompt = [
    "Morning Watch. Run today's first ops move from overnight work.",
    pending.length ? `Waiting: ${pending.join("; ")}.` : "No pending autopilot actions.",
    done.length ? `Already done: ${done.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { spoken: spokenParts.join(" "), prompt };
}

export function ackForIntent(kind: EarpieceKind): string | null {
  switch (kind) {
    case "wake":
      return "Here.";
    case "skip":
      return "Standing by.";
    case "go":
      return "Running it.";
    case "next":
      return "Next.";
    case "fix":
      return "Opening it.";
    case "tell":
      return "I'll tell them.";
    case "stop":
      return "Earpiece off.";
    case "noise":
      return null;
    default:
      return "On it.";
  }
}
