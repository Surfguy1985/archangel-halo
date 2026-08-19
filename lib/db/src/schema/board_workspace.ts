import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Board workspace: the office's own columns and saved views.
 *
 * HALO's boards are opinionated on purpose — the five rails are wired to the
 * money flow and cannot be user-defined. What the office CAN own is the
 * information layered on top: extra fields they track per job, and named views
 * (filters + layout) they switch between. That is the ClickUp-style flexibility
 * without handing the workflow itself to arbitrary configuration.
 */

/** A user-defined column the office tracks on job cards. */
export const boardFieldDefsTable = pgTable("board_field_defs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Which board the field belongs to. Only "job" today; dispatch/make-ready
  // reuse the same table when they adopt the views layer.
  scope: text("scope").notNull().default("job"),
  // Stable slug used as the key inside jobs.custom_fields. Never reused after
  // delete — values are keyed by it, so a recycled key would inherit old data.
  key: text("key").notNull(),
  label: text("label").notNull(),
  // "text" | "number" | "money" | "select" | "date" | "checkbox"
  type: text("type").notNull(),
  // For select: [{ value, label, color }]
  options: jsonb("options"),
  // Shown under the card title on the board when true; always available in the
  // table view. Keeps the board tiles from drowning in fields.
  showOnCard: boolean("show_on_card").notNull().default(false),
  position: doublePrecision("position").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A saved layout: view type + filters + sort + grouping + visible columns. */
export const boardViewsTable = pgTable("board_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull().default("job"),
  name: text("name").notNull(),
  // "board" | "list" | "table"
  viewType: text("view_type").notNull().default("board"),
  // { search, propertyIds[], rails[], crewIds[], services[], flags[], custom{} }
  filters: jsonb("filters"),
  // { key, dir } — key may be a built-in column or "cf:<fieldKey>"
  sort: jsonb("sort"),
  // Built-in grouping key: "rail" | "property" | "crew" | "none"
  groupBy: text("group_by").notNull().default("rail"),
  // Column keys shown in table/list view, in order.
  visibleColumns: jsonb("visible_columns"),
  position: doublePrecision("position").notNull().default(0),
  // Exactly one default per scope is enforced in the route, not the DB.
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
