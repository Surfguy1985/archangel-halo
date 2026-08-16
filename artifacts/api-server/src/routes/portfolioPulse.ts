import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, notInArray } from "drizzle-orm";
import {
  db,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  propertiesTable,
} from "@workspace/db";
import {
  ListClientPortfoliosResponse,
  GetPortfolioPulseParams,
  GetPortfolioPulseQueryParams,
  GetPortfolioPulseResponse,
  GetPortfolioAttentionParams,
  GetPortfolioAttentionQueryParams,
  GetPortfolioAttentionResponse,
  StreamPortfolioPulseParams,
  PutPortfolioSavedViewParams,
  PutPortfolioSavedViewBody,
  PutPortfolioSavedViewResponse,
  GetClientPortfolioPulseParams,
  GetClientPortfolioPulseQueryParams,
  GetClientPortfolioPulseResponse,
  GetClientPortfolioAttentionParams,
  GetClientPortfolioAttentionQueryParams,
  GetClientPortfolioAttentionResponse,
  StreamClientPortfolioPulseParams,
  PutClientPortfolioSavedViewParams,
  PutClientPortfolioSavedViewBody,
  PutClientPortfolioSavedViewResponse,
  ListClientPortfolioAvailablePropertiesParams,
  ListClientPortfolioAvailablePropertiesResponse,
  AddClientPortfolioPropertyParams,
  AddClientPortfolioPropertyBody,
  AddClientPortfolioPropertyResponse,
} from "@workspace/api-zod";
import { officeActor, propertyIdsForActor, sendAccessError } from "../lib/clientBoardAccess";
import { resolveClientBoardLink, regionalClientLink } from "../lib/clientBoardLink";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import { attachPortfolioStream } from "../lib/clientPortfolioEvents";
import {
  computePortfolioAttention,
  computePortfolioPulse,
  listPortfoliosForOffice,
  loadSavedPulseQuery,
  PortfolioNotFoundError,
  PulseRangeError,
  resolvePortfolioForProperty,
  savePulseView,
  type PulseQuery,
} from "../lib/portfolioPulse";
import { answerPortfolioAsk } from "../lib/portfolioAsk";

const router: IRouter = Router();

const DARK = { error: "Portfolio Pulse is not enabled" };

async function requirePulse(): Promise<boolean> {
  return isClientBoardSegmentEnabled("pulse");
}

function officePropertyHref(propertyId: string): string {
  return `/properties/${propertyId}/turns`;
}

function clientPropertyHref(token: string): (propertyId: string) => string {
  return (propertyId: string) => `/${token}/property/${propertyId}`;
}

function pulseQueryFromParsed(q: {
  range?: PulseQuery["range"];
  from?: string | null;
  to?: string | null;
  sort?: PulseQuery["sort"];
  workSource?: PulseQuery["workSource"];
}): PulseQuery {
  return {
    range: q.range,
    from: q.from ?? null,
    to: q.to ?? null,
    sort: q.sort,
    workSource: q.workSource,
  };
}

function sendPulseError(res: Response, err: unknown): boolean {
  if (err instanceof PulseRangeError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof PortfolioNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  return false;
}

async function orgIdForPortfolio(portfolioId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: clientPortfoliosTable.orgId })
    .from(clientPortfoliosTable)
    .where(eq(clientPortfoliosTable.id, portfolioId))
    .limit(1);
  return row?.orgId ?? null;
}

async function mergedQuery(
  userId: string,
  portfolioId: string,
  requestQuery: PulseQuery,
): Promise<PulseQuery> {
  const saved = await loadSavedPulseQuery(userId, portfolioId);
  return {
    range: requestQuery.range ?? saved.range,
    from: requestQuery.from ?? saved.from,
    to: requestQuery.to ?? saved.to,
    sort: requestQuery.sort ?? saved.sort,
    workSource: requestQuery.workSource,
  };
}

async function officeScope(req: Request, orgId: string) {
  const actor = await officeActor(req, orgId);
  return { actor, allowedPropertyIds: await propertyIdsForActor(actor) };
}

router.get("/v1/portfolios", async (_req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const portfolios = await listPortfoliosForOffice();
  res.json(ListClientPortfoliosResponse.parse({ portfolios }));
});

