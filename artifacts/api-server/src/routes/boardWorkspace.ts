/**
 * Board workspace — the office's own columns and saved views for the job board.
 *
 * The five rails are NOT configurable: they are wired to the money flow (PO
 * gate, invoice, crew pay) and a user-defined workflow would break those
 * guards. What the office owns here is the layer on top — extra fields tracked
 * per job, and named views (filters + layout) they switch between.
 *
 * Field VALUES live in `jobs.custom_fields`, keyed by the def's `key`. Deleting
 * a field archives the def and leaves the values in place, so a delete by
 * mistake is recoverable and no job write is needed to drop a column.
 */

import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import {
  db,
  boardFieldDefsTable,
  boardViewsTable,
  jobsTable,
} from "@workspace/db";
import {
  ListBoardWorkspaceResponse,
  CreateBoardFieldBody,
  CreateBoardFieldResponse,
  UpdateBoardFieldParams,
  UpdateBoardFieldBody,
  UpdateBoardFieldResponse,
  DeleteBoardFieldParams,
  DeleteBoardFieldResponse,
  CreateBoardViewBody,
  CreateBoardViewResponse,
  UpdateBoardViewParams,
  UpdateBoardViewBody,
  UpdateBoardViewResponse,
  DeleteBoardViewParams,
  DeleteBoardViewResponse,
  SetJobCustomFieldsParams,
  SetJobCustomFieldsBody,
  SetJobCustomFieldsResponse,
} from "@workspace/api-zod";

export const boardWorkspaceRouter: IRouter = Router();

const FIELD_TYPES = new Set([
  "text",
  "number",
  "money",
  "select",
  "date",
  "checkbox",
]);
const VIEW_TYPES = new Set(["board", "list", "table"]);
const GROUP_BYS = new Set(["rail", "property", "crew", "none"]);

type FieldDef = typeof boardFieldDefsTable.$inferSelect;

type SelectOption = { value: string; label: string; color?: string | null };

function serField(f: FieldDef) {
  return {
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.type,
    options: (f.options as SelectOption[] | null) ?? null,
    showOnCard: f.showOnCard,
    position: f.position,
  };
}

function serView(v: typeof boardViewsTable.$inferSelect) {
  return {
    id: v.id,
    name: v.name,
    viewType: v.viewType,
    filters: (v.filters as Record<string, unknown> | null) ?? null,
    sort: (v.sort as Record<string, unknown> | null) ?? null,
    groupBy: v.groupBy,
    visibleColumns: (v.visibleColumns as string[] | null) ?? null,
    position: v.position,
    isDefault: v.isDefault,
  };
}

/**
 * Slug for the value bag. Keys are permanent: values are stored under them, so
 * renaming a field's LABEL never changes its key, and a key is never handed to
 * a second field while the first is live.
 */
function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "field";
}

async function uniqueKey(scope: string, label: string): Promise<string> {
  const base = slugify(label);
  const live = await db
    .select({ key: boardFieldDefsTable.key })
    .from(boardFieldDefsTable)
    .where(
      and(
        eq(boardFieldDefsTable.scope, scope),
        eq(boardFieldDefsTable.archived, false),
      ),
    );
  const taken = new Set(live.map((r) => r.key));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 200; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

function normalizeOptions(raw: unknown): SelectOption[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SelectOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const rec = o as Record<string, unknown>;
    const value =
      typeof rec.value === "string" && rec.value.trim()
        ? rec.value.trim()
        : typeof rec.label === "string"
          ? slugify(rec.label)
          : "";
    if (!value) continue;
    out.push({
      value,
      label:
        typeof rec.label === "string" && rec.label.trim()
          ? rec.label.trim()
          : value,
      color: typeof rec.color === "string" ? rec.color : null,
    });
  }
  return out.length ? out : null;
}

/**
 * Coerce and validate one value against its field definition. Returns
 * `{ ok: false, error }` rather than throwing: there is no global error
 * middleware in this server, so routes must answer for themselves.
 */
