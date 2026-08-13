/**
 * Open-Meteo forecast fetch for HALO properties. Stateless — no SoR write.
 */

import {
  classifyDayForecast,
  geocodeQueryFromProperty,
  peakSeverity,
  type DayForecast,
  type DayRisk,
  type WeatherSeverity,
} from "./weatherRiskCore";
import { logger } from "./logger";

export const MAX_SCAN_SITES = 50;
const FORECAST_DAYS = 3;
const FETCH_MS = 8_000;

export interface ScanSiteInput {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface SiteWeatherScan {
  propertyId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  skipped?: "ungeocoded" | "upstream";
  peakSeverity: WeatherSeverity | null;
  days: Array<DayForecast & DayRisk>;
}

const geoCache = new Map<string, { lat: number; lng: number; at: number }>();
const GEO_TTL_MS = 24 * 3_600_000;
const MAX_GEO_CACHE = 500;

function cacheGet(key: string): { lat: number; lng: number } | null {
  const hit = geoCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > GEO_TTL_MS) {
    geoCache.delete(key);
    return null;
  }
  return { lat: hit.lat, lng: hit.lng };
}

function cacheSet(key: string, lat: number, lng: number): void {
  if (geoCache.size >= MAX_GEO_CACHE) {
    const first = geoCache.keys().next().value;
    if (first !== undefined) geoCache.delete(first);
  }
  geoCache.set(key, { lat, lng, at: Date.now() });
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "HALO-ArchangelOps/1.0 (weather.risk_scan)",
    },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

export async function geocodePlace(query: string): Promise<{ lat: number; lng: number } | null> {
  const key = query.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return cached;
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
    `&count=1&language=en&format=json`;
  try {
    const json = (await fetchJson(url)) as {
      results?: { latitude: number; longitude: number }[];
    };
    const hit = json.results?.[0];
    if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return null;
    cacheSet(key, hit.latitude, hit.longitude);
    return { lat: hit.latitude, lng: hit.longitude };
  } catch (err) {
    logger.warn({ err, query }, "weather: geocode failed");
    return null;
  }
}

function parseDaily(json: {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
  };
}): DayForecast[] {
  const d = json.daily;
  if (!d?.time?.length) return [];
  return d.time.map((date, i) => ({
    date,
    weatherCode: d.weather_code?.[i] ?? 0,
    tempMaxC: d.temperature_2m_max?.[i] ?? 0,
    tempMinC: d.temperature_2m_min?.[i] ?? 0,
    precipMm: d.precipitation_sum?.[i] ?? 0,
    precipProb: d.precipitation_probability_max?.[i] ?? 0,
    windKph: d.wind_speed_10m_max?.[i] ?? 0,
  }));
}

export async function fetchForecast(lat: number, lng: number): Promise<DayForecast[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max` +
    `&timezone=auto&forecast_days=${FORECAST_DAYS}`;
  const json = (await fetchJson(url)) as Parameters<typeof parseDaily>[0];
  return parseDaily(json);
}

async function resolveCoords(site: ScanSiteInput): Promise<{ lat: number; lng: number } | null> {
  if (
    typeof site.latitude === "number" &&
    Number.isFinite(site.latitude) &&
    typeof site.longitude === "number" &&
    Number.isFinite(site.longitude)
  ) {
    return { lat: site.latitude, lng: site.longitude };
  }
  const q = geocodeQueryFromProperty(site);
  if (!q) return null;
  return geocodePlace(q);
}

export async function scanSites(sites: ScanSiteInput[]): Promise<SiteWeatherScan[]> {
  const limited = sites.slice(0, MAX_SCAN_SITES);
  const out: SiteWeatherScan[] = [];
  for (const site of limited) {
    const coords = await resolveCoords(site);
    if (!coords) {
      out.push({
        propertyId: site.id,
        name: site.name,
        lat: null,
        lng: null,
        skipped: "ungeocoded",
        peakSeverity: null,
        days: [],
      });
      continue;
    }
    try {
      const forecast = await fetchForecast(coords.lat, coords.lng);
      const days = forecast.map((d) => ({ ...d, ...classifyDayForecast(d) }));
      out.push({
        propertyId: site.id,
        name: site.name,
        lat: coords.lat,
        lng: coords.lng,
        peakSeverity: peakSeverity(days),
        days,
      });
    } catch (err) {
      logger.warn({ err, propertyId: site.id }, "weather: forecast failed");
      out.push({
        propertyId: site.id,
        name: site.name,
        lat: coords.lat,
        lng: coords.lng,
        skipped: "upstream",
        peakSeverity: null,
        days: [],
      });
    }
  }
  return out;
}

export function scanHeadline(sites: SiteWeatherScan[]): string {
  const high = sites.filter((s) => s.peakSeverity === "high").length;
  const medium = sites.filter((s) => s.peakSeverity === "medium").length;
  const skipped = sites.filter((s) => s.skipped).length;
  if (high > 0) return `${high} site${high === 1 ? "" : "s"} at high weather risk in the next ${FORECAST_DAYS} days.`;
  if (medium > 0)
    return `${medium} site${medium === 1 ? "" : "s"} at medium weather risk in the next ${FORECAST_DAYS} days.`;
  if (skipped === sites.length) return "No forecasts available — properties need coordinates or a city.";
  return `No high weather risk in the next ${FORECAST_DAYS} days across ${sites.length} site${sites.length === 1 ? "" : "s"}.`;
}