router.get("/v1/portfolios/:id/pulse", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetPortfolioPulseParams.safeParse(req.params);
  const query = GetPortfolioPulseQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid pulse request" });
    return;
  }
  const orgId = await orgIdForPortfolio(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }
  try {
    const { actor, allowedPropertyIds } = await officeScope(req, orgId);
    const merged = await mergedQuery("office", path.data.id, pulseQueryFromParsed(query.data));
    const scoped = Boolean(allowedPropertyIds && allowedPropertyIds.length === 1);
    const doc = await computePortfolioPulse({
      portfolioId: path.data.id,
      orgId,
      query: merged,
      hrefForProperty: officePropertyHref,
      allowedPropertyIds,
      viewKind: scoped ? "property" : "regional",
      canAddProperties: actor.role === "regional_manager" || actor.role === "asset_manager",
    });
    res.json(GetPortfolioPulseResponse.parse(doc));
  } catch (err) {
    if (sendAccessError(res, err)) return;
    if (!sendPulseError(res, err)) throw err;
  }
});

router.get("/v1/portfolios/:id/attention", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetPortfolioAttentionParams.safeParse(req.params);
  const query = GetPortfolioAttentionQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid attention request" });
    return;
  }
  const orgId = await orgIdForPortfolio(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }
  try {
    const { allowedPropertyIds } = await officeScope(req, orgId);
    const doc = await computePortfolioAttention({
      portfolioId: path.data.id,
      orgId,
      hrefForProperty: officePropertyHref,
      workSource: query.data.workSource,
      allowedPropertyIds,
    });
    res.json(GetPortfolioAttentionResponse.parse(doc));
  } catch (err) {
    if (sendAccessError(res, err)) return;
    if (!sendPulseError(res, err)) throw err;
  }
});

router.post("/v1/portfolios/:id/ask", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    res.status(400).json({ error: "Ask a question" });
    return;
  }
  const portfolioId = String(req.params.id);
  const orgId = await orgIdForPortfolio(portfolioId);
  if (!orgId) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }
  try {
    const { allowedPropertyIds } = await officeScope(req, orgId);
    const [pulse, attention] = await Promise.all([
      computePortfolioPulse({
        portfolioId,
        orgId,
        query: { range: "this_month" },
        hrefForProperty: officePropertyHref,
        allowedPropertyIds,
      }),
      computePortfolioAttention({
        portfolioId,
        orgId,
        hrefForProperty: officePropertyHref,
        allowedPropertyIds,
      }),
    ]);
    const out = await answerPortfolioAsk({
      question,
      title: pulse.viewLabel ?? pulse.portfolioName,
      properties: pulse.tiles.map((t) => ({ id: t.propertyId, name: t.name })),
      pulse: {
        vacancyCostCents: pulse.headline.vacancyCostCents,
        unitsInTurn: pulse.supporting.unitsInTurn,
        medianTurnDays: pulse.supporting.medianTurnDays,
        tiles: pulse.tiles,
      },
      turns: attention.turns ?? [],
      photoCount: attention.photoUnits?.length ?? 0,
      attentionCount: attention.groups.reduce((n, g) => n + g.items.length, 0),
      attentionGroups: attention.groups,
      history: Array.isArray(req.body?.history) ? req.body.history : undefined,
      focus: req.body?.focus && typeof req.body.focus === "object" ? req.body.focus : undefined,
      queueAct: req.body?.queueAct && typeof req.body.queueAct === "object" ? req.body.queueAct : undefined,
      dismissAct: typeof req.body?.dismissAct === "string" ? req.body.dismissAct : undefined,
    });
    res.json(out);
  } catch (err) {
    if (sendAccessError(res, err)) return;
    if (!sendPulseError(res, err)) throw err;
  }
});

router.get("/v1/portfolios/:id/stream", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = StreamPortfolioPulseParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid stream request" });
    return;
  }
  const orgId = await orgIdForPortfolio(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }
  attachPortfolioStream(path.data.id, res);
});

router.put("/v1/portfolios/:id/saved-view", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = PutPortfolioSavedViewParams.safeParse(req.params);
  const body = PutPortfolioSavedViewBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid saved view" });
    return;
  }
  const orgId = await orgIdForPortfolio(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }
  const saved = await savePulseView({
    userId: "office",
    portfolioId: path.data.id,
    range: body.data.range,
    from: body.data.from ?? null,
    to: body.data.to ?? null,
    sort: body.data.sort,
  });
  res.json(PutPortfolioSavedViewResponse.parse(saved));
});

