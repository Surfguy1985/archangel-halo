/**
 * HALO Command Brain — multi-turn, data-grounded operational assistant.
 *
 * Builds a live business snapshot, a role-aware system prompt, and runs a
 * multi-turn Anthropic conversation using the caller's persisted history.
 * Returns a structured BrainResponse that the front-end renders appropriately.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  db,
  jobsTable,
  invoicesTable,
  propertiesTable,
  crewsTable,
  crewCheckinsTable,
  crewPaymentsTable,
} from "@workspace/db";
import { eq, isNull, and, inArray, gte, sql } from "drizzle-orm";
import { logger } from "./logger";
import { computeQueues } from "./queues";
import { falkonConnectionsTable } from "@workspace/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BusinessSnapshot {
  date: string;
  hour: number;
  todayItems: Array<{
    id: string;
    title: string;
    tier: string;
    queue: string;
    amount: number | null;
  }>;
  properties: Array<{
    id: string;
    name: string;
    city: string;
    units: number;
    status: string;
  }>;
  jobs: {
    total: number;
    open: number;
    overdue: number;
    uncrewed: number;
    overBudget: number;
    recentOpen: Array<{
      id: string;
      unitNo: string | null;
      propertyId: string;
      status: string;
      boardStatus: string;
    }>;
  };
  invoices: {
    totalReceivables: number;
    overdueCount: number;
    sentCount: number;
    pendingCrewPay: number;
  };
  crews: {
    total: number;
    checkedInToday: number;
  };
  margin: {
    avgMarginPct: number | null;
    flaggedCount: number;
  };
  falkonMode: string;
}

export type BrainResponseType = "answer" | "lens" | "voice_action" | "error";

/** Risk classification for ASSISTED mode auto-execution */
export type ActionRisk = "auto" | "review" | "block";

export interface ActionPlan {
  /** Plain-English description of exactly what will happen */
  description: string;
  /** auto = safe to execute immediately in ASSISTED; review = requires explicit human approval; block = not permitted from this surface */
  risk: ActionRisk;
  /** HALO capability key, e.g. "invoice.send", "job.create", "crew.schedule", "payment.release" */
  capability?: string;
  /** Key parameters the executor will use */
  params?: Record<string, unknown>;
}

