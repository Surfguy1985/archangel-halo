/**
 * Cached matched OSM footprints for Site Twin plate.
 * Soft-fail: plate still works if Overpass is down.
 */
import { fetchOsmBuildings, THORNBURY_BBOX } from "./osmBuildings";
import { matchOsmToHaloBuildings, type MatchedFootprint } from "./matchOsmToHalo";
import { logger } from "./logger";

let cache: { at: number; matched: MatchedFootprint[] } | null = null;
const TTL_MS = 30 * 60 * 1000;

export async function getMatchedFootprints(force = false): Promise<MatchedFootprint[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.matched;
  try {
    const data = await fetchOsmBuildings(THORNBURY_BBOX);
    const { matched } = matchOsmToHaloBuildings(data.buildings, 90);
    cache = { at: Date.now(), matched };
    logger.info({ count: matched.length }, "matched footprints cached");
    return matched;
  } catch (err) {
    logger.warn({ err }, "matched footprints unavailable");
    return cache?.matched ?? [];
  }
}
