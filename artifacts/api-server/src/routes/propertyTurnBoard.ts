import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetPropertyTurnBoardParams,
  GetPropertyTurnBoardQueryParams,
  GetPropertyTurnBoardResponse,
  StreamPropertyTurnBoardParams,
  GetTurnDetailParams,
  GetTurnDetailResponse,
  ApproveTurnScopeParams,
  ApproveTurnScopeResponse,
  ApproveTurnVarianceParams,
  ApproveTurnVarianceResponse,
  RequestTurnWorkParams,
  RequestTurnWorkResponse,
  GetClientPropertyTurnBoardParams,
  GetClientPropertyTurnBoardQueryParams,
  GetClientPropertyTurnBoardResponse,
  StreamClientPropertyTurnBoardParams,
  GetClientTurnDetailParams,
  GetClientTurnDetailResponse,
  ApproveClientTurnScopeParams,
  ApproveClientTurnScopeResponse,
  ApproveClientTurnVarianceParams,
  ApproveClientTurnVarianceResponse,
  RequestClientTurnWorkParams,
  RequestClientTurnWorkResponse,
} from "@workspace/api-zod";
import { db, propertiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireProperty, sendAccessError, scopeTotalForTurn, assertApproveAmount } from "../lib/clientBoardAccess";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import { resolveClientPropertyIdForToken } from "../lib/sessionAuth";
import { attachPortfolioStream } from "../lib/clientPortfolioEvents";
import { resolvePortfolioForProperty } from "../lib/portfolioPulse";
import { loadTurnRef } from "../lib/clientBoardRepo";
import {
  computePropertyTurnBoard,
  computeTurnDetail,
  approveTurnScope,
  approveTurnVariance,
  requestTurnWork,
  PropertyBoardNotFoundError,
  TurnBoardNotFoundError,
  TurnActionConflictError,
  type TurnBoardGroupBy,
} from "../lib/propertyTurnBoard";

const router: IRouter = Router();
const DARK = { error: "Property board is not enabled" };

async function requireBoard(): Promise<boolean> {
  return isClientBoardSegmentEnabled("propertyBoard");
}

async function orgIdForProperty(propertyId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  return row?.orgId ?? null;
}

function sendBoardError(res: Response, err: unknown): boolean {
  if (sendAccessError(res, err)) return true;
  if (err instanceof PropertyBoardNotFoundError || err instanceof TurnBoardNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof TurnActionConflictError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  return false;
}

function idempotencyKey(req: Request): string {
  const raw = req.header("idempotency-key") ?? req.header("Idempotency-Key");
  return raw && raw.trim().length > 0 ? raw.trim() : crypto.randomUUID();
}

async function clientMayAccessProperty(token: string, propertyId: string): Promise<{
  orgId: string;
} | null> {
  const turn = await loadTurnRef(turnId);
  if (!turn) return null;
  const allowed = await clientMayAccessProperty(token, turn.propertyId);
  if (!allowed) return null;
  return { orgId: turn.orgId };
}

router.get("/v1/properties/:id/board", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetPropertyTurnBoardParams.safeParse(req.params);
  const query = GetPropertyTurnBoardQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid board request" });
    return;
  }
  const orgId = await orgIdForProperty(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  try {
    await requireProperty(req, orgId, path.data.id, "read");
    const doc = await computePropertyTurnBoard({
      propertyId: path.data.id,
      orgId,
      groupBy: query.data.groupBy as TurnBoardGroupBy | undefined,
      workSource: query.data.workSource,
    });
    res.json(GetPropertyTurnBoardResponse.parse(doc));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

router.get("/v1/properties/:id/board/stream", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = StreamPropertyTurnBoardParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid stream request" });
    return;
  }
  const resolved = await resolvePortfolioForProperty(path.data.id);
  if (!resolved) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  try {
    await requireProperty(req, resolved.orgId, path.data.id, "read");
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
    return;
  }
  attachPortfolioStream(resolved.portfolioId, res, "turn");
});

router.get("/v1/turns/:id", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetTurnDetailParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid turn request" });
    return;
  }
  const turn = await loadTurnRef(path.data.id);
  if (!turn) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  try {
    await requireProperty(req, turn.orgId, turn.propertyId, "read");
    const doc = await computeTurnDetail({ turnId: path.data.id, orgId: turn.orgId });
    res.json(GetTurnDetailResponse.parse(doc));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

router.post("/v1/turns/:id/approve-scope", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ApproveTurnScopeParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid turn request" });
    return;
  }
  const turn = await loadTurnRef(path.data.id);
  if (!turn) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, turn.orgId, turn.propertyId, "approve");
    await assertApproveAmount(actor, turn.propertyId, await scopeTotalForTurn(path.data.id));
    const result = await approveTurnScope({
      turnId: path.data.id,
      orgId: turn.orgId,
      actorId: actor.actorId,
      idempotencyKey: idempotencyKey(req),
      ip: req.ip,
      userAgent: req.header("user-agent"),
    });
    res.json(ApproveTurnScopeResponse.parse(result));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

router.post("/v1/turns/:id/approve-variance", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ApproveTurnVarianceParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid turn request" });
    return;
  }
  const turn = await loadTurnRef(path.data.id);
  if (!turn) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, turn.orgId, turn.propertyId, "approve");
    const result = await approveTurnVariance({
      turnId: path.data.id,
      orgId: turn.orgId,
      actorId: actor.actorId,
      idempotencyKey: idempotencyKey(req),
      ip: req.ip,
      userAgent: req.header("user-agent"),
    });
    res.json(ApproveTurnVarianceResponse.parse(result));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

