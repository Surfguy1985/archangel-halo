import { Router, type IRouter } from "express";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db, remindersTable } from "@workspace/db";

const router: IRouter = Router();

// GET /reminders — list active (non-dismissed) reminders, optionally filtered
router.get("/reminders", async (req, res): Promise<void> => {
  const { entityType, entityId } = req.query;

  const now = new Date();
  const conditions: ReturnType<typeof eq>[] = [
    isNull(remindersTable.dismissedAt) as ReturnType<typeof eq>,
    // Exclude reminders that are currently snoozed (snoozedUntil is in the future)
    or(
      isNull(remindersTable.snoozedUntil),
      lte(remindersTable.snoozedUntil, now),
    ) as ReturnType<typeof eq>,
  ];
  if (entityType) conditions.push(eq(remindersTable.entityType, String(entityType)));
  if (entityId) conditions.push(eq(remindersTable.entityId, String(entityId)));

  const rows = await db
    .select()
    .from(remindersTable)
    .where(and(...conditions))
    .orderBy(
      // remindAt NULLS LAST, then createdAt
      asc(remindersTable.createdAt),
    );

  // Sort: remindAt non-null first (ascending), then null, then by createdAt
  rows.sort((a, b) => {
    if (a.remindAt && b.remindAt) return a.remindAt.getTime() - b.remindAt.getTime();
    if (a.remindAt && !b.remindAt) return -1;
    if (!a.remindAt && b.remindAt) return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  res.json({
    reminders: rows.map((r) => ({
      id: r.id,
      text: r.text,
      entityType: r.entityType,
      entityId: r.entityId,
      entityLabel: r.entityLabel,
      remindAt: r.remindAt?.toISOString() ?? null,
      dismissedAt: r.dismissedAt?.toISOString() ?? null,
      snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

// POST /reminders — create a new reminder
router.post("/reminders", async (req, res): Promise<void> => {
  const { text, entityType, entityId, entityLabel, remindAt } = req.body as Record<string, unknown>;

  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  let remindAtDate: Date | null = null;
  if (remindAt) {
    const d = new Date(String(remindAt));
    if (isNaN(d.getTime())) {
      res.status(400).json({ error: "remindAt must be a valid ISO datetime" });
      return;
    }
    remindAtDate = d;
  }

  const [row] = await db
    .insert(remindersTable)
    .values({
      text: text.trim(),
      entityType: entityType ? String(entityType) : null,
      entityId: entityId ? String(entityId) : null,
      entityLabel: entityLabel ? String(entityLabel) : null,
      remindAt: remindAtDate,
    })
    .returning();

  res.status(201).json({
    reminder: {
      id: row.id,
      text: row.text,
      entityType: row.entityType,
      entityId: row.entityId,
      entityLabel: row.entityLabel,
      remindAt: row.remindAt?.toISOString() ?? null,
      dismissedAt: row.dismissedAt?.toISOString() ?? null,
      snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    },
  });
});

// PATCH /reminders/:id — dismiss or snooze
router.patch("/reminders/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { action, snoozeMinutes } = req.body as { action?: string; snoozeMinutes?: number };

  if (action !== "dismiss" && action !== "snooze") {
    res.status(400).json({ error: 'action must be "dismiss" or "snooze"' });
    return;
  }

  const [existing] = await db
    .select()
    .from(remindersTable)
    .where(eq(remindersTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Reminder not found" });
    return;
  }

  if (action === "dismiss") {
    const [updated] = await db
      .update(remindersTable)
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where(eq(remindersTable.id, id))
      .returning();
    res.json({ ok: true, reminder: { id: updated.id, dismissedAt: updated.dismissedAt?.toISOString() ?? null } });
  } else {
    // snooze
    const mins = Number(snoozeMinutes ?? 30);
    const snoozedUntil = new Date(Date.now() + mins * 60 * 1000);
    const [updated] = await db
      .update(remindersTable)
      .set({ snoozedUntil, updatedAt: new Date() })
      .where(eq(remindersTable.id, id))
      .returning();
    res.json({ ok: true, reminder: { id: updated.id, snoozedUntil: updated.snoozedUntil?.toISOString() ?? null } });
  }
});

export default router;