async function clientContext(token: string) {
  return resolveClientBoardLink(token);
}

router.get("/client/:token/portfolio/pulse", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientPortfolioPulseParams.safeParse(req.params);
  const query = GetClientPortfolioPulseQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid pulse request" });
    return;
  }
  const ctx = await clientContext(path.data.token);
  if (!ctx) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const merged = await mergedQuery(
      `client:${ctx.kind}:${ctx.propertyId ?? ctx.portfolioId}`,
      ctx.portfolioId,
      pulseQueryFromParsed(query.data),
    );
    const doc = await computePortfolioPulse({
      portfolioId: ctx.portfolioId,
      orgId: ctx.orgId,
      query: merged,
      hrefForProperty: clientPropertyHref(path.data.token),
      allowedPropertyIds: ctx.allowedPropertyIds,
      viewKind: ctx.kind,
      viewLabel: ctx.viewLabel,
      canAddProperties: ctx.kind === "regional",
    });
    res.json(GetClientPortfolioPulseResponse.parse(doc));
  } catch (err) {
    if (!sendPulseError(res, err)) throw err;
  }
});

router.get("/client/:token/portfolio/attention", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientPortfolioAttentionParams.safeParse(req.params);
  const query = GetClientPortfolioAttentionQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid attention request" });
    return;
  }
  const ctx = await clientContext(path.data.token);
  if (!ctx) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const doc = await computePortfolioAttention({
      portfolioId: ctx.portfolioId,
      orgId: ctx.orgId,
      hrefForProperty: clientPropertyHref(path.data.token),
      workSource: query.data.workSource,
      allowedPropertyIds: ctx.allowedPropertyIds,
    });
    res.json(GetClientPortfolioAttentionResponse.parse(doc));
  } catch (err) {
    if (!sendPulseError(res, err)) throw err;
  }
});

router.post("/client/:token/portfolio/ask", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    res.status(400).json({ error: "Ask a question" });
    return;
  }
  const ctx = await clientContext(String(req.params.token ?? ""));
  if (!ctx) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  try {
    const href = clientPropertyHref(String(req.params.token));
    const [pulse, attention] = await Promise.all([
      computePortfolioPulse({
        portfolioId: ctx.portfolioId,
        orgId: ctx.orgId,
        query: { range: "this_month" },
        hrefForProperty: href,
        allowedPropertyIds: ctx.allowedPropertyIds,
        viewKind: ctx.kind,
        viewLabel: ctx.viewLabel,
      }),
      computePortfolioAttention({
        portfolioId: ctx.portfolioId,
        orgId: ctx.orgId,
        hrefForProperty: href,
        allowedPropertyIds: ctx.allowedPropertyIds,
      }),
    ]);
    const out = await answerPortfolioAsk({
      question,
      title: pulse.viewLabel ?? pulse.portfolioName,
      properties: pulse.tiles.map((t) => ({ id: t.propertyId, name: t.name })),
      pulse: {
        vacancyCostCents: pulse.headline.vacancyCostCents,
        unitsInTurn: pulse.supporting.unitsInTurn,
        medianTurnDays: pulse.supporting.medianTurnDays,
        tiles: pulse.tiles,
      },
      turns: attention.turns ?? [],
      photoCount: attention.photoUnits?.length ?? 0,
      attentionCount: attention.groups.reduce((n, g) => n + g.items.length, 0),
      attentionGroups: attention.groups,
      history: Array.isArray(req.body?.history) ? req.body.history : undefined,
      focus: req.body?.focus && typeof req.body.focus === "object" ? req.body.focus : undefined,
      queueAct: req.body?.queueAct && typeof req.body.queueAct === "object" ? req.body.queueAct : undefined,
      dismissAct: typeof req.body?.dismissAct === "string" ? req.body.dismissAct : undefined,
    });
    res.json(out);
  } catch (err) {
    if (!sendPulseError(res, err)) throw err;
  }
});

router.get("/client/:token/portfolio/stream", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = StreamClientPortfolioPulseParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid stream request" });
    return;
  }
  const ctx = await clientContext(path.data.token);
  if (!ctx) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  attachPortfolioStream(ctx.portfolioId, res);
});

