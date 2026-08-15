import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetPortfolioCostToServeParams,
  GetPortfolioCostToServeQueryParams,
  GetPortfolioCostToServeResponse,
  GetClientPortfolioCostToServeParams,
  GetClientPortfolioCostToServeQueryParams,
  GetClientPortfolioCostToServeResponse,
} from "@workspace/api-zod";
import { db, clientPortfoliosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isClientBoardSegmentEnabled } from "../lib/clientBoardFlags";
import { regionalClientLink } from "../lib/clientBoardLink";
import { officeActor, sendAccessError } from "../lib/clientBoardAccess";
import { computeCostToServe } from "../lib/costToServe";
import { PortfolioNotFoundError, PulseRangeError, type PulseQuery } from "../lib/portfolioPulse";

const router: IRouter = Router();
const DARK = { error: "Work-source views are not enabled" };

async function requireFlag(): Promise<boolean> {
  return isClientBoardSegmentEnabled("workSource");
}

function queryFrom(q: {
  range?: PulseQuery["range"];
  from?: string;
  to?: string;
  workSource?: PulseQuery["workSource"];
}): PulseQuery {
  return { range: q.range, from: q.from ?? null, to: q.to ?? null, workSource: q.workSource };
}

function sendErr(res: Response, err: unknown): boolean {
  if (sendAccessError(res, err)) return true;
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

router.get("/v1/portfolios/:id/cost-to-serve", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetPortfolioCostToServeParams.safeParse(req.params);
  const query = GetPortfolioCostToServeQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
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
    const doc = await computeCostToServe({
      portfolioId: path.data.id,
      orgId: port.orgId,
      query: queryFrom(query.data),
    });
    res.json(GetPortfolioCostToServeResponse.parse(doc));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

router.get("/client/:token/portfolio/cost-to-serve", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFlag())) {
    res.status(404).json(DARK);
    return;
  }
  const path = GetClientPortfolioCostToServeParams.safeParse(req.params);
  const query = GetClientPortfolioCostToServeQueryParams.safeParse(req.query);
  if (!path.success || !query.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const gated = await regionalClientLink(path.data.token);
  if (!gated.ok) {
    res.status(gated.status).json({ error: gated.error });
    return;
  }
  try {
    const doc = await computeCostToServe({
      portfolioId: gated.link.portfolioId,
      orgId: gated.link.orgId,
      query: queryFrom(query.data),
    });
    res.json(GetClientPortfolioCostToServeResponse.parse(doc));
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

export default router;
