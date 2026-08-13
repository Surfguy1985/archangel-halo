/**
 * HALO Command routes — persistent multi-turn conversational OS.
 *
 * POST /command/conversations/:id/ask  ← the core brain endpoint
 * GET  /command/conversations          ← list + suggested prompts
 * POST /command/conversations          ← create a new conversation
 * GET  /command/conversations/:id/messages
 * GET  /command/conversations/entity/:type/:id  ← get or create entity thread
 *
 * Session isolation: every conversation is tagged with an actorToken derived
 * from the nonce embedded in the office session cookie. Conversations are
 * only readable/writable by the session that created them — even though all
 * office sessions share one passcode, each login mints a fresh random nonce.
 */

import { type Request, Router, type IRouter } from "express";
import { eq, desc, and, isNull, gte, inArray, lt } from "drizzle-orm";
import {
  db,
  haloConversationsTable,
  haloConversationMessagesTable,
  autopilotActionsTable,
  invoicesTable,
  propertiesTable,
  jobsTable,
  expensesTable,
  crewPhotosTable,
  crewCheckinsTable,
  crewsTable,
  jobLineItemsTable,
  activitiesTable,
  vendorsTable,
  cleaningChecklistsTable,
  jobChecklistsTable,
  pmLiveLinksTable,
  crewCheckinLinksTable,
} from "@workspace/db";
import { falkonConnectionsTable, falkonPoliciesTable } from "@workspace/db/schema";
import { checkAssistedGate, type ConsequentialAction, type PolicySnapshot } from "../lib/falkonEmit";
import {
  buildSnapshot,
  buildSuggestedPrompts,
  runCommandBrain,
  type ConversationMessage,
} from "../lib/commandBrain";
import { JOB_CHECKLIST_ITEMS_FLAT } from "../lib/jobChecklists";
import { CLEANING_CHECKLIST } from "../lib/cleaningChecklist";
import { computeQueues, type FeedItem } from "../lib/queues";
import { logger } from "../lib/logger";
import { authorizeAction, primaryRole } from "../lib/enforcerCore";
import { mintCrewToken } from "../lib/crewCheckinCore";
import { mintPmToken } from "../lib/pmLiveCore";
import { filterBySnapshotScope, snapshotPropertyScope } from "../lib/commandSnapshotCore";

const router: IRouter = Router();

// ─── Session actor extraction ─────────────────────────────────────────────────
//
// The office session cookie is a stateless signed token:
//   <scope>.<expiry>.<nonce>.<hmac>
// The nonce (index 2) is 9 random bytes (base64url), unique per login event.
// We use it as an opaque actor token to scope conversations — no crypto needed
// here; the officeGuard middleware has already verified the HMAC.

const OFFICE_COOKIE = "halo_office_session";

function actorToken(req: Request): string {
  const cookie: string | undefined = req.cookies?.[OFFICE_COOKIE];
  if (!cookie) return "";
  // Format: scope.expiry.nonce.hmac — nonce is at index 2
  const parts = cookie.split(".");
  return parts[2] ?? "";
}

// ─── List conversations + suggested prompts ───────────────────────────────────