router.put("/client/:token/portfolio/saved-view", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = PutClientPortfolioSavedViewParams.safeParse(req.params);
  const body = PutClientPortfolioSavedViewBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid saved view" });
    return;
  }
  const ctx = await clientContext(path.data.token);
  if (!ctx) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const saved = await savePulseView({
    userId: `client:${ctx.kind}:${ctx.propertyId ?? ctx.portfolioId}`,
    portfolioId: ctx.portfolioId,
    range: body.data.range,
    from: body.data.from ?? null,
    to: body.data.to ?? null,
    sort: body.data.sort,
  });
  res.json(PutClientPortfolioSavedViewResponse.parse(saved));
});

router.get("/client/:token/portfolio/available-properties", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = ListClientPortfolioAvailablePropertiesParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const gated = await regionalClientLink(path.data.token);
  if (!gated.ok) {
    res.status(gated.status).json({ error: gated.error });
    return;
  }
  const attached = await db
    .select({ propertyId: clientPortfolioPropertiesTable.propertyId })
    .from(clientPortfolioPropertiesTable)
    .where(eq(clientPortfolioPropertiesTable.portfolioId, gated.link.portfolioId));
  const attachedIds = attached.map((r) => r.propertyId);
  const where = attachedIds.length
    ? and(eq(propertiesTable.clientOrgId, gated.link.orgId), notInArray(propertiesTable.id, attachedIds))
    : eq(propertiesTable.clientOrgId, gated.link.orgId);
  const rows = await db
    .select({
      propertyId: propertiesTable.id,
      name: propertiesTable.name,
      city: propertiesTable.city,
    })
    .from(propertiesTable)
    .where(where);
  res.json(
    ListClientPortfolioAvailablePropertiesResponse.parse({
      properties: rows.map((r) => ({
        propertyId: r.propertyId,
        name: r.name,
        city: r.city ?? null,
      })),
    }),
  );
});

router.post("/client/:token/portfolio/properties", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = AddClientPortfolioPropertyParams.safeParse(req.params);
  const body = AddClientPortfolioPropertyBody.safeParse(req.body);
  if (!path.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const gated = await regionalClientLink(path.data.token);
  if (!gated.ok) {
    res.status(gated.status).json({ error: gated.error });
    return;
  }
  const propertyId = body.data.propertyId?.trim();
  if (propertyId) {
    const [existing] = await db
      .select({
        id: propertiesTable.id,
        name: propertiesTable.name,
        orgId: propertiesTable.clientOrgId,
      })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId))
      .limit(1);
    if (!existing || existing.orgId !== gated.link.orgId) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    await db
      .insert(clientPortfolioPropertiesTable)
      .values({ portfolioId: gated.link.portfolioId, propertyId: existing.id })
      .onConflictDoNothing();
    res.json(
      AddClientPortfolioPropertyResponse.parse({
        propertyId: existing.id,
        name: existing.name,
        created: false,
      }),
    );
    return;
  }

  const name = body.data.name?.trim();
  if (!name) {
    res.status(400).json({ error: "Provide propertyId or name" });
    return;
  }
  const city = body.data.city?.trim() || null;
  const timezone = body.data.timezone?.trim() || "America/Chicago";
  let avgDailyRentCents: bigint | null = null;
  if (body.data.avgDailyRentCents != null && body.data.avgDailyRentCents !== "") {
    if (!/^-?\d+$/.test(body.data.avgDailyRentCents)) {
      res.status(400).json({ error: "avgDailyRentCents must be integer cents" });
      return;
    }
    avgDailyRentCents = BigInt(body.data.avgDailyRentCents);
  }
  const targetTurnDays =
    typeof body.data.targetTurnDays === "number" && Number.isFinite(body.data.targetTurnDays)
      ? Math.max(1, Math.floor(body.data.targetTurnDays))
      : 7;

  const [created] = await db
    .insert(propertiesTable)
    .values({
      name,
      city,
      timezone,
      avgDailyRentCents,
      targetTurnDays,
      clientOrgId: gated.link.orgId,
      status: "active",
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Could not create property" });
    return;
  }
  await db.insert(clientPortfolioPropertiesTable).values({
    portfolioId: gated.link.portfolioId,
    propertyId: created.id,
  });
  res.json(
    AddClientPortfolioPropertyResponse.parse({
      propertyId: created.id,
      name: created.name,
      created: true,
    }),
  );
});

export default router;
