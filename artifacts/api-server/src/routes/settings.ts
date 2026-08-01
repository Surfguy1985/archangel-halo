import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  autopilotActionsTable,
  feedDismissalsTable,
  businessSettingsTable,
  crewInvoiceItemsTable,
  crewInvoicesTable,
  crewPaymentsTable,
  crewPayoutsTable,
  crewBankAccountsTable,
  paymentRequestJobsTable,
  paymentRequestsTable,
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
  propertySopRulesTable,
  clientAccountsTable,
  clientUsersTable,
  clientOnboardingSendsTable,
  clientBoardCardsTable,
  clientDashboardCardsTable,
  propertyMapsTable,
  propertyUnitsTable,
  clientHubItemsTable,
  clientDashboardActionsTable,
  clientCardCommentsTable,
  clientCardHistoryTable,
  clientBoardNotificationsTable,
  jobSummariesTable,
  workRequestsTable,
  contactsTable,
  jobsTable,
  crewsTable,
  propertiesTable,
  journalLinesTable,
  journalEntriesTable,
  wingMembersTable,
  wingScoreSnapshotsTable,
  wingAssignmentsTable,
  wingIncidentsTable,
  wingQualitySubmissionsTable,
  wingQualityReviewsTable,
  wingOverridesTable,
  wingReserveAccountsTable,
  wingReserveTxnsTable,
  wingEventsTable,
  wingAutomationRunsTable,
  wingAuditTable,
} from "@workspace/db";
import {
  GetBusinessSettingsResponse,
  UpdateBusinessSettingsBody,
  UpdateBusinessSettingsResponse,
  ResetAllDataResponse,
} from "@workspace/api-zod";
import { getBusinessSettings } from "../lib/businessSettings";
import { executeAutopilotAction, runAutopilot } from "../lib/autopilot";

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
  taxRatePct?: number | null;
  expenseApprovalThreshold?: number | null;
  autoSendRecapLinks?: boolean | null;
  autopilotEnabled?: boolean | null;
  autopilotAutoApprove?: boolean | null;
  requireSummaryBeforeCloseOut?: boolean | null;
}) {
  return {
    expenseApprovalThreshold: row.expenseApprovalThreshold ?? 0,
    autoSendRecapLinks: row.autoSendRecapLinks ?? true,
    autopilotEnabled: row.autopilotEnabled ?? true,
    autopilotAutoApprove: row.autopilotAutoApprove ?? false,
    requireSummaryBeforeCloseOut: row.requireSummaryBeforeCloseOut ?? false,
    companyName: row.companyName,
    tagline: row.tagline,
    street: row.street,
    city: row.city,
    attn: row.attn,
    taxRatePct: row.taxRatePct ?? 0,
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
      ...(body.taxRatePct != null
        ? { taxRatePct: Math.min(Math.max(body.taxRatePct, 0), 25) }
        : {}),
      ...(body.expenseApprovalThreshold != null
        ? { expenseApprovalThreshold: Math.max(body.expenseApprovalThreshold, 0) }
        : {}),
      ...(body.autoSendRecapLinks != null
        ? { autoSendRecapLinks: body.autoSendRecapLinks }
        : {}),
      ...(body.autopilotEnabled != null
        ? { autopilotEnabled: body.autopilotEnabled }
        : {}),
      ...(body.autopilotAutoApprove != null
        ? { autopilotAutoApprove: body.autopilotAutoApprove }
        : {}),
      ...(body.requireSummaryBeforeCloseOut != null
        ? { requireSummaryBeforeCloseOut: body.requireSummaryBeforeCloseOut }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(businessSettingsTable.id, existing.id))
    .returning();
  res.json(UpdateBusinessSettingsResponse.parse(serialize(updated)));
});

router.post("/autopilot/run", async (_req, res): Promise<void> => {
  const actions = await runAutopilot();
  res.json({ ok: true, actions });
});

