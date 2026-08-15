/**
 * Segment 8 — Turn pipeline HTTP. Flag dark → 404.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetPortfolioPipelineParams,
  GetPortfolioPipelineResponse,
  GetClientPortfolioPipelineParams,
  GetClientPortfolioPipelineResponse,
  HoldTurnCapacityParams,
  HoldTurnCapacityResponse,
  HoldClientTurnCapacityParams,
  HoldClientTurnCapacityResponse,
  ConfirmCapacityHoldParams,
  ConfirmCapacityHoldResponse,
  ConfirmClientCapacityHoldParams,
  ConfirmClientCapacityHoldResponse,
  ScheduleVacateNoticeParams,
  ScheduleVacateNoticeBody,
  ScheduleVacateNoticeResponse,
  ScheduleClientVacateNoticeParams,
  ScheduleClientVacateNoticeBody,
  ScheduleClientVacateNoticeResponse,
} from "@workspace/api-zod";
import { db, clientPortfoliosTable, propertiesTable, zonedCivilToUtc } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import { resolveClientPropertyIdForToken } from "../lib/sessionAuth";
import { officeActor, requireProperty, sendAccessError } from "../lib/clientBoardAccess";
import {
  PipelineError,
  computePipeline,
  holdCrewCapacity,
  confirmCapacityHold,
  scheduleVacateNotice,
  propertyIdOfTurn,
  propertyIdOfHoldBundle,
  propertyIdOfUnit,
} from "../lib/turnPipeline";
import { PortfolioNotFoundError, resolvePortfolioForProperty } from "../lib/portfolioPulse";

const router: IRouter = Router();
const DARK = { error: "Pipeline is not enabled" };

async function requireFlag(): Promise<boolean> {
  return isClientBoardSegmentEnabled("pipeline");
}

function sendErr(res: Response, err: unknown): boolean {
  if (sendAccessError(res, err)) return true;
  if (err instanceof PipelineError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  if (err instanceof PortfolioNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  return false;
}

function parseCivil(raw: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  return zonedCivilToUtc(timeZone, Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0);
}

async function orgOfProperty(propertyId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  return row?.orgId ?? null;
}

async function timezoneOfProperty(propertyId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: propertiesTable.timezone })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  return row?.timezone || "America/Chicago";
}

async function clientMayAccessProperty(token: string, propertyId: string): Promise<{ orgId: string } | null> {
  const tokenPropertyId = await resolveClientPropertyIdForToken(token);
  if (!tokenPropertyId) return null;
  const tokenPort = await resolvePortfolioForProperty(tokenPropertyId);
  const targetPort = await resolvePortfolioForProperty(propertyId);
  if (!tokenPort || !targetPort || tokenPort.portfolioId !== targetPort.portfolioId) return null;
  return { orgId: tokenPort.orgId };
}

router.get("/v1/portfolios/:id/pipeline", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetPortfolioPipelineParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [port] = await db
    .select({ orgId: clientPortfoliosTable.orgId })
    .from(clientPortfoliosTable)
    .where(eq(clientPortfoliosTable.id, path.data.id))
    .limit(1);
  if (!port) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }
  try {
    await officeActor(req, port.orgId);
    const doc = await computePipeline({ portfolioId: path.data.id, orgId: port.orgId });
    res.json(GetPortfolioPipelineResponse.parse(doc));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/turns/:id/capacity-hold", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = HoldTurnCapacityParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid hold" });
    return;
  }
  const propertyId = await propertyIdOfTurn(path.data.id);
  const orgId = propertyId ? await orgOfProperty(propertyId) : null;
  if (!propertyId || !orgId) {
    res.status(404).json({ error: "Turn not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, orgId, propertyId, "write");
    res.json(
      HoldTurnCapacityResponse.parse(
        await holdCrewCapacity({ turnId: path.data.id, orgId: actor.orgId, actorId: actor.actorId }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/capacity-holds/:bundleId/confirm", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ConfirmCapacityHoldParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid confirm" });
    return;
  }
  const propertyId = await propertyIdOfHoldBundle(path.data.bundleId);
  const orgId = propertyId ? await orgOfProperty(propertyId) : null;
  if (!propertyId || !orgId) {
    res.status(404).json({ error: "Hold not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, orgId, propertyId, "write");
    res.json(
      ConfirmCapacityHoldResponse.parse(
        await confirmCapacityHold({ bundleId: path.data.bundleId, orgId: actor.orgId, actorId: actor.actorId }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/v1/units/:id/vacate-notice", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ScheduleVacateNoticeParams.safeParse(req.params);
  const body = ScheduleVacateNoticeBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "scheduledVacate must be YYYY-MM-DD" });
    return;
  }
  const propertyId = await propertyIdOfUnit(path.data.id);
  const orgId = propertyId ? await orgOfProperty(propertyId) : null;
  if (!propertyId || !orgId) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  try {
    const actor = await requireProperty(req, orgId, propertyId, "write");
    const scheduled = parseCivil(body.data.scheduledVacate, await timezoneOfProperty(propertyId));
    if (!scheduled) {
      res.status(400).json({ error: "scheduledVacate must be YYYY-MM-DD" });
      return;
    }
    res.json(
      ScheduleVacateNoticeResponse.parse(
        await scheduleVacateNotice({
          unitId: path.data.id,
          orgId: actor.orgId,
          actorId: actor.actorId,
          scheduledVacate: scheduled,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/portfolio/pipeline", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientPortfolioPipelineParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid request" });
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
  try {
    const doc = await computePipeline({ portfolioId: resolved.portfolioId, orgId: resolved.orgId });
    res.json(GetClientPortfolioPipelineResponse.parse(doc));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/turns/:id/capacity-hold", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = HoldClientTurnCapacityParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid hold" });
    return;
  }
  const propertyId = await propertyIdOfTurn(path.data.id);
  const allowed = propertyId ? await clientMayAccessProperty(path.data.token, propertyId) : null;
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      HoldClientTurnCapacityResponse.parse(
        await holdCrewCapacity({
          turnId: path.data.id,
          orgId: allowed.orgId,
          actorId: `client:${path.data.token}`,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/capacity-holds/:bundleId/confirm", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ConfirmClientCapacityHoldParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid confirm" });
    return;
  }
  const propertyId = await propertyIdOfHoldBundle(path.data.bundleId);
  const allowed = propertyId ? await clientMayAccessProperty(path.data.token, propertyId) : null;
  if (!allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    res.json(
      ConfirmClientCapacityHoldResponse.parse(
        await confirmCapacityHold({
          bundleId: path.data.bundleId,
          orgId: allowed.orgId,
          actorId: `client:${path.data.token}`,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.post("/client/:token/units/:id/vacate-notice", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ScheduleClientVacateNoticeParams.safeParse(req.params);
  const body = ScheduleClientVacateNoticeBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "scheduledVacate must be YYYY-MM-DD" });
    return;
  }
  const propertyId = await propertyIdOfUnit(path.data.id);
  const allowed = propertyId ? await clientMayAccessProperty(path.data.token, propertyId) : null;
  if (!propertyId || !allowed) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const scheduled = parseCivil(body.data.scheduledVacate, await timezoneOfProperty(propertyId));
    if (!scheduled) {
      res.status(400).json({ error: "scheduledVacate must be YYYY-MM-DD" });
      return;
    }
    res.json(
      ScheduleClientVacateNoticeResponse.parse(
        await scheduleVacateNotice({
          unitId: path.data.id,
          orgId: allowed.orgId,
          actorId: `client:${path.data.token}`,
          scheduledVacate: scheduled,
        }),
      ),
    );
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

export default router;
