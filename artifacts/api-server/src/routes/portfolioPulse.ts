import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  clientPortfoliosTable,
} from "@workspace/db";
import {
  ListClientPortfoliosResponse,
  GetPortfolioPulseParams,
  GetPortfolioPulseQueryParams,
  GetPortfolioPulseResponse,
  GetPortfolioAttentionParams,
  GetPortfolioAttentionResponse,
  StreamPortfolioPulseParams,
  PutPortfolioSavedViewParams,
  PutPortfolioSavedViewBody,
  PutPortfolioSavedViewResponse,
  GetClientPortfolioPulseParams,
  GetClientPortfolioPulseQueryParams,
  GetClientPortfolioPulseResponse,
  GetClientPortfolioAttentionParams,
  GetClientPortfolioAttentionResponse,
  StreamClientPortfolioPulseParams,
  PutClientPortfolioSavedViewParams,
  PutClientPortfolioSavedViewBody,
  PutClientPortfolioSavedViewResponse,
} from "@workspace/api-zod";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import { resolveClientPropertyIdForToken } from "../lib/sessionAuth";
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
}): PulseQuery {
  return {
    range: q.range,
    from: q.from ?? null,
    to: q.to ?? null,
    sort: q.sort,
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
  };
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
    const merged = await mergedQuery("office", path.data.id, pulseQueryFromParsed(query.data));
    const doc = await computePortfolioPulse({
      portfolioId: path.data.id,
      orgId,
      query: merged,
      hrefForProperty: officePropertyHref,
    });
    res.json(GetPortfolioPulseResponse.parse(doc));
  } catch (err) {
    if (!sendPulseError(res, err)) throw err;
  }
});

router.get("/v1/portfolios/:id/attention", async (req: Request, res: Response): Promise<void> => {
  if (!(await requirePulse())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetPortfolioAttentionParams.safeParse(req.params);
  if (!path.success) {
    res.status(400).json({ error: "Invalid attention request" });
    return;
  }
  const orgId = await orgIdForPortfolio(path.data.id);
  if (!orgId) {
    res.status(404).json({ error: "Portfolio not found" });
    return;
  }
  try {
    const doc = await computePortfolioAttention({
      portfolioId: path.data.id,
      orgId,
      hrefForProperty: officePropertyHref,
    });
    res.json(GetPortfolioAttentionResponse.parse(doc));
  } catch (err) {
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

async function clientContext(token: string): Promise<{
  propertyId: string;
  portfolioId: string;
  orgId: string;
} | null> {
  const propertyId = await resolveClientPropertyIdForToken(token);
  if (!propertyId) return null;
  const resolved = await resolvePortfolioForProperty(propertyId);
  if (!resolved) return null;
  return { propertyId, ...resolved };
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
      `client:${ctx.propertyId}`,
      ctx.portfolioId,
      pulseQueryFromParsed(query.data),
    );
    const doc = await computePortfolioPulse({
      portfolioId: ctx.portfolioId,
      orgId: ctx.orgId,
      query: merged,
      hrefForProperty: clientPropertyHref(path.data.token),
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
  if (!path.success) {
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
    });
    res.json(GetClientPortfolioAttentionResponse.parse(doc));
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
    userId: `client:${ctx.propertyId}`,
    portfolioId: ctx.portfolioId,
    range: body.data.range,
    from: body.data.from ?? null,
    to: body.data.to ?? null,
    sort: body.data.sort,
  });
  res.json(PutClientPortfolioSavedViewResponse.parse(saved));
});

export default router;
