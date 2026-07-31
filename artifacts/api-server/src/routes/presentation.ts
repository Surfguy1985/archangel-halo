// Presentation Mode: seed/teardown a clearly-marked demo property so the
// office can run a narrated live walkthrough of the client dashboard.
import { Router, type IRouter } from "express";
import {
  getPresentationDemoState,
  seedPresentationDemo,
  teardownPresentationDemo,
} from "../lib/presentationDemo";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/presentation/demo", async (_req, res) => {
  try {
    res.json(await getPresentationDemoState());
  } catch (err) {
    logger.error({ err }, "presentation demo state failed");
    res.status(500).json({ error: "Could not read presentation demo state" });
  }
});

router.post("/presentation/demo", async (_req, res) => {
  try {
    const { dashboardToken, propertyId } = await seedPresentationDemo();
    res.json({ active: true, dashboardToken, propertyId });
  } catch (err) {
    logger.error({ err }, "presentation demo seed failed");
    res.status(500).json({ error: "Could not set up the presentation demo" });
  }
});

router.delete("/presentation/demo", async (_req, res) => {
  try {
    await teardownPresentationDemo();
    res.json({ active: false, dashboardToken: null, propertyId: null });
  } catch (err) {
    logger.error({ err }, "presentation demo teardown failed");
    res.status(500).json({ error: "Could not remove the presentation demo" });
  }
});

export default router;
