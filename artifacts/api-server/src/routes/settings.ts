import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  businessSettingsTable,
  crewInvoiceItemsTable,
  crewInvoicesTable,
  crewPaymentsTable,
  photoSharesTable,
  recapSharesTable,
  crewPhotosTable,
  crewDocumentsTable,
  crewCheckinsTable,
  crewMessagesTable,
  jobBroadcastsTable,
  schedulesTable,
  calendarEventsTable,
  invoiceLineItemsTable,
  paymentsTable,
  expensesTable,
  invoicesTable,
  bidLineItemsTable,
  bidsTable,
  leadsTable,
  leadCampaignsTable,
  crewPacketsTable,
  notificationsTable,
  activitiesTable,
  voiceLogsTable,
  importUploadsTable,
  inventoryItemsTable,
  purchaseOrdersTable,
  vendorsTable,
  agreementsTable,
  priceItemsTable,
  contactsTable,
  jobsTable,
  crewsTable,
  propertiesTable,
  journalLinesTable,
  journalEntriesTable,
} from "@workspace/db";
import {
  GetBusinessSettingsResponse,
  UpdateBusinessSettingsBody,
  UpdateBusinessSettingsResponse,
  ResetAllDataResponse,
} from "@workspace/api-zod";
import { getBusinessSettings } from "../lib/businessSettings";

const router: IRouter = Router();

function serialize(row: {
  companyName: string;
  tagline: string;
  street: string;
  city: string;
  attn: string;
  phone: string;
  email: string;
  paymentInstructions: string;
}) {
  return {
    companyName: row.companyName,
    tagline: row.tagline,
    street: row.street,
    city: row.city,
    attn: row.attn,
    phone: row.phone,
    email: row.email,
    paymentInstructions: row.paymentInstructions,
  };
}

router.get("/settings/business", async (_req, res): Promise<void> => {
  const settings = await getBusinessSettings();
  res.json(GetBusinessSettingsResponse.parse(serialize(settings)));
});

router.put("/settings/business", async (req, res): Promise<void> => {
  const body = UpdateBusinessSettingsBody.parse(req.body);
  const existing = await getBusinessSettings();
  const [updated] = await db
    .update(businessSettingsTable)
    .set({
      ...(body.companyName != null ? { companyName: body.companyName } : {}),
      ...(body.tagline != null ? { tagline: body.tagline } : {}),
      ...(body.street != null ? { street: body.street } : {}),
      ...(body.city != null ? { city: body.city } : {}),
      ...(body.attn != null ? { attn: body.attn } : {}),
      ...(body.phone != null ? { phone: body.phone } : {}),
      ...(body.email != null ? { email: body.email } : {}),
      ...(body.paymentInstructions != null
        ? { paymentInstructions: body.paymentInstructions }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(businessSettingsTable.id, existing.id))
    .returning();
  res.json(UpdateBusinessSettingsResponse.parse(serialize(updated)));
});

router.post("/settings/reset", async (_req, res): Promise<void> => {
  await db.transaction(async (tx) => {
    // Delete children before parents (no DB-level FKs, but keep it safe/ordered).
    await tx.delete(crewInvoiceItemsTable);
    await tx.delete(crewInvoicesTable);
    await tx.delete(crewPaymentsTable);
    await tx.delete(photoSharesTable);
    await tx.delete(recapSharesTable);
    await tx.delete(crewPhotosTable);
    await tx.delete(crewDocumentsTable);
    await tx.delete(crewCheckinsTable);
    await tx.delete(crewMessagesTable);
    await tx.delete(crewPacketsTable);
    await tx.delete(jobBroadcastsTable);
    await tx.delete(schedulesTable);
    await tx.delete(calendarEventsTable);
    await tx.delete(journalLinesTable);
    await tx.delete(journalEntriesTable);
    await tx.delete(invoiceLineItemsTable);
    await tx.delete(paymentsTable);
    await tx.delete(expensesTable);
    await tx.delete(invoicesTable);
    await tx.delete(bidLineItemsTable);
    await tx.delete(bidsTable);
    await tx.delete(leadsTable);
    await tx.delete(leadCampaignsTable);
    await tx.delete(notificationsTable);
    // Intentionally preserved: activitiesTable — the activity log is a
    // permanent history that survives data wipes.
    await tx.delete(voiceLogsTable);
    await tx.delete(importUploadsTable);
    await tx.delete(inventoryItemsTable);
    await tx.delete(purchaseOrdersTable);
    await tx.delete(vendorsTable);
    await tx.delete(agreementsTable);
    await tx.delete(priceItemsTable);
    await tx.delete(contactsTable);
    await tx.delete(jobsTable);
    await tx.delete(crewsTable);
    await tx.delete(propertiesTable);
    // Intentionally preserved: businessSettingsTable (company info),
    // plaidItemsTable (real bank connection).
    await tx.insert(activitiesTable).values({
      entityType: "system",
      entityId: "reset",
      kind: "note",
      body: "All data wiped — fresh start",
    });
  });
  res.json(ResetAllDataResponse.parse({ ok: true }));
});

export default router;