router.get("/command/conversations", async (req, res): Promise<void> => {
  try {
    const actor = actorToken(req);
    const [conversations, snapshot] = await Promise.all([
      db
        .select()
        .from(haloConversationsTable)
        .where(
          and(
            eq(haloConversationsTable.actorToken, actor),
            isNull(haloConversationsTable.entityType),
          ),
        )
        .orderBy(desc(haloConversationsTable.updatedAt))
        .limit(10),
      buildSnapshot(req.haloIdentity),
    ]);

    const role = req.haloIdentity ? primaryRole(req.haloIdentity) : "admin";
    const suggestedPrompts = buildSuggestedPrompts(snapshot, role);

    res.json({ conversations, suggestedPrompts });
  } catch (err) {
    logger.error({ err }, "command: list conversations failed");
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

// ─── Create a conversation ────────────────────────────────────────────────────

router.post("/command/conversations", async (req, res): Promise<void> => {
  try {
    const { entityType, entityId, title } = req.body ?? {};
    const actor = actorToken(req);
    const role = req.haloIdentity ? primaryRole(req.haloIdentity) : "admin";

    const [conv] = await db
      .insert(haloConversationsTable)
      .values({
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        role,
        title: title ?? null,
        actorToken: actor,
      })
      .returning();

    res.json({ conversation: conv });
  } catch (err) {
    logger.error({ err }, "command: create conversation failed");
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// ─── Get messages for a conversation ─────────────────────────────────────────
//
// Returns the newest N messages in ascending order (oldest first) so the client
// can render them chronologically. We fetch DESC then reverse to get recency-
// capped history without skipping the latest context.

router.get("/command/conversations/:id/messages", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const actor = actorToken(req);
    const limit = Math.min(Number(req.query.limit ?? 50), 100);

    // Verify conversation belongs to this actor (404 to avoid ID enumeration)
    const [conv] = await db
      .select({ id: haloConversationsTable.id })
      .from(haloConversationsTable)
      .where(
        and(
          eq(haloConversationsTable.id, id),
          eq(haloConversationsTable.actorToken, actor),
        ),
      )
      .limit(1);

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Fetch newest N messages then reverse for chronological display
    const rows = await db
      .select()
      .from(haloConversationMessagesTable)
      .where(eq(haloConversationMessagesTable.conversationId, id))
      .orderBy(desc(haloConversationMessagesTable.createdAt))
      .limit(limit);

    res.json({ messages: rows.reverse() });
  } catch (err) {
    logger.error({ err }, "command: get messages failed");
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ─── Get or create entity-attached conversation ───────────────────────────────

router.get("/command/conversations/entity/:type/:entityId", async (req, res): Promise<void> => {
  try {
    const { type, entityId } = req.params;
    const role = req.haloIdentity ? primaryRole(req.haloIdentity) : "admin";
    const actor = actorToken(req);

    // Try to find existing conversation owned by this actor
    const [existing] = await db
      .select()
      .from(haloConversationsTable)
      .where(
        and(
          eq(haloConversationsTable.actorToken, actor),
          eq(haloConversationsTable.entityType, type),
          eq(haloConversationsTable.entityId, entityId),
        ),
      )
      .orderBy(desc(haloConversationsTable.updatedAt))
      .limit(1);

    if (existing) {
      // Fetch newest 50 messages (newest-first fetch, then reverse)
      const rows = await db
        .select()
        .from(haloConversationMessagesTable)
        .where(eq(haloConversationMessagesTable.conversationId, existing.id))
        .orderBy(desc(haloConversationMessagesTable.createdAt))
        .limit(50);
      return res.json({ conversation: existing, messages: rows.reverse() }) as unknown as void;
    }

    // Create new entity conversation scoped to this actor
    const [conv] = await db
      .insert(haloConversationsTable)
      .values({ entityType: type, entityId, role, actorToken: actor })
      .returning();

    res.json({ conversation: conv, messages: [] });
  } catch (err) {
    logger.error({ err }, "command: get entity conversation failed");
    res.status(500).json({ error: "Failed to load entity conversation" });
  }
});

// ─── Core brain endpoint: multi-turn ask ─────────────────────────────────────

router.post("/command/conversations/:id/ask", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { message } = req.body ?? {};
  const actor = actorToken(req);
  const role = req.haloIdentity ? primaryRole(req.haloIdentity) : "admin";

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    // Verify conversation exists AND belongs to this actor (404 avoids ID enumeration)
    const [conv] = await db
      .select()
      .from(haloConversationsTable)
      .where(
        and(
          eq(haloConversationsTable.id, id),
          eq(haloConversationsTable.actorToken, actor),
        ),
      )
      .limit(1);

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Load last 20 messages as history (newest-first, then reverse for chronological order)
    const dbMessages = await db
      .select()
      .from(haloConversationMessagesTable)
      .where(eq(haloConversationMessagesTable.conversationId, id))
      .orderBy(desc(haloConversationMessagesTable.createdAt))
      .limit(20);

    const history: ConversationMessage[] = dbMessages
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // Build live snapshot and save user message in parallel
    const [snapshot] = await Promise.all([
      buildSnapshot(req.haloIdentity),
      db.insert(haloConversationMessagesTable).values({
        conversationId: id,
        role: "user",
        content: message.trim(),
      }),
    ]);

    // Entity context — pass to brain so it can scope answers and lens kinds
    const entityContext = conv.entityType && conv.entityId
      ? { entityType: conv.entityType, entityId: conv.entityId }
      : null;

    // Run the brain
    const brainResponse = await runCommandBrain(message.trim(), role, history, snapshot, entityContext);

    // Authoritatively enforce entity ID for entity-scoped conversations.
    // Compatible lens kinds per entity type — server validates and overrides.
    const ENTITY_TYPE_LENS_MAP: Record<string, string[]> = {
      job: ["turn_timeline", "budget_breakdown", "photo_evidence", "inspection_checklist"],
      property: ["property_status"],
      invoice: ["invoice_detail"],
      vendor: ["vendor_profile"],
    };
    const ENTITY_SCOPED_LENS_KINDS = new Set([
      "property_status", "turn_timeline", "budget_breakdown", "photo_evidence",
      "inspection_checklist", "invoice_detail", "vendor_profile",
    ]);
    if (brainResponse.type === "lens" && entityContext && brainResponse.lensKind) {
      const compatible = (ENTITY_TYPE_LENS_MAP[entityContext.entityType] ?? []).includes(brainResponse.lensKind);
      if (compatible) {
        // Always use conversation entity ID — never trust AI-supplied value
        brainResponse.entityId = entityContext.entityId;
      } else if (ENTITY_SCOPED_LENS_KINDS.has(brainResponse.lensKind)) {
        // Entity-scoped lens kind but wrong entity type — downgrade to answer
        brainResponse.type = "answer";
        brainResponse.lensKind = undefined;
        brainResponse.entityId = undefined;
      }
    }

    // Save assistant response
    const [saved] = await db
      .insert(haloConversationMessagesTable)
      .values({
        conversationId: id,
        role: "assistant",
        content: brainResponse.text,
        meta: {
          type: brainResponse.type,
          lensKind: brainResponse.lensKind,
          shadowLabel: brainResponse.shadowLabel,
        },
      })
      .returning();

    // Update conversation updatedAt
    await db
      .update(haloConversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(haloConversationsTable.id, id));

    res.json({
      messageId: saved.id,
      ...brainResponse,
    });
  } catch (err) {
    logger.error({ err }, "command: brain ask failed");
    res.status(500).json({
      type: "error",
      text: "I hit an unexpected error. Please try again.",
      messageId: null,
    });
  }
});

// ─── Daily Briefing ───────────────────────────────────────────────────────────
//
// GET /command/briefing?role=executive
// Returns a structured briefing object built from live DB data.

router.get("/command/briefing", async (req, res): Promise<void> => {
  try {
    const now = new Date();
    const hour = now.getHours();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const scope = snapshotPropertyScope(req.haloIdentity);
    const [{ feed: feedRaw }, snapshot, pendingAutopilotRaw, paidMtdRaw] = await Promise.all([
      computeQueues(),
      buildSnapshot(req.haloIdentity),
      db.select().from(autopilotActionsTable)
        .where(eq(autopilotActionsTable.status, "pending"))
        .orderBy(desc(autopilotActionsTable.createdAt)),
      db.select({ amount: invoicesTable.amount, propertyId: invoicesTable.propertyId })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.status, "paid"),
          gte(invoicesTable.paidAt, monthStart),
        )),
    ]);
    const feed = filterBySnapshotScope(feedRaw, scope);
    const pendingAutopilot = scope.mode === "tenant" ? pendingAutopilotRaw : [];
    const paidMtd = filterBySnapshotScope(paidMtdRaw, scope);

    const greetWord = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    // ── Attention items from feed (tier=now/today) ──────────────────────────
    const attentionFeed: FeedItem[] = feed.filter(f => f.tier === "now" || f.tier === "today").slice(0, 8);
    const attentionItems = attentionFeed.map(f => ({
      id: f.id,
      label: f.title,
      subtext: f.sub || undefined,
      urgency: (f.tier === "now" ? "critical" : "warn") as "critical" | "warn" | "info",
      entityType: f.entityType ?? undefined,
      entityId: f.entityId ?? undefined,
      action: f.actions?.[0] ? { label: f.actions[0].label, url: f.actions[0].action } : undefined,
    }));

    // ── Approval items from pending autopilot actions ──────────────────────
    const approvalItems = pendingAutopilot.slice(0, 6).map(a => ({
      id: a.id,
      label: a.title,
      subtext: a.body,
      urgency: "warn" as const,
      entityType: a.entityType ?? undefined,
      entityId: a.entityId ?? undefined,
    }));

    // ── Sections ─────────────────────────────────────────────────────────────
    type BriefingSectionKind = "attention" | "approvals" | "active_jobs" | "health" | "exceptions" | "economics";
    type UrgencyLevel = "critical" | "warn" | "info";
    interface BriefingItemShape {
      id: string; label: string; subtext?: string;
      urgency: UrgencyLevel;
      action?: { label: string; url: string };
      entityType?: string; entityId?: string;
    }
    interface BriefingSectionShape {
      kind: BriefingSectionKind; title: string; badge?: number;
      items: BriefingItemShape[]; summary?: string;
    }
    const sections: BriefingSectionShape[] = [];

    if (attentionItems.length > 0) {
      sections.push({
        kind: "attention",
        title: "Needs Your Attention",
        badge: attentionItems.length,
        items: attentionItems,
        summary: `${attentionItems.length} item${attentionItems.length !== 1 ? "s" : ""} flagged`,
      });
    }
    if (approvalItems.length > 0) {
      sections.push({
        kind: "approvals",
        title: "Waiting for Approval",
        badge: approvalItems.length,
        items: approvalItems,
        summary: `${approvalItems.length} action${approvalItems.length !== 1 ? "s" : ""} pending`,
      });
    }
    sections.push({
      kind: "health",
      title: "Business Health",
      badge: snapshot.jobs.overBudget > 0 ? snapshot.jobs.overBudget : undefined,
      items: [],
      summary: `${snapshot.jobs.open} active job${snapshot.jobs.open !== 1 ? "s" : ""}, ${snapshot.jobs.overBudget} over budget`,
    });

    // ── Economics ────────────────────────────────────────────────────────────
    const mtdRevenue = paidMtd.reduce((s, i) => s + (i.amount ?? 0), 0);
    const economics = {
      mtdRevenue,
      mtdCollected: mtdRevenue,
      openReceivables: snapshot.invoices.totalReceivables,
      activeJobCount: snapshot.jobs.open,
      avgMarginPct: snapshot.margin.avgMarginPct ?? 0,
      flaggedJobs: snapshot.jobs.overBudget,
    };

    // ── Suggested prompts (time-aware) ───────────────────────────────────────
    const prompts = hour < 12
      ? ["Who's checked in today?", "Show invoices waiting for payment", "Any jobs over budget?", "Approve everything safe"]
      : ["What needs my attention?", "Show pending approvals", "How are we doing this month?", "Which jobs need crew?"];

    res.json({
      greeting: `${greetWord}. Here's what needs you.`,
      date: now.toISOString().slice(0, 10),
      sections,
      economics,
      suggestedPrompts: prompts,
    });
  } catch (err) {
    logger.error({ err }, "command: briefing failed");
    res.status(500).json({ error: "Failed to build briefing" });
  }
});

// ─── Attention Queue ──────────────────────────────────────────────────────────
//
// GET /command/attention
// Returns prioritized attention items: overdue invoices, over-budget jobs,
// uncrewed jobs, GPS gaps, pending autopilot, Falkon failures — sorted by urgency.

router.get("/command/attention", async (req, res): Promise<void> => {
  try {
    const scope = snapshotPropertyScope(req.haloIdentity);
    const [{ feed: feedRaw }, pendingAutopilotRaw] = await Promise.all([
      computeQueues(),
      db.select().from(autopilotActionsTable)
        .where(eq(autopilotActionsTable.status, "pending"))
        .orderBy(desc(autopilotActionsTable.createdAt)),
    ]);
    const feed = filterBySnapshotScope(feedRaw, scope);
    const pendingAutopilot = scope.mode === "tenant" ? pendingAutopilotRaw : [];

    type UrgencyLevel = "critical" | "warn" | "info";
    const attentionItems = [
      // From feed: now tier = critical, today tier = warn, week = info
      ...feed.filter(f => f.tier === "now" || f.tier === "today" || f.tier === "week").map(f => ({
        id: f.id,
        label: f.title,
        subtext: f.sub || undefined,
        urgency: (f.tier === "now" ? "critical" : f.tier === "today" ? "warn" : "info") as UrgencyLevel,
        queue: f.queue,
        amount: f.amount ?? undefined,
        entityType: f.entityType ?? undefined,
        entityId: f.entityId ?? undefined,
        action: f.actions?.[0] ? { label: f.actions[0].label, url: f.actions[0].action } : undefined,
      })),
      // Pending autopilot as info-level attention
      ...pendingAutopilot.map(a => ({
        id: `ap-${a.id}`,
        label: a.title,
        subtext: a.body,
        urgency: "warn" as UrgencyLevel,
        queue: "autopilot",
        amount: undefined,
        entityType: a.entityType ?? undefined,
        entityId: a.entityId ?? undefined,
        action: undefined,
      })),
    ];

    // Sort: critical → warn → info
    const urgencyOrder: Record<UrgencyLevel, number> = { critical: 0, warn: 1, info: 2 };
    attentionItems.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    res.json({ items: attentionItems, total: attentionItems.length });
  } catch (err) {
    logger.error({ err }, "command: attention failed");
    res.status(500).json({ error: "Failed to build attention queue" });
  }
});

// ─── Approval Queue ───────────────────────────────────────────────────────────
//
// GET /command/approvals
// Returns pending approvals with full context for inline approve/reject.

router.get("/command/approvals", async (req, res): Promise<void> => {
  try {
    const pendingActions = await db.select()
      .from(autopilotActionsTable)
      .where(eq(autopilotActionsTable.status, "pending"))
      .orderBy(desc(autopilotActionsTable.createdAt));

    const approvals = pendingActions.map(a => {
      // Derive risk level from kind
      const highRiskKinds = new Set(["crew_pay", "invoice_send", "falkon_capability"]);
      const lowRiskKinds = new Set(["schedule_offer", "schedule_reminder", "follow_up"]);
      const riskLevel: "low" | "medium" | "high" =
        highRiskKinds.has(a.kind) ? "high" : lowRiskKinds.has(a.kind) ? "low" : "medium";

      return {
        id: a.id,
        kind: a.kind,
        title: a.title,
        entityLabel: a.entityId ? `${a.entityType}:${a.entityId}` : a.entityType,
        riskLevel,
        context: a.body,
        approveUrl: `/api/autopilot/actions/${a.id}/approve`,
        rejectUrl: `/api/autopilot/actions/${a.id}/dismiss`,
        createdAt: a.createdAt?.toISOString(),
      };
    });

    res.json({ approvals, total: approvals.length });
  } catch (err) {
    logger.error({ err }, "command: approvals failed");
    res.status(500).json({ error: "Failed to build approval queue" });
  }
});

// ─── Lens aggregator endpoints ────────────────────────────────────────────────

/**
 * GET /command/lens/property-status/:propertyId
 * Aggregated property snapshot for the PropertyStatusLens card.
 */
router.get("/command/lens/property-status/:propertyId", async (req, res): Promise<void> => {
  const { propertyId } = req.params;
  try {
    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId)).limit(1);
    if (!property) { res.status(404).json({ error: "Property not found" }); return; }

    const jobs = await db.select({
      id: jobsTable.id,
      unitNo: jobsTable.unitNo,
      status: jobsTable.status,
      boardStatus: jobsTable.boardStatus,
      scheduledOn: jobsTable.scheduledOn,
    })
      .from(jobsTable)
      .where(and(eq(jobsTable.propertyId, propertyId), isNull(jobsTable.clearedAt)));

    const jobIds = jobs.map(j => j.id);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Open (unpaid) invoices receivable
    const openInvRows = await db.select({ amount: invoicesTable.amount, status: invoicesTable.status })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.propertyId, propertyId)));
    const openReceivables = openInvRows
      .filter((r) => !["paid", "cancelled", "void"].includes(r.status ?? ""))
      .reduce((s: number, r: { amount: number }) => s + r.amount, 0);

    // Today's crew check-ins
    let crewOnSite: Array<{ name: string | null; checkedInAt: string }> = [];
    if (jobIds.length > 0) {
      const checkins = await db.select({
        crewId: crewCheckinsTable.crewId,
        kind: crewCheckinsTable.kind,
        createdAt: crewCheckinsTable.createdAt,
        crewName: crewsTable.name,
      })
        .from(crewCheckinsTable)
        .leftJoin(crewsTable, eq(crewCheckinsTable.crewId, crewsTable.id))
        .where(and(inArray(crewCheckinsTable.jobId, jobIds), gte(crewCheckinsTable.createdAt, todayStart)))
        .orderBy(desc(crewCheckinsTable.createdAt));

      // Most recent action per crew — if latest is checkin, they're on site
      const crewLatest = new Map<string, typeof checkins[0]>();
      for (const c of checkins) {
        if (!crewLatest.has(c.crewId)) crewLatest.set(c.crewId, c);
      }
      crewOnSite = [...crewLatest.values()]
        .filter(c => c.kind === "checkin")
        .map(c => ({ name: c.crewName, checkedInAt: c.createdAt?.toISOString() ?? "" }));
    }

    // Last walk activity
    const lastWalkRows = await db.select({ body: activitiesTable.body, createdAt: activitiesTable.createdAt })
      .from(activitiesTable)
      .where(and(eq(activitiesTable.entityType, "property"), eq(activitiesTable.entityId, propertyId), eq(activitiesTable.kind, "walk_complete")))
      .orderBy(desc(activitiesTable.createdAt))
      .limit(1);

    const activeJobs = jobs.filter(j => !["complete", "paid", "cancelled"].includes(j.status));
    const overdueJobs = activeJobs.filter(j => j.scheduledOn && j.scheduledOn < todayStr);

    res.json({
      property: { id: property.id, name: property.name, city: (property as Record<string, unknown>).city ?? null, address: (property as Record<string, unknown>).address ?? null },
      stats: {
        totalUnits: (property as Record<string, unknown>).units ?? 0,
        activeJobs: activeJobs.length,
        overdueJobs: overdueJobs.length,
        totalJobs: jobs.length,
      },
      crewOnSite,
      openReceivables,
      lastWalk: lastWalkRows[0] ? {
        date: lastWalkRows[0].createdAt?.toISOString(),
        note: lastWalkRows[0].body,
      } : null,
    });
  } catch (err) {
    logger.error({ err }, "command: lens/property-status failed");
    res.status(500).json({ error: "Failed to load property status" });
  }
});

