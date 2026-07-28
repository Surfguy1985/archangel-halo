import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  paymentRequestsTable,
  paymentRequestJobsTable,
  crewBankAccountsTable,
  crewPayoutsTable,
  crewsTable,
  jobsTable,
  jobLineItemsTable,
  schedulesTable,
  propertiesTable,
  contactsTable,
  invoicesTable,
  paymentsTable,
  activitiesTable,
  notificationsTable,
} from "@workspace/db";
import {
  ExtractPaymentInfoBody,
  ExtractPaymentInfoResponse,
  GetPayHubOverviewResponse,
  CreatePaymentRequestBody,
  GetPaymentRequestResponse,
  SendPaymentRequestBody,
  ReturnPaymentRequestBody,
  GetPublicPaymentRequestResponse,
  SubmitPublicPaymentBody,
  SubmitPublicPaymentResponse,
  CreateCrewPayoutBody,
  CreateCrewPayoutResponse,
  GetPayoutDistributionResponse,
  GetCrewBankStatusResponse,
} from "@workspace/api-zod";
import { completeJsonWithImage } from "../lib/ai";
import { sendEmail } from "../lib/email";
import { getBusinessSettings } from "../lib/businessSettings";
import { recomputeJobFinancials } from "../lib/jobFinance";
import { syncInvoiceLedger } from "../lib/ledger";
import { jobLabelMap } from "../lib/jobLabels";

const router: IRouter = Router();

function confirmationNo(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

function publicOrigin(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) return `https://${domains.split(",")[0]}`;
  return "http://localhost:80";
}

type PayerInfoShape = {
  routingNumber?: string | null;
  accountNumber?: string | null;
  cardNumber?: string | null;
  cardExp?: string | null;
  cardCode?: string | null;
  zip?: string | null;
  payerName?: string | null;
  amount?: number | null;
  notes?: string | null;
};

// Never persist CVV; keep only last4 of card/account numbers in payerInfo.
function sanitizePayerInfo(info: PayerInfoShape | null): PayerInfoShape | null {
  if (!info) return null;
  const mask = (v: string | null | undefined) => {
    if (!v) return v ?? null;
    const digits = v.replace(/\D/g, "");
    return digits.length > 4 ? `••••${digits.slice(-4)}` : v;
  };
  return {
    ...info,
    cardCode: null,
    cardNumber: mask(info.cardNumber),
    accountNumber: mask(info.accountNumber),
  };
}

async function requestDetail(reqRow: typeof paymentRequestsTable.$inferSelect) {
  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, reqRow.propertyId))
    .limit(1);
  const jobs = await db
    .select()
    .from(paymentRequestJobsTable)
    .where(eq(paymentRequestJobsTable.requestId, reqRow.id))
    .orderBy(paymentRequestJobsTable.sortOrder);
  return {
    id: reqRow.id,
    requestNo: reqRow.requestNo,
    token: reqRow.token,
    propertyId: reqRow.propertyId,
    propertyName: prop?.name ?? "Property",
    total: reqRow.total,
    memo: reqRow.memo,
    status: reqRow.status,
    sentVia: reqRow.sentVia,
    sentTo: reqRow.sentTo,
    sentAt: reqRow.sentAt?.toISOString() ?? null,
    approvedAt: reqRow.approvedAt?.toISOString() ?? null,
    paidAt: reqRow.paidAt?.toISOString() ?? null,
    paidAmount: reqRow.paidAmount,
    paymentMethod: reqRow.paymentMethod,
    confirmationNo: reqRow.confirmationNo,
    returnedAt: reqRow.returnedAt?.toISOString() ?? null,
    returnReason: reqRow.returnReason,
    payerInfo: (reqRow.payerInfo as PayerInfoShape | null) ?? undefined,
    createdAt: reqRow.createdAt.toISOString(),
    jobs: jobs.map((j) => ({
      id: j.id,
      jobId: j.jobId,
      invoiceId: j.invoiceId,
      label: j.label,
      amount: j.amount,
    })),
  };
}

// ---------- OCR ----------