function coerceValue(
  def: FieldDef,
  raw: unknown,
): { ok: true; value: string | number | boolean | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  switch (def.type) {
    case "text":
      return typeof raw === "string"
        ? { ok: true, value: raw.slice(0, 2000) }
        : { ok: false, error: `${def.label} must be text` };
    case "number":
    case "money": {
      if (typeof raw !== "number" && typeof raw !== "string") {
        return { ok: false, error: `${def.label} must be a number` };
      }
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : { ok: false, error: `${def.label} must be a number` };
    }
    case "checkbox":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
      return { ok: false, error: `${def.label} must be yes or no` };
    case "date": {
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { ok: false, error: `${def.label} must be a date (YYYY-MM-DD)` };
      }
      // Date-only values stay as literal YYYY-MM-DD strings — never parsed
      // through Date, which would shift the day by the server's offset. The
      // calendar check below compares parts, so it can't shift anything.
      const [y, m, d] = raw.split("-").map(Number);
      const probe = new Date(Date.UTC(y, m - 1, d));
      if (
        probe.getUTCFullYear() !== y ||
        probe.getUTCMonth() !== m - 1 ||
        probe.getUTCDate() !== d
      ) {
        return { ok: false, error: `${raw} isn't a real date` };
      }
      return { ok: true, value: raw };
    }
    case "select": {
      const options = (def.options as SelectOption[] | null) ?? [];
      const value = String(raw);
      return options.some((o) => o.value === value)
        ? { ok: true, value }
        : { ok: false, error: `${value} is not a choice on ${def.label}` };
    }
    default:
      return { ok: false, error: `${def.label} has an unknown field type` };
  }
}

/**
 * Wrap a handler so a thrown Zod error or database fault becomes a JSON answer.
 * This server has no global error middleware — an uncaught throw in an async
 * route hangs the request.
 */
function guard(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ZodError) {
        if (!res.headersSent) {
          res.status(400).json({
            error: err.issues[0]?.message
              ? `That request didn't look right: ${err.issues[0].message}`
              : "That request didn't look right",
          });
        }
        return;
      }
      console.error("[board-workspace]", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Something went wrong on the board" });
      }
    }
  };
}

