/**
 * Falkon weather.risk_scan — office-gated, read-only. No schedule write.
 */

import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, jobsTable, propertiesTable } from "@workspace/db";
import { MAX_SCAN_SITES, scanHeadline, scanSites } from "../lib/weatherScan";
import { localDateInEastern } from "../lib/eodBriefingCore";
import { recommendScheduleMoves } from "../lib/scheduleRecommendCore";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/weather/scan", async (req, res): Promise<void> => {
  try {
    const rawIds = Array.isArray(req.body?.propertyIds) ? req.body.propertyIds : [];
    const propertyIds = rawIds.filter((id: unknown): id is string => typeof id === "string").slice(0, MAX_SCAN_SITES);

    const rows =
      propertyIds.length > 0
        ? await db
            .select({
              id: propertiesTable.id,
              name: propertiesTable.name,
              city: propertiesTable.city,
              address: propertiesTable.address,
              latitude: propertiesTable.latitude,
              longitude: propertiesTable.longitude,
            })
            .from(propertiesTable)
            .where(inArray(propertiesTable.id, propertyIds))
        : await db
            .select({
              id: propertiesTable.id,
              name: propertiesTable.name,
              city: propertiesTable.city,
              address: propertiesTable.address,
              latitude: propertiesTable.latitude,
              longitude: propertiesTable.longitude,
            })
            .from(propertiesTable)
            .where(eq(propertiesTable.status, "active"));

    const sites = await scanSites(
      rows.slice(0, MAX_SCAN_SITES).map((p) => ({
        id: p.id,
        name: p.name,
        city: p.city,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
    );

    res.json({
      ok: true,
      capability: "weather.risk_scan",
      writes: false,
      headline: scanHeadline(sites),
      sites,
    });
  } catch (err) {
    logger.error({ err }, "weather.risk_scan failed");
    res.status(502).json({ error: "Weather scan unavailable" });
  }
});

router.post("/weather/recommend", async (req, res): Promise<void> => {
  try {
    const today = localDateInEastern();
    const jobRows = await db
      .select({
        id: jobsTable.id,
        jobNo: jobsTable.jobNo,
        propertyId: jobsTable.propertyId,
        scheduledOn: jobsTable.scheduledOn,
        description: jobsTable.description,
      })
      .from(jobsTable)
      .where(and(isNotNull(jobsTable.scheduledOn), gte(jobsTable.scheduledOn, today)));

    const propIds = [...new Set(jobRows.map((j) => j.propertyId))].slice(0, MAX_SCAN_SITES);
    const props =
      propIds.length === 0
        ? []
        : await db
            .select({
              id: propertiesTable.id,
              name: propertiesTable.name,
              city: propertiesTable.city,
              address: propertiesTable.address,
              latitude: propertiesTable.latitude,
              longitude: propertiesTable.longitude,
            })
            .from(propertiesTable)
            .where(inArray(propertiesTable.id, propIds));

    const nameById = new Map(props.map((p) => [p.id, p.name]));
    const scanned = await scanSites(
      props.map((p) => ({
        id: p.id,
        name: p.name,
        city: p.city,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
    );
    const packet = recommendScheduleMoves(
      jobRows.map((j) => ({
        id: j.id,
        jobNo: j.jobNo,
        propertyId: j.propertyId,
        propertyName: nameById.get(j.propertyId) ?? null,
        scheduledOn: j.scheduledOn,
        description: j.description,
      })),
      scanned.map((s) => ({
        propertyId: s.propertyId,
        days: s.days.map((d) => ({ date: d.date, severity: d.severity, summary: d.summary })),
      })),
      today,
    );
    res.json({
      ok: true,
      capability: "weather.schedule_recommend",
      ...packet,
    });
  } catch (err) {
    logger.error({ err }, "weather.schedule_recommend failed");
    res.status(502).json({ error: "Schedule recommendation unavailable" });
  }
});

export default router;
