/**
 * Segment 7 — Bid Board HTTP. Flag dark → 404.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateScopeBidRequestParams,
  CreateScopeBidRequestBody,
  CreateScopeBidRequestResponse,
  InviteBidVendorsParams,
  InviteBidVendorsBody,
  InviteBidVendorsResponse,
  SubmitVendorBidParams,
  SubmitVendorBidBody,
  SubmitVendorBidResponse,
  GetBidComparisonParams,
  GetBidComparisonResponse,
  AwardBidRequestParams,
  AwardBidRequestBody,
  AwardBidRequestResponse,
  CreateClientScopeBidRequestParams,
  CreateClientScopeBidRequestBody,
  CreateClientScopeBidRequestResponse,
  InviteClientBidVendorsParams,
  InviteClientBidVendorsBody,
  InviteClientBidVendorsResponse,
  SubmitClientVendorBidParams,
  SubmitClientVendorBidBody,
  SubmitClientVendorBidResponse,
  GetClientBidComparisonParams,
  GetClientBidComparisonResponse,
  AwardClientBidRequestParams,
  AwardClientBidRequestBody,
  AwardClientBidRequestResponse,
} from "@workspace/api-zod";
import { db, clientTurnsTable, clientScopesTable, propertiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import { clientMayAccessProperty } from "../lib/clientBoardLink";
import {
  requireProperty,
  sendAccessError,
  propertyIdOfScope,
} from "../lib/clientBoardAccess";
import {
  BidBoardError,
  VENDOR_ORG_HEADER,
  createBidRequest,
  inviteVendors,
  submitVendorBid,
  computeComparison,
  awardBid,
  propertyIdOfBidRequest,
} from "../lib/bidBoard";

const router: IRouter = Router();
const DARK = { error: "Bid board is not enabled" };

async function requireFlag(): Promise<boolean> {
  return isClientBoardSegmentEnabled("bidBoard");
}

function sendErr(res: Response, err: unknown): boolean {
  if (sendAccessError(res, err)) return true;
  if (err instanceof BidBoardError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

function idempotencyKey(req: Request): string {
  const raw = req.header("idempotency-key") ?? req.header("Idempotency-Key");
  return raw && raw.trim().length > 0 ? raw.trim() : crypto.randomUUID();
}

async function orgForScope(scopeId: string): Promise<{ orgId: string; turnId: string } | null> {
  const [row] = await db
    .select({ orgId: clientTurnsTable.orgId, turnId: clientTurnsTable.id })
    .from(clientScopesTable)
    .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientScopesTable.turnId))
    .where(eq(clientScopesTable.id, scopeId))
    .limit(1);
  return row ?? null;
}

async function orgForBidRequest(id: string): Promise<string | null> {
  const propertyId = await propertyIdOfBidRequest(id);
  if (!propertyId) return null;
  const [prop] = await db
    .select({ orgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  return prop?.orgId ?? null;
}

router.post("/v1/scopes/:id/bid-requests", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = CreateScopeBidRequestParams.safeParse(req.params);
  const body = CreateScopeBidRequestBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid bid request" });
    return;
  }
  const found = await orgForScope(path.data.id);
  if (!found) {
    res.status(404).json({ error: "Scope not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, found.orgId, await propertyIdOfScope(path.data.id), "write");
    const dueAt = new Date(body.data.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      res.status(400).json({ error: "dueAt must be an ISO timestamp" });
      return;
    }
    res.json(
      CreateScopeBidRequestResponse.parse(
        await createBidRequest({
          scopeId: path.data.id,
          orgId: found.orgId,
          actorId: actor.actorId,
          dueAt,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/bid-requests/:id/invitations", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = InviteBidVendorsParams.safeParse(req.params);
  const body = InviteBidVendorsBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid invitation" });
    return;
  }
  const orgId = await orgForBidRequest(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Bid request not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, orgId, await propertyIdOfBidRequest(path.data.id), "write");
    res.json(
      InviteBidVendorsResponse.parse(
        await inviteVendors({
          bidRequestId: path.data.id,
          orgId,
          actorId: actor.actorId,
          vendorOrgIds: body.data.vendorOrgIds,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/bid-requests/:id/bids", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = SubmitVendorBidParams.safeParse(req.params);
  const body = SubmitVendorBidBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid bid" });
    return;
  }
  const orgId = await orgForBidRequest(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Bid request not found" });
    return;
  }
  const vendorOrgId = (req.header(VENDOR_ORG_HEADER) ?? "").trim() || (body.data.vendorOrgId ?? "").trim();
  if (!vendorOrgId) {
    res.status(400).json({ error: "vendorOrgId is required" });
    return;
  }
  try {
    const headerVendor = (req.header(VENDOR_ORG_HEADER) ?? "").trim();
    const actorId = headerVendor
      ? `vendor:${headerVendor}`
      : (
          await requireProperty(req, orgId, await propertyIdOfBidRequest(path.data.id), "write")
        ).actorId;
    res.json(
      SubmitVendorBidResponse.parse(
        await submitVendorBid({
          bidRequestId: path.data.id,
          orgId,
          vendorOrgId: headerVendor || vendorOrgId,
          actorId,
          earliestStartAt: body.data.earliestStartAt ? new Date(body.data.earliestStartAt) : null,
          promisedDays: body.data.promisedDays ?? null,
          lines: body.data.lines.map((l) => ({
            code: l.code,
            tier: l.tier,
            unitPriceCents: BigInt(l.unitPriceCents),
          })),
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/v1/bid-requests/:id/comparison", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetBidComparisonParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid comparison request" });
    return;
  }
  const orgId = await orgForBidRequest(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Bid request not found" });
    return;
  }
  try {
    await requireProperty(req, orgId, await propertyIdOfBidRequest(path.data.id), "read");
    res.json(GetBidComparisonResponse.parse(await computeComparison({ bidRequestId: path.data.id, orgId })));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/bid-requests/:id/award", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = AwardBidRequestParams.safeParse(req.params);
  const body = AwardBidRequestBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid award" });
    return;
  }
  const orgId = await orgForBidRequest(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Bid request not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, orgId, await propertyIdOfBidRequest(path.data.id), "approve");
    res.json(
      AwardBidRequestResponse.parse(
        await awardBid({
          bidRequestId: path.data.id,
          orgId,
          actorId: actor.actorId,
          vendorOrgId: body.data.vendorOrgId,
          idempotencyKey: idempotencyKey(req),
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/scopes/:id/bid-requests", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = CreateClientScopeBidRequestParams.safeParse(req.params);
  const body = CreateClientScopeBidRequestBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid bid request" });
    return;
  }
  const propertyId = await propertyIdOfScope(path.data.id);
  const allowed = propertyId ? await clientMayAccessProperty(path.data.token, propertyId) : null;
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const dueAt = new Date(body.data.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      res.status(400).json({ error: "dueAt must be an ISO timestamp" });
      return;
    }
    res.json(
      CreateClientScopeBidRequestResponse.parse(
        await createBidRequest({
          scopeId: path.data.id,
          orgId: allowed.orgId,
          actorId: `client:${path.data.token}`,
          dueAt,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/bid-requests/:id/invitations", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = InviteClientBidVendorsParams.safeParse(req.params);
  const body = InviteClientBidVendorsBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid invitation" });
    return;
  }
  const propertyId = await propertyIdOfBidRequest(path.data.id);
  const allowed = propertyId ? await clientMayAccessProperty(path.data.token, propertyId) : null;
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      InviteClientBidVendorsResponse.parse(
        await inviteVendors({
          bidRequestId: path.data.id,
          orgId: allowed.orgId,
          actorId: `client:${path.data.token}`,
          vendorOrgIds: body.data.vendorOrgIds,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/bid-requests/:id/bids", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = SubmitClientVendorBidParams.safeParse(req.params);
  const body = SubmitClientVendorBidBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid bid" });
    return;
  }
  const propertyId = await propertyIdOfBidRequest(path.data.id);
  const allowed = propertyId ? await clientMayAccessProperty(path.data.token, propertyId) : null;
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const vendorOrgId = (req.header(VENDOR_ORG_HEADER) ?? body.data.vendorOrgId ?? "").trim();
  if (!vendorOrgId) {
    res.status(400).json({ error: "vendorOrgId is required" });
    return;
  }
  try {
    res.json(
      SubmitClientVendorBidResponse.parse(
        await submitVendorBid({
          bidRequestId: path.data.id,
          orgId: allowed.orgId,
          vendorOrgId,
          actorId: `client:${path.data.token}`,
          earliestStartAt: body.data.earliestStartAt ? new Date(body.data.earliestStartAt) : null,
          promisedDays: body.data.promisedDays ?? null,
          lines: body.data.lines.map((l) => ({
            code: l.code,
            tier: l.tier,
            unitPriceCents: BigInt(l.unitPriceCents),
          })),
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/bid-requests/:id/comparison", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientBidComparisonParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid comparison request" });
    return;
  }
  const propertyId = await propertyIdOfBidRequest(path.data.id);
  const allowed = propertyId ? await clientMayAccessProperty(path.data.token, propertyId) : null;
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      GetClientBidComparisonResponse.parse(
        await computeComparison({ bidRequestId: path.data.id, orgId: allowed.orgId }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/bid-requests/:id/award", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = AwardClientBidRequestParams.safeParse(req.params);
  const body = AwardClientBidRequestBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid award" });
    return;
  }
  const propertyId = await propertyIdOfBidRequest(path.data.id);
  const allowed = propertyId ? await clientMayAccessProperty(path.data.token, propertyId) : null;
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      AwardClientBidRequestResponse.parse(
        await awardBid({
          bidRequestId: path.data.id,
          orgId: allowed.orgId,
          actorId: `client:${path.data.token}`,
          vendorOrgId: body.data.vendorOrgId,
          idempotencyKey: idempotencyKey(req),
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

export default router;
