import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetTurnScopeParams,
  GetTurnScopeResponse,
  AddScopeLineParams,
  AddScopeLineBody,
  AddScopeLineResponse,
  ValidateScopeParams,
  ValidateScopeResponse,
  CreateVarianceRequestParams,
  CreateVarianceRequestBody,
  CreateVarianceRequestResponse,
  ApproveVarianceRequestParams,
  ApproveVarianceRequestResponse,
  RejectVarianceRequestParams,
  RejectVarianceRequestResponse,
  CounterVarianceRequestParams,
  CounterVarianceRequestBody,
  CounterVarianceRequestResponse,
  CreateScopeInvoiceParams,
  CreateScopeInvoiceBody,
  CreateScopeInvoiceResponse,
  ExportTurnInvoiceParams,
  ExportTurnInvoiceQueryParams,
  GetPropertyComplianceStatsParams,
  GetPropertyComplianceStatsResponse,
  GetClientTurnScopeParams,
  GetClientTurnScopeResponse,
  AddClientScopeLineParams,
  AddClientScopeLineBody,
  AddClientScopeLineResponse,
  ValidateClientScopeParams,
  ValidateClientScopeResponse,
  CreateClientVarianceRequestParams,
  CreateClientVarianceRequestBody,
  CreateClientVarianceRequestResponse,
  ApproveClientVarianceRequestParams,
  ApproveClientVarianceRequestResponse,
  RejectClientVarianceRequestParams,
  RejectClientVarianceRequestResponse,
  CounterClientVarianceRequestParams,
  CounterClientVarianceRequestBody,
  CounterClientVarianceRequestResponse,
  CreateClientScopeInvoiceParams,
  CreateClientScopeInvoiceBody,
  CreateClientScopeInvoiceResponse,
  ExportClientTurnInvoiceParams,
  ExportClientTurnInvoiceQueryParams,
  GetClientPropertyComplianceStatsParams,
  GetClientPropertyComplianceStatsResponse,
} from "@workspace/api-zod";
import { db, clientTurnsTable, propertiesTable, clientVarianceRequestsTable, clientTurnInvoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import {
  requireProperty,
  sendAccessError,
  propertyIdOfTurn,
  propertyIdOfScope,
  propertyIdOfInvoice,
  propertyIdOfVariance,
  scopeTotalCents,
  assertApproveAmount,
} from "../lib/clientBoardAccess";
import { resolveClientPropertyIdForToken } from "../lib/sessionAuth";
import { resolvePortfolioForProperty } from "../lib/portfolioPulse";
import {
  addScopeLine,
  buildInvoiceExport,
  complianceStats,
  createScopeInvoice,
  createVarianceRequest,
  decideVariance,
  exportInvoiceCsv,
  exportInvoicePdf,
  getTurnScope,
  InvoiceBlockedError,
  InvoiceNotFoundError,
  markInvoiceExported,
  orgForInvoice,
  orgForScope,
  orgForVariance,
  validateScope,
} from "../lib/turnInvoice";

const router: IRouter = Router();
const DARK = { error: "Invoice compliance is not enabled" };

async function requireFlag(): Promise<boolean> {
  return isClientBoardSegmentEnabled("invoiceCompliance");
}

function sendErr(res: Response, err: unknown): boolean {
  if (sendAccessError(res, err)) return true;
  if (err instanceof InvoiceNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof InvoiceBlockedError) {
    res.status(err.message.includes("required") ? 400 : 422).json({
      error: err.message,
      priceListRevision: err.revision,
      lines: err.lines,
    });
    return true;
  }
  return false;
}

async function clientMayAccessTurn(token: string, turnId: string): Promise<{ orgId: string } | null> {
  const [turn] = await db
    .select({ propertyId: clientTurnsTable.propertyId, orgId: clientTurnsTable.orgId })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, turnId))
    .limit(1);
  if (!turn) return null;
  const tokenPropertyId = await resolveClientPropertyIdForToken(token);
  if (!tokenPropertyId) return null;
  const tokenPort = await resolvePortfolioForProperty(tokenPropertyId);
  const targetPort = await resolvePortfolioForProperty(turn.propertyId);
  if (!tokenPort || !targetPort || tokenPort.portfolioId !== targetPort.portfolioId) return null;
  return { orgId: turn.orgId };
}

