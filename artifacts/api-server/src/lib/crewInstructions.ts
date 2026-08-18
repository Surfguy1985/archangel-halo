/**
 * The umbrella crew-link instructions gate.
 *
 * Every crew QR link — printed paycard check-in, crew portal, foreman join —
 * opens on this page before the crew can reach any working surface. The copy
 * lives HERE, on the server, for two reasons:
 *
 *  1. The wording stored with each acceptance must be the wording the crew was
 *     actually shown. If the apps owned the text, a stale bundle on a crew's
 *     phone would silently sign them up to something the record does not match.
 *  2. All three surfaces (plus the Expo app) render one text, in two languages,
 *     from one place.
 *
 * This gate does NOT replace the per-job payout agreement or the per-checklist
 * agreement — those stay exactly as they are. This is the umbrella requirement
 * that sits in front of every link.
 *
 * Bump CREW_INSTRUCTIONS_VERSION whenever the copy changes. Existing rows keep
 * their own snapshot; only new acceptances get the new text.
 */

export const CREW_INSTRUCTIONS_VERSION = "2026-08.v1";

/** How long one acceptance stays "current" for the server-side check-in gate. */
export const CREW_ACK_TTL_HOURS = 24;
export const CREW_ACK_TTL_MS = CREW_ACK_TTL_HOURS * 60 * 60 * 1000;

export type CrewLinkKind = "paycard" | "portal" | "join" | "app";
export const CREW_LINK_KINDS: CrewLinkKind[] = ["paycard", "portal", "join", "app"];

export type InstructionsLang = "en" | "es";

export type CrewInstructionsCopy = {
  lang: InstructionsLang;
  kicker: string;
  title: string;
  intro: string;
  /** Numbered requirements, in the order they happen on site. */
  requirements: { title: string; body: string }[];
  /** The consequence line — this is the part a supervisor cites later. */
  warning: string;
  agreeLabel: string;
  agreeCheckbox: string;
  footnote: string;
  otherLangLabel: string;
};

const COPY: Record<InstructionsLang, CrewInstructionsCopy> = {
  en: {
    lang: "en",
    kicker: "HALO crew",
    title: "Read this before you start",
    intro:
      "These are the requirements for getting your work approved for payment. They apply to every unit, on every job.",
    requirements: [
      {
        title: "Check in and check out at every unit",
        body: "Check in when you arrive at a unit you are assigned, and check out when you finish that unit. Every unit, every time.",
      },
      {
        title: "Take the before and after photos",
        body: "Photograph the work area before you start and after you finish. Both sets are required for each unit.",
      },
      {
        title: "This is what approves your pay",
        body: "Your check-in, your check-out, and your before and after photos are the record the office uses to approve payment for the work.",
      },
    ],
    warning:
      "If you do not check in and check out at every unit assigned and complete the before and after photo requirements, payment may be delayed until it is completed or reviewed by a supervisor.",
    agreeLabel: "I agree — continue",
    agreeCheckbox:
      "I have read and understood these requirements and agree to follow them on every unit.",
    footnote: "Your name, the time, and this exact wording are recorded when you agree.",
    otherLangLabel: "Español",
  },
  es: {
    lang: "es",
    kicker: "Cuadrilla HALO",
    title: "Lea esto antes de empezar",
    intro:
      "Estos son los requisitos para que su trabajo sea aprobado para el pago. Aplican a cada unidad, en cada trabajo.",
    requirements: [
      {
        title: "Registre entrada y salida en cada unidad",
        body: "Registre su entrada al llegar a cada unidad asignada y su salida al terminar esa unidad. Cada unidad, todas las veces.",
      },
      {
        title: "Tome las fotos de antes y después",
        body: "Fotografíe el área de trabajo antes de empezar y después de terminar. Ambos juegos de fotos son obligatorios en cada unidad.",
      },
      {
        title: "Esto es lo que aprueba su pago",
        body: "Su entrada, su salida y sus fotos de antes y después son el registro que la oficina usa para aprobar el pago del trabajo.",
      },
    ],
    warning:
      "Si no registra entrada y salida en cada unidad asignada y no completa los requisitos de fotos de antes y después, el pago puede retrasarse hasta que se complete o lo revise un supervisor.",
    agreeLabel: "Acepto — continuar",
    agreeCheckbox:
      "He leído y entendido estos requisitos y acepto cumplirlos en cada unidad.",
    footnote: "Su nombre, la hora y este texto exacto quedan registrados cuando acepta.",
    otherLangLabel: "English",
  },
};

export function normalizeInstructionsLang(raw: unknown): InstructionsLang {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return v.startsWith("es") ? "es" : "en";
}

/**
 * The portal token backs both the web portal and the Expo app, so the client
 * says which surface it is. Anything unrecognised falls back to 'portal'
 * rather than being trusted verbatim.
 */
export function normalizeCrewLinkKind(raw: unknown): CrewLinkKind {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (CREW_LINK_KINDS as string[]).includes(v) ? (v as CrewLinkKind) : "portal";
}

export function crewInstructionsCopy(lang: unknown): CrewInstructionsCopy {
  return COPY[normalizeInstructionsLang(lang)];
}

/**
 * The flat snapshot stored on the acceptance row. Built from the same copy the
 * crew read, so the record and the screen can never drift apart.
 */
export function crewInstructionsText(lang: unknown): string {
  const c = crewInstructionsCopy(lang);
  const lines = [
    c.title,
    "",
    c.intro,
    "",
    ...c.requirements.map((r, i) => `${i + 1}. ${r.title} — ${r.body}`),
    "",
    c.warning,
    "",
    c.agreeCheckbox,
  ];
  return lines.join("\n");
}

/** Both languages plus the version — what the gate component renders from. */
export function crewInstructionsPayload() {
  return {
    version: CREW_INSTRUCTIONS_VERSION,
    ttlHours: CREW_ACK_TTL_HOURS,
    copy: { en: COPY.en, es: COPY.es },
  };
}