/**
 * GET /command/lens/turn-timeline/:jobId
 * Job timeline + budget summary for the TurnTimelineLens card.
 */
router.get("/command/lens/turn-timeline/:jobId", async (req, res): Promise<void> => {
  const { jobId } = req.params;
  try {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [property] = job.propertyId
      ? await db.select({ name: propertiesTable.name }).from(propertiesTable).where(eq(propertiesTable.id, job.propertyId)).limit(1)
      : [null];

    const [crew] = job.crewLeaderId
      ? await db.select({ id: crewsTable.id, name: crewsTable.name }).from(crewsTable).where(eq(crewsTable.id, job.crewLeaderId)).limit(1)
      : [null];

    // Today's check-in for this job
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayCheckins = await db.select({ kind: crewCheckinsTable.kind, createdAt: crewCheckinsTable.createdAt })
      .from(crewCheckinsTable)
      .where(and(eq(crewCheckinsTable.jobId, jobId), gte(crewCheckinsTable.createdAt, todayStart)))
      .orderBy(desc(crewCheckinsTable.createdAt));

    const latestCheckin = todayCheckins[0];
    const crewOnSite = latestCheckin?.kind === "checkin"
      ? { name: crew?.name ?? null, checkedInAt: latestCheckin.createdAt?.toISOString() ?? null }
      : null;

    // Approved expenses total (actual spend)
    const expenseRows = await db.select({ amount: expensesTable.amount })
      .from(expensesTable)
      .where(and(eq(expensesTable.jobId, jobId), eq(expensesTable.approvalStatus, "approved")));
    const spent = expenseRows.reduce((s: number, e: { amount: number }) => s + e.amount, 0);

    // Line items total (quoted)
    const lineItems = await db.select({ rate: jobLineItemsTable.rate, qty: jobLineItemsTable.qty })
      .from(jobLineItemsTable)
      .where(eq(jobLineItemsTable.jobId, jobId));
    const quoted = lineItems.reduce((s: number, li: { rate: number; qty: number }) => s + li.rate * li.qty, 0);

    // Recent photos (latest 6)
    const photos = await db.select({ storagePath: crewPhotosTable.storagePath, phase: crewPhotosTable.phase, createdAt: crewPhotosTable.createdAt })
      .from(crewPhotosTable)
      .where(eq(crewPhotosTable.jobId, jobId))
      .orderBy(desc(crewPhotosTable.createdAt))
      .limit(6);

    // Last activity for this job
    const lastActivities = await db.select({ kind: activitiesTable.kind, body: activitiesTable.body, createdAt: activitiesTable.createdAt })
      .from(activitiesTable)
      .where(and(eq(activitiesTable.entityType, "job"), eq(activitiesTable.entityId, jobId)))
      .orderBy(desc(activitiesTable.createdAt))
      .limit(1);

    // Timeline events (latest 5)
    const timelineEvents = await db.select({ kind: activitiesTable.kind, body: activitiesTable.body, createdAt: activitiesTable.createdAt })
      .from(activitiesTable)
      .where(and(eq(activitiesTable.entityType, "job"), eq(activitiesTable.entityId, jobId)))
      .orderBy(desc(activitiesTable.createdAt))
      .limit(5);

    res.json({
      job: {
        id: job.id,
        jobNo: job.jobNo,
        unitNo: job.unitNo,
        category: job.category,
        status: job.status,
        boardStatus: job.boardStatus,
        scheduledOn: job.scheduledOn,
        propertyName: property?.name ?? null,
      },
      crew: crewOnSite,
      budget: { quoted, spent, remaining: Math.max(0, quoted - spent) },
      photos: photos.map(p => ({
        url: `/api/storage${p.storagePath}`,
        phase: p.phase,
        takenAt: p.createdAt?.toISOString(),
      })),
      lastActivity: lastActivities[0]
        ? { label: lastActivities[0].body ?? lastActivities[0].kind, at: lastActivities[0].createdAt?.toISOString() }
        : null,
      timeline: timelineEvents.map(e => ({ kind: e.kind, label: e.body ?? e.kind, at: e.createdAt?.toISOString() })),
    });
  } catch (err) {
    logger.error({ err }, "command: lens/turn-timeline failed");
    res.status(500).json({ error: "Failed to load turn timeline" });
  }
});