async function orgForTurn(turnId: string): Promise<string | null> {
  const [turn] = await db
    .select({ orgId: clientTurnsTable.orgId })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, turnId))
    .limit(1);
  return turn?.orgId ?? null;
}

router.get("/v1/turns/:id/scope", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetTurnScopeParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid scope request" });
    return;
  }
  const orgId = await orgForTurn(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  try {
    await requireProperty(req, orgId, await propertyIdOfTurn(path.data.id), "read");
    res.json(GetTurnScopeResponse.parse(await getTurnScope({ turnId: path.data.id, orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/scopes/:id/lines", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = AddScopeLineParams.safeParse(req.params);
  const body = AddScopeLineBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid line" });
    return;
  }
  const found = await orgForScope(path.data.id);
  if (!found) {
    res.status(404).json({ error: "Scope not found" });
    return;
  }
  try {
    await requireProperty(req, found.orgId, await propertyIdOfScope(path.data.id), "write");
    res.json(
      AddScopeLineResponse.parse(
        await addScopeLine({
          scopeId: path.data.id,
          orgId: found.orgId,
          actorId: "office",
          description: body.data.description,
          code: body.data.code,
          tier: body.data.tier,
          qty: body.data.qty,
          unitPriceCents: body.data.unitPriceCents,
          uom: body.data.uom,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/scopes/:id/validate", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ValidateScopeParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid scope" });
    return;
  }
  const found = await orgForScope(path.data.id);
  if (!found) {
    res.status(404).json({ error: "Scope not found" });
    return;
  }
  try {
    await requireProperty(req, found.orgId, await propertyIdOfScope(path.data.id), "read");
    res.json(ValidateScopeResponse.parse(await validateScope({ scopeId: path.data.id, orgId: found.orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/scopes/:id/variance-request", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = CreateVarianceRequestParams.safeParse(req.params);
  const body = CreateVarianceRequestBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid variance request" });
    return;
  }
  const found = await orgForScope(path.data.id);
  if (!found) {
    res.status(404).json({ error: "Scope not found" });
    return;
  }
  try {
    await requireProperty(req, found.orgId, await propertyIdOfScope(path.data.id), "write");
    res.json(
      CreateVarianceRequestResponse.parse(
        await createVarianceRequest({
          scopeId: path.data.id,
          orgId: found.orgId,
          actorId: "office",
          scopeLineId: body.data.scopeLineId,
          reason: body.data.reason,
          evidenceIds: body.data.evidenceIds,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

async function varianceDecision(
  req: Request,
  res: Response,
  decision: "approved" | "rejected" | "countered",
): Promise<void> {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ApproveVarianceRequestParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid variance" });
    return;
  }
  const orgId = await orgForVariance(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Variance not found" });
    return;
  }
  const counter = decision === "countered" ? CounterVarianceRequestBody.safeParse(req.body ?? {}) : null;
  if (counter && !counter.success) {
    res.status(400).json({ error: "Invalid counter" });
    return;
  }
  try {
    await requireProperty(req, orgId, await propertyIdOfVariance(path.data.id), "approve");
    const doc = await decideVariance({
      varianceId: path.data.id,
      orgId,
      actorId: "office",
      decision,
      unitPriceCents: counter?.data.unitPriceCents,
      qty: counter?.data.qty,
      reason: counter?.data.reason,
    });
    const parsed =
      decision === "approved"
        ? ApproveVarianceRequestResponse.parse(doc)
        : decision === "rejected"
          ? RejectVarianceRequestResponse.parse(doc)
          : CounterVarianceRequestResponse.parse(doc);
    res.json(parsed);
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
}

router.post("/v1/variances/:id/approve", (req, res) => void varianceDecision(req, res, "approved"));
router.post("/v1/variances/:id/reject", (req, res) => void varianceDecision(req, res, "rejected"));
router.post("/v1/variances/:id/counter", (req, res) => void varianceDecision(req, res, "countered"));

router.post("/v1/scopes/:id/invoice", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = CreateScopeInvoiceParams.safeParse(req.params);
  const body = CreateScopeInvoiceBody.safeParse(req.body ?? {});
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid invoice request" });
    return;
  }
  const found = await orgForScope(path.data.id);
  if (!found) {
    res.status(404).json({ error: "Scope not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, found.orgId, await propertyIdOfScope(path.data.id), "approve");
    await assertApproveAmount(actor, (await propertyIdOfScope(path.data.id))!, await scopeTotalCents(path.data.id));
    res.json(
      CreateScopeInvoiceResponse.parse(
        await createScopeInvoice({
          scopeId: path.data.id,
          orgId: found.orgId,
          actorId: actor.actorId,
          poNumber: body.data.poNumber,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/v1/invoices/:id/export", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ExportTurnInvoiceParams.safeParse(req.params);
  const query = ExportTurnInvoiceQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid export" });
    return;
  }
  const orgId = await orgForInvoice(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  try {
    await requireProperty(req, orgId, await propertyIdOfInvoice(path.data.id), "read");
    if (query.data.format === "json") {
      const { payload } = await buildInvoiceExport({ invoiceId: path.data.id, orgId });
      await markInvoiceExported(path.data.id);
      res.json(payload);
      return;
    }
    if (query.data.format === "csv") {
      const csv = await exportInvoiceCsv({ invoiceId: path.data.id, orgId });
      await markInvoiceExported(path.data.id);
      res.setHeader("Content-Type", "text/csv");
      res.send(csv);
      return;
    }
    const pdf = await exportInvoicePdf({ invoiceId: path.data.id, orgId });
    await markInvoiceExported(path.data.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/v1/properties/:id/compliance-stats", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetPropertyComplianceStatsParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  const [prop] = await db
    .select({ orgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, path.data.id))
    .limit(1);
  if (!prop?.orgId) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  try {
    await requireProperty(req, prop.orgId, path.data.id, "read");
    res.json(
      GetPropertyComplianceStatsResponse.parse(
        await complianceStats({ orgId: prop.orgId, propertyIds: [path.data.id], propertyId: path.data.id }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/turns/:id/scope", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientTurnScopeParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid scope request" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(GetClientTurnScopeResponse.parse(await getTurnScope({ turnId: path.data.id, orgId: allowed.orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/scopes/:id/lines", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = AddClientScopeLineParams.safeParse(req.params);
  const body = AddClientScopeLineBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid line" });
    return;
  }
  const found = await orgForScope(path.data.id);
  if (!found) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, found.turnId);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      AddClientScopeLineResponse.parse(
        await addScopeLine({
          scopeId: path.data.id,
          orgId: allowed.orgId,
          actorId: `client:${path.data.token}`,
          description: body.data.description,
          code: body.data.code,
          tier: body.data.tier,
          qty: body.data.qty,
          unitPriceCents: body.data.unitPriceCents,
          uom: body.data.uom,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/scopes/:id/validate", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ValidateClientScopeParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid scope" });
    return;
  }
  const found = await orgForScope(path.data.id);
  if (!found) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, found.turnId);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(ValidateClientScopeResponse.parse(await validateScope({ scopeId: path.data.id, orgId: allowed.orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/scopes/:id/variance-request", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = CreateClientVarianceRequestParams.safeParse(req.params);
  const body = CreateClientVarianceRequestBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid variance request" });
    return;
  }
  const found = await orgForScope(path.data.id);
  if (!found) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, found.turnId);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      CreateClientVarianceRequestResponse.parse(
        await createVarianceRequest({
          scopeId: path.data.id,
          orgId: allowed.orgId,
          actorId: `client:${path.data.token}`,
          scopeLineId: body.data.scopeLineId,
          reason: body.data.reason,
          evidenceIds: body.data.evidenceIds,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

async function clientVarianceDecision(
  req: Request,
  res: Response,
  decision: "approved" | "rejected" | "countered",
): Promise<void> {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ApproveClientVarianceRequestParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid variance" });
    return;
  }
  const [vr] = await db
    .select({ turnId: clientVarianceRequestsTable.turnId, orgId: clientVarianceRequestsTable.orgId })
    .from(clientVarianceRequestsTable)
    .where(eq(clientVarianceRequestsTable.id, path.data.id))
    .limit(1);
  if (!vr) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, vr.turnId);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const counter = decision === "countered" ? CounterClientVarianceRequestBody.safeParse(req.body ?? {}) : null;
  if (counter && !counter.success) {
    res.status(400).json({ error: "Invalid counter" });
    return;
  }
  try {
    const doc = await decideVariance({
      varianceId: path.data.id,
      orgId: allowed.orgId,
      actorId: `client:${path.data.token}`,
      decision,
      unitPriceCents: counter?.data.unitPriceCents,
      qty: counter?.data.qty,
      reason: counter?.data.reason,
    });
    const parsed =
      decision === "approved"
        ? ApproveClientVarianceRequestResponse.parse(doc)
        : decision === "rejected"
          ? RejectClientVarianceRequestResponse.parse(doc)
          : CounterClientVarianceRequestResponse.parse(doc);
    res.json(parsed);
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
}

router.post("/client/:token/variances/:id/approve", (req, res) => void clientVarianceDecision(req, res, "approved"));
router.post("/client/:token/variances/:id/reject", (req, res) => void clientVarianceDecision(req, res, "rejected"));
router.post("/client/:token/variances/:id/counter", (req, res) => void clientVarianceDecision(req, res, "countered"));

router.post("/client/:token/scopes/:id/invoice", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = CreateClientScopeInvoiceParams.safeParse(req.params);
  const body = CreateClientScopeInvoiceBody.safeParse(req.body ?? {});
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid invoice request" });
    return;
  }
  const found = await orgForScope(path.data.id);
  if (!found) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, found.turnId);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      CreateClientScopeInvoiceResponse.parse(
        await createScopeInvoice({
          scopeId: path.data.id,
          orgId: allowed.orgId,
          actorId: `client:${path.data.token}`,
          poNumber: body.data.poNumber,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/invoices/:id/export", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ExportClientTurnInvoiceParams.safeParse(req.params);
  const query = ExportClientTurnInvoiceQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid export" });
    return;
  }
  const orgId = await orgForInvoice(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const [inv] = await db
    .select({ turnId: clientTurnInvoicesTable.turnId })
    .from(clientTurnInvoicesTable)
    .where(eq(clientTurnInvoicesTable.id, path.data.id))
    .limit(1);
  if (!inv) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const ok = await clientMayAccessTurn(path.data.token, inv.turnId);
  if (!ok) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    if (query.data.format === "json") {
      const { payload } = await buildInvoiceExport({ invoiceId: path.data.id, orgId });
      await markInvoiceExported(path.data.id);
      res.json(payload);
      return;
    }
    if (query.data.format === "csv") {
      const csv = await exportInvoiceCsv({ invoiceId: path.data.id, orgId });
      await markInvoiceExported(path.data.id);
      res.setHeader("Content-Type", "text/csv");
      res.send(csv);
      return;
    }
    const pdf = await exportInvoicePdf({ invoiceId: path.data.id, orgId });
    await markInvoiceExported(path.data.id);
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(pdf));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/properties/:id/compliance-stats", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientPropertyComplianceStatsParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  const tokenPropertyId = await resolveClientPropertyIdForToken(path.data.token);
  if (!tokenPropertyId) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const tokenPort = await resolvePortfolioForProperty(tokenPropertyId);
  const targetPort = await resolvePortfolioForProperty(path.data.id);
  if (!tokenPort || !targetPort || tokenPort.portfolioId !== targetPort.portfolioId) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const [prop] = await db
    .select({ orgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, path.data.id))
    .limit(1);
  if (!prop?.orgId) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  res.json(
    GetClientPropertyComplianceStatsResponse.parse(
      await complianceStats({ orgId: prop.orgId, propertyIds: [path.data.id], propertyId: path.data.id }),
    ),
  );
});

export default router;
