import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const plaidItemsTable = pgTable("plaid_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: text("item_id").notNull(),
  accessToken: text("access_token").notNull(),
  institutionName: text("institution_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PlaidItem = typeof plaidItemsTable.$inferSelect;
