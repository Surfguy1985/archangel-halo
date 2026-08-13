import { describe, expect, it } from "vitest";
import {
  classifyDayForecast,
  geocodeQueryFromProperty,
  peakSeverity,
  wmoCodeLabel,
  type DayForecast,
} from "./weatherRiskCore";

function day(over: Partial<DayForecast> = {}): DayForecast {
  return {
    date: "2026-08-14",
    weatherCode: 0,
    tempMaxC: 24,
    tempMinC: 14,
    precipMm: 0,
    precipProb: 10,
    windKph: 8,
    ...over,
  };
}

describe("weather.risk_scan classification", () => {
  it("labels clear days with no severity", () => {
    const r = classifyDayForecast(day());
    expect(r.severity).toBeNull();
    expect(r.summary).toBe("Clear");
    expect(wmoCodeLabel(95)).toBe("Thunderstorm");
  });

  it("flags heavy rain and thunderstorms as high", () => {
    expect(classifyDayForecast(day({ precipMm: 30, precipProb: 90 })).severity).toBe("high");
    expect(classifyDayForecast(day({ weatherCode: 95 })).severity).toBe("high");
  });

  it("flags heat and freeze bands", () => {
    expect(classifyDayForecast(day({ tempMaxC: 39 })).severity).toBe("high");
    expect(classifyDayForecast(day({ tempMaxC: 33 })).severity).toBe("medium");
    expect(classifyDayForecast(day({ tempMinC: -6 })).severity).toBe("high");
    expect(classifyDayForecast(day({ tempMinC: 1 })).severity).toBe("medium");
  });

  it("does not let a later low issue downgrade high wind", () => {
    const r = classifyDayForecast(day({ windKph: 65, precipProb: 40, precipMm: 3 }));
    expect(r.severity).toBe("high");
  });

  it("peaks across a site's forecast days", () => {
    expect(
      peakSeverity([
        classifyDayForecast(day({ precipProb: 45 })),
        classifyDayForecast(day({ weatherCode: 95 })),
      ]),
    ).toBe("high");
  });

  it("builds a place-name geocode query, not a raw street dump when city exists", () => {
    expect(geocodeQueryFromProperty({ name: "Oak", city: "Dallas", address: "100 Main St" })).toBe(
      "Dallas",
    );
    expect(
      geocodeQueryFromProperty({
        name: "Oak",
        city: null,
        address: "3000 Grapevine Mills Pkwy, Grapevine, TX 76051",
      }),
    ).toBe("Grapevine, TX");
  });
});
