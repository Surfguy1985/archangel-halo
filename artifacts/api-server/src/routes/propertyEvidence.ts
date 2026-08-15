import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetTurnEvidenceParams,
  GetTurnEvidenceResponse,
  CreateTurnRecordParams,
  CreateTurnRecordBody,
  CreateTurnRecordResponse,
  GetTurnRecordParams,
  GetTurnRecordResponse,
  GetTurnRecordFileParams,
  GetTurnRecordFileQueryParams,
  VerifyTurnParams,
  VerifyTurnResponse,
  GetEvidenceFileParams,
  GetEvidenceFileQueryParams,
  GetClientTurnEvidenceParams,
  GetClientTurnEvidenceResponse,
  CreateClientTurnRecordParams,
  CreateClientTurnRecordBody,
  CreateClientTurnRecordResponse,
  GetClientTurnRecordParams,
  GetClientTurnRecordResponse,
  VerifyClientTurnParams,
  VerifyClientTurnResponse,
} from "@workspace/api-zod";
import { db, clientTurnsTable, clientTurnRecordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import {
  requireProperty,
  sendAccessError,
  propertyIdOfTurn,
  propertyIdOfRecord,
} from "../lib/clientBoardAccess";
import { resolveClientPropertyIdForToken } from "../lib/sessionAuth";
import { resolvePortfolioForProperty } from "../lib/portfolioPulse";
import { verifyFileQuery } from "../lib/evidenceSign";
import {
  computeTurnEvidence,
  createTurnRecord,
  getTurnRecord,
  verifyTurn,
  readRecordFile,
  readEvidenceFile,
  EvidenceNotFoundError,
} from "../lib/turnEvidence";

const router: IRouter = Router();
const DARK = { error: "Evidence is not enabled" };

async function requireEvidence(): Promise<boolean> {
  return isClientBoardSegmentEnabled("evidence");
}

function sendErr(res: Response, err: unknown): boolean {
  if (sendAccessError(res, err)) return true;
  if (err instanceof EvidenceNotFoundError) {
    res.status(404).json({ error: err.message });
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

router.get("/v1/turns/:id/evidence", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetTurnEvidenceParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid evidence request" });
    return;
  }
  const orgId = await orgForTurn(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  try {
    await requireProperty(req, orgId, await propertyIdOfTurn(path.data.id), "read");
    res.json(GetTurnEvidenceResponse.parse(await computeTurnEvidence({ turnId: path.data.id, orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/turns/:id/records", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = CreateTurnRecordParams.safeParse(req.params);
  const body = CreateTurnRecordBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid record request" });
    return;
  }
  const orgId = await orgForTurn(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, orgId, await propertyIdOfTurn(path.data.id), "write");
    const doc = await createTurnRecord({
      turnId: path.data.id,
      orgId,
      variant: body.data.variant,
      actorId: actor.actorId,
    });
    res.json(CreateTurnRecordResponse.parse(doc));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/v1/records/:id", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetTurnRecordParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid record request" });
    return;
  }
  const [row] = await db
    .select({ orgId: clientTurnRecordsTable.orgId })
    .from(clientTurnRecordsTable)
    .where(eq(clientTurnRecordsTable.id, path.data.id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  try {
    await requireProperty(req, row.orgId, await propertyIdOfRecord(path.data.id), "read");
    res.json(GetTurnRecordResponse.parse(await getTurnRecord({ recordId: path.data.id, orgId: row.orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/v1/records/:id/file", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetTurnRecordFileParams.safeParse(req.params);
  const query = GetTurnRecordFileQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid file request" });
    return;
  }
  if (!verifyFileQuery({ kind: "record", id: path.data.id, exp: query.data.exp, sig: query.data.sig })) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const bytes = await readRecordFile(path.data.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="unit-turn-record.pdf"`);
    res.send(bytes);
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/v1/turns/:id/verify", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = VerifyTurnParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid verify request" });
    return;
  }
  const orgId = await orgForTurn(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  try {
    await requireProperty(req, orgId, await propertyIdOfTurn(path.data.id), "read");
    res.json(VerifyTurnResponse.parse(await verifyTurn({ turnId: path.data.id, orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/v1/evidence/:id/file", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetEvidenceFileParams.safeParse(req.params);
  const query = GetEvidenceFileQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid file request" });
    return;
  }
  if (
    !verifyFileQuery({
      kind: "evidence",
      id: path.data.id,
      size: query.data.size,
      exp: query.data.exp,
      sig: query.data.sig,
    })
  ) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const file = await readEvidenceFile(path.data.id);
  res.setHeader("Content-Type", file.mime);
  res.send(file.bytes);
});

router.get("/client/:token/turns/:id/evidence", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientTurnEvidenceParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid evidence request" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      GetClientTurnEvidenceResponse.parse(
        await computeTurnEvidence({ turnId: path.data.id, orgId: allowed.orgId }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/turns/:id/records", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = CreateClientTurnRecordParams.safeParse(req.params);
  const body = CreateClientTurnRecordBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid record request" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      CreateClientTurnRecordResponse.parse(
        await createTurnRecord({
          turnId: path.data.id,
          orgId: allowed.orgId,
          variant: body.data.variant,
          actorId: `client:${path.data.token}`,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/records/:id", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientTurnRecordParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid record request" });
    return;
  }
  const [row] = await db
    .select({ orgId: clientTurnRecordsTable.orgId, turnId: clientTurnRecordsTable.turnId })
    .from(clientTurnRecordsTable)
    .where(eq(clientTurnRecordsTable.id, path.data.id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, row.turnId);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(GetClientTurnRecordResponse.parse(await getTurnRecord({ recordId: path.data.id, orgId: row.orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/turns/:id/verify", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireEvidence())) {
    res.status(404).json(DARK);
    return;
  }
  const path = VerifyClientTurnParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid verify request" });
    return;
  }
  const allowed = await clientMayAccessTurn(path.data.token, path.data.id);
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(VerifyClientTurnResponse.parse(await verifyTurn({ turnId: path.data.id, orgId: allowed.orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

export default router;
