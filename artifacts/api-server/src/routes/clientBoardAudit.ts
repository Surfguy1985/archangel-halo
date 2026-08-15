/**
 * Segment 11 — audit log + evidence tombstone. Flag dark → 404.
 * Auditor and asset_manager may read; regional_manager is 403.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetPortfolioAuditParams,
  GetPortfolioAuditQueryParams,
  GetPortfolioAuditResponse,
  ExportPortfolioAuditParams,
  ExportPortfolioAuditQueryParams,
  TombstoneEvidenceParams,
  TombstoneEvidenceResponse,
  GetClientPortfolioAuditParams,
  GetClientPortfolioAuditQueryParams,
  GetClientPortfolioAuditResponse,
  ExportClientPortfolioAuditParams,
  ExportClientPortfolioAuditQueryParams,
  TombstoneClientEvidenceParams,
  TombstoneClientEvidenceResponse,
} from "@workspace/api-zod";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import {
  officeActor,
  requireProperty,
  sendAccessError,
  assertAuditAccess,
} from "../lib/clientBoardAccess";
import { resolveClientPropertyIdForToken } from "../lib/sessionAuth";
import { resolvePortfolioForProperty } from "../lib/portfolioPulse";
import {
  store,
  loadPortfolioRef,
  loadEvidenceRef,
  type AuditListQuery,
} from "../lib/clientBoardRepo";

const router: IRouter = Router();
const DARK = { error: "Audit log is not enabled" };

async function requireFlag(): Promise<boolean> {
  return isClientBoardSegmentEnabled("security");
}

function sendErr(res: Response, err: unknown): boolean {
  return sendAccessError(res, err);
}

function parseFilters(query: {
  entityType?: string;
  actorId?: string;
  from?: string;
  to?: string;
}): AuditListQuery | { error: string } {
  const out: AuditListQuery = {};
  if (query.entityType) out.entityType = query.entityType;
  if (query.actorId) out.actorId = query.actorId;
  if (query.from) {
    const d = new Date(query.from);
    if (Number.isNaN(d.getTime())) return { error: "Invalid from" };
    out.from = d;
  }
  if (query.to) {
    const d = new Date(query.to);
    if (Number.isNaN(d.getTime())) return { error: "Invalid to" };
    out.to = d;
  }
  return out;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function auditCsv(
  entries: Array<{
    occurredAt: string;
    actorId: string | null;
    entityType: string;
    entityId: string;
    action: string;
  }>,
): string {
  const header = "occurredAt,actorId,entityType,entityId,action";
  const rows = entries.map((e) =>
    [e.occurredAt, e.actorId ?? "", e.entityType, e.entityId, e.action].map(csvCell).join(","),
  );
  return `${[header, ...rows].join("\n")}\n`;
}

function sendCsv(res: Response, filename: string, body: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

router.get("/v1/portfolios/:id/audit", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetPortfolioAuditParams.safeParse(req.params);
  const query = GetPortfolioAuditQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid audit request" });
    return;
  }
  const port = await loadPortfolioRef(path.data.id);
  if (!port) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }
  const filters = parseFilters(query.data);
  if ("error" in filters) {
    res.status(400).json({ error: filters.error });
    return;
  }
  try {
    const actor = await officeActor(req, port.orgId);
    assertAuditAccess(actor);
    const entries = await store(port.orgId).listAudit(filters);
    res.json(GetPortfolioAuditResponse.parse({ portfolioId: port.id, entries }));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/v1/portfolios/:id/audit/export", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ExportPortfolioAuditParams.safeParse(req.params);
  const query = ExportPortfolioAuditQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid audit request" });
    return;
  }
  const port = await loadPortfolioRef(path.data.id);
  if (!port) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }
  const filters = parseFilters(query.data);
  if ("error" in filters) {
    res.status(400).json({ error: filters.error });
    return;
  }
  try {
    const actor = await officeActor(req, port.orgId);
    assertAuditAccess(actor);
    const entries = await store(port.orgId).listAudit({ ...filters, limit: 500 });
    sendCsv(res, "audit-log.csv", auditCsv(entries));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/evidence/:id/tombstone", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = TombstoneEvidenceParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid tombstone request" });
    return;
  }
  const item = await loadEvidenceRef(path.data.id);
  if (!item) {
    res.status(404).json({ error: "Evidence not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, item.orgId, item.propertyId, "write");
    const doc = await store(item.orgId).tombstoneEvidence(item.id, actor.actorId);
    res.json(TombstoneEvidenceResponse.parse(doc));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/portfolio/audit", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientPortfolioAuditParams.safeParse(req.params);
  const query = GetClientPortfolioAuditQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid audit request" });
    return;
  }
  const propertyId = await resolveClientPropertyIdForToken(path.data.token);
  if (!propertyId) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const resolved = await resolvePortfolioForProperty(propertyId);
  if (!resolved) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const filters = parseFilters(query.data);
  if ("error" in filters) {
    res.status(400).json({ error: filters.error });
    return;
  }
  try {
    const entries = await store(resolved.orgId).listAudit(filters);
    res.json(GetClientPortfolioAuditResponse.parse({ portfolioId: resolved.portfolioId, entries }));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/portfolio/audit/export", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ExportClientPortfolioAuditParams.safeParse(req.params);
  const query = ExportClientPortfolioAuditQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid audit request" });
    return;
  }
  const propertyId = await resolveClientPropertyIdForToken(path.data.token);
  if (!propertyId) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const resolved = await resolvePortfolioForProperty(propertyId);
  if (!resolved) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const filters = parseFilters(query.data);
  if ("error" in filters) {
    res.status(400).json({ error: filters.error });
    return;
  }
  try {
    const entries = await store(resolved.orgId).listAudit({ ...filters, limit: 500 });
    sendCsv(res, "audit-log.csv", auditCsv(entries));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/evidence/:id/tombstone", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = TombstoneClientEvidenceParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid tombstone request" });
    return;
  }
  const item = await loadEvidenceRef(path.data.id);
  if (!item) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const tokenPropertyId = await resolveClientPropertyIdForToken(path.data.token);
  if (!tokenPropertyId) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const tokenPort = await resolvePortfolioForProperty(tokenPropertyId);
  const targetPort = await resolvePortfolioForProperty(item.propertyId);
  if (!tokenPort || !targetPort || tokenPort.portfolioId !== targetPort.portfolioId) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const doc = await store(item.orgId).tombstoneEvidence(item.id, `client:${path.data.token}`);
    res.json(TombstoneClientEvidenceResponse.parse(doc));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

export default router;