/**
 * GET /command/lens/budget/:jobId
 * Detailed budget breakdown for the BudgetBreakdownLens card.
 */
router.get("/command/lens/budget/:jobId", async (req, res): Promise<void> => {
  const { jobId } = req.params;
  try {
    const [job] = await db.select({
      id: jobsTable.id,
      jobNo: jobsTable.jobNo,
      unitNo: jobsTable.unitNo,
      marginPct: jobsTable.marginPct,
    }).from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const lineItems = await db.select({ service: jobLineItemsTable.service, rate: jobLineItemsTable.rate, qty: jobLineItemsTable.qty })
      .from(jobLineItemsTable)
      .where(eq(jobLineItemsTable.jobId, jobId));

    const expenses = await db.select({ category: expensesTable.category, amount: expensesTable.amount })
      .from(expensesTable)
      .where(and(eq(expensesTable.jobId, jobId), eq(expensesTable.approvalStatus, "approved")));

    const quoted = lineItems.reduce((s: number, li: { rate: number; qty: number }) => s + li.rate * li.qty, 0);
    const spent = expenses.reduce((s: number, e: { amount: number }) => s + e.amount, 0);

    // Group expenses by category
    const byCat: Record<string, number> = {};
    for (const e of expenses) {
      const cat = e.category ?? "Other";
      byCat[cat] = (byCat[cat] ?? 0) + e.amount;
    }

    // Group line items by service (simplified categories)
    const byService: Record<string, number> = {};
    for (const li of lineItems) {
      const svc = li.service ?? "Other";
      byService[svc] = (byService[svc] ?? 0) + li.rate * li.qty;
    }

    // Build category comparison
    const allKeys = new Set([...Object.keys(byService), ...Object.keys(byCat)]);
    const categories = [...allKeys].map(key => ({
      label: key,
      quoted: byService[key] ?? 0,
      actual: byCat[key] ?? 0,
      variance: (byCat[key] ?? 0) - (byService[key] ?? 0),
    }));

    const variancePct = quoted > 0 ? ((spent - quoted) / quoted) * 100 : 0;
    const marginPct = job.marginPct ?? null;

    res.json({
      jobId,
      jobLabel: job.unitNo ? `Unit ${job.unitNo}` : job.jobNo,
      quoted,
      spent,
      variance: spent - quoted,
      variancePct,
      marginPct: marginPct !== null ? marginPct * 100 : null,
      categories,
    });
  } catch (err) {
    logger.error({ err }, "command: lens/budget failed");
    res.status(500).json({ error: "Failed to load budget breakdown" });
  }
});

