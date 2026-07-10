import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, leadsTable, bidsTable, propertiesTable } from "@workspace/db";
import {
  ListLeadsResponse,
  CreateLeadBody,
  CreateLeadResponse,
  ListBidsResponse,
  ListBidsQueryParams,
  CreateBidBody,
  CreateBidResponse,
  UpdateBidBody,
  UpdateBidParams,
  UpdateBidResponse,
  NudgeBidParams,
  NudgeBidResponse,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();

async function propertyNames(): Promise<Map<string, string>> {
  const rows = await db.select().from(propertiesTable);
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function nextBidNo(): Promise<string> {
  const rows = await db.select().from(bidsTable);
  return `B-${String(1000 + rows.length + 1)}`;
}

router.get("/leads", async (_req, res): Promise<void> => {
  const rows = await db.select().from(leadsTable).orderBy(desc(leadsTable.createdAt));
  const names = await propertyNames();
  res.json(
    ListLeadsResponse.parse(
      rows.map((r) => ({
        ...ser(r),
        propertyName: r.propertyId ? (names.get(r.propertyId) ?? null) : null,
      })),
    ),
  );
});

router.post("/leads", async (req, res): Promise<void> => {
  const body = CreateLeadBody.parse(req.body);
  const [row] = await db.insert(leadsTable).values(body).returning();
  res.status(201).json(CreateLeadResponse.parse(ser(row)));
});

router.get("/bids", async (req, res): Promise<void> => {
  const { status } = ListBidsQueryParams.parse(req.query);
  const rows = await db.select().from(bidsTable).orderBy(desc(bidsTable.createdAt));
  const names = await propertyNames();
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  res.json(
    ListBidsResponse.parse(
      filtered.map((r) => ({
        ...ser(r),
        propertyName: r.propertyId ? (names.get(r.propertyId) ?? null) : null,
      })),
    ),
  );
});

router.post("/bids", async (req, res): Promise<void> => {
  const body = CreateBidBody.parse(req.body);
  const [row] = await db
    .insert(bidsTable)
    .values({ ...body, bidNo: await nextBidNo(), sentAt: new Date() })
    .returning();
  res.status(201).json(CreateBidResponse.parse(ser(row)));
});

router.patch("/bids/:id", async (req, res): Promise<void> => {
  const { id } = UpdateBidParams.parse(req.params);
  const body = UpdateBidBody.parse(req.body);
  const patch: Record<string, unknown> = { ...body };
  if (body.status === "won" || body.status === "lost") {
    patch.decidedAt = new Date();
  }
  const [row] = await db
    .update(bidsTable)
    .set(patch)
    .where(eq(bidsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  res.json(UpdateBidResponse.parse(ser(row)));
});

router.post("/bids/:id/nudge", async (req, res): Promise<void> => {
  const { id } = NudgeBidParams.parse(req.params);
  const [bid] = await db.select().from(bidsTable).where(eq(bidsTable.id, id));
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  const names = await propertyNames();
  const propName = bid.propertyId ? names.get(bid.propertyId) : "your property";
  await sendEmail({
    to: "decision-maker@example.com",
    subject: `Following up on bid ${bid.bidNo} for ${propName}`,
    html: `<p>Just checking in on our proposal <strong>${bid.bidNo}</strong> (${bid.scope ?? ""}) for $${bid.amount.toLocaleString()}. Happy to answer any questions.</p><p>— ArchAngel Contractors</p>`,
  });
  const [row] = await db
    .update(bidsTable)
    .set({ lastNudgeAt: new Date() })
    .where(eq(bidsTable.id, id))
    .returning();
  res.json(
    NudgeBidResponse.parse({
      ...ser(row),
      propertyName: row.propertyId ? (names.get(row.propertyId) ?? null) : null,
    }),
  );
});

export default router;
