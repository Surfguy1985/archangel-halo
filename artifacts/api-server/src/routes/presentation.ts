// Presentation Mode: seed/teardown a clearly-marked demo property so the
// office can run a narrated live walkthrough of the client dashboard.
import { Router, type IRouter } from "express";
import {
  getPresentationDemoState,
  seedPresentationDemo,
  teardownPresentationDemo,
  runPresentationDemoStep,
  PRESENTATION_DEMO_STEPS,
} from "../lib/presentationDemo";
import { getOfficeBoardFull } from "./clientBoard";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Token guard shared by the two public-safe demo drive endpoints: the caller
// must present the CURRENT demo dashboardToken AND the demo must be active.
// This is safe on an unauthenticated (audience) device because these routes
// only ever mutate/read the demo property's own data.
async function requireDemoToken(
  token: unknown,
): Promise<{ propertyId: string } | null> {
  if (typeof token !== "string" || !token) return null;
  const state = await getPresentationDemoState();
  if (!state.active || !state.dashboardToken || !state.propertyId) return null;
  if (state.dashboardToken !== token) return null;
  return { propertyId: state.propertyId };
}

// PUBLIC (see officeGuard): never disclose the dashboardToken here — that
// token is the sole guard on the public step/office-board endpoints. Callers
// that already hold a board token pass it as ?token= and get a `matches`
// boolean back; the token itself is only ever returned by the office-gated
// POST (seed) route.
router.get("/presentation/demo", async (req, res) => {
  try {
    const state = await getPresentationDemoState();
    const token = typeof req.query.token === "string" ? req.query.token : null;
    res.json({
      active: state.active,
      matches:
        !!state.active && !!token && state.dashboardToken === token,
    });
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

// Public-safe: the audience device drives the scripted card lifecycle. Guarded
// by the current demo dashboardToken + active demo (403 otherwise). Only ever
// mutates the demo property's data. Its prefix is on PUBLIC_PREFIXES so the
// office passcode gate lets an unauthenticated device through.
router.post("/presentation/demo/step", async (req, res) => {
  try {
    const guard = await requireDemoToken(req.body?.token);
    if (!guard) {
      res.status(403).json({ error: "Presentation demo is not active or token is invalid" });
      return;
    }
    const step = String(req.body?.step ?? "");
    if (!(PRESENTATION_DEMO_STEPS as readonly string[]).includes(step)) {
      res.status(400).json({ error: `Unknown step: ${step}`, steps: PRESENTATION_DEMO_STEPS });
      return;
    }
    await runPresentationDemoStep(step);
    res.json({ ok: true, step });
  } catch (err) {
    logger.error({ err }, "presentation demo step failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Demo step failed" });
  }
});

// Public-safe office-side board projection for the demo property, so a
// client-side office panel can render the OFFICE view live during the demo.
// Same token guard + same projection as GET /admin/accounts/:id/board/full.
router.get("/presentation/demo/office-board", async (req, res) => {
  try {
    const guard = await requireDemoToken(req.query?.token);
    if (!guard) {
      res.status(403).json({ error: "Presentation demo is not active or token is invalid" });
      return;
    }
    const full = await getOfficeBoardFull(guard.propertyId);
    if (!full) {
      res.status(404).json({ error: "No client account for the demo property" });
      return;
    }
    res.json(full);
  } catch (err) {
    logger.error({ err }, "presentation demo office-board failed");
    res.status(500).json({ error: "Could not read the demo office board" });
  }
});

export default router;
