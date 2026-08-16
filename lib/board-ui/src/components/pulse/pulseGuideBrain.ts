/**
 * Pulse guide — types + reasoner entry.
 * Cortex ranks; askReason decides focus, citations, and proof tiles.
 * Server ask may rewrite prose; it may not change rank or invent a unit.
 */

import { reasonAsk, type AskCitation, type AskMemory, type AskStep } from "./askReason";
import { pulseStarters } from "./pulseCortex";
import type { AskCard, GuidePhoto } from "./askMedia";
export type { AskCard, GuidePhoto } from "./askMedia";
export type { AskCitation, AskMemory, AskStep } from "./askReason";

export type GuidePanelId =
  | "chat"
  | "vacancy"
  | "turns"
  | "photos"
  | "overview"
  | "sites"
  | "attention"
  | "crew"
  | "range"
  | "compliance"
  | "activity"
  | "tools";

export type GuideAction =
  | { type: "open"; panel: GuidePanelId }
  | { type: "select"; propertyId: string }
  | { type: "kanban" }
  | { type: "turns"; propertyId?: string };

export type GuideSite = {
  propertyId: string;
  name: string;
  city?: string | null;
  unitsInTurn: number;
  statusLabel: string;
  vacancyCostCents: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type GuideTurn = {
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  days: number;
};

export type GuideCrew = {
  propertyId: string;
  propertyName: string;
  unitNumber: string | null;
  crewName: string;
  status: string;
};

export type GuideNeed = {
  kind: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  days: number;
};

export type GuideContext = {
  title: string;
  vacancyLabel?: string;
  vacancyCostCents?: string;
  unitsInTurn?: number;
  medianTurnDays?: number | null;
  selectedPropertyId?: string | null;
  sites: GuideSite[];
  turns: GuideTurn[];
  photoCount: number;
  attentionCount: number;
  crew: GuideCrew[];
  needs?: GuideNeed[];
  photos?: GuidePhoto[];
};

export type GuideReply = {
  answer: string;
  actions: GuideAction[];
  followUps?: string[];
  cards?: AskCard[];
  why?: string[];
  citations?: AskCitation[];
  steps?: AskStep[];
};

export { pulseStarters };

export function interpretPulseQuestion(raw: string, ctx: GuideContext, memory?: AskMemory): GuideReply {
  return reasonAsk(raw, ctx, memory);
}