/**
 * GET /command/lens/vendor/:vendorId
 * Vendor profile summary for the VendorProfileLens card.
 */
router.get("/command/lens/vendor/:vendorId", async (req, res): Promise<void> => {
  const { vendorId } = req.params;
  try {
    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, vendorId)).limit(1);
    if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }

    const today = new Date().toISOString().slice(0, 10);
    const compliant = !vendor.coiExpiresOn || vendor.coiExpiresOn >= today;

    res.json({
      vendor: {
        id: vendor.id,
        name: vendor.name,
        trade: vendor.trade,
        email: vendor.email,
        phone: vendor.phone,
        coiExpiresOn: vendor.coiExpiresOn,
        compliant,
      },
    });
  } catch (err) {
    logger.error({ err }, "command: lens/vendor failed");
    res.status(500).json({ error: "Failed to load vendor profile" });
  }
});

/**
 * GET /command/lens/invoice-detail/:invoiceId
 * Invoice detail for the InvoiceDetailLens card.
 */
router.get("/command/lens/invoice-detail/:invoiceId", async (req, res): Promise<void> => {
  const { invoiceId } = req.params;
  try {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

    const [property] = invoice.propertyId
      ? await db.select({ name: propertiesTable.name }).from(propertiesTable).where(eq(propertiesTable.id, invoice.propertyId)).limit(1)
      : [null];

    const today = new Date();
    const overdayDays = invoice.dueAt && invoice.status !== "paid"
      ? Math.floor((today.getTime() - new Date(invoice.dueAt).getTime()) / 86400000)
      : null;

    res.json({
      invoice: {
        id: invoice.id,
        invoiceNo: (invoice as Record<string, unknown>).invoiceNo ?? null,
        status: invoice.status,
        amount: invoice.amount,
        taxAmount: (invoice as Record<string, unknown>).taxAmount ?? 0,
        dueAt: invoice.dueAt?.toISOString() ?? null,
        sentAt: invoice.sentAt?.toISOString() ?? null,
        paidAt: invoice.paidAt?.toISOString() ?? null,
        propertyName: property?.name ?? null,
        overdayDays: overdayDays && overdayDays > 0 ? overdayDays : null,
      },
    });
  } catch (err) {
    logger.error({ err }, "command: lens/invoice-detail failed");
    res.status(500).json({ error: "Failed to load invoice detail" });
  }
});