// ---------------------------------------------------------------------------
// One call for the whole toolbar: field defs + saved views.
// ---------------------------------------------------------------------------
boardWorkspaceRouter.get("/board/workspace", guard(async (req, res) => {
  const scope =
    typeof req.query.scope === "string" && req.query.scope ? req.query.scope : "job";
  const [fields, views] = await Promise.all([
    db
      .select()
      .from(boardFieldDefsTable)
      .where(
        and(
          eq(boardFieldDefsTable.scope, scope),
          eq(boardFieldDefsTable.archived, false),
        ),
      )
      .orderBy(asc(boardFieldDefsTable.position), asc(boardFieldDefsTable.createdAt)),
    db
      .select()
      .from(boardViewsTable)
      .where(eq(boardViewsTable.scope, scope))
      .orderBy(asc(boardViewsTable.position), asc(boardViewsTable.createdAt)),
  ]);
  res.json(
    ListBoardWorkspaceResponse.parse({
      fields: fields.map(serField),
      views: views.map(serView),
    }),
  );
}));

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------
boardWorkspaceRouter.post("/board/fields", guard(async (req, res) => {
  const body = CreateBoardFieldBody.parse(req.body);
  const label = body.label.trim();
  if (!label) {
    res.status(400).json({ error: "Give the field a name" });
    return;
  }
  if (!FIELD_TYPES.has(body.type)) {
    res.status(400).json({ error: `Unknown field type ${body.type}` });
    return;
  }
  const options = body.type === "select" ? normalizeOptions(body.options) : null;
  if (body.type === "select" && !options) {
    res.status(400).json({ error: "A dropdown needs at least one choice" });
    return;
  }
  const scope = body.scope ?? "job";
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${boardFieldDefsTable.position}), 0)` })
    .from(boardFieldDefsTable)
    .where(eq(boardFieldDefsTable.scope, scope));
  const [created] = await db
    .insert(boardFieldDefsTable)
    .values({
      scope,
      key: await uniqueKey(scope, label),
      label,
      type: body.type,
      options,
      showOnCard: body.showOnCard ?? false,
      position: Number(max ?? 0) + 1,
    })
    .returning();
  res.status(201).json(CreateBoardFieldResponse.parse(serField(created)));
}));

boardWorkspaceRouter.patch("/board/fields/:id", guard(async (req, res) => {
  const { id } = UpdateBoardFieldParams.parse(req.params);
  const body = UpdateBoardFieldBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(boardFieldDefsTable)
    .where(eq(boardFieldDefsTable.id, id));
  if (!existing || existing.archived) {
    res.status(404).json({ error: "Field not found" });
    return;
  }
  // The key is deliberately NOT editable — job values are stored under it.
  const options =
    body.options !== undefined
      ? existing.type === "select"
        ? normalizeOptions(body.options)
        : null
      : (existing.options as SelectOption[] | null);
  if (existing.type === "select" && body.options !== undefined && !options) {
    res.status(400).json({ error: "A dropdown needs at least one choice" });
    return;
  }
  const [updated] = await db
    .update(boardFieldDefsTable)
    .set({
      ...(body.label != null ? { label: body.label.trim() } : {}),
      ...(body.options !== undefined ? { options } : {}),
      ...(body.showOnCard != null ? { showOnCard: body.showOnCard } : {}),
      ...(body.position != null ? { position: body.position } : {}),
    })
    .where(eq(boardFieldDefsTable.id, id))
    .returning();
  res.json(UpdateBoardFieldResponse.parse(serField(updated)));
}));

boardWorkspaceRouter.delete("/board/fields/:id", guard(async (req, res) => {
  const { id } = DeleteBoardFieldParams.parse(req.params);
  // Archive, never hard-delete: the values stay in jobs.custom_fields so an
  // accidental delete loses nothing, and no bulk job write is needed.
  const [archived] = await db
    .update(boardFieldDefsTable)
    .set({ archived: true })
    .where(eq(boardFieldDefsTable.id, id))
    .returning();
  if (!archived) {
    res.status(404).json({ error: "Field not found" });
    return;
  }
  res.json(DeleteBoardFieldResponse.parse({ ok: true }));
}));

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------
async function clearOtherDefaults(
  tx: Pick<typeof db, "update">,
  scope: string,
  keepId: string | null,
) {
  await tx
    .update(boardViewsTable)
    .set({ isDefault: false })
    .where(
      keepId
        ? and(
            eq(boardViewsTable.scope, scope),
            eq(boardViewsTable.isDefault, true),
            sql`${boardViewsTable.id} <> ${keepId}`,
          )
        : and(
            eq(boardViewsTable.scope, scope),
            eq(boardViewsTable.isDefault, true),
          ),
    );
}

boardWorkspaceRouter.post("/board/views", guard(async (req, res) => {
  const body = CreateBoardViewBody.parse(req.body);
  const name = body.name.trim();
  if (!name) {
    res.status(400).json({ error: "Give the view a name" });
    return;
  }
  if (!VIEW_TYPES.has(body.viewType)) {
    res.status(400).json({ error: `Unknown view type ${body.viewType}` });
    return;
  }
  if (body.groupBy != null && !GROUP_BYS.has(body.groupBy)) {
    res.status(400).json({ error: `Unknown grouping ${body.groupBy}` });
    return;
  }
  const scope = body.scope ?? "job";
  const created = await db.transaction(async (tx) => {
  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${boardViewsTable.position}), 0)` })
    .from(boardViewsTable)
    .where(eq(boardViewsTable.scope, scope));
  const [row] = await tx
    .insert(boardViewsTable)
    .values({
      scope,
      name,
      viewType: body.viewType,
      filters: body.filters ?? null,
      sort: body.sort ?? null,
      groupBy: body.groupBy ?? "rail",
      visibleColumns: body.visibleColumns ?? null,
      position: Number(max ?? 0) + 1,
      isDefault: body.isDefault ?? false,
    })
    .returning();
    if (row.isDefault) await clearOtherDefaults(tx, scope, row.id);
    return row;
  });
  res.status(201).json(CreateBoardViewResponse.parse(serView(created)));
}));

