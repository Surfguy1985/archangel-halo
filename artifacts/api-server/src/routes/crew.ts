import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { and, desc, eq, gte, lt, ne } from "drizzle-orm";
import {
  db,
  crewsTable,
  crewMessagesTable,
  crewCheckinsTable,
  crewDocumentsTable,
  crewPaymentsTable,
  crewPhotosTable,
  crewInvoicesTable,
  crewInvoiceItemsTable,
  photoSharesTable,
  notificationsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  GetCrewDetailParams,
  GetCrewDetailResponse,
  GenerateCrewPortalLinkParams,
  GenerateCrewPortalLinkResponse,
  ListCrewMessagesParams,
  ListCrewMessagesResponse,
  SendCrewMessageParams,
  SendCrewMessageBody,
  SendCrewMessageResponse,
  ListCrewCheckinsParams,
  ListCrewCheckinsResponse,
  ListCrewDocumentsParams,
  ListCrewDocumentsResponse,
  SendCrewDocumentParams,
  SendCrewDocumentBody,
  SendCrewDocumentResponse,
  UpdateCrewPaymentMethodParams,
  UpdateCrewPaymentMethodBody,
  UpdateCrewPaymentMethodResponse,
  ListCrewPaymentsResponse,
  CreateCrewPaymentBody,
  CreateCrewPaymentResponse,
  UpdateCrewPaymentParams,
  UpdateCrewPaymentBody,
  UpdateCrewPaymentResponse,
  ListCrewPhotosParams,
  ListCrewPhotosResponse,
  CreatePhotoShareParams,
  CreatePhotoShareBody,
  CreatePhotoShareResponse,
  GetPhotoShareParams,
  GetPhotoShareReportPdfParams,
  UpdatePhotoShareNotesParams,
  UpdatePhotoShareNotesBody,
  UpdatePhotoShareNotesResponse,
  GetPhotoShareResponse,
  ListCrewInvoicesParams,
  ListCrewInvoicesResponse,
  ReviewCrewInvoiceParams,
  ReviewCrewInvoiceBody,
  ReviewCrewInvoiceResponse,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";
import { jobLabelMap } from "../lib/jobLabels";
import { gatherDayReport, buildDayReportPdf } from "../lib/dayReportPdf";

const router: IRouter = Router();

type CrewRow = typeof crewsTable.$inferSelect;

function crewDetail(row: CrewRow) {
  return {
    id: row.id,
    name: row.name,
    trade: row.trade,
    phone: row.phone,
    email: row.email,
    isLeader: row.isLeader,
    active: row.active,
    portalToken: row.portalToken,
    preferredPaymentMethod: row.preferredPaymentMethod,
    paymentDetails: row.paymentDetails,
    paymentTerms: row.paymentTerms,
    services:
      (row.services as { name: string; rate?: number | null }[] | null) ??
      null,
    selfiePath: row.selfiePath ?? null,
    w9Submitted: row.w9SubmittedAt != null,
    w9SubmittedAt: row.w9SubmittedAt ? row.w9SubmittedAt.toISOString() : null,
    w9: (row.w9 as Record<string, unknown> | null) ?? null,
  };
}

router.get("/crews/:id/detail", async (req, res): Promise<void> => {
  const { id } = GetCrewDetailParams.parse(req.params);
  const [row] = await db.select().from(crewsTable).where(eq(crewsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const payments = await db
    .select()
    .from(crewPaymentsTable)
    .where(eq(crewPaymentsTable.crewId, id));
  let paidTotal = 0;
  let outstandingTotal = 0;
  for (const p of payments) {
    if (p.status === "completed") paidTotal += p.amount;
    else if (p.status !== "cancelled") outstandingTotal += p.amount;
  }
  res.json(
    GetCrewDetailResponse.parse({
      ...crewDetail(row),
      paidTotal,
      outstandingTotal,
    }),
  );
});

router.post("/crews/:id/portal-link", async (req, res): Promise<void> => {
  const { id } = GenerateCrewPortalLinkParams.parse(req.params);
  const [row] = await db.select().from(crewsTable).where(eq(crewsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  let token = row.portalToken;
  if (!token) {
    token = randomBytes(24).toString("base64url");
    await db
      .update(crewsTable)
      .set({ portalToken: token })
      .where(eq(crewsTable.id, id));
  }
  res.json(
    GenerateCrewPortalLinkResponse.parse({
      token,
      path: `/portal/${token}`,
    }),
  );
});

router.get("/crews/:id/messages", async (req, res): Promise<void> => {
  const { id } = ListCrewMessagesParams.parse(req.params);
  const rows = await db
    .select()
    .from(crewMessagesTable)
    .where(eq(crewMessagesTable.crewId, id))
    .orderBy(crewMessagesTable.createdAt);
  res.json(ListCrewMessagesResponse.parse(rows.map((r) => ser(r))));
});

router.post("/crews/:id/messages", async (req, res): Promise<void> => {
  const { id } = SendCrewMessageParams.parse(req.params);
  const body = SendCrewMessageBody.parse(req.body);
  const [row] = await db
    .insert(crewMessagesTable)
    .values({ crewId: id, sender: "admin", body: body.body })
    .returning();
  res.status(201).json(SendCrewMessageResponse.parse(ser(row)));
});

router.get("/crews/:id/photos", async (req, res): Promise<void> => {
  const { id } = ListCrewPhotosParams.parse(req.params);
  const rows = await db
    .select()
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.crewId, id))
    .orderBy(desc(crewPhotosTable.createdAt));
  const labels = await jobLabelMap(
    rows.map((r) => r.jobId).filter((v): v is string => !!v),
  );
  res.json(
    ListCrewPhotosResponse.parse(
      rows.map((r) => ({
        ...ser(r),
        jobLabel: r.jobId ? (labels.get(r.jobId) ?? null) : null,
      })),
    ),
  );
});

router.post("/crews/:id/photo-shares", async (req, res): Promise<void> => {
  const { id } = CreatePhotoShareParams.parse(req.params);
  const body = CreatePhotoShareBody.parse(req.body);
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, id));
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(photoSharesTable)
    .where(
      and(eq(photoSharesTable.crewId, id), eq(photoSharesTable.day, body.day)),
    );
  if (existing) {
    res.status(201).json(
      CreatePhotoShareResponse.parse({
        token: existing.token,
        day: existing.day,
        notes: existing.notes,
      }),
    );
    return;
  }
  const token = randomBytes(18).toString("base64url");
  const [row] = await db
    .insert(photoSharesTable)
    .values({ crewId: id, day: body.day, token })
    .returning();
  res
    .status(201)
    .json(CreatePhotoShareResponse.parse({ token: row.token, day: row.day }));
});

router.get("/photo-shares/:token", async (req, res): Promise<void> => {
  const { token } = GetPhotoShareParams.parse(req.params);
  const [share] = await db
    .select()
    .from(photoSharesTable)
    .where(eq(photoSharesTable.token, token));
  if (!share) {
    res.status(404).json({ error: "Invalid share link" });
    return;
  }
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, share.crewId));
  const photos = await db
    .select()
    .from(crewPhotosTable)
    .where(
      and(
        eq(crewPhotosTable.crewId, share.crewId),
        eq(crewPhotosTable.takenOn, share.day),
      ),
    )
    .orderBy(crewPhotosTable.createdAt);
  const [dy, dm, dd] = share.day.split("-").map(Number);
  const dayStart = new Date(dy, dm - 1, dd);
  const dayEnd = new Date(dy, dm - 1, dd + 1);
  const checkins = await db
    .select()
    .from(crewCheckinsTable)
    .where(
      and(
        eq(crewCheckinsTable.crewId, share.crewId),
        gte(crewCheckinsTable.createdAt, dayStart),
        lt(crewCheckinsTable.createdAt, dayEnd),
      ),
    )
    .orderBy(crewCheckinsTable.createdAt);
  const labels = await jobLabelMap(
    [...photos.map((p) => p.jobId), ...checkins.map((c) => c.jobId)].filter(
      (v): v is string => !!v,
    ),
  );
  res.json(
    GetPhotoShareResponse.parse({
      crewName: crew?.name ?? "Crew",
      trade: crew?.trade ?? null,
      day: share.day,
      photos: photos.map((p) => ({
        ...ser(p),
        jobLabel: p.jobId ? (labels.get(p.jobId) ?? null) : null,
      })),
      checkins: checkins.map((c) => ({
        id: c.id,
        jobId: c.jobId ?? null,
        jobLabel: c.jobId ? (labels.get(c.jobId) ?? null) : null,
        kind: c.kind,
        label: c.label ?? null,
        note: c.note ?? null,
        createdAt: c.createdAt ? c.createdAt.toISOString() : null,
      })),
    }),
  );
});