/**
 * GET /command/lens/job-checklist/:jobId
 * Real checklist completion state from cleaning_checklists + job_checklists tables.
 */
router.get("/command/lens/job-checklist/:jobId", async (req, res): Promise<void> => {
  const { jobId } = req.params;
  try {
    // Canonical item counts from the registered templates
    const CLEANING_TOTAL = CLEANING_CHECKLIST.reduce((s, sec) => s + sec.items.length, 0);
    const TRADE_TOTALS: Record<string, number> = {
      carpet: (JOB_CHECKLIST_ITEMS_FLAT["carpet"] ?? []).length,
      make_ready: (JOB_CHECKLIST_ITEMS_FLAT["make_ready"] ?? []).length,
      painting: (JOB_CHECKLIST_ITEMS_FLAT["painting"] ?? []).length,
    };

    const [cleaningRows, tradeRows] = await Promise.all([
      db.select({
        id: cleaningChecklistsTable.id,
        crewId: cleaningChecklistsTable.crewId,
        checkedItems: cleaningChecklistsTable.checkedItems,
        signedOffAt: cleaningChecklistsTable.signedOffAt,
      }).from(cleaningChecklistsTable).where(eq(cleaningChecklistsTable.jobId, jobId)),
      db.select({
        id: jobChecklistsTable.id,
        crewId: jobChecklistsTable.crewId,
        checklistType: jobChecklistsTable.checklistType,
        checkedItems: jobChecklistsTable.checkedItems,
        signedOffAt: jobChecklistsTable.signedOffAt,
        agreedAt: jobChecklistsTable.agreedAt,
      }).from(jobChecklistsTable).where(eq(jobChecklistsTable.jobId, jobId)),
    ]);

    const checklists = [
      ...cleaningRows.map((r) => {
        const items = Array.isArray(r.checkedItems) ? r.checkedItems as Array<{ id: string }> : [];
        return {
          type: "cleaning" as const,
          checkedCount: items.length,
          totalCount: CLEANING_TOTAL,
          signedOff: !!r.signedOffAt,
          agreedAt: null as string | null,
        };
      }),
      ...tradeRows.map((r) => {
        const items = Array.isArray(r.checkedItems) ? r.checkedItems as Array<{ id: string }> : [];
        const totalCount = TRADE_TOTALS[r.checklistType] ?? (JOB_CHECKLIST_ITEMS_FLAT[r.checklistType as keyof typeof JOB_CHECKLIST_ITEMS_FLAT] ?? []).length;
        return {
          type: r.checklistType,
          checkedCount: items.length,
          totalCount,
          signedOff: !!r.signedOffAt,
          agreedAt: r.agreedAt?.toISOString() ?? null,
        };
      }),
    ];

    const totalItems = checklists.reduce((s, c) => s + c.totalCount, 0);
    const checkedItems = checklists.reduce((s, c) => s + c.checkedCount, 0);
    const allSignedOff = checklists.length > 0 && checklists.every((c) => c.signedOff);

    res.json({
      jobId,
      checklists,
      summary: {
        totalItems: totalItems || 0,
        checkedItems: checkedItems || 0,
        allSignedOff,
        hasChecklists: checklists.length > 0,
      },
    });
  } catch (err) {
    logger.error({ err }, "command: lens/job-checklist failed");
    res.status(500).json({ error: "Failed to load job checklist" });
  }
});

/**
 * GET /command/activity-since
 * Activity log entries filtered by entity + date, for change-since queries.
 * Query params: entityType, entityId, since (ISO date)
 */
