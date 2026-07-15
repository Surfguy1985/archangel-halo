import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, notificationsTable, activitiesTable } from "@workspace/db";
import {
  ListNotificationsResponse,
  ReadNotificationParams,
  ReadNotificationResponse,
  DeleteNotificationParams,
  ListActivitiesResponse,
  ListActivitiesQueryParams,
  CreateActivityBody,
  CreateActivityResponse,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";

const router: IRouter = Router();

router.get("/notifications", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(notificationsTable)
    .orderBy(desc(notificationsTable.createdAt));
  res.json(ListNotificationsResponse.parse(rows.map((r) => ser(r))));
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const { id } = ReadNotificationParams.parse(req.params);
  const [row] = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(eq(notificationsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(ReadNotificationResponse.parse(ser(row)));
});

router.delete("/notifications/:id", async (req, res): Promise<void> => {
  const { id } = DeleteNotificationParams.parse(req.params);
  const [row] = await db
    .delete(notificationsTable)
    .where(eq(notificationsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.status(204).end();
});

router.get("/activities", async (req, res): Promise<void> => {
  const { entityType, entityId, limit } = ListActivitiesQueryParams.parse(req.query);
  const conditions = [
    ...(entityType ? [eq(activitiesTable.entityType, entityType)] : []),
    ...(entityId ? [eq(activitiesTable.entityId, entityId)] : []),
  ];
  const rows = await db
    .select()
    .from(activitiesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(activitiesTable.createdAt))
    .limit(limit ?? 100);
  res.json(ListActivitiesResponse.parse(rows.map((r) => ser(r))));
});

router.post("/activities", async (req, res): Promise<void> => {
  const body = CreateActivityBody.parse(req.body);
  const [row] = await db.insert(activitiesTable).values(body).returning();
  res.status(201).json(CreateActivityResponse.parse(ser(row)));
});

export default router;
