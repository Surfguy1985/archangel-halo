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
import { eq, desc, and, isNull } from "drizzle-orm";
import { db, haloConversationsTable, haloConversationMessagesTable } from "@workspace/db";
import {
  buildSnapshot,
  buildSuggestedPrompts,
  runCommandBrain,
  type ConversationMessage,
} from "../lib/commandBrain";
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

export default router;