router.post("/pay-hub/ocr", async (req, res): Promise<void> => {
  const parsed = ExtractPaymentInfoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const system = `You extract payment information from invoice/billing document images for a property maintenance company. Respond ONLY with JSON:
{"found": boolean, "confidence": "high"|"medium"|"low", "summary": string|null, "payerInfo": {"routingNumber": string|null, "accountNumber": string|null, "cardNumber": string|null, "cardExp": string|null, "cardCode": string|null, "zip": string|null, "payerName": string|null, "amount": number|null, "notes": string|null}}
Rules: extract ONLY what is visibly present (bank routing number, bank account number, credit card number, expiration date MM/YY, security code, billing zip, payer/company name, total amount due). Never invent digits. summary = one short sentence about the document. notes = anything payment-relevant that doesn't fit other fields (e.g. check number, payment terms).`;
  const result = await completeJsonWithImage<{
    found: boolean;
    confidence: string;
    summary: string | null;
    payerInfo: PayerInfoShape;
  }>(
    system,
    "Extract the payment info from this document.",
    parsed.data.image,
    parsed.data.mediaType,
    1200,
  );
  res.json(
    ExtractPaymentInfoResponse.parse({
      found: Boolean(result?.found),
      confidence: result?.confidence ?? "low",
      summary: result?.summary ?? null,
      payerInfo: result?.payerInfo ?? {},
    }),
  );
});

// ---------- Overview ----------

router.get("/pay-hub/overview", async (_req, res): Promise<void> => {
  const requests = await db.select().from(paymentRequestsTable);
  const payouts = await db.select().from(crewPayoutsTable);
  const banks = await db
    .select()
    .from(crewBankAccountsTable)
    .where(eq(crewBankAccountsTable.status, "verified"));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const outstanding = requests.filter((r) => r.status === "sent");
  const receivedMtd = requests
    .filter((r) => r.status === "paid" && r.paidAt && r.paidAt >= monthStart)
    .reduce((s, r) => s + (r.paidAmount ?? r.total), 0);
  const payoutsMtd = payouts
    .filter((p) => p.status === "paid" && p.paidAt >= monthStart)
    .reduce((s, p) => s + p.amount, 0);
  const returnedCount =
    requests.filter((r) => r.status === "returned").length +
    payouts.filter((p) => p.status === "returned").length;
  res.json(
    GetPayHubOverviewResponse.parse({
      outstandingCount: outstanding.length,
      outstandingTotal: outstanding.reduce((s, r) => s + r.total, 0),
      receivedMtd,
      payoutsMtd,
      returnedCount,
      verifiedCrewCount: banks.length,
    }),
  );
});

// ---------- Requests ----------

router.get("/pay-hub/requests", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(paymentRequestsTable)
    .orderBy(desc(paymentRequestsTable.createdAt));
  const out = [];
  for (const row of rows) out.push(await requestDetail(row));
  res.json(out.map((r) => GetPaymentRequestResponse.parse(r)));
});

router.post("/pay-hub/requests", async (req, res): Promise<void> => {
  const parsed = CreatePaymentRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, body.propertyId))
    .limit(1);
  if (!prop) {
    res.status(400).json({ error: "Property not found" });
    return;
  }
  const jobs = await db
    .select()
    .from(jobsTable)
    .where(inArray(jobsTable.id, body.jobIds));
  if (jobs.length !== body.jobIds.length) {
    res.status(400).json({ error: "One or more jobs not found" });
    return;
  }
  const badJob = jobs.find((j) => j.propertyId !== body.propertyId);
  if (badJob) {
    res
      .status(400)
      .json({ error: `Job ${badJob.jobNo} does not belong to this property` });
    return;
  }
  const labels = await jobLabelMap(body.jobIds);
  // Amount per job: latest unpaid invoice amount, else job line items, else 0.
  const invoices = await db
    .select()
    .from(invoicesTable)
    .where(inArray(invoicesTable.jobId, body.jobIds));
  const lineItems = await db
    .select()
    .from(jobLineItemsTable)
    .where(inArray(jobLineItemsTable.jobId, body.jobIds));
  const lines = jobs.map((job, i) => {
    const jobInvoices = invoices
      .filter((inv) => inv.jobId === job.id && inv.status === "sent")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const inv = jobInvoices[0];
    const liTotal = lineItems
      .filter((li) => li.jobId === job.id)
      .reduce((s, li) => s + li.rate * li.qty, 0);
    return {
      jobId: job.id,
      invoiceId: inv?.id ?? null,
      label: labels.get(job.id) ?? `#${job.jobNo}`,
      amount: inv ? inv.amount + (inv.taxAmount ?? 0) : liTotal,
      sortOrder: i,
    };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const count = (await db.select({ id: paymentRequestsTable.id }).from(paymentRequestsTable)).length;
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(paymentRequestsTable)
      .values({
        requestNo: `PR-${1001 + count}`,
        token: newToken(),
        propertyId: body.propertyId,
        total,
        memo: body.memo ?? null,
        payerInfo: sanitizePayerInfo(body.payerInfo ?? null),
      })
      .returning();
    await tx
      .insert(paymentRequestJobsTable)
      .values(lines.map((l) => ({ ...l, requestId: row!.id })));
    return row!;
  });
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: prop.id,
    kind: "payment",
    body: `Payment request ${created.requestNo} created for ${prop.name} — $${total.toFixed(2)} across ${lines.length} job${lines.length === 1 ? "" : "s"}`,
  });
  res.status(201).json(GetPaymentRequestResponse.parse(await requestDetail(created)));
});

