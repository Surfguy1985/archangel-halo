import type {
  CatalogItem,
  CrewMapPin,
  Job,
  PortfolioPulseDocument,
  PropertySummary,
} from "@workspace/api-client-react";
import { formatUsdCents } from "./formatUsdCents";
import type { HaloStoryLevel } from "./haloLevels";

export type HaloDeskPanel = "overview" | "sites" | "reports" | "vendors" | "waiting" | "crew";

export function haloDeskPanels(level: HaloStoryLevel): HaloDeskPanel[] {
  if (level === "portfolio") return ["overview", "sites", "reports"];
  if (level === "pulse") return ["overview", "sites", "vendors"];
  return ["overview", "sites", "crew"];
}

const CITY_PIN: Record<string, [number, number]> = {
  frisco: [33.1507, -96.8236],
  dallas: [32.7767, -96.797],
  plano: [33.0198, -96.6989],
  mckinney: [33.1972, -96.6397],
  austin: [30.2672, -97.7431],
  "san antonio": [29.4241, -98.4936],
  houston: [29.7604, -95.3698],
  phoenix: [33.4484, -112.074],
  tucson: [32.2226, -110.9747],
  tulsa: [36.154, -95.9928],
  "oklahoma city": [35.4676, -97.5164],
  albuquerque: [35.0844, -106.6504],
};

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export function propertyMapPoint(p: {
  id: string;
  name: string;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): [number, number] {
  if (p.latitude != null && p.longitude != null && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
    return [p.latitude, p.longitude];
  }
  const city = (p.city ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  const known = CITY_PIN[city];
  if (known) {
    const j = hash01(p.id);
    return [known[0] + (j - 0.5) * 0.04, known[1] + (hash01(p.name) - 0.5) * 0.04];
  }
  const j = hash01(p.id + p.name);
  return [32.7767 + (j - 0.5) * 0.18, -96.797 + (hash01(p.name) - 0.5) * 0.22];
}

export type HaloMapCrew = {
  id: string;
  name: string;
  trade: string;
  lat: number;
  lng: number;
  status: "site" | "route";
  propertyName: string;
  mock: boolean;
  selfiePath?: string | null;
};

const DEMO_CREW: Array<{ name: string; trade: string; status: "site" | "route" }> = [
  { name: "Elena V.", trade: "Paint", status: "site" },
  { name: "Diego R.", trade: "Make-ready", status: "route" },
  { name: "Priya K.", trade: "Clean", status: "site" },
  { name: "Jonah M.", trade: "Punch", status: "route" },
];

export function haloMapCrews(args: {
  properties: Array<{ id: string; name: string; city?: string | null; latitude?: number | null; longitude?: number | null }>;
  pins: CrewMapPin[];
}): HaloMapCrew[] {
  const live: HaloMapCrew[] = [];
  for (const c of args.pins) {
    if (c.lat == null || c.lng == null || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    live.push({
      id: c.id,
      name: c.name,
      trade: c.trade ?? "Turn",
      lat: c.lat,
      lng: c.lng,
      status:
        c.lastCheckinKind === "checkin"
          ? "site"
          : c.lastCheckinKind === "checkout"
            ? "route"
            : c.todayStatus === "route"
              ? "route"
              : "site",
      propertyName: c.todayProperty ?? "On the book",
      mock: false,
      selfiePath: c.selfiePath,
    });
  }
  const taken = new Set(live.map((c) => c.propertyName.toLowerCase()));
  const homes = args.properties.slice(0, 8);
  DEMO_CREW.forEach((demo, i) => {
    const home = homes[i % Math.max(homes.length, 1)];
    if (!home) return;
    if (taken.has(home.name.toLowerCase()) && live.length >= 3) return;
    const [lat, lng] = propertyMapPoint(home);
    const j = hash01(demo.name + home.id);
    live.push({
      id: `demo-crew-${i}`,
      name: demo.name,
      trade: demo.trade,
      lat: lat + (j - 0.5) * 0.012,
      lng: lng + (hash01(demo.trade) - 0.5) * 0.012,
      status: demo.status,
      propertyName: home.name,
      mock: true,
    });
  });
  return live;
}

export type VendorDeskRow = {
  name: string;
  jobs: number;
  avgTurnDays: number | null;
  avgCostLabel: string;
  callbacks: number;
};

function jobTurnDays(j: Job): number | null {
  if (!j.completedAt || !j.createdAt) return null;
  const done = new Date(j.completedAt).getTime();
  const start = new Date(j.createdAt).getTime();
  if (!Number.isFinite(done) || !Number.isFinite(start) || done < start) return null;
  return (done - start) / 86_400_000;
}

export function vendorDeskRows(jobs: Job[]): VendorDeskRow[] {
  const groups = new Map<string, Job[]>();
  for (const j of jobs) {
    if (j.status === "cancelled") continue;
    const name = j.crewLeaderName?.trim() || "Unassigned";
    const list = groups.get(name) ?? [];
    list.push(j);
    groups.set(name, list);
  }
  return [...groups.entries()]
    .map(([name, list]) => {
      const turns = list.map(jobTurnDays).filter((d): d is number => d != null);
      const costs = list.map((j) => j.invoicedTotal).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
      const avgCost =
        costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
      return {
        name,
        jobs: list.length,
        avgTurnDays: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : null,
        avgCostLabel: avgCost == null ? "—" : `$${Math.round(avgCost).toLocaleString("en-US")}`,
        callbacks: list.filter((j) => j.boardStatus === "reopened").length,
      };
    })
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 8);
}

export function meanPoWaitDays(liveJobs: Job[]): number | null {
  const waits: number[] = [];
  const now = Date.now();
  for (const j of liveJobs) {
    if (j.poNumber?.trim()) continue;
    if (!j.createdAt) continue;
    const start = new Date(j.createdAt).getTime();
    if (!Number.isFinite(start) || start > now) continue;
    waits.push((now - start) / 86_400_000);
  }
  if (waits.length === 0) return null;
  return waits.reduce((a, b) => a + b, 0) / waits.length;
}

/** Days from job created → PO received. Existing timestamps only. */
export function meanPoProvideDays(jobs: Job[]): { days: number | null; sample: number } {
  const waits: number[] = [];
  for (const j of jobs) {
    if (!j.createdAt || !j.poReceivedAt) continue;
    const start = new Date(j.createdAt).getTime();
    const got = new Date(j.poReceivedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(got) || got < start) continue;
    waits.push((got - start) / 86_400_000);
  }
  return {
    days: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null,
    sample: waits.length,
  };
}

export function callbackRate(jobs: Job[]): { count: number; of: number } {
  const finished = jobs.filter((j) => j.completedAt && j.status !== "cancelled");
  const callbacks = jobs.filter((j) => j.boardStatus === "reopened" && j.status !== "cancelled");
  return { count: callbacks.length, of: Math.max(finished.length, callbacks.length) };
}

export function downloadVacancyCsv(pulse: PortfolioPulseDocument, filename = "halo-vacancy-report.csv") {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ["Community", "City", "Units in turn", "Typical turn days", "Vacancy cost", "Status"];
  const lines = [header.join(",")];
  const tiles = [...pulse.tiles].sort((a, b) => {
    try {
      const d = BigInt(b.vacancyCostCents) - BigInt(a.vacancyCostCents);
      if (d === 0n) return a.name.localeCompare(b.name);
      return d > 0n ? 1 : -1;
    } catch {
      return a.name.localeCompare(b.name);
    }
  });
  for (const t of tiles) {
    lines.push(
      [
        cell(t.name),
        cell(t.city ?? ""),
        String(t.unitsInTurn),
        t.medianTurnDays == null ? "" : t.medianTurnDays.toFixed(1),
        cell(formatUsdCents(t.vacancyCostCents)),
        cell(t.statusLabel),
      ].join(","),
    );
  }
  lines.push("");
  lines.push(
    [
      cell("TOTAL"),
      "",
      String(pulse.supporting.unitsInTurn),
      pulse.supporting.medianTurnDays == null ? "" : pulse.supporting.medianTurnDays.toFixed(1),
      cell(formatUsdCents(pulse.headline.vacancyCostCents)),
      cell(pulse.headline.label),
    ].join(","),
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function priceBookRows(items: CatalogItem[]): CatalogItem[] {
  return items.slice().sort((a, b) => a.service.localeCompare(b.service)).slice(0, 12);
}

export function priceLabel(item: CatalogItem): string {
  if (item.rate == null || !Number.isFinite(item.rate)) return "—";
  return `$${item.rate.toLocaleString("en-US", { maximumFractionDigits: 0 })}${item.unit ? ` / ${item.unit}` : ""}`;
}
