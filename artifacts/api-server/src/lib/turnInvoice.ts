/**
 * Segment 6 — invoice compliance. The gate lives here, not in the UI.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientTurnsTable,
  clientUnitsTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientPriceListsTable,
  clientPriceListItemsTable,
  clientTurnInvoicesTable,
  clientTurnInvoiceLinesTable,
  clientVarianceRequestsTable,
  clientAuditLogTable,
  mulCents,
  addCents,
  toCents,
  pickActivePriceList,
  resolveScopeLine,
  canCreateInvoice,
  invoiceBlockers,
  blockingInvoiceMessage,
  complianceBadgeText,
  assumedHoursSaved,
  formatInvoiceNumber,
  nextInvoiceSeq,
  DEFAULT_TOLERANCE_BPS,
  DEFAULT_VARIANCE_REVIEW_MINUTES,
  yymmddInZone,
  datePartsInZone,
  type ScopeComplianceStatus,
  type VarianceRequestStatus,
} from "@workspace/db";
import { EVIDENCE_URL_TTL_SEC, fileUrl, issueSignedFile } from "./evidenceSign";
import { renderInvoicePdf } from "./invoiceExportPdf";
import { bidRequestIdForTurn } from "./bidBoard";

export class InvoiceNotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "InvoiceNotFoundError";
  }
}

export class InvoiceBlockedError extends Error {
  revision: string;
  lines: Array<{ description: string; compliance: ScopeComplianceStatus }>;
  constructor(
    message: string,
    revision: string,
    lines: Array<{ description: string; compliance: ScopeComplianceStatus }>,
  ) {
    super(message);
    this.name = "InvoiceBlockedError";
    this.revision = revision;
    this.lines = lines;
  }
}

function monthLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", year: "numeric" }).format(at);
}

async function loadTurn(turnId: string, orgId: string) {
  const [row] = await db
    .select({
      id: clientTurnsTable.id,
      orgId: clientTurnsTable.orgId,
      propertyId: clientTurnsTable.propertyId,
      unitId: clientTurnsTable.unitId,
      unitNumber: clientUnitsTable.unitNumber,
      bedrooms: clientUnitsTable.bedrooms,
      propertyName: propertiesTable.name,
      timezone: propertiesTable.timezone,
      propertyCode: propertiesTable.entrataPropertyId,
      toleranceBps: propertiesTable.invoiceToleranceBps,
      reviewMinutes: propertiesTable.varianceReviewMinutes,
    })
    .from(clientTurnsTable)
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .innerJoin(propertiesTable, eq(propertiesTable.id, clientTurnsTable.propertyId))
    .where(and(eq(clientTurnsTable.id, turnId), eq(clientTurnsTable.orgId, orgId)))
    .limit(1);
  if (!row) throw new InvoiceNotFoundError("Turn not found");
  return row;
}

async function activeList(propertyId: string, at: Date) {
  const lists = await db
    .select()
    .from(clientPriceListsTable)
    .where(eq(clientPriceListsTable.propertyId, propertyId));
  const picked = pickActivePriceList(lists, at);
  if (!picked) return { list: null as (typeof lists)[number] | null, items: [] as Array<typeof clientPriceListItemsTable.$inferSelect> };
  const items = await db
    .select()
    .from(clientPriceListItemsTable)
    .where(eq(clientPriceListItemsTable.priceListId, picked.id));
  return { list: picked, items };
}

function centsStr(n: bigint | null | undefined): string {
  return (n ?? 0n).toString();
}

async function writeAudit(args: {
  orgId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}) {
  await db.insert(clientAuditLogTable).values({
    orgId: args.orgId,
    actorId: args.actorId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    before: args.before ?? null,
    after: args.after ?? null,
  });
}

export async function getTurnScope(args: { turnId: string; orgId: string }) {
  const turn = await loadTurn(args.turnId, args.orgId);
  const [scope] = await db
    .select()
    .from(clientScopesTable)
    .where(eq(clientScopesTable.turnId, args.turnId))
    .limit(1);
  const at = scope?.submittedAt ?? scope?.createdAt ?? new Date();
  const { list, items } = await activeList(turn.propertyId, at);
  const revision = list?.revision ?? "no active schedule";
  const effectiveLabel = list ? monthLabel(list.effectiveFrom, turn.timezone) : "-";
  const lines = scope
    ? await db.select().from(clientScopeLinesTable).where(eq(clientScopeLinesTable.scopeId, scope.id))
    : [];
  const priceViews = items.map((i) => ({
    id: i.id,
    code: i.code,
    tier: i.tier,
    description: i.description,
    unitPriceCents: i.unitPriceCents,
  }));
  const resolved = lines.map((line) => {
    const r = resolveScopeLine(
      {
        id: line.id,
        code: line.code,
        tier: line.tier,
        description: line.description,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        priceItemId: line.priceItemId,
        compliance: line.compliance as ScopeComplianceStatus,
      },
      priceViews,
      turn.toleranceBps ?? DEFAULT_TOLERANCE_BPS,
    );
    const compliance =
      line.compliance === "variance_approved" ? ("variance_approved" as const) : r.compliance;
    return {
      id: line.id,
      code: line.code,
      tier: line.tier,
      description: line.description,
      qty: line.qty,
      uom: line.uom,
      unitPriceCents: centsStr(line.unitPriceCents),
      extendedCents: centsStr(line.extendedCents),
      compliance,
      varianceReason: line.varianceReason,
      scheduleCode: r.scheduleCode,
      scheduleDescription: r.scheduleDescription,
      scheduleUnitPriceCents: r.scheduleUnitPriceCents != null ? centsStr(r.scheduleUnitPriceCents) : null,
      deltaCents: centsStr(r.deltaCents),
    };
  });
  const matched = resolved.filter((l) => l.compliance === "matched" || l.compliance === "variance_approved").length;
  const blockers = invoiceBlockers(resolved);
  const [invoice] = scope
    ? await db.select().from(clientTurnInvoicesTable).where(eq(clientTurnInvoicesTable.scopeId, scope.id)).limit(1)
    : [];
  const vars = scope
    ? await db.select().from(clientVarianceRequestsTable).where(eq(clientVarianceRequestsTable.scopeId, scope.id))
    : [];
  return {
    turnId: turn.id,
    scopeId: scope?.id ?? null,
    status: scope?.status ?? "none",
    priceListRevision: list?.revision ?? null,
    priceListEffectiveLabel: list ? effectiveLabel : null,
    canInvoice: Boolean(scope) && canCreateInvoice(resolved) && resolved.length > 0,
    blockingMessage:
      blockers.length && list
        ? blockingInvoiceMessage({ lines: resolved, revision, effectiveLabel })
        : blockers.length
          ? "Cannot invoice: no active price list covers this scope date."
          : null,
    badge:
      resolved.length === 0
        ? "No scope lines yet."
        : complianceBadgeText({ matched, total: resolved.length, revision, effectiveLabel }),
    lines: resolved,
    variances: await Promise.all(vars.map((v) => toVarianceDoc(v))),
    invoice: invoice ? toInvoiceDoc(invoice) : null,
    bidRequestId: scope ? await bidRequestIdForTurn(args.turnId) : null,
  };
}

function toInvoiceDoc(row: typeof clientTurnInvoicesTable.$inferSelect) {
  return {
    id: row.id,
    turnId: row.turnId,
    scopeId: row.scopeId,
    invoiceNumber: row.invoiceNumber,
    poNumber: row.poNumber,
    status: row.status,
    subtotalCents: centsStr(row.subtotalCents),
    taxCents: centsStr(row.taxCents),
    totalCents: centsStr(row.totalCents),
    complianceScore: row.complianceScore,
    firstPassAccepted: row.firstPassAccepted,
  };
}

async function toVarianceDoc(row: typeof clientVarianceRequestsTable.$inferSelect) {
  let nearestScheduleCode: string | null = null;
  let nearestScheduleDescription: string | null = null;
  if (row.nearestPriceItemId) {
    const [item] = await db
      .select({ code: clientPriceListItemsTable.code, description: clientPriceListItemsTable.description })
      .from(clientPriceListItemsTable)
      .where(eq(clientPriceListItemsTable.id, row.nearestPriceItemId))
      .limit(1);
    nearestScheduleCode = item?.code ?? null;
    nearestScheduleDescription = item?.description ?? null;
  }
  const photoUrls = await Promise.all(
    (row.evidenceIds ?? []).map(async (id) => {
      const signed = await issueSignedFile({
        kind: "evidence",
        id,
        size: "thumb",
        ttlSec: EVIDENCE_URL_TTL_SEC,
      });
      return fileUrl(`/v1/evidence/${id}/file`, signed, "thumb");
    }),
  );
  return {
    id: row.id,
    scopeId: row.scopeId,
    scopeLineId: row.scopeLineId,
    turnId: row.turnId,
    reason: row.reason,
    status: row.status,
    evidenceIds: row.evidenceIds ?? [],
    nearestScheduleCode,
    nearestScheduleDescription,
    requestedQty: row.requestedQty,
    requestedUnitPriceCents: centsStr(row.requestedUnitPriceCents),
    scheduleUnitPriceCents: row.scheduleUnitPriceCents != null ? centsStr(row.scheduleUnitPriceCents) : null,
    deltaCents: centsStr(row.deltaCents),
    photoUrls,
  };
}

async function persistResolutions(scopeId: string, orgId: string, turnId: string) {
  const turn = await loadTurn(turnId, orgId);
  const [scope] = await db.select().from(clientScopesTable).where(eq(clientScopesTable.id, scopeId)).limit(1);
  if (!scope) throw new InvoiceNotFoundError("Scope not found");
  const at = scope.submittedAt ?? scope.createdAt;
  const { items } = await activeList(turn.propertyId, at);
  const priceViews = items.map((i) => ({
    id: i.id,
    code: i.code,
    tier: i.tier,
    description: i.description,
    unitPriceCents: i.unitPriceCents,
  }));
  const lines = await db.select().from(clientScopeLinesTable).where(eq(clientScopeLinesTable.scopeId, scopeId));
  for (const line of lines) {
    if (line.compliance === "variance_approved") continue;
    const r = resolveScopeLine(
      {
        code: line.code,
        tier: line.tier,
        description: line.description,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        priceItemId: line.priceItemId,
      },
      priceViews,
      turn.toleranceBps ?? DEFAULT_TOLERANCE_BPS,
    );
    await db
      .update(clientScopeLinesTable)
      .set({ compliance: r.compliance, priceItemId: r.priceItemId })
      .where(eq(clientScopeLinesTable.id, line.id));
  }
}

export async function validateScope(args: { scopeId: string; orgId: string }) {
  const [scope] = await db.select().from(clientScopesTable).where(eq(clientScopesTable.id, args.scopeId)).limit(1);
  if (!scope) throw new InvoiceNotFoundError("Scope not found");
  const turn = await loadTurn(scope.turnId, args.orgId);
  await persistResolutions(scope.id, turn.orgId, turn.id);
  return getTurnScope({ turnId: turn.id, orgId: turn.orgId });
}

export async function addScopeLine(args: {
  scopeId: string;
  orgId: string;
  actorId: string;
  description: string;
  code?: string | null;
  tier?: string | null;
  qty: number;
  unitPriceCents: string;
  uom?: string;
}) {
  const [scope] = await db.select().from(clientScopesTable).where(eq(clientScopesTable.id, args.scopeId)).limit(1);
  if (!scope) throw new InvoiceNotFoundError("Scope not found");
  const turn = await loadTurn(scope.turnId, args.orgId);
  const price = toCents(args.unitPriceCents);
  const qty = args.qty;
  const [line] = await db
    .insert(clientScopeLinesTable)
    .values({
      scopeId: scope.id,
      description: args.description,
      code: args.code ?? null,
      tier: args.tier ?? null,
      qty,
      uom: args.uom ?? "ea",
      unitPriceCents: price,
      extendedCents: mulCents(price, qty),
      compliance: "off_schedule",
    })
    .returning();
  await persistResolutions(scope.id, turn.orgId, turn.id);
  await writeAudit({
    orgId: turn.orgId,
    actorId: args.actorId,
    entityType: "client_scope_line",
    entityId: line!.id,
    action: "scope.line_added",
    after: { description: args.description, code: args.code },
  });
  return getTurnScope({ turnId: turn.id, orgId: turn.orgId });
}

export async function createVarianceRequest(args: {
  scopeId: string;
  orgId: string;
  actorId: string;
  scopeLineId: string;
  reason: string;
  evidenceIds?: string[];
}) {
  const reason = args.reason.trim();
  if (!reason) throw new InvoiceBlockedError("A reason is required.", "", []);
  const [scope] = await db.select().from(clientScopesTable).where(eq(clientScopesTable.id, args.scopeId)).limit(1);
  if (!scope) throw new InvoiceNotFoundError("Scope not found");
  const turn = await loadTurn(scope.turnId, args.orgId);
  const [line] = await db
    .select()
    .from(clientScopeLinesTable)
    .where(and(eq(clientScopeLinesTable.id, args.scopeLineId), eq(clientScopeLinesTable.scopeId, scope.id)))
    .limit(1);
  if (!line) throw new InvoiceNotFoundError("Scope line not found");
  const at = scope.submittedAt ?? scope.createdAt;
  const { items } = await activeList(turn.propertyId, at);
  const r = resolveScopeLine(
    {
      code: line.code,
      tier: line.tier,
      description: line.description,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      priceItemId: line.priceItemId,
    },
    items.map((i) => ({
      id: i.id,
      code: i.code,
      tier: i.tier,
      description: i.description,
      unitPriceCents: i.unitPriceCents,
    })),
    turn.toleranceBps ?? DEFAULT_TOLERANCE_BPS,
  );
  const [row] = await db
    .insert(clientVarianceRequestsTable)
    .values({
      orgId: turn.orgId,
      scopeId: scope.id,
      scopeLineId: line.id,
      turnId: turn.id,
      propertyId: turn.propertyId,
      reason,
      status: "pending",
      evidenceIds: args.evidenceIds ?? [],
      nearestPriceItemId: r.priceItemId,
      requestedQty: line.qty,
      requestedUnitPriceCents: line.unitPriceCents,
      scheduleUnitPriceCents: r.scheduleUnitPriceCents,
      deltaCents: r.deltaCents,
    })
    .returning();
  await db
    .update(clientScopeLinesTable)
    .set({ compliance: "variance_pending", varianceReason: reason })
    .where(eq(clientScopeLinesTable.id, line.id));
  await writeAudit({
    orgId: turn.orgId,
    actorId: args.actorId,
    entityType: "client_variance_request",
    entityId: row!.id,
    action: "variance.requested",
    after: { reason, line: line.description },
  });
  return toVarianceDoc(row!);
}

export async function decideVariance(args: {
  varianceId: string;
  orgId: string;
  actorId: string;
  decision: "approved" | "rejected" | "countered";
  unitPriceCents?: string;
  qty?: number;
  reason?: string;
}) {
  const [row] = await db
    .select()
    .from(clientVarianceRequestsTable)
    .where(and(eq(clientVarianceRequestsTable.id, args.varianceId), eq(clientVarianceRequestsTable.orgId, args.orgId)))
    .limit(1);
  if (!row) throw new InvoiceNotFoundError("Variance not found");
  const now = new Date();
  const patch: Partial<typeof clientVarianceRequestsTable.$inferInsert> = {
    status: args.decision as VarianceRequestStatus,
    decidedBy: args.actorId,
    decidedAt: now,
  };
  if (args.decision === "countered") {
    if (!args.unitPriceCents) throw new InvoiceBlockedError("Counter requires a unit price.", "", []);
    patch.counterUnitPriceCents = toCents(args.unitPriceCents);
    patch.counterQty = args.qty ?? row.requestedQty;
  }
  const [updated] = await db
    .update(clientVarianceRequestsTable)
    .set(patch)
    .where(eq(clientVarianceRequestsTable.id, row.id))
    .returning();
  if (args.decision === "approved") {
    await db
      .update(clientScopeLinesTable)
      .set({ compliance: "variance_approved", approvedBy: args.actorId, approvedAt: now })
      .where(eq(clientScopeLinesTable.id, row.scopeLineId));
  } else if (args.decision === "countered") {
    const price = toCents(args.unitPriceCents!);
    const qty = args.qty ?? row.requestedQty;
    await db
      .update(clientScopeLinesTable)
      .set({
        unitPriceCents: price,
        qty,
        extendedCents: mulCents(price, qty),
        compliance: "variance_approved",
        varianceReason: args.reason ?? row.reason,
        approvedBy: args.actorId,
        approvedAt: now,
      })
      .where(eq(clientScopeLinesTable.id, row.scopeLineId));
  }
  await writeAudit({
    orgId: args.orgId,
    actorId: args.actorId,
    entityType: "client_variance_request",
    entityId: row.id,
    action: `variance.${args.decision}`,
    before: { status: row.status },
    after: { status: args.decision },
  });
  return toVarianceDoc(updated!);
}

export async function createScopeInvoice(args: {
  scopeId: string;
  orgId: string;
  actorId: string;
  poNumber?: string | null;
}) {
  const doc = await validateScope({ scopeId: args.scopeId, orgId: args.orgId });
  const [scope] = await db.select().from(clientScopesTable).where(eq(clientScopesTable.id, args.scopeId)).limit(1);
  if (!scope) throw new InvoiceNotFoundError("Scope not found");
  const turn = await loadTurn(scope.turnId, args.orgId);
  if (!doc.canInvoice) {
    throw new InvoiceBlockedError(
      doc.blockingMessage ?? "Scope is not invoice-compliant.",
      doc.priceListRevision ?? "",
      doc.lines.map((l) => ({ description: l.description, compliance: l.compliance })),
    );
  }
  const existing = await db
    .select({ invoiceNumber: clientTurnInvoicesTable.invoiceNumber })
    .from(clientTurnInvoicesTable)
    .where(eq(clientTurnInvoicesTable.turnId, turn.id));
  const ymd = yymmddInZone(new Date(), turn.timezone);
  const propertyCode = turn.propertyCode || "PROP";
  const prefix = `${propertyCode}-${turn.unitNumber}-${ymd}`;
  const invoiceNumber = formatInvoiceNumber({
    propertyCode,
    unitNumber: turn.unitNumber,
    yymmdd: ymd,
    seq: nextInvoiceSeq(existing.map((e) => e.invoiceNumber), prefix),
  });
  const subtotal = doc.lines.reduce((s, l) => addCents(s, toCents(l.extendedCents)), 0n);
  const allMatched = doc.lines.every((l) => l.compliance === "matched");
  const matchedCount = doc.lines.filter((l) => l.compliance === "matched" || l.compliance === "variance_approved").length;
  const [invoice] = await db
    .insert(clientTurnInvoicesTable)
    .values({
      turnId: turn.id,
      scopeId: scope.id,
      invoiceNumber,
      poNumber: args.poNumber ?? `PO-${turn.unitNumber}-${ymd}`,
      status: "submitted",
      subtotalCents: subtotal,
      taxCents: 0n,
      totalCents: subtotal,
      complianceScore: `${matchedCount}/${doc.lines.length}`,
      submittedAt: new Date(),
      firstPassAccepted: allMatched,
    })
    .returning();
  await db.insert(clientTurnInvoiceLinesTable).values(
    doc.lines.map((l, i) => ({
      invoiceId: invoice!.id,
      description: l.description,
      qty: l.qty,
      uom: l.uom,
      unitPriceCents: toCents(l.unitPriceCents),
      extendedCents: toCents(l.extendedCents),
      compliance: l.compliance,
      glCode: "6200",
      unitNumber: turn.unitNumber,
      sortOrder: i,
    })),
  );
  await db
    .update(clientScopesTable)
    .set({ status: "invoiced", submittedAt: new Date() })
    .where(eq(clientScopesTable.id, scope.id));
  await writeAudit({
    orgId: turn.orgId,
    actorId: args.actorId,
    entityType: "client_turn_invoice",
    entityId: invoice!.id,
    action: "invoice.created",
    after: { invoiceNumber },
  });
  return toInvoiceDoc(invoice!);
}

export async function buildInvoiceExport(args: { invoiceId: string; orgId: string }) {
  const [invoice] = await db
    .select()
    .from(clientTurnInvoicesTable)
    .where(eq(clientTurnInvoicesTable.id, args.invoiceId))
    .limit(1);
  if (!invoice) throw new InvoiceNotFoundError("Invoice not found");
  const turn = await loadTurn(invoice.turnId, args.orgId);
  const lines = await db
    .select()
    .from(clientTurnInvoiceLinesTable)
    .where(eq(clientTurnInvoiceLinesTable.invoiceId, invoice.id));
  const issued = invoice.submittedAt ?? invoice.createdAt;
  const parts = datePartsInZone(issued, turn.timezone);
  const issuedOn = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const propertyCode = turn.propertyCode || "PROP";
  const payload = {
    invoiceNumber: invoice.invoiceNumber,
    propertyCode,
    propertyName: turn.propertyName,
    unitNumber: turn.unitNumber,
    poNumber: invoice.poNumber ?? "",
    issuedOn,
    subtotalCents: centsStr(invoice.subtotalCents),
    taxCents: centsStr(invoice.taxCents),
    totalCents: centsStr(invoice.totalCents),
    lines: lines.map((l) => ({
      description: l.description,
      code: null as string | null,
      qty: l.qty,
      uom: l.uom,
      unitPriceCents: centsStr(l.unitPriceCents),
      extendedCents: centsStr(l.extendedCents),
      glCode: l.glCode,
      unitNumber: l.unitNumber ?? turn.unitNumber,
      poNumber: invoice.poNumber,
      propertyCode,
    })),
  };
  return { invoice, turn, payload };
}

export async function exportInvoiceCsv(args: { invoiceId: string; orgId: string }): Promise<string> {
  const { payload } = await buildInvoiceExport(args);
  const header = [
    "invoice_number",
    "property_code",
    "unit_number",
    "po_number",
    "gl_code",
    "description",
    "qty",
    "unit_price_cents",
    "extended_cents",
  ];
  const rows = payload.lines.map((l) =>
    [
      payload.invoiceNumber,
      payload.propertyCode,
      payload.unitNumber,
      payload.poNumber,
      l.glCode ?? "",
      l.description.replaceAll(",", " "),
      String(l.qty),
      l.unitPriceCents,
      l.extendedCents,
    ].join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export async function exportInvoicePdf(args: { invoiceId: string; orgId: string }): Promise<Uint8Array> {
  const { payload } = await buildInvoiceExport(args);
  return renderInvoicePdf(payload);
}

export async function markInvoiceExported(invoiceId: string): Promise<void> {
  await db
    .update(clientTurnInvoicesTable)
    .set({ entrataExportAt: new Date() })
    .where(eq(clientTurnInvoicesTable.id, invoiceId));
}

export async function complianceStats(args: {
  orgId: string;
  propertyIds: string[];
  propertyId?: string | null;
}) {
  const minutes = DEFAULT_VARIANCE_REVIEW_MINUTES;
  const assumption = (review: number) =>
    `Assumes ${review} minutes per blocked line that would otherwise need manual AP review. This is a configured assumption, not a measured duration.`;
  if (args.propertyIds.length === 0) {
    return {
      propertyId: args.propertyId ?? null,
      invoicesAutoValidated: 0,
      offScheduleBlocked: 0,
      assumedHoursSaved: 0,
      assumedMinutesPerReview: minutes,
      firstPassAcceptRate: null as number | null,
      assumption: assumption(minutes),
    };
  }
  const invoices = await db
    .select({ firstPassAccepted: clientTurnInvoicesTable.firstPassAccepted })
    .from(clientTurnInvoicesTable)
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientTurnInvoicesTable.turnId))
    .where(and(eq(clientTurnsTable.orgId, args.orgId), inArray(clientTurnsTable.propertyId, args.propertyIds)));
  const auto = invoices.filter((i) => i.firstPassAccepted).length;
  const blocked = await db
    .select({ id: clientScopeLinesTable.id })
    .from(clientScopeLinesTable)
    .innerJoin(clientScopesTable, eq(clientScopesTable.id, clientScopeLinesTable.scopeId))
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientScopesTable.turnId))
    .where(
      and(
        eq(clientTurnsTable.orgId, args.orgId),
        inArray(clientTurnsTable.propertyId, args.propertyIds),
        inArray(clientScopeLinesTable.compliance, ["off_schedule", "variance_pending"]),
      ),
    );
  const [prop] = args.propertyId
    ? await db
        .select({ minutes: propertiesTable.varianceReviewMinutes })
        .from(propertiesTable)
        .where(eq(propertiesTable.id, args.propertyId))
        .limit(1)
    : [];
  const review = prop?.minutes ?? minutes;
  return {
    propertyId: args.propertyId ?? null,
    invoicesAutoValidated: auto,
    offScheduleBlocked: blocked.length,
    assumedHoursSaved: assumedHoursSaved(blocked.length, review),
    assumedMinutesPerReview: review,
    firstPassAcceptRate: invoices.length ? Math.round((auto / invoices.length) * 1000) / 10 : null,
    assumption: assumption(review),
  };
}

export async function orgForScope(scopeId: string): Promise<{ orgId: string; turnId: string } | null> {
  const [scope] = await db
    .select({ turnId: clientScopesTable.turnId })
    .from(clientScopesTable)
    .where(eq(clientScopesTable.id, scopeId))
    .limit(1);
  if (!scope) return null;
  const [turn] = await db
    .select({ orgId: clientTurnsTable.orgId })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, scope.turnId))
    .limit(1);
  return turn ? { orgId: turn.orgId, turnId: scope.turnId } : null;
}

export async function orgForInvoice(invoiceId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: clientTurnsTable.orgId })
    .from(clientTurnInvoicesTable)
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientTurnInvoicesTable.turnId))
    .where(eq(clientTurnInvoicesTable.id, invoiceId))
    .limit(1);
  return row?.orgId ?? null;
}

export async function orgForVariance(varianceId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: clientVarianceRequestsTable.orgId })
    .from(clientVarianceRequestsTable)
    .where(eq(clientVarianceRequestsTable.id, varianceId))
    .limit(1);
  return row?.orgId ?? null;
}