boardWorkspaceRouter.patch("/board/views/:id", guard(async (req, res) => {
  const { id } = UpdateBoardViewParams.parse(req.params);
  const body = UpdateBoardViewBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(boardViewsTable)
    .where(eq(boardViewsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "View not found" });
    return;
  }
  if (body.viewType != null && !VIEW_TYPES.has(body.viewType)) {
    res.status(400).json({ error: `Unknown view type ${body.viewType}` });
    return;
  }
  if (body.groupBy != null && !GROUP_BYS.has(body.groupBy)) {
    res.status(400).json({ error: `Unknown grouping ${body.groupBy}` });
    return;
  }
  const updated = await db.transaction(async (tx) => {
  const [row] = await tx
    .update(boardViewsTable)
    .set({
      ...(body.name != null ? { name: body.name.trim() } : {}),
      ...(body.viewType != null ? { viewType: body.viewType } : {}),
      ...(body.filters !== undefined ? { filters: body.filters ?? null } : {}),
      ...(body.sort !== undefined ? { sort: body.sort ?? null } : {}),
      ...(body.groupBy != null ? { groupBy: body.groupBy } : {}),
      ...(body.visibleColumns !== undefined
        ? { visibleColumns: body.visibleColumns ?? null }
        : {}),
      ...(body.position != null ? { position: body.position } : {}),
      ...(body.isDefault != null ? { isDefault: body.isDefault } : {}),
    })
    .where(eq(boardViewsTable.id, id))
    .returning();
    if (row.isDefault) await clearOtherDefaults(tx, row.scope, row.id);
    return row;
  });
  res.json(UpdateBoardViewResponse.parse(serView(updated)));
}));

boardWorkspaceRouter.delete("/board/views/:id", guard(async (req, res) => {
  const { id } = DeleteBoardViewParams.parse(req.params);
  const [deleted] = await db
    .delete(boardViewsTable)
    .where(eq(boardViewsTable.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "View not found" });
    return;
  }
  res.json(DeleteBoardViewResponse.parse({ ok: true }));
}));

// ---------------------------------------------------------------------------
// Values on a job card
// ---------------------------------------------------------------------------
boardWorkspaceRouter.patch(
  "/jobs/:id/custom-fields",
  guard(async (req, res) => {
    const { id } = SetJobCustomFieldsParams.parse(req.params);
    const body = SetJobCustomFieldsBody.parse(req.body);
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const defs = await db
      .select()
      .from(boardFieldDefsTable)
      .where(
        and(
          eq(boardFieldDefsTable.scope, "job"),
          eq(boardFieldDefsTable.archived, false),
        ),
      );
    const byKey = new Map(defs.map((d) => [d.key, d]));
    // Merge server-side: two people editing different cells of the same job
    // at once would otherwise overwrite each other with a stale snapshot.
    const patch: Record<string, unknown> = {};
    const cleared: string[] = [];
    for (const [key, raw] of Object.entries(body.values)) {
      const def = byKey.get(key);
      if (!def) {
        res.status(400).json({ error: `No field named ${key} on this board` });
        return;
      }
      const coerced = coerceValue(def, raw);
      if (!coerced.ok) {
        res.status(400).json({ error: coerced.error });
        return;
      }
      if (coerced.value === null) cleared.push(key);
      else patch[key] = coerced.value;
    }
    const [updated] = await db
      .update(jobsTable)
      .set({
        customFields: sql`(coalesce(${jobsTable.customFields}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb) - ${sql.raw(
          `ARRAY[${cleared.map((k) => `'${k.replace(/'/g, "''")}'`).join(",")}]::text[]`,
        )}`,
      })
      .where(eq(jobsTable.id, id))
      .returning();
    res.json(
      SetJobCustomFieldsResponse.parse({
        id: updated.id,
        customFields: (updated.customFields as Record<string, unknown>) ?? {},
      }),
    );
  }),
);