router.patch("/crews/:id/photo-share-notes", async (req, res): Promise<void> => {
  const { id } = UpdatePhotoShareNotesParams.parse(req.params);
  const body = UpdatePhotoShareNotesBody.parse(req.body);
  const [row] = await db
    .update(photoSharesTable)
    .set({ notes: body.notes })
    .where(
      and(eq(photoSharesTable.crewId, id), eq(photoSharesTable.day, body.day)),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "No share exists for that crew and day" });
    return;
  }
  res.json(
    UpdatePhotoShareNotesResponse.parse({
      token: row.token,
      day: row.day,
      notes: row.notes,
    }),
  );
});

router.get("/photo-shares/:token/report", async (req, res): Promise<void> => {
  const { token } = GetPhotoShareReportPdfParams.parse({ token: req.params.token });
  const data = await gatherDayReport(token);
  if (!data) {
    res.status(404).json({ error: "Invalid share link" });
    return;
  }
  const pdf = await buildDayReportPdf(data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="daily-report-${data.crewName.replace(/[^\w.-]+/g, "_")}-${data.day}.pdf"`,
  );
  res.send(Buffer.from(pdf));
});

router.get("/crews/:id/checkins", async (req, res): Promise<void> => {
  const { id } = ListCrewCheckinsParams.parse(req.params);
  const rows = await db
    .select()
    .from(crewCheckinsTable)
    .where(eq(crewCheckinsTable.crewId, id))
    .orderBy(desc(crewCheckinsTable.createdAt));
  res.json(ListCrewCheckinsResponse.parse(rows.map((r) => ser(r))));
});

router.get("/crews/:id/documents", async (req, res): Promise<void> => {
  const { id } = ListCrewDocumentsParams.parse(req.params);
  const rows = await db
    .select()
    .from(crewDocumentsTable)
    .where(eq(crewDocumentsTable.crewId, id))
    .orderBy(desc(crewDocumentsTable.createdAt));
  res.json(ListCrewDocumentsResponse.parse(rows.map((r) => ser(r))));
});

router.get("/crews/:id/invoices", async (req, res): Promise<void> => {
  const { id } = ListCrewInvoicesParams.parse(req.params);
  const [crew] = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(eq(crewsTable.id, id))
    .limit(1);
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const invoices = await db
    .select()
    .from(crewInvoicesTable)
    .where(eq(crewInvoicesTable.crewId, id))
    .orderBy(desc(crewInvoicesTable.createdAt));
  const ids = invoices.map((i) => i.id);
  const items =
    ids.length > 0
      ? await db
          .select()
          .from(crewInvoiceItemsTable)
          .where(inArray(crewInvoiceItemsTable.invoiceId, ids))
      : [];
  const labels = await jobLabelMap(
    invoices.map((i) => i.jobId).filter((v): v is string => !!v),
  );
  res.json(
    ListCrewInvoicesResponse.parse(
      invoices.map((inv) => ({
        ...ser(inv),
        jobLabel: inv.jobId ? (labels.get(inv.jobId) ?? null) : null,
        items: items
          .filter((it) => it.invoiceId === inv.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((it) => ser(it)),
      })),
    ),
  );
});

router.patch("/crew-invoices/:id", async (req, res): Promise<void> => {
  const { id } = ReviewCrewInvoiceParams.parse(req.params);
  const body = ReviewCrewInvoiceBody.parse(req.body);
  const [inv] = await db
    .select()
    .from(crewInvoicesTable)
    .where(eq(crewInvoicesTable.id, id))
    .limit(1);
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const now = new Date();
  let updates: Partial<typeof crewInvoicesTable.$inferInsert>;
  let noteText = "";
  if (body.action === "approve") {
    if (inv.status !== "submitted" && inv.status !== "needs_corrections") {
      res.status(409).json({
        error: `Only submitted invoices can be approved (this one is ${inv.status})`,
      });
      return;
    }
    updates = { status: "approved", decidedAt: now, adminNote: null };
  } else if (body.action === "send_back") {
    if (inv.status !== "submitted") {
      res.status(409).json({
        error: `Only submitted invoices can be sent back (this one is ${inv.status})`,
      });
      return;
    }
    const note = body.note?.trim();
    if (!note) {
      res
        .status(400)
        .json({ error: "A note is required when sending back for corrections" });
      return;
    }
    noteText = note;
    updates = { status: "needs_corrections", decidedAt: now, adminNote: note };
  } else if (body.action === "mark_paid") {
    if (inv.status !== "approved") {
      res.status(409).json({
        error: `Only approved invoices can be marked paid (this one is ${inv.status})`,
      });
      return;
    }
    updates = { status: "paid", decidedAt: inv.decidedAt ?? now };
  } else {
    if (inv.status === "submitted") {
      res.status(409).json({
        error: "Review this invoice before clearing it to history",
      });
      return;
    }
    if (inv.clearedAt) {
      res.status(409).json({ error: "This invoice is already in history" });
      return;
    }
    updates = { clearedAt: now };
  }
  const [updated] = await db
    .update(crewInvoicesTable)
    .set(updates)
    .where(eq(crewInvoicesTable.id, id))
    .returning();
  const items = await db
    .select()
    .from(crewInvoiceItemsTable)
    .where(eq(crewInvoiceItemsTable.invoiceId, id));

  if (body.action !== "clear") {
    const [crew] = await db
      .select({ name: crewsTable.name })
      .from(crewsTable)
      .where(eq(crewsTable.id, inv.crewId))
      .limit(1);
    const labels: Record<string, string> = {
      approve: "approved",
      send_back: "sent back for corrections",
      mark_paid: "marked paid",
    };
    await db.insert(notificationsTable).values({
      kind: "crew_invoice",
      priority: "normal",
      entityType: "crew",
      entityId: inv.crewId,
      title: `Invoice ${inv.invoiceNo ? `${inv.invoiceNo} ` : ""}from ${crew?.name ?? "crew"} ${labels[body.action]} — $${inv.total.toFixed(2)}`,
      body: noteText || inv.propertyAddress,
    });
  }

  res.json(
    ReviewCrewInvoiceResponse.parse({
      ...ser(updated),
      items: items
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((it) => ser(it)),
    }),
  );
});

router.post("/crews/:id/documents", async (req, res): Promise<void> => {
  const { id } = SendCrewDocumentParams.parse(req.params);
  const body = SendCrewDocumentBody.parse(req.body);
  const [row] = await db
    .insert(crewDocumentsTable)
    .values({
      crewId: id,
      direction: "to_crew",
      name: body.name,
      storagePath: body.storagePath,
      contentType: body.contentType ?? null,
      size: body.size ?? null,
      note: body.note ?? null,
    })
    .returning();
  res.status(201).json(SendCrewDocumentResponse.parse(ser(row)));
});

router.patch("/crews/:id/payment-method", async (req, res): Promise<void> => {
  const { id } = UpdateCrewPaymentMethodParams.parse(req.params);
  const body = UpdateCrewPaymentMethodBody.parse(req.body);
  const [row] = await db
    .update(crewsTable)
    .set({
      preferredPaymentMethod: body.preferredPaymentMethod ?? null,
      paymentDetails: body.paymentDetails ?? null,
    })
    .where(eq(crewsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  res.json(UpdateCrewPaymentMethodResponse.parse(crewDetail(row)));
});

router.get("/crew-payments", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(crewPaymentsTable)
    .orderBy(desc(crewPaymentsTable.createdAt));
  const crews = await db.select().from(crewsTable);
  const names = new Map(crews.map((c) => [c.id, c.name]));
  res.json(
    ListCrewPaymentsResponse.parse(
      rows.map((r) => ({ ...ser(r), crewName: names.get(r.crewId) ?? null })),
    ),
  );
});

router.post("/crew-payments", async (req, res): Promise<void> => {
  const body = CreateCrewPaymentBody.parse(req.body);
  const status = body.status ?? "pending";
  // Idempotency guard: one payment per (job, crew). A double-click or retry
  // should never record the crew as paid twice for the same job.
  if (body.jobId) {
    const existing = await db
      .select()
      .from(crewPaymentsTable)
      .where(
        and(
          eq(crewPaymentsTable.jobId, body.jobId),
          eq(crewPaymentsTable.crewId, body.crewId),
          ne(crewPaymentsTable.status, "cancelled"),
        ),
      );
    const prior =
      existing.find((p) => p.status === "completed") ?? existing[0];
    if (prior) {
      let row = prior;
      if (status === "completed" && prior.status !== "completed") {
        const [updated] = await db
          .update(crewPaymentsTable)
          .set({ status: "completed", paidAt: new Date() })
          .where(eq(crewPaymentsTable.id, prior.id))
          .returning();
        if (updated) row = updated;
      }
      const [crew] = await db
        .select()
        .from(crewsTable)
        .where(eq(crewsTable.id, row.crewId));
      res
        .status(201)
        .json(
          CreateCrewPaymentResponse.parse({
            ...ser(row),
            crewName: crew?.name ?? null,
          }),
        );
      return;
    }
  }
  const [row] = await db
    .insert(crewPaymentsTable)
    .values({
      crewId: body.crewId,
      amount: body.amount,
      method: body.method ?? null,
      status,
      note: body.note ?? null,
      jobId: body.jobId ?? null,
      dueOn: body.dueOn ? new Date(body.dueOn) : null,
      paidAt: status === "completed" ? new Date() : null,
    })
    .returning();
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, row.crewId));
  res
    .status(201)
    .json(
      CreateCrewPaymentResponse.parse({
        ...ser(row),
        crewName: crew?.name ?? null,
      }),
    );
});

router.patch("/crew-payments/:id", async (req, res): Promise<void> => {
  const { id } = UpdateCrewPaymentParams.parse(req.params);
  const body = UpdateCrewPaymentBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(crewPaymentsTable)
    .where(eq(crewPaymentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const patch: Partial<typeof crewPaymentsTable.$inferInsert> = {};
  if (body.amount != null) patch.amount = body.amount;
  if (body.method !== undefined) patch.method = body.method ?? null;
  if (body.note !== undefined) patch.note = body.note ?? null;
  if (body.dueOn !== undefined)
    patch.dueOn = body.dueOn ? new Date(body.dueOn) : null;
  if (body.status != null) {
    patch.status = body.status;
    if (body.status === "completed" && !existing.paidAt) {
      patch.paidAt = new Date();
    }
    if (body.status === "pending") patch.paidAt = null;
  }
  if (body.paidAt !== undefined)
    patch.paidAt = body.paidAt ? new Date(body.paidAt) : null;
  const [row] = await db
    .update(crewPaymentsTable)
    .set(patch)
    .where(eq(crewPaymentsTable.id, id))
    .returning();
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, row.crewId));
  res.json(
    UpdateCrewPaymentResponse.parse({
      ...ser(row),
      crewName: crew?.name ?? null,
    }),
  );
});

export default router;
