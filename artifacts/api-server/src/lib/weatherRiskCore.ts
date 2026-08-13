/**
 * Weather risk classification (pure). Open-Meteo WMO codes + daily totals.
 * Recommendation only — never writes a schedule.
 */

export type WeatherSeverity = "low" | "medium" | "high";

export interface DayForecast {
  date: string;
  weatherCode: number;
  tempMaxC: number;
  tempMinC: number;
  precipMm: number;
  precipProb: number;
  windKph: number;
}

export interface DayRisk {
  severity: WeatherSeverity | null;
  summary: string;
  issues: string[];
}

export function wmoCodeLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm with hail";
  return "Mixed";
}

function bump(current: WeatherSeverity | null, next: WeatherSeverity): WeatherSeverity {
  if (current === "high" || next === "high") return "high";
  if (current === "medium" || next === "medium") return "medium";
  return "low";
}

export function classifyDayForecast(d: DayForecast): DayRisk {
  const issues: string[] = [];
  let sev: WeatherSeverity | null = null;

  if (d.precipMm >= 25 || d.precipProb >= 80) {
    sev = "high";
    issues.push(`heavy rain ${d.precipMm.toFixed(1)}mm (${d.precipProb}% chance)`);
  } else if (d.precipMm >= 10 || d.precipProb >= 60) {
    sev = bump(sev, "medium");
    issues.push(`rain ${d.precipMm.toFixed(1)}mm (${d.precipProb}% chance)`);
  } else if (d.precipMm >= 3 || d.precipProb >= 40) {
    sev = sev ?? "low";
    issues.push(`light rain possible (${d.precipProb}%)`);
  }

  if (d.windKph >= 60) {
    sev = "high";
    issues.push(`high winds ${Math.round(d.windKph)} kph`);
  } else if (d.windKph >= 35) {
    sev = bump(sev, "medium");
    issues.push(`gusty winds ${Math.round(d.windKph)} kph`);
  }

  if (d.tempMaxC >= 38) {
    sev = "high";
    issues.push(`extreme heat ${Math.round(d.tempMaxC)}°C`);
  } else if (d.tempMaxC >= 32) {
    sev = bump(sev, "medium");
    issues.push(`hot ${Math.round(d.tempMaxC)}°C`);
  }
  if (d.tempMinC <= -5) {
    sev = "high";
    issues.push(`hard freeze ${Math.round(d.tempMinC)}°C`);
  } else if (d.tempMinC <= 2) {
    sev = bump(sev, "medium");
    issues.push(`freezing risk ${Math.round(d.tempMinC)}°C`);
  }

  if (d.weatherCode === 95 || d.weatherCode === 96 || d.weatherCode === 99) {
    sev = "high";
    issues.unshift("thunderstorm");
  }
  if (d.weatherCode >= 71 && d.weatherCode <= 77) {
    sev = bump(sev, "medium");
    issues.unshift("snow");
  }

  const cond = wmoCodeLabel(d.weatherCode);
  if (!sev) return { severity: null, summary: cond, issues: [] };
  return { severity: sev, summary: `${cond} — ${issues.join(", ")}`, issues };
}

export function peakSeverity(days: DayRisk[]): WeatherSeverity | null {
  let peak: WeatherSeverity | null = null;
  for (const d of days) {
    if (!d.severity) continue;
    peak = peak ? bump(peak, d.severity) : d.severity;
  }
  return peak;
}

/** Place-name query for Open-Meteo geocoder (not a street-address geocoder). */
export function geocodeQueryFromProperty(input: {
  name: string;
  city?: string | null;
  address?: string | null;
}): string | null {
  const city = input.city?.trim();
  if (city) return city.slice(0, 200);
  const addr = (input.address ?? "").trim();
  if (!addr) return null;
  const tail = addr.match(/([A-Za-z .]+,\s*[A-Z]{2})\b/);
  if (tail?.[1]) return tail[1].trim().slice(0, 200);
  return addr.slice(0, 200);
}