router.post("/v1/turns/:id/request-work", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = RequestTurnWorkParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid turn request" });
    return;
  }
  const turn = await loadTurnRef(path.data.id);
  if (!turn) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, turn.orgId, turn.propertyId, "write");
    const result = await requestTurnWork({
      turnId: path.data.id,
      orgId: turn.orgId,
      actorId: actor.actorId,
      idempotencyKey: idempotencyKey(req),
      ip: req.ip,
      userAgent: req.header("user-agent"),
    });
    res.json(RequestTurnWorkResponse.parse(result));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

router.get("/client/:token/properties/:id/board", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientPropertyTurnBoardParams.safeParse(req.params);
  const query = GetClientPropertyTurnBoardQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid board request" });
    return;
  }
  const allowed = await clientMayAccessProperty(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const doc = await computePropertyTurnBoard({
      propertyId: path.data.id,
      orgId: allowed.orgId,
      groupBy: query.data.groupBy as TurnBoardGroupBy | undefined,
      workSource: query.data.workSource,
    });
    res.json(GetClientPropertyTurnBoardResponse.parse(doc));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

router.get("/client/:token/properties/:id/board/stream", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = StreamClientPropertyTurnBoardParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid stream request" });
    return;
  }
  const allowed = await clientMayAccessProperty(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const resolved = await resolvePortfolioForProperty(path.data.id);
  if (!resolved) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  attachPortfolioStream(resolved.portfolioId, res, "turn");
});

router.get("/client/:token/turns/:id", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientTurnDetailParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid turn request" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const doc = await computeTurnDetail({ turnId: path.data.id, orgId: allowed.orgId });
    res.json(GetClientTurnDetailResponse.parse(doc));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

router.post("/client/:token/turns/:id/approve-scope", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ApproveClientTurnScopeParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid turn request" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const result = await approveTurnScope({
      turnId: path.data.id,
      orgId: allowed.orgId,
      actorId: `client:${path.data.token}`,
      idempotencyKey: idempotencyKey(req),
      ip: req.ip,
      userAgent: req.header("user-agent"),
    });
    res.json(ApproveClientTurnScopeResponse.parse(result));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

router.post("/client/:token/turns/:id/approve-variance", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ApproveClientTurnVarianceParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid turn request" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const result = await approveTurnVariance({
      turnId: path.data.id,
      orgId: allowed.orgId,
      actorId: `client:${path.data.token}`,
      idempotencyKey: idempotencyKey(req),
      ip: req.ip,
      userAgent: req.header("user-agent"),
    });
    res.json(ApproveClientTurnVarianceResponse.parse(result));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

router.post("/client/:token/turns/:id/request-work", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireBoard())) {
    res.status(404).json(DARK);
    return;
  }
  const path = RequestClientTurnWorkParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid turn request" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const result = await requestTurnWork({
      turnId: path.data.id,
      orgId: allowed.orgId,
      actorId: `client:${path.data.token}`,
      idempotencyKey: idempotencyKey(req),
      ip: req.ip,
      userAgent: req.header("user-agent"),
    });
    res.json(RequestClientTurnWorkResponse.parse(result));
  } catch (err) {
    if (!sendBoardError(res, err)) throw err;
  }
});

export default router;
