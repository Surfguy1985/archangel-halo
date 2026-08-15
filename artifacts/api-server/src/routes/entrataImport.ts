import { Router, type IRouter, type Request, type Response } from "express";
import {
  ImportEntrataCsvBody,
  ImportEntrataCsvResponse,
  ListEntrataImportsResponse,
  GetEntrataImportParams,
  GetEntrataImportResponse,
  GetEntrataCsvTemplateParams,
  GetEntrataCsvTemplateResponse,
  SubmitTurnInvoiceToEntrataParams,
  SubmitTurnInvoiceToEntrataResponse,
  ImportClientEntrataCsvParams,
  ImportClientEntrataCsvBody,
  ImportClientEntrataCsvResponse,
  ListClientEntrataImportsParams,
  ListClientEntrataImportsResponse,
  GetClientEntrataImportParams,
  GetClientEntrataImportResponse,
  GetClientEntrataCsvTemplateParams,
  GetClientEntrataCsvTemplateResponse,
  SubmitClientTurnInvoiceToEntrataParams,
  SubmitClientTurnInvoiceToEntrataResponse,
} from "@workspace/api-zod";
import { csvTemplate, db, clientPortfolioPropertiesTable, propertiesTable, firstPropertyCode, type EntrataImportKind } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import { regionalClientLink } from "../lib/clientBoardLink";
import { listPortfoliosForOffice } from "../lib/portfolioPulse";
import {
  getEntrataAdapter,
  getEntrataImport,
  listEntrataImports,
  InvoiceNotFoundError,
} from "../lib/entrataCsvAdapter";
import { EntrataApiDisabledError } from "../lib/entrataAdapter";
import { orgForInvoice } from "../lib/turnInvoice";
import { requireProperty, sendAccessError, propertyIdOfInvoice } from "../lib/clientBoardAccess";

const router: IRouter = Router();
const DARK = { error: "CSV import is not enabled" };

async function requireFlag(): Promise<boolean> {
  return isClientBoardSegmentEnabled("csvImport");
}

async function officeOrgIds(): Promise<string[]> {
  const portfolios = await listPortfoliosForOffice();
  return [...new Set(portfolios.map((p) => p.orgId))];
}

async function officeOrgId(): Promise<string | null> {
  return (await officeOrgIds())[0] ?? null;
}

async function officeOrgIdFromCsv(csv: string): Promise<string | null> {
  const code = firstPropertyCode(csv);
  if (!code) return officeOrgId();
  const [row] = await db
    .select({ orgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.entrataPropertyId, code))
    .limit(1);
  return row?.orgId ?? officeOrgId();
}

function sendErr(res: Response, err: unknown): boolean {
  if (sendAccessError(res, err)) return true;
  if (err instanceof InvoiceNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof EntrataApiDisabledError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  return false;
}

router.post("/v1/imports/entrata", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const body = ImportEntrataCsvBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid import" });
    return;
  }
  const orgId = await officeOrgIdFromCsv(body.data.csv);
  if (!orgId) {
    res.status(404).json({ error: "No portfolio" });
    return;
  }
  try {
    const adapter = getEntrataAdapter();
    res.json(
      ImportEntrataCsvResponse.parse(
        await adapter.importFile({
          orgId,
          kind: body.data.kind,
          filename: body.data.filename,
          csv: body.data.csv,
          actorId: "office",
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/v1/imports/entrata", async (_req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const orgIds = await officeOrgIds();
  if (orgIds.length === 0) {
    res.status(404).json({ error: "No portfolio" });
    return;
  }
  const adapter = getEntrataAdapter();
  const imports = (await Promise.all(orgIds.map((id) => listEntrataImports(id)))).flat().slice(0, 50);
  res.json(ListEntrataImportsResponse.parse({ adapter: adapter.kind, imports }));
});

router.get("/v1/imports/entrata/templates/:kind", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetEntrataCsvTemplateParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid kind" });
    return;
  }
  res.json(
    GetEntrataCsvTemplateResponse.parse({
      kind: path.data.kind as EntrataImportKind,
      csv: csvTemplate(path.data.kind as EntrataImportKind),
    }),
  );
});

router.get("/v1/imports/entrata/:id", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetEntrataImportParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid import" });
    return;
  }
  const orgIds = await officeOrgIds();
  if (orgIds.length === 0) {
    res.status(404).json({ error: "No portfolio" });
    return;
  }
  let doc = null;
  for (const orgId of orgIds) {
    doc = await getEntrataImport(orgId, path.data.id);
    if (doc) break;
  }
  if (!doc) {
    res.status(404).json({ error: "Import not found" });
    return;
  }
  res.json(GetEntrataImportResponse.parse(doc));
});