function serializeAction(a: {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  status: string;
  result: string | null;
  executedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: a.id,
    kind: a.kind,
    entityType: a.entityType,
    entityId: a.entityId,
    title: a.title,
    body: a.body,
    status: a.status,
    result: a.result,
    executedAt: a.executedAt ? a.executedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/autopilot/actions", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(autopilotActionsTable)
    .orderBy(desc(autopilotActionsTable.createdAt))
    .limit(50);
  // Pending first, then most recent history.
  const pending = rows.filter((r) => r.status === "pending");
  const rest = rows.filter((r) => r.status !== "pending").slice(0, 15);
  res.json([...pending, ...rest].map(serializeAction));
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/autopilot/actions/:id/approve", async (req, res): Promise<void> => {
  if (!UUID_RE.test(req.params.id)) {
    res.status(404).json({ error: "Action not found" });
    return;
  }
  const [action] = await db
    .select()
    .from(autopilotActionsTable)
    .where(eq(autopilotActionsTable.id, req.params.id));
  if (!action) {
    res.status(404).json({ error: "Action not found" });
    return;
  }
  if (action.status !== "pending") {
    res.status(409).json({ error: `Action is already ${action.status}` });
    return;
  }
  const done = await executeAutopilotAction(action);
  if (!done) {
    res.status(409).json({ error: "Action was already handled" });
    return;
  }
  res.json(serializeAction(done));
});

router.post("/autopilot/actions/:id/dismiss", async (req, res): Promise<void> => {
  if (!UUID_RE.test(req.params.id)) {
    res.status(404).json({ error: "Action not found" });
    return;
  }
  // Atomic: only a still-pending action can be dismissed.
  const [dismissed] = await db
    .update(autopilotActionsTable)
    .set({ status: "dismissed", result: "Dismissed by you." })
    .where(
      and(
        eq(autopilotActionsTable.id, req.params.id),
        eq(autopilotActionsTable.status, "pending"),
      ),
    )
    .returning();
  if (dismissed) {
    res.json(serializeAction(dismissed));
    return;
  }
  const [action] = await db
    .select()
    .from(autopilotActionsTable)
    .where(eq(autopilotActionsTable.id, req.params.id));
  if (!action) {
    res.status(404).json({ error: "Action not found" });
    return;
  }
  res.status(409).json({ error: `Action is already ${action.status}` });
});

router.post("/settings/reset", async (_req, res): Promise<void> => {
  await db.transaction(async (tx) => {
    // Delete children before parents (no DB-level FKs, but keep it safe/ordered).
    await tx.delete(crewInvoiceItemsTable);
    await tx.delete(crewInvoicesTable);
    await tx.delete(crewPaymentsTable);
    await tx.delete(crewPayoutsTable);
    await tx.delete(crewBankAccountsTable);
    await tx.delete(paymentRequestJobsTable);
    await tx.delete(paymentRequestsTable);
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
    await tx.delete(autopilotActionsTable);
    await tx.delete(feedDismissalsTable);
    // Intentionally preserved: activitiesTable — the activity log is a
    // permanent history that survives data wipes.
    await tx.delete(voiceLogsTable);
    await tx.delete(importUploadsTable);
    await tx.delete(inventoryItemsTable);
    await tx.delete(purchaseOrdersTable);
    await tx.delete(vendorsTable);
    await tx.delete(agreementsTable);
    await tx.delete(priceItemsTable);
    await tx.delete(propertySopRulesTable);
    await tx.delete(clientOnboardingSendsTable);
    await tx.delete(clientBoardCardsTable);
    await tx.delete(clientDashboardCardsTable);
    await tx.delete(propertyMapsTable);
    await tx.delete(propertyUnitsTable);
    await tx.delete(clientHubItemsTable);
    await tx.delete(clientDashboardActionsTable);
    await tx.delete(clientCardCommentsTable);
    await tx.delete(clientCardHistoryTable);
    await tx.delete(clientBoardNotificationsTable);
    await tx.delete(jobSummariesTable);
    await tx.delete(workRequestsTable);
    await tx.delete(clientUsersTable);
    await tx.delete(clientAccountsTable);
    await tx.delete(contactsTable);
    await tx.delete(jobsTable);
    await tx.delete(crewsTable);
    await tx.delete(propertiesTable);
    await tx.delete(wingMembersTable);
    await tx.delete(wingScoreSnapshotsTable);
    await tx.delete(wingAssignmentsTable);
    await tx.delete(wingIncidentsTable);
    await tx.delete(wingQualitySubmissionsTable);
    await tx.delete(wingQualityReviewsTable);
    await tx.delete(wingOverridesTable);
    await tx.delete(wingReserveAccountsTable);
    await tx.delete(wingReserveTxnsTable);
    await tx.delete(wingEventsTable);
    await tx.delete(wingAutomationRunsTable);
    await tx.delete(wingAuditTable);
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
