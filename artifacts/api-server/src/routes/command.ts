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
import { eq, desc, and, isNull, gte } from "drizzle-orm";
import { db, haloConversationsTable, haloConversationMessagesTable, autopilotActionsTable, invoicesTable, propertiesTable, jobsTable } from "@workspace/db";
import {
  buildSnapshot,
  buildSuggestedPrompts,
  runCommandBrain,
  type ConversationMessage,
} from "../lib/commandBrain";
import { computeQueues, type FeedItem } from "../lib/queues";
import { logger } from "../lib/logger";

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
      buildSnapshot(),
    ]);

    const role = "executive"; // default; real role-detection is a future enhancement
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
    const { entityType, entityId, role = "executive", title } = req.body ?? {};
    const actor = actorToken(req);

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
    const role = (req.query.role as string) ?? "executive";
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
  const { message, role = "executive" } = req.body ?? {};
  const actor = actorToken(req);

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
      buildSnapshot(),
      db.insert(haloConversationMessagesTable).values({
        conversationId: id,
        role: "user",
        content: message.trim(),
      }),
    ]);

    // Run the brain
    const brainResponse = await runCommandBrain(message.trim(), role, history, snapshot);

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

    const [{ feed }, snapshot, pendingAutopilot, paidMtd] = await Promise.all([
      computeQueues(),
      buildSnapshot(),
      db.select().from(autopilotActionsTable)
        .where(eq(autopilotActionsTable.status, "pending"))
        .orderBy(desc(autopilotActionsTable.createdAt)),
      db.select({ amount: invoicesTable.amount })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.status, "paid"),
          gte(invoicesTable.paidAt, monthStart),
        )),
    ]);

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
    const [{ feed }, pendingAutopilot] = await Promise.all([
      computeQueues(),
      db.select().from(autopilotActionsTable)
        .where(eq(autopilotActionsTable.status, "pending"))
        .orderBy(desc(autopilotActionsTable.createdAt)),
    ]);

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

export default router;
