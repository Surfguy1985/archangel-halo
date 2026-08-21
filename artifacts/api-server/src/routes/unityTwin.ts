/**
 * Unity Site Twin feed — compact snapshot for 3D client + MCP agents.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import { buildBuildingPins, SITE_M } from "../lib/buildingSiteOps";
import { THORNBURY_SITE_META } from "../lib/thornburySitePlan";
import { logger } from "../lib/logger";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lightweight health for Unity boot. */
router.get("/unity-twin/health", (_req, res) => {
  res.json({
    ok: true,
    service: "unity-twin",
    version: 1,
    unityMcp: {
      package: "https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity",
      haloScripts: "unity/HaloSiteTwin/Assets/Scripts",
    },
  });
});

/**
 * Unity-friendly twin snapshot.
 * Prefer this over raw building-ops for JsonUtility (flat, stable field names).
 * Internally reuses building-ops logic by proxying shape.
 */
router.get("/properties/:id/unity-twin", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  try {
    // Delegate to building-ops by importing handler logic is heavy;
    // call internal shape: redirect clients can use building-ops.
    // Here we return a compact plate + world hints for Unity.
    const [prop] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
    if (!prop) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    const buildings = buildBuildingPins().map((b) => ({
      building: b.building,
      label: b.label,
      x: b.x,
      y: b.y,
      lat: b.lat,
      lng: b.lng,
      unitCount: b.unitCount,
    }));

    const site = {
      lat: prop.latitude ?? THORNBURY_SITE_META.lat,
      lng: prop.longitude ?? THORNBURY_SITE_META.lng,
    };

    res.json({
      ok: true,
      mode: "building_first",
      propertyId: id,
      propertyName: prop.name,
      site,
      siteRadiusMeters: SITE_M,
      summary: {
        buildings: buildings.length,
        crewsTracked: 0,
        onSite: 0,
        offSite: 0,
        liveJobs: 0,
        headline: "Use /building-ops for live crew — unity-twin returns geometry plate",
      },
      buildings,
      presence: [] as unknown[],
      heat: [] as unknown[],
      units: [] as unknown[],
      // Unity world helpers
      unity: {
        pollSeconds: 3,
        buildingScale: 12,
        crewScale: 2,
        recommendedCameraHeight: 80,
        mcpTools: [
          "focus_building",
          "list_on_site_crew",
          "get_headline",
          "refresh_twin",
        ],
      },
      liveFeed: `/api/properties/${id}/building-ops`,
    });
  } catch (err: any) {
    logger.error({ err }, "unity-twin failed");
    res.status(500).json({ error: err.message || "unity-twin failed" });
  }
});

export default router;