router.get("/pay-hub/requests/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [row] = await db
    .select()
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Payment request not found" });
    return;
  }
  res.json(GetPaymentRequestResponse.parse(await requestDetail(row)));
});

router.delete("/pay-hub/requests/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [row] = await db
    .select()
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Payment request not found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(paymentRequestJobsTable)
      .where(eq(paymentRequestJobsTable.requestId, id));
    await tx.delete(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  });
  res.sendStatus(204);
});

router.post("/pay-hub/requests/:id/send", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = SendPaymentRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Payment request not found" });
    return;
  }
  const detail = await requestDetail(row);
  const settings = await getBusinessSettings();
  const link = `${publicOrigin()}/pay/${row.token}`;
  if (parsed.data.via === "email") {
    const jobsHtml = detail.jobs
      .map(
        (j) =>
          `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${j.label}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">$${j.amount.toFixed(2)}</td></tr>`,
      )
      .join("");
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">
  <div style="background:#101010;color:#fff;padding:22px 26px;">
    <div style="font-size:19px;font-weight:bold;letter-spacing:0.04em;">${settings.companyName}</div>
    ${settings.tagline ? `<div style="font-size:12px;color:#B4FF44;margin-top:3px;">${settings.tagline}</div>` : ""}
  </div>
  <div style="padding:26px;">
    <p style="margin:0 0 6px;font-size:15px;">Payment request <strong>${detail.requestNo}</strong> for <strong>${detail.propertyName}</strong></p>
    <p style="margin:0 0 18px;font-size:26px;font-weight:bold;">$${detail.total.toFixed(2)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
      <tr><th style="text-align:left;padding:6px 12px;background:#f5f5f5;">Job</th><th style="text-align:right;padding:6px 12px;background:#f5f5f5;">Amount</th></tr>
      ${jobsHtml}
      <tr><td style="padding:8px 12px;font-weight:bold;">Total</td><td style="padding:8px 12px;text-align:right;font-weight:bold;">$${detail.total.toFixed(2)}</td></tr>
    </table>
    ${detail.memo ? `<p style="font-size:13px;color:#555;">${detail.memo}</p>` : ""}
    <a href="${link}" style="display:block;text-align:center;background:#B4FF44;color:#000;font-weight:bold;padding:14px 0;border-radius:8px;text-decoration:none;font-size:15px;">Pay securely now</a>
    <p style="font-size:11px;color:#999;margin-top:16px;">Pay by card, ACH, wire, or eCheck. Questions? ${settings.email ?? ""} ${settings.phone ?? ""}</p>
  </div>
</div>`;
    const sent = await sendEmail({
      to: parsed.data.to,
      subject: `${settings.companyName} — Payment request ${detail.requestNo} ($${detail.total.toFixed(2)})`,
      html,
    });
    if (!sent.ok) {
      res.status(400).json({ error: sent.error ?? "Email failed to send" });
      return;
    }
  } else {
    // SMS sending is stubbed until an SMS provider is connected; the link is
    // recorded so the office can copy/paste it into any texting app.
    req.log.info({ to: parsed.data.to, link }, "SMS payment link (stub)");
  }
  const [updated] = await db
    .update(paymentRequestsTable)
    .set({
      status: row.status === "draft" || row.status === "sent" ? "sent" : row.status,
      sentVia: parsed.data.via,
      sentTo: parsed.data.to,
      sentAt: new Date(),
    })
    .where(eq(paymentRequestsTable.id, id))
    .returning();
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: row.propertyId,
    kind: "payment",
    body: `Payment link for ${row.requestNo} sent via ${parsed.data.via} to ${parsed.data.to}`,
  });
  res.json(GetPaymentRequestResponse.parse(await requestDetail(updated!)));
});

router.post("/pay-hub/requests/:id/return", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = ReturnPaymentRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Payment request not found" });
    return;
  }
  if (row.status !== "paid") {
    res.status(409).json({ error: "Only a paid request can be marked returned" });
    return;
  }
  const links = await db
    .select()
    .from(paymentRequestJobsTable)
    .where(eq(paymentRequestJobsTable.requestId, id));
  // Atomic: only revert invoices this confirmation actually paid.
  const touched: { invoiceId: string; jobId: string }[] = [];
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(paymentRequestsTable)
      .set({
        status: "returned",
        returnedAt: new Date(),
        returnReason: parsed.data.reason,
      })
      .where(
        and(
          eq(paymentRequestsTable.id, id),
          eq(paymentRequestsTable.status, "paid"),
        ),
      )
      .returning();
    if (!u) return null;
    for (const link of links) {
      if (!link.invoiceId || !row.confirmationNo) continue;
      const deleted = await tx
        .delete(paymentsTable)
        .where(
          and(
            eq(paymentsTable.invoiceId, link.invoiceId),
            eq(paymentsTable.checkNumber, row.confirmationNo),
          ),
        )
        .returning();
      if (!deleted.length) continue;
      await tx
        .update(invoicesTable)
        .set({ status: "sent", paidAt: null })
        .where(
          and(
            eq(invoicesTable.id, link.invoiceId),
            eq(invoicesTable.status, "paid"),
          ),
        );
      touched.push({ invoiceId: link.invoiceId, jobId: link.jobId });
    }
    return u;
  });
  if (!updated) {
    res.status(409).json({ error: "Only a paid request can be marked returned" });
    return;
  }
  for (const t of touched) {
    await syncInvoiceLedger(t.invoiceId);
    await recomputeJobFinancials(t.jobId);
  }
  const amount = row.paidAmount ?? row.total;
  await db.insert(notificationsTable).values({
    kind: "payment_returned",
    priority: "high",
    entityType: "property",
    entityId: row.propertyId,
    title: `Payment returned — ${row.requestNo}`,
    body: `$${amount.toFixed(2)} payment (${row.confirmationNo ?? "no confirmation"}) was returned: ${parsed.data.reason}`,
  });
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: row.propertyId,
    kind: "payment",
    body: `Payment for ${row.requestNo} RETURNED — $${amount.toFixed(2)}: ${parsed.data.reason}`,
  });
  res.json(GetPaymentRequestResponse.parse(await requestDetail(updated!)));
});

// ---------- Public payment page ----------

async function publicPayload(row: typeof paymentRequestsTable.$inferSelect) {
  const detail = await requestDetail(row);
  const settings = await getBusinessSettings();
  return {
    requestNo: detail.requestNo,
    status: detail.status,
    total: detail.total,
    memo: detail.memo,
    propertyName: detail.propertyName,
    companyName: settings.companyName,
    companyTagline: settings.tagline ?? null,
    companyEmail: settings.email ?? null,
    companyPhone: settings.phone ?? null,
    approvedAt: detail.approvedAt,
    paidAt: detail.paidAt,
    paidAmount: detail.paidAmount,
    confirmationNo: detail.confirmationNo,
    paymentMethod: detail.paymentMethod,
    jobs: detail.jobs,
  };
}

router.get("/pay/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token);
  const [row] = await db
    .select()
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.token, token))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Invalid payment link" });
    return;
  }
  res.json(GetPublicPaymentRequestResponse.parse(await publicPayload(row)));
});

router.post("/pay/:token/approve", async (req, res): Promise<void> => {
  const token = String(req.params.token);
  const [row] = await db
    .select()
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.token, token))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Invalid payment link" });
    return;
  }
  let current = row;
  if (!row.approvedAt && row.status !== "paid" && row.status !== "returned") {
    const [u] = await db
      .update(paymentRequestsTable)
      .set({ approvedAt: new Date() })
      .where(eq(paymentRequestsTable.id, row.id))
      .returning();
    current = u!;
    await db.insert(activitiesTable).values({
      entityType: "property",
      entityId: row.propertyId,
      kind: "payment",
      body: `Invoice ${row.requestNo} approved by the property`,
    });
  }
  res.json(GetPublicPaymentRequestResponse.parse(await publicPayload(current)));
});

router.post("/pay/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token);
  const parsed = SubmitPublicPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.token, token))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Invalid payment link" });
    return;
  }
  if (row.status === "paid") {
    res.status(409).json({ error: "This request has already been paid" });
    return;
  }
  // NOTE: Cybrid payment rails drop in here. For now the charge is stubbed
  // and always succeeds instantly.
  const confirmation = confirmationNo("PAY");
  const paidAt = new Date();
  const links = await db
    .select()
    .from(paymentRequestJobsTable)
    .where(eq(paymentRequestJobsTable.requestId, row.id));
  // Atomic: guarded request flip + invoice/payment propagation together.
  const flipped = await db.transaction(async (tx) => {
    const updated = await tx
      .update(paymentRequestsTable)
      .set({
        status: "paid",
        approvedAt: row.approvedAt ?? paidAt,
        paidAt,
        paidAmount: row.total,
        paymentMethod: parsed.data.method,
        confirmationNo: confirmation,
      })
      .where(
        and(
          eq(paymentRequestsTable.id, row.id),
          inArray(paymentRequestsTable.status, ["draft", "sent"]),
        ),
      )
      .returning();
    if (!updated.length) return false;
    for (const link of links) {
      if (!link.invoiceId) continue;
      const [inv] = await tx
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.id, link.invoiceId))
        .limit(1);
      if (!inv || inv.status === "paid") continue;
      await tx.insert(paymentsTable).values({
        invoiceId: link.invoiceId,
        amount: link.amount,
        method: parsed.data.method,
        payerName: parsed.data.payerName,
        checkNumber: confirmation,
        receivedAt: paidAt,
      });
      await tx
        .update(invoicesTable)
        .set({ status: "paid", paidAt })
        .where(eq(invoicesTable.id, link.invoiceId));
    }
    return true;
  });
  if (!flipped) {
    res.status(409).json({ error: "This request has already been paid" });
    return;
  }
  for (const link of links) {
    if (link.invoiceId) await syncInvoiceLedger(link.invoiceId);
    await recomputeJobFinancials(link.jobId);
  }
  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, row.propertyId))
    .limit(1);
  await db.insert(notificationsTable).values({
    kind: "payment_received",
    priority: "normal",
    entityType: "property",
    entityId: row.propertyId,
    title: `Payment received — ${row.requestNo}`,
    body: `$${row.total.toFixed(2)} received from ${prop?.name ?? "property"} via ${parsed.data.method} (confirmation ${confirmation})`,
  });
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: row.propertyId,
    kind: "payment",
    body: `Payment received for ${row.requestNo} — $${row.total.toFixed(2)} via ${parsed.data.method}, confirmation ${confirmation}`,
  });
  res.json(
    SubmitPublicPaymentResponse.parse({
      confirmationNo: confirmation,
      amount: row.total,
      paidAt: paidAt.toISOString(),
      method: parsed.data.method,
    }),
  );
});

// ---------- Payout distribution ----------

router.get("/pay-hub/distribution/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [row] = await db
    .select()
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Payment request not found" });
    return;
  }
  const detail = await requestDetail(row);
  const jobIds = detail.jobs.map((j) => j.jobId);
  const jobs = jobIds.length
    ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
    : [];
  const scheduleRows = jobIds.length
    ? await db
        .select()
        .from(schedulesTable)
        .where(inArray(schedulesTable.jobId, jobIds))
    : [];
  const jobCrews = new Map<string, string[]>();
  for (const job of jobs) {
    const set = new Set<string>();
    if (job.crewLeaderId) set.add(job.crewLeaderId);
    for (const sc of scheduleRows)
      if (sc.jobId === job.id && sc.crewLeaderId) set.add(sc.crewLeaderId);
    jobCrews.set(job.id, [...set]);
  }
  const crewIds = [...new Set([...jobCrews.values()].flat())];
  const crews = crewIds.length
    ? await db.select().from(crewsTable).where(inArray(crewsTable.id, crewIds))
    : [];
  const banks = crewIds.length
    ? await db
        .select()
        .from(crewBankAccountsTable)
        .where(inArray(crewBankAccountsTable.crewId, crewIds))
    : [];
  const payouts = await db
    .select()
    .from(crewPayoutsTable)
    .where(eq(crewPayoutsTable.paymentRequestId, id));
  // One row per (job, assigned crew) so multi-crew jobs get individual payouts.
  const rows = detail.jobs.flatMap((line) => {
    const job = jobs.find((j) => j.id === line.jobId);
    const assigned = jobCrews.get(line.jobId) ?? [];
    const perCrewRate =
      job?.crewRate != null && assigned.length > 0
        ? job.crewRate / assigned.length
        : job?.crewRate ?? null;
    const makeRow = (crewId: string | null) => {
      const crew = crewId ? crews.find((c) => c.id === crewId) : undefined;
      const bank = crew ? banks.find((b) => b.crewId === crew.id) : undefined;
      const payout = payouts.find(
        (p) =>
          p.jobId === line.jobId &&
          (!crewId || p.crewId === crewId) &&
          p.status !== "returned",
      );
      return {
        jobId: line.jobId,
        jobLabel: line.label,
        jobAmount: line.amount,
        crewId: crew?.id ?? null,
        crewName: crew?.name ?? null,
        crewRate: assigned.length > 1 ? perCrewRate : job?.crewRate ?? null,
        bankConnected: !!bank,
        bankVerified: bank?.status === "verified",
        crewPaid: !!payout,
        payoutId: payout?.id ?? null,
        payoutStatus: payout?.status ?? null,
      };
    };
    if (!assigned.length) return [makeRow(null)];
    return assigned.map((crewId) => makeRow(crewId));
  });
  res.json(
    GetPayoutDistributionResponse.parse({
      requestId: row.id,
      requestNo: row.requestNo,
      propertyName: detail.propertyName,
      receivedAmount: row.paidAmount ?? (row.status === "paid" ? row.total : 0),
      confirmationNo: row.confirmationNo,
      paidAt: row.paidAt?.toISOString() ?? null,
      rows,
    }),
  );
});

// ---------- Crew payouts ----------

async function payoutView(row: typeof crewPayoutsTable.$inferSelect) {
  const [crew] = await db
    .select({ name: crewsTable.name })
    .from(crewsTable)
    .where(eq(crewsTable.id, row.crewId))
    .limit(1);
  const labels = await jobLabelMap([row.jobId]);
  return {
    id: row.id,
    crewId: row.crewId,
    crewName: crew?.name ?? "Crew",
    jobId: row.jobId,
    jobLabel: labels.get(row.jobId) ?? "Job",
    paymentRequestId: row.paymentRequestId,
    amount: row.amount,
    method: row.method,
    status: row.status,
    confirmationNo: row.confirmationNo,
    paidAt: row.paidAt.toISOString(),
    returnedAt: row.returnedAt?.toISOString() ?? null,
    returnReason: row.returnReason,
  };
}

router.get("/pay-hub/payouts", async (req, res): Promise<void> => {
  const crewId = typeof req.query.crewId === "string" ? req.query.crewId : null;
  const jobId = typeof req.query.jobId === "string" ? req.query.jobId : null;
  const conds = [];
  if (crewId) conds.push(eq(crewPayoutsTable.crewId, crewId));
  if (jobId) conds.push(eq(crewPayoutsTable.jobId, jobId));
  const rows = await db
    .select()
    .from(crewPayoutsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(crewPayoutsTable.paidAt));
  const out = [];
  for (const row of rows) out.push(await payoutView(row));
  res.json(out.map((r) => CreateCrewPayoutResponse.parse(r)));
});

router.post("/pay-hub/payouts", async (req, res): Promise<void> => {
  const parsed = CreateCrewPayoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, body.crewId))
    .limit(1);
  if (!crew) {
    res.status(400).json({ error: "Crew not found" });
    return;
  }
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, body.jobId))
    .limit(1);
  if (!job) {
    res.status(400).json({ error: "Job not found" });
    return;
  }
  if (job.crewLeaderId !== crew.id) {
    const [sched] = await db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.jobId, job.id),
          eq(schedulesTable.crewLeaderId, crew.id),
        ),
      )
      .limit(1);
    if (!sched) {
      res.status(400).json({ error: `${crew.name} is not assigned to job #${job.jobNo}` });
      return;
    }
  }
  if (body.paymentRequestId) {
    const [reqRow] = await db
      .select()
      .from(paymentRequestsTable)
      .where(eq(paymentRequestsTable.id, body.paymentRequestId))
      .limit(1);
    if (!reqRow || reqRow.status !== "paid") {
      res.status(400).json({ error: "Payment request not found or not paid yet" });
      return;
    }
    const [link] = await db
      .select()
      .from(paymentRequestJobsTable)
      .where(
        and(
          eq(paymentRequestJobsTable.requestId, body.paymentRequestId),
          eq(paymentRequestJobsTable.jobId, body.jobId),
        ),
      )
      .limit(1);
    if (!link) {
      res.status(400).json({ error: "That job is not part of this payment request" });
      return;
    }
  }
  const [existing] = await db
    .select()
    .from(crewPayoutsTable)
    .where(
      and(
        eq(crewPayoutsTable.crewId, body.crewId),
        eq(crewPayoutsTable.jobId, body.jobId),
        eq(crewPayoutsTable.status, "paid"),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({
      error: `${crew.name} was already paid for #${job.jobNo} (${existing.confirmationNo})`,
    });
    return;
  }
  const [bank] = await db
    .select()
    .from(crewBankAccountsTable)
    .where(eq(crewBankAccountsTable.crewId, body.crewId))
    .limit(1);
  if (!bank || bank.status !== "verified") {
    res.status(409).json({
      error: `${crew.name} has no verified bank account connected yet`,
    });
    return;
  }
  // NOTE: Cybrid ACH payout rails drop in here. Stubbed to succeed instantly.
  const confirmation = confirmationNo("ACH");
  const [row] = await db
    .insert(crewPayoutsTable)
    .values({
      crewId: body.crewId,
      jobId: body.jobId,
      paymentRequestId: body.paymentRequestId ?? null,
      amount: body.amount,
      method: "ach",
      status: "paid",
      confirmationNo: confirmation,
    })
    .returning();
  await db.insert(activitiesTable).values({
    entityType: "crew",
    entityId: crew.id,
    kind: "payment",
    body: `Crew payout sent to ${crew.name} — $${body.amount.toFixed(2)} for #${job.jobNo} via ACH, confirmation ${confirmation}`,
  });
  await recomputeJobFinancials(body.jobId);
  res.status(201).json(CreateCrewPayoutResponse.parse(await payoutView(row!)));
});

