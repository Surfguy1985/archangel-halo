import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// ─── Persistent HALO conversation threads ────────────────────────────────────
// One row per conversation (global or attached to a business entity).
// Messages are stored in halo_conversation_messages.

export const haloConversationsTable = pgTable("halo_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null = global office conversation; set for entity-scoped threads */
  entityType: text("entity_type"), // 'property'|'job'|'unit'|'crew'|'vendor'|'invoice'
  entityId: text("entity_id"),
  /** Human-readable title (auto-generated from first message or entity name) */
  title: text("title"),
  /** Caller's role when the conversation was created */
  role: text("role").default("executive"),
  /**
   * Session-scoped actor token — the nonce extracted from the office session
   * cookie (the unique random part minted at login time). Conversations are
   * only visible to the session that created them; different browser/device
   * sessions have different nonces even if they share the same passcode.
   */
  actorToken: text("actor_token").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HaloConversation = typeof haloConversationsTable.$inferSelect;
export type NewHaloConversation = typeof haloConversationsTable.$inferInsert;

// ─── Individual messages within a conversation ───────────────────────────────

export const haloConversationMessagesTable = pgTable("halo_conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => haloConversationsTable.id, { onDelete: "cascade" }),
  /** 'user' | 'assistant' | 'system' | 'tool' */
  role: text("role").notNull(),
  /** The message text content */
  content: text("content").notNull().default(""),
  /** Structured tool calls / actions / lens refs attached to this message */
  toolCalls: jsonb("tool_calls"),
  /** Audit / Falkon job ID / idempotency key / actor metadata */
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HaloConversationMessage = typeof haloConversationMessagesTable.$inferSelect;
export type NewHaloConversationMessage = typeof haloConversationMessagesTable.$inferInsert;