router.post("/v1/invoices/:id/entrata", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = SubmitTurnInvoiceToEntrataParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid invoice" });
    return;
  }
  const orgId = await orgForInvoice(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  try {
    await requireProperty(req, orgId, await propertyIdOfInvoice(path.data.id), "write");
    res.json(
      SubmitTurnInvoiceToEntrataResponse.parse(await getEntrataAdapter().submitInvoice({ orgId, invoiceId: path.data.id })),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

function sendClientImportGate(
  res: Response,
  ctx: { orgId: string; propertyIds: string[] } | { error: 403 | 404; message: string },
): ctx is { orgId: string; propertyIds: string[] } {
  if ("error" in ctx) {
    res.status(ctx.error).json({ error: ctx.message });
    return false;
  }
  return true;
}

async function clientOrgAndProperties(
  token: string,
): Promise<{ orgId: string; propertyIds: string[] } | { error: 403 | 404; message: string }> {
  const gated = await regionalClientLink(token);
  if (!gated.ok) return { error: gated.status, message: gated.error };
  const rows = await db
    .select({ propertyId: clientPortfolioPropertiesTable.propertyId })
    .from(clientPortfolioPropertiesTable)
    .where(eq(clientPortfolioPropertiesTable.portfolioId, gated.link.portfolioId));
  return { orgId: gated.link.orgId, propertyIds: rows.map((r) => r.propertyId) };
}

router.post("/client/:token/imports/entrata", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ImportClientEntrataCsvParams.safeParse(req.params);
  const body = ImportClientEntrataCsvBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid import" });
    return;
  }
  const ctx = await clientOrgAndProperties(path.data.token);
  if (!sendClientImportGate(res, ctx)) return;
  try {
    res.json(
      ImportClientEntrataCsvResponse.parse(
        await getEntrataAdapter().importFile({
          orgId: ctx.orgId,
          kind: body.data.kind,
          filename: body.data.filename,
          csv: body.data.csv,
          actorId: `client:${path.data.token}`,
          allowedPropertyIds: ctx.propertyIds,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/imports/entrata", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ListClientEntrataImportsParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const ctx = await clientOrgAndProperties(path.data.token);
  if (!sendClientImportGate(res, ctx)) return;
  const adapter = getEntrataAdapter();
  res.json(
    ListClientEntrataImportsResponse.parse({ adapter: adapter.kind, imports: await listEntrataImports(ctx.orgId) }),
  );
});

router.get("/client/:token/imports/entrata/templates/:kind", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientEntrataCsvTemplateParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid kind" });
    return;
  }
  const ctx = await clientOrgAndProperties(path.data.token);
  if (!sendClientImportGate(res, ctx)) return;
  res.json(
    GetClientEntrataCsvTemplateResponse.parse({
      kind: path.data.kind as EntrataImportKind,
      csv: csvTemplate(path.data.kind as EntrataImportKind),
    }),
  );
});

router.get("/client/:token/imports/entrata/:id", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientEntrataImportParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid import" });
    return;
  }
  const ctx = await clientOrgAndProperties(path.data.token);
  if (!sendClientImportGate(res, ctx)) return;
  const doc = await getEntrataImport(ctx.orgId, path.data.id);
  if (!doc) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  res.json(GetClientEntrataImportResponse.parse(doc));
});

router.post("/client/:token/invoices/:id/entrata", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = SubmitClientTurnInvoiceToEntrataParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid invoice" });
    return;
  }
  const ctx = await clientOrgAndProperties(path.data.token);
  if (!sendClientImportGate(res, ctx)) return;
  const orgId = await orgForInvoice(path.data.id);
  if (!orgId || orgId !== ctx.orgId) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      SubmitClientTurnInvoiceToEntrataResponse.parse(
        await getEntrataAdapter().submitInvoice({ orgId, invoiceId: path.data.id }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

export default router;