router.post("/pay-hub/payouts/:id/return", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = ReturnPaymentRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(crewPayoutsTable)
    .where(eq(crewPayoutsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }
  const [updated] = await db
    .update(crewPayoutsTable)
    .set({
      status: "returned",
      returnedAt: new Date(),
      returnReason: parsed.data.reason,
    })
    .where(eq(crewPayoutsTable.id, id))
    .returning();
  const [crew] = await db
    .select({ name: crewsTable.name })
    .from(crewsTable)
    .where(eq(crewsTable.id, row.crewId))
    .limit(1);
  await db.insert(notificationsTable).values({
    kind: "payout_returned",
    priority: "high",
    entityType: "crew",
    entityId: row.crewId,
    title: `Payout returned — ${crew?.name ?? "crew"}`,
    body: `$${row.amount.toFixed(2)} ACH payout (${row.confirmationNo}) was returned: ${parsed.data.reason}`,
  });
  await db.insert(activitiesTable).values({
    entityType: "crew",
    entityId: row.crewId,
    kind: "payment",
    body: `Payout ${row.confirmationNo} RETURNED — $${row.amount.toFixed(2)}: ${parsed.data.reason}`,
  });
  await recomputeJobFinancials(row.jobId);
  res.json(CreateCrewPayoutResponse.parse(await payoutView(updated!)));
});

// ---------- Bank status (office view) ----------

export function bankStatusPayload(
  bank: typeof crewBankAccountsTable.$inferSelect | undefined,
) {
  if (!bank) return { connected: false };
  return {
    connected: true,
    status: bank.status,
    accountKind: bank.accountKind,
    holderName: bank.holderName,
    businessName: bank.businessName,
    bankName: bank.bankName,
    accountType: bank.accountType,
    routingLast4: bank.routingNumber.slice(-4),
    accountLast4: bank.accountNumber.slice(-4),
    verifiedAt: bank.verifiedAt?.toISOString() ?? null,
  };
}

router.get("/crews/:id/bank", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [crew] = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(eq(crewsTable.id, id))
    .limit(1);
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const [bank] = await db
    .select()
    .from(crewBankAccountsTable)
    .where(eq(crewBankAccountsTable.crewId, id))
    .limit(1);
  res.json(GetCrewBankStatusResponse.parse(bankStatusPayload(bank)));
});

export default router;
