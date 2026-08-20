import { Router } from "express";
import { buildPortfolioHome } from "../lib/portfolioHome";

export const portfolioHomeRouter = Router();

portfolioHomeRouter.get("/portfolio/home", async (_req, res) => {
  try {
    return res.json(await buildPortfolioHome());
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

portfolioHomeRouter.get("/portfolio/health", (_req, res) => {
  res.json({ ok: true, service: "portfolio-home", version: 1, money: false });
});

export default portfolioHomeRouter;
