import { Router, type IRouter } from "express";
import {
  ReverseGeocodeQueryParams,
  ReverseGeocodeResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const cache = new Map<string, string | null>();
const MAX_CACHE = 500;

let queue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;

async function nominatimReverse(
  lat: number,
  lng: number,
): Promise<string | null> {
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HALO-ArchangelOps/1.0 (admin@archangelcontractors.com)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, "Nominatim reverse geocode failed");
    return null;
  }
  const data: any = await res.json().catch(() => null);
  return typeof data?.display_name === "string" ? data.display_name : null;
}

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
  const result = queue.then(async () => {
    if (cache.has(key)) return cache.get(key) ?? null;
    try {
      const address = await nominatimReverse(lat, lng);
      if (cache.size >= MAX_CACHE) {
        const first = cache.keys().next().value;
        if (first !== undefined) cache.delete(first);
      }
      if (address !== null) cache.set(key, address);
      return address;
    } catch (err) {
      logger.warn({ err }, "Reverse geocode error");
      return null;
    }
  });
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  const address = await result;
  res.json(ReverseGeocodeResponse.parse({ address }));
});

export default router;
