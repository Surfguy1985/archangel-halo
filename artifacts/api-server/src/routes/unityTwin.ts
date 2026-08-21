/**
 * Unity + web Site Twin feed — full live plate + 3D hints.
 */
import { Router } from "express";
import { getBuildingOpsPlate } from "../lib/getBuildingOpsPlate";
import { logger } from "../lib/logger";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/unity-twin/health", (_req, res) => {
  res.json({
    ok: true,
    service: "unity-twin",
    version: 2,
    unityMcp: {
      package: "https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity",
      haloScripts: "unity/HaloSiteTwin/Assets/Scripts",
      haloMcp: "tools/halo-mcp/server.mjs",
    },
  });
});

router.get("/properties/:id/unity-twin", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  try {
    const plate = await getBuildingOpsPlate(id);
    if (!plate) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    res.json({
      ...plate,
      siteRadiusMeters: 120,
      unity: {
        pollSeconds: 3,
        buildingScale: 12,
        crewScale: 2,
        recommendedCameraHeight: 80,
        streamUrl: `/api/properties/${id}/building-ops/stream`,
        mcpTools: [
          "focus_building",
          "list_on_site_crew",
          "get_headline",
          "refresh_twin",
          "show_heat",
          "highlight_exceptions",
        ],
      },
      liveFeed: `/api/properties/${id}/building-ops`,
      streamFeed: `/api/properties/${id}/building-ops/stream`,
    });
  } catch (err: any) {
    logger.error({ err }, "unity-twin failed");
    res.status(500).json({ error: err.message || "unity-twin failed" });
  }
});

export default router;