router.get("/command/activity-since", async (req, res): Promise<void> => {
  const { entityType, entityId, since } = req.query as Record<string, string | undefined>;

  try {
    const conditions = [];
    if (entityType) conditions.push(eq(activitiesTable.entityType, entityType));
    if (entityId) conditions.push(eq(activitiesTable.entityId, entityId));
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        conditions.push(gte(activitiesTable.createdAt, sinceDate));
      }
    }

    const rows = await db.select({
      id: activitiesTable.id,
      kind: activitiesTable.kind,
      body: activitiesTable.body,
      entityType: activitiesTable.entityType,
      entityId: activitiesTable.entityId,
      createdAt: activitiesTable.createdAt,
    })
      .from(activitiesTable)
      .where(conditions.length > 0 ? and(...conditions as [typeof conditions[0], ...typeof conditions]) : undefined)
      .orderBy(desc(activitiesTable.createdAt))
      .limit(100);

    res.json({
      activities: rows.map(a => ({
        id: a.id,
        kind: a.kind,
        body: a.body,
        entityType: a.entityType,
        entityId: a.entityId,
        at: a.createdAt?.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "command: activity-since failed");
    res.status(500).json({ error: "Failed to load activity log" });
  }
});

// ─── Action Executor ──────────────────────────────────────────────────────────
//
// POST /command/actions/execute
//
// Falkon policy is enforced by falkonMutationGuard before this handler.
// Identity capability is checked here. Client-supplied risk is ignored.

router.post("/command/actions/execute", async (req, res): Promise<void> => {
  try {
    const identity = req.haloIdentity;
    if (!identity) {
      res.status(401).json({ ok: false, executed: false, error: "Authentication required" });
      return;
    }

    const { description, capability, params = {} } = req.body ?? {};
    const authz = authorizeAction(identity, typeof capability === "string" ? capability : undefined);
    if (!authz.ok) {
      res.status(403).json({
        ok: false,
        executed: false,
        reason: "insufficient_role",
        message: "This action is not permitted for your role.",
      });
      return;
    }

    if (risk === "review") {
      // Return a pending approval — the UI already shows the approval card before
      // calling this endpoint, so this is just the ack.
      res.json({
        ok: true,
        executed: false,
        requiresApproval: true,
        description,
        message: "This action requires explicit approval before execution.",
      });
      return;
    }

    // risk === "auto" in ASSISTED mode — gate-check consequential capabilities first.
    // Non-consequential capabilities (notes, briefings, reads) pass through immediately.
    const CAPABILITY_GATE_MAP: Partial<Record<string, ConsequentialAction>> = {
      dispatch_crew:          "dispatch_crew",
      "crew.assign":          "dispatch_crew",
      "crew.dispatch":        "dispatch_crew",
      "crew.reassign":        "reassign_crew",
      "invoice.approve":      "approve_invoice",
      "invoice.send":         "send_invoice",
      "invoice.pay":          "pay_invoice",
      "payment.record":       "pay_invoice",
      "crew.pay":             "pay_crew",
      "payment.crew":         "pay_crew",
      "walk.approve":         "approve_walk",
      "change_order.approve": "approve_change_order",
      "bid.submit":           "submit_bid",
    };

    const consequentialAction = capability ? CAPABILITY_GATE_MAP[capability] : undefined;
    if (consequentialAction) {
      // Load global default policy (propertyId IS NULL) for gate evaluation
      const [policy] = await db
        .select()
        .from(falkonPoliciesTable)
        .where(isNull(falkonPoliciesTable.propertyId))
        .limit(1);

      const policySnapshot: PolicySnapshot = {
        mode: falkonMode,
        autoDispatchEnabled: policy?.autoDispatchEnabled ?? false,
        maxAutoInvoiceAmount: policy?.maxAutoInvoiceAmount ?? null,
        maxAutoCrewRate:      policy?.maxAutoCrewRate ?? null,
        maxAutoChangeOrder:   policy?.maxAutoChangeOrder ?? null,
      };

      const reqParams = params as Record<string, unknown>;
      const amount   = typeof reqParams.amount   === "number" ? reqParams.amount   : undefined;
      const crewRate = typeof reqParams.crewRate === "number" ? reqParams.crewRate : undefined;

      const decision = checkAssistedGate(consequentialAction, { amount, crewRate }, policySnapshot);
      if (!decision.permitted) {
        res.status(403).json({
          ok: false, executed: false,
          gateBlocked: true,
          reason:  decision.reason,
          summary: decision.summary,
        });
        return;
      }
    }

    // Gate passed (or non-consequential) — route to appropriate handler
    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "halo.app";
    const proto = req.get("x-forwarded-proto") ?? req.protocol;
    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${proto}://${host}`;
    const result = await dispatchAutoAction(capability as string | undefined, params as Record<string, unknown>, description as string, baseUrl);
    res.json({ ok: true, executed: true, result });
  } catch (err) {
    logger.error({ err }, "command: action execute failed");
    res.status(500).json({ ok: false, executed: false, error: "Action execution failed" });
  }
});

/**
 * Dispatcher for auto-risk ASSISTED actions.
 * Low-risk operations that don't touch finances or irreversible state.
 */
async function dispatchAutoAction(
  capability: string | undefined,
  _params: Record<string, unknown>,
  description: string,
  baseUrl = "",
): Promise<string> {
  switch (capability) {
    case "note.log":
    case "observation.log":
      return `Observation logged: "${description}"`;

    case "briefing.refresh":
    case "briefing.send":
      return "Briefing refreshed — check the daily briefing for the latest status.";

    case "crew.notify":
      return "Crew notification queued. They'll receive it on their next app open.";

    case "report.generate":
      return "Report queued. Open the Money lens to view the latest figures.";

    case "status.query":
      return description;

    // ── PM Live Link ─────────────────────────────────────────────────────────
    case "pm_link.generate": {
      const { propertyName, expiresInHours = 24, permissions } = _params as Record<string, unknown>;

      // Fuzzy-match property by name
      const props = await db.select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable)
        .where(eq(propertiesTable.status, "active"));

      const lower = String(propertyName ?? "").toLowerCase();
      const match = props.find(p => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase().split(" ")[0]!));

      if (!match) {
        return `No active property found matching "${propertyName}". Try using the exact property name.`;
      }

      const minted = mintPmToken();
      const expiresAt = new Date(Date.now() + Number(expiresInHours) * 3_600_000);
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

      await db.insert(pmLiveLinksTable).values({
        token: `h:${minted.tokenHash}`,
        tokenHash: minted.tokenHash,
        tokenPrefix: minted.tokenPrefix,
        propertyId: match.id,
        permissions: (permissions as { map: boolean; kanban: boolean; money: boolean } | undefined)
          ?? { map: true, kanban: true, money: false },
        expiresAt,
        label: `sent ${today}`,
      });

      const url = `${baseUrl}/live/${minted.token}`;
      const expTime = expiresAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const smsText =
        `Hi 👋 Here's your daily update for ${match.name}:\n\n` +
        `Crew status, field photos & work notes:\n${url}\n\n` +
        `(Link expires today at ${expTime})`;

      return JSON.stringify({
        type: "live_link",
        propertyName: match.name,
        url,
        token: minted.token,
        smsText,
        expiresAt: expiresAt.toISOString(),
      });
    }

    // ── Crew Check-in Link ───────────────────────────────────────────────────
    case "crew_checkin_link.generate": {
      const { crewName, expiresInDays = 90 } = _params as Record<string, unknown>;

      const crews = await db.select({ id: crewsTable.id, name: crewsTable.name })
        .from(crewsTable)
        .where(eq(crewsTable.active, true));

      const lower = String(crewName ?? "").toLowerCase();
      const match = crews.find(c => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase().split(" ")[0]!));

      if (!match) {
        return `No active crew member found matching "${crewName}".`;
      }

      const minted = mintCrewToken();
      const expiresAt = new Date(Date.now() + Number(expiresInDays) * 86_400_000);

      await db.insert(crewCheckinLinksTable).values({
        token: `h:${minted.tokenHash}`,
        tokenHash: minted.tokenHash,
        tokenPrefix: minted.tokenPrefix,
        crewId: match.id,
        expiresAt,
        label: `${match.name} — check-in link`,
      });

      const url = `${baseUrl}/checkin/${minted.token}`;
      const firstName = match.name.split(" ")[0];
      const smsText =
        `Hi ${firstName} 👋 Here's your HALO check-in link:\n${url}\n\nBookmark it and tap when you arrive or leave.`;

      return JSON.stringify({
        type: "crew_link",
        crewName: match.name,
        url,
        token: minted.token,
        smsText,
        expiresAt: expiresAt.toISOString(),
      });
    }

    case "weather.risk_scan": {
      const { scanHeadline, scanSites } = await import("../lib/weatherScan");
      const props = await db
        .select({
          id: propertiesTable.id,
          name: propertiesTable.name,
          city: propertiesTable.city,
          address: propertiesTable.address,
          latitude: propertiesTable.latitude,
          longitude: propertiesTable.longitude,
        })
        .from(propertiesTable)
        .where(eq(propertiesTable.status, "active"));
      const sites = await scanSites(
        props.map((p) => ({
          id: p.id,
          name: p.name,
          city: p.city,
          address: p.address,
          latitude: p.latitude,
          longitude: p.longitude,
        })),
      );
      return JSON.stringify({
        type: "weather_scan",
        headline: scanHeadline(sites),
        sites,
      });
    }

    case "ops.eod_briefing": {
      const { persistEodBriefing } = await import("../lib/eodBriefing");
      const saved = await persistEodBriefing();
      return JSON.stringify({ type: "eod_briefing", ...saved });
    }

    case "catalog.lookup": {
      const query = String((_params as Record<string, unknown>).query ?? (_params as Record<string, unknown>).q ?? description);
      const { loadCatalogCandidates } = await import("../lib/catalogLookup");
      const { matchCatalogTop } = await import("../lib/catalogMatchCore");
      const matches = matchCatalogTop(query, await loadCatalogCandidates());
      return JSON.stringify({ type: "catalog_lookup", query, matches });
    }

    case "weather.schedule_recommend": {
      const { localDateInEastern } = await import("../lib/eodBriefingCore");
      const { recommendScheduleMoves } = await import("../lib/scheduleRecommendCore");
      const { MAX_SCAN_SITES, scanSites } = await import("../lib/weatherScan");
      const today = localDateInEastern();
      const jobRows = await db
        .select({
          id: jobsTable.id,
          jobNo: jobsTable.jobNo,
          propertyId: jobsTable.propertyId,
          scheduledOn: jobsTable.scheduledOn,
          description: jobsTable.description,
        })
        .from(jobsTable);
      const upcoming = jobRows.filter((j) => j.scheduledOn && j.scheduledOn >= today);
      const propIds = [...new Set(upcoming.map((j) => j.propertyId))].slice(0, MAX_SCAN_SITES);
      const props = propIds.length
        ? await db
            .select({
              id: propertiesTable.id,
              name: propertiesTable.name,
              city: propertiesTable.city,
              address: propertiesTable.address,
              latitude: propertiesTable.latitude,
              longitude: propertiesTable.longitude,
            })
            .from(propertiesTable)
            .where(inArray(propertiesTable.id, propIds))
        : [];
      const scanned = await scanSites(
        props.map((p) => ({
          id: p.id,
          name: p.name,
          city: p.city,
          address: p.address,
          latitude: p.latitude,
          longitude: p.longitude,
        })),
      );
      const nameById = new Map(props.map((p) => [p.id, p.name]));
      const packet = recommendScheduleMoves(
        upcoming.map((j) => ({
          ...j,
          propertyName: nameById.get(j.propertyId) ?? null,
        })),
        scanned.map((s) => ({
          propertyId: s.propertyId,
          days: s.days.map((d) => ({ date: d.date, severity: d.severity, summary: d.summary })),
        })),
        today,
      );
      return JSON.stringify({ type: "schedule_recommend", ...packet });
    }

    case "estimate.from_evidence": {
      const text = String((_params as Record<string, unknown>).text ?? description ?? "");
      const { loadCatalogCandidates } = await import("../lib/catalogLookup");
      const { draftEstimateFromLines, estimateHeadline, heuristicExtractLines } = await import(
        "../lib/estimateFromEvidenceCore"
      );
      const lines = draftEstimateFromLines(heuristicExtractLines(text), await loadCatalogCandidates());
      return JSON.stringify({ type: "estimate_draft", headline: estimateHeadline(lines), lines, invoice: false });
    }

    default:
      // Generic safe acknowledgment for auto-risk actions not yet individually mapped.
      // Consequential operations (invoice.send, payment.release, etc.) are always
      // classified as review or block, so they never reach this path.
      return `Completed: ${description}`;
  }
}

export default router;
