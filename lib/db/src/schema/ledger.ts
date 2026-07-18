import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  integer,
  boolean,
  timestamp,
  date,
} from "drizzle-orm/pg-core";

export const ledgerAccountsTable = pgTable("ledger_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const journalEntriesTable = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryNo: text("entry_no").notNull().unique(),
  entryDate: date("entry_date", { mode: "string" }).notNull(),
  memo: text("memo"),
  refType: text("ref_type").notNull().default("manual"),
  refId: uuid("ref_id"),
  source: text("source").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const journalLinesTable = pgTable("journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull(),
  accountId: uuid("account_id").notNull(),
  debit: doublePrecision("debit").notNull().default(0),
  credit: doublePrecision("credit").notNull().default(0),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type LedgerAccountRow = typeof ledgerAccountsTable.$inferSelect;
export type JournalEntryRow = typeof journalEntriesTable.$inferSelect;
export type JournalLineRow = typeof journalLinesTable.$inferSelect;
