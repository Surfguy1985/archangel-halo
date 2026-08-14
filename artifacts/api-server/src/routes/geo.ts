import { Router, type IRouter } from "express";
import {
  ReverseGeocodeQueryParams,
  ReverseGeocodeResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { nominatimReverse, nominatimSearch } from "../lib/geocode";

const router: IRouter = Router();

const cache = new Map<string, string | null>();
const MAX_CACHE = 500;

router.get("/geo/search", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 3) {
    res.json({ hits: [] });
    return;
  }
  try {
    const hits = await nominatimSearch(q, 6);
    res.json({ hits });
  } catch (err) {
    logger.warn({ err, q }, "geo search failed");
    res.json({ hits: [] });
  }
});

router.get("/geo/reverse", async (req, res): Promise<void> => {
  const { lat, lng } = ReverseGeocodeQueryParams.parse(req.query);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.json(ReverseGeocodeResponse.parse({ address: null }));
    return;
  }
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache.has(key)) {
    res.json(ReverseGeocodeResponse.parse({ address: cache.get(key) ?? null }));
    return;
  }
  try {
    const address = await nominatimReverse(lat, lng);
    if (cache.size >= MAX_CACHE) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
    if (address !== null) cache.set(key, address);
    res.json(ReverseGeocodeResponse.parse({ address }));
  } catch (err) {
    logger.warn({ err }, "Reverse geocode error");
    res.json(ReverseGeocodeResponse.parse({ address: null }));
  }
});

export default router;