export interface BrainResponse {
  /** How the front-end should render this message */
  type: BrainResponseType;
  /** Always present — the natural language response text */
  text: string;
  /** Set when type === 'lens' — which lens to open */
  lensKind?: "portfolio" | "timeline" | "money" | "evidence" | "network" | "map" | "property_status" | "turn_timeline" | "budget_breakdown" | "crew_map" | "invoice_detail" | "vendor_profile" | "photo_evidence" | "inspection_checklist";
  /** Set when type === 'lens' and lens is entity-scoped — the entity UUID for the API call */
  entityId?: string;
  /** Set when a proposed action is in SHADOW mode */
  shadowLabel?: string;
  /** Data citations shown below the response bubble */
  sources?: Array<{ label: string; value: string }>;
  /** 2-3 suggested follow-up prompts shown as tappable chips */
  suggestedFollowUps?: string[];
  /** Set when type === 'voice_action' — structured action plan for ASSISTED auto-execution or approval */
  actionPlan?: ActionPlan;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────

export async function buildSnapshot(): Promise<BusinessSnapshot> {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  // Local midnight for today — used as a string for the date columns
  const todayMidnight = new Date(`${todayStr}T00:00:00`);

  const [props, jobs, invoices, crews, todayCheckins, crewPays, { feed }] =
    await Promise.all([
      db.select().from(propertiesTable),
      db.select().from(jobsTable),
      db.select().from(invoicesTable),
      db.select().from(crewsTable),
      // Count today's check-in events (kind='checkin') as a proxy for active crews
      db
        .select({ crewId: crewCheckinsTable.crewId })
        .from(crewCheckinsTable)
        .where(
          and(
            eq(crewCheckinsTable.kind, "checkin"),
            gte(crewCheckinsTable.createdAt, todayMidnight),
          ),
        ),
      db.select({ amount: crewPaymentsTable.amount }).from(crewPaymentsTable).where(
        inArray(crewPaymentsTable.status, ["pending", "held"]),
      ),
      computeQueues(),
    ]);

  const openStatuses = ["open", "pending", "scheduled", "in_progress", "active"];
  const openJobs = jobs.filter((j) => openStatuses.includes(j.status));
  // scheduledOn is a date string ("YYYY-MM-DD") — compare lexicographically to today
  const overdueJobs = openJobs.filter(
    (j) => j.scheduledOn !== null && j.scheduledOn !== undefined && j.scheduledOn < todayStr,
  );
  const uncrewedJobs = openJobs.filter((j) => !j.crewLeaderId);
  const overBudgetJobs = jobs.filter(
    (j) => typeof j.marginPct === "number" && j.marginPct < 0.25,
  );

  const receivables = invoices.filter(
    (i) => i.status === "sent" || i.status === "overdue",
  );
  const totalReceivables = receivables.reduce((s, i) => s + (i.amount ?? 0), 0);
  const overdueInvoices = invoices.filter((i) => i.status === "overdue");

  const margins = jobs
    .filter((j) => typeof j.marginPct === "number")
    .map((j) => j.marginPct as number);
  const avgMarginPct =
    margins.length > 0 ? margins.reduce((s, m) => s + m, 0) / margins.length : null;

  // Unique crew IDs that checked in today
  const uniqueCheckedIn = new Set(todayCheckins.map((c) => c.crewId)).size;

  // Falkon mode
  let falkonMode = "SHADOW";
  try {
    const [conn] = await db
      .select({ mode: falkonConnectionsTable.mode })
      .from(falkonConnectionsTable)
      .limit(1);
    if (conn?.mode) falkonMode = conn.mode;
  } catch {
    // ignore — non-fatal
  }

  return {
    date: todayStr,
    hour: today.getHours(),
    todayItems: feed.slice(0, 15).map((f) => ({
      id: f.id,
      title: f.title,
      tier: f.tier,
      queue: f.queue,
      amount: f.amount ?? null,
    })),
    properties: props.map((p) => ({
      id: p.id,
      name: p.name,
      city: p.city ?? "",
      units: p.units ?? 0,
      status: p.status ?? "active",
    })),
    jobs: {
      total: jobs.length,
      open: openJobs.length,
      overdue: overdueJobs.length,
      uncrewed: uncrewedJobs.length,
      overBudget: overBudgetJobs.length,
      recentOpen: openJobs.slice(0, 8).map((j) => ({
        id: j.id,
        unitNo: j.unitNo ?? null,
        propertyId: j.propertyId,
        status: j.status,
        boardStatus: j.boardStatus,
      })),
    },
    invoices: {
      totalReceivables,
      overdueCount: overdueInvoices.length,
      sentCount: receivables.length,
      pendingCrewPay: crewPays.reduce((s, p) => s + (p.amount ?? 0), 0),
    },
    crews: {
      total: crews.length,
      checkedInToday: uniqueCheckedIn,
    },
    margin: {
      avgMarginPct,
      flaggedCount: overBudgetJobs.length,
    },
    falkonMode,
  };
}

// ─── Role-scoped system prompt ────────────────────────────────────────────────

const ROLE_DESCRIPTIONS: Record<string, string> = {
  executive: "You see the full business: all properties, financials, margins, exceptions, and approvals.",
  pm: "You focus on properties, open jobs, crew performance, client requests, and invoicing.",
  field: "You focus on crew dispatch, schedules, GPS check-ins, job status, and daily operations.",
  accounting: "You focus on invoices, payments, receivables, crew pay, and financial metrics.",
  admin: "You have full access including Falkon control, settings, and data management.",
};

export function buildSystemPrompt(
  role: string,
  snapshot: BusinessSnapshot,
): string {
  const roleDesc =
    ROLE_DESCRIPTIONS[role] ??
    "You assist with property-services business operations.";

  const shadowNote =
    snapshot.falkonMode === "SHADOW" || snapshot.falkonMode === "OFF"
      ? "\n\n⚠️ FALKON MODE: SHADOW — Proposed actions are NOT executed. Set shadowLabel for any voice_action. Always include actionPlan even in SHADOW so the user can see what would happen."
      : snapshot.falkonMode === "ASSISTED"
      ? "\n\n✅ FALKON MODE: ASSISTED — Auto-pilot is active. Low-risk (auto) actions execute immediately without asking. Consequential (review) actions surface an approval card. Never set shadowLabel. Classify every voice_action with the correct risk level in actionPlan."
      : "";

  const economicsCtx = [
    `Open receivables: $${snapshot.invoices.totalReceivables.toLocaleString()}`,
    `Overdue invoices: ${snapshot.invoices.overdueCount}`,
    snapshot.margin.avgMarginPct !== null
      ? `Average margin: ${(snapshot.margin.avgMarginPct * 100).toFixed(1)}%`
      : null,
    snapshot.margin.flaggedCount > 0
      ? `Over-budget jobs: ${snapshot.margin.flaggedCount}`
      : null,
    `Pending crew pay: $${snapshot.invoices.pendingCrewPay.toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const attentionItems = snapshot.todayItems
    .filter((i) => i.tier === "now" || i.tier === "today")
    .slice(0, 6)
    .map((i) => `• ${i.title}${i.amount ? ` ($${i.amount.toLocaleString()})` : ""}`)
    .join("\n");

  return `You are HALO, an expert AI chief-of-staff for a property-maintenance and make-ready contracting business. You have access to live business data and assist with operational decisions, financial analysis, crew management, and work coordination.

Role: ${role} — ${roleDesc}
${shadowNote}

## Live Business Snapshot (${snapshot.date})
Properties: ${snapshot.properties.length} | Open jobs: ${snapshot.jobs.open} | Crews: ${snapshot.crews.total} (${snapshot.crews.checkedInToday} checked in today)
Economics: ${economicsCtx}
Uncrewed jobs: ${snapshot.jobs.uncrewed} | Overdue jobs: ${snapshot.jobs.overdue}

## Properties
${snapshot.properties.map((p) => `${p.name} (${p.city}) — ${p.units} units`).join("\n")}

## Needs Attention
${attentionItems || "Nothing urgent right now."}

## Instructions
- Answer from the live snapshot above. Be concise and specific with numbers.
- For data queries (what/who/why/show/which), give a direct operational answer with real numbers.
- If asked about a specific entity not fully detailed in the snapshot, say what you know and suggest opening the full view.
- For "who is behind" → look at overdue jobs and uncrewed jobs.
- For "why over budget" → reference margin data and expense context.
- For "approve everything safe" → describe what autopilot would evaluate.
- For action commands (create/schedule/send/approve) → describe the proposed action clearly and note if SHADOW mode is active.
- Always give 2–3 specific follow-up suggestions relevant to the current context.
- Respond in JSON format exactly as specified. No markdown fences, no prose outside the JSON.`;
}

// ─── Suggested prompts ────────────────────────────────────────────────────────

export function buildSuggestedPrompts(
  snapshot: BusinessSnapshot,
  role: string,
): string[] {
  const prompts: string[] = [];

  // Time-of-day
  if (snapshot.hour < 12) {
    prompts.push("What needs my attention this morning?");
  } else if (snapshot.hour < 17) {
    prompts.push("Where do we stand right now?");
  } else {
    prompts.push("How did today close out?");
  }

  // State-aware
  if (snapshot.invoices.overdueCount > 0) {
    prompts.push(`Show every invoice waiting on me`);
  }
  if (snapshot.jobs.overdue > 0) {
    prompts.push("Who is behind on their jobs?");
  } else if (snapshot.jobs.uncrewed > 0) {
    prompts.push(`Fill the ${snapshot.jobs.uncrewed} uncrewed job${snapshot.jobs.uncrewed === 1 ? "" : "s"}`);
  }
  if (snapshot.margin.flaggedCount > 0) {
    prompts.push("Show over-budget jobs");
  }

  // Role-aware fill-ins
  if (prompts.length < 4) {
    const rolePrompts: Record<string, string[]> = {
      executive: ["What's my margin health?", "Brief me on all properties"],
      field: ["Show live crew map", "Who checked in today?"],
      accounting: ["Show open receivables", "What crew pay is pending?"],
      pm: ["Show active jobs by property", "What's due this week?"],
      admin: ["Show Falkon connection status", "Run autopilot evaluation"],
    };
    const extras = rolePrompts[role] ?? rolePrompts.executive;
    for (const p of extras) {
      if (prompts.length >= 4) break;
      if (!prompts.includes(p)) prompts.push(p);
    }
  }

  return prompts.slice(0, 4);
}

// ─── Brain response schema for AI ────────────────────────────────────────────

const BRAIN_RESPONSE_SCHEMA = `{
  "type": "answer" | "lens" | "voice_action" | "error",
  "text": "string — your natural language response, always present",
  "lensKind": "portfolio" | "timeline" | "money" | "evidence" | "network" | "map" | "property_status" | "turn_timeline" | "budget_breakdown" | "crew_map" | "invoice_detail" | "vendor_profile" | "photo_evidence" | "inspection_checklist" | null,
  "entityId": "string UUID or null — required when lensKind is entity-scoped",
  "shadowLabel": "string or null — set only for proposed actions in SHADOW mode",
  "sources": [{ "label": "string", "value": "string" }] | null,
  "suggestedFollowUps": ["string", "string"] — exactly 2-3 relevant next questions,
  "actionPlan": {
    "description": "string — one sentence describing exactly what will happen",
    "risk": "auto" | "review" | "block",
    "capability": "string — HALO operation key e.g. invoice.send, job.create, crew.schedule, expense.approve, payment.release, note.log",
    "params": {}
  } | null
}

Rules:
- type "answer" → text response to a data query or question
- type "lens" → user wants to see a visual data view; set lensKind to the most relevant lens
- type "voice_action" → user wants to CREATE, SCHEDULE, SEND, APPROVE, or DELETE something; always include actionPlan
- type "error" → only for missing data or genuine inability to answer
- shadowLabel: if falkon mode is SHADOW and type is "voice_action", set to "SHADOW — proposed, not executed"
- sources: cite 2–4 specific data points from the snapshot
- suggestedFollowUps: always include 2–3 context-aware follow-up prompts
- actionPlan.risk classification:
    "auto"   → safe, non-financial, reversible: note.log, observation.log, draft creation, status queries
    "review" → consequential: invoice.send, job.create, job.status.update, crew.schedule, expense.approve, change_order.create
    "block"  → irreversible or high-stakes: payment.release, record.delete, compliance.suspend, unit.ready`;

// ─── Core multi-turn brain function ───────────────────────────────────────────

export async function runCommandBrain(
  userMessage: string,
  role: string,
  history: ConversationMessage[],
  snapshot: BusinessSnapshot,
  entityContext?: { entityType: string; entityId: string } | null,
): Promise<BrainResponse> {
  const entityNote = entityContext
    ? `\n\n## Entity Context\nThis conversation is scoped to a specific ${entityContext.entityType} (ID: ${entityContext.entityId}). When the user asks about status, budget, timeline, photos, or other details, answer in the context of this specific ${entityContext.entityType} rather than the global portfolio. When emitting a lens type, prefer the entity-specific kinds (property_status, turn_timeline, budget_breakdown, invoice_detail, photo_evidence, inspection_checklist) and return entityId="${entityContext.entityId}" in your response.`
    : "";
  const systemPrompt = buildSystemPrompt(role, snapshot) + entityNote;

  // Build the messages array with history + current message
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.slice(-18), // keep last 18 messages (9 turns) for context
    { role: "user", content: userMessage },
  ];

  // Ensure messages start with 'user' (Anthropic requirement)
  while (messages.length > 0 && messages[0].role !== "user") {
    messages.shift();
  }

  const fullSystem = `${systemPrompt}\n\n## Response Format\nReturn ONLY valid JSON matching this schema:\n${BRAIN_RESPONSE_SCHEMA}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: fullSystem,
      messages,
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();

    // Extract JSON (handle optional markdown fences)
    let jsonStr = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const firstBrace = jsonStr.search(/[{]/);
    if (firstBrace > 0) jsonStr = jsonStr.slice(firstBrace);

    const parsed = JSON.parse(jsonStr) as BrainResponse;

    return {
      type: parsed.type ?? "answer",
      text: parsed.text ?? "I couldn't formulate a response. Please try rephrasing.",
      lensKind: parsed.lensKind ?? undefined,
      entityId: parsed.entityId ?? undefined,
      shadowLabel: parsed.shadowLabel ?? undefined,
      sources: parsed.sources ?? undefined,
      suggestedFollowUps: parsed.suggestedFollowUps ?? undefined,
      actionPlan: parsed.actionPlan ?? undefined,
    };
  } catch (err) {
    logger.warn({ err }, "commandBrain: AI call failed");
    return {
      type: "error",
      text: "I couldn't reach the assistant right now. Please try again in a moment.",
      suggestedFollowUps: ["What needs my attention today?", "Show job overview"],
    };
  }
}
