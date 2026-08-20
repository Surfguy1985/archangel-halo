/**
 * Portfolio Home — corporate property lens.
 * Aggregates Pulse-style status by property. ZERO money fields.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db, jobsTable, propertiesTable, crewPhotosTable } from "@workspace/db";
import { logger } from "./logger";

export type PortfolioPropertyCard = {
  propertyId: string;
  name: string;
  city: string | null;
  turning: number;
  waiting: number;
  done: number;
  blocked: number;
  total: number;
  health: "good" | "watch" | "attention";
  healthLabel: string;
  lat: number | null;
  lng: number | null;
};

export type PortfolioHomePayload = {
  ok: true;
  asOf: string;
  counts: {
    properties: number;
    turning: number;
    waiting: number;
    done: number;
    blocked: number;
  };
  headline: string;
  properties: PortfolioPropertyCard[];
};

function mapStatus(board?: string | null, status?: string | null): "turning" | "waiting" | "done" | "blocked" {
  const b = (board || status || "").toLowerCase();
  if (["completed", "complete", "done", "billing"].includes(b)) return "done";
  if (["hold", "blocked", "change_order", "waiting"].includes(b)) return "blocked";
  if (["filled", "scheduled", "in_progress", "active", "dispatched"].includes(b)) return "turning";
  if (["open", "reopened", "new", "backlog"].includes(b)) return "waiting";
  return "turning";
}

export async function buildPortfolioHome(opts?: { limitJobs?: number }): Promise<PortfolioHomePayload> {
  const limitJobs = opts?.limitJobs ?? 200;

  const props = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      city: (propertiesTable as any).city,
      lat: propertiesTable.latitude,
      lng: propertiesTable.longitude,
    })
    .from(propertiesTable)
    .orderBy(propertiesTable.name)
    .limit(80);

  const jobs = await db
    .select({
      id: jobsTable.id,
      propertyId: jobsTable.propertyId,
      boardStatus: jobsTable.boardStatus,
      status: jobsTable.status,
    })
    .from(jobsTable)
    .orderBy(desc(jobsTable.updatedAt))
    .limit(limitJobs);

  const byProp = new Map<
    string,
    { turning: number; waiting: number; done: number; blocked: number; total: number }
  >();

  for (const j of jobs) {
    if (!j.propertyId) continue;
    const bucket = mapStatus(j.boardStatus, j.status);
    const cur = byProp.get(j.propertyId) || { turning: 0, waiting: 0, done: 0, blocked: 0, total: 0 };
    cur[bucket]++;
    cur.total++;
    byProp.set(j.propertyId, cur);
  }

  // Include properties with activity first, then quiet ones with names
  const cards: PortfolioPropertyCard[] = [];
  for (const p of props) {
    const c = byProp.get(p.id) || { turning: 0, waiting: 0, done: 0, blocked: 0, total: 0 };
    let health: PortfolioPropertyCard["health"] = "good";
    let healthLabel = "On track";
    if (c.blocked > 0) {
      health = "attention";
      healthLabel = `${c.blocked} need attention`;
    } else if (c.turning > 0 || c.waiting > 0) {
      health = "watch";
      healthLabel = c.turning > 0 ? `${c.turning} turning` : `${c.waiting} waiting`;
    }
    cards.push({
      propertyId: p.id,
      name: p.name || "Property",
      city: p.city ?? null,
      ...c,
      health,
      healthLabel,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
    });
  }

  // Sort: attention → watch → good; within by blocked+turning
  cards.sort((a, b) => {
    const rank = { attention: 0, watch: 1, good: 2 };
    const d = rank[a.health] - rank[b.health];
    if (d !== 0) return d;
    return b.blocked + b.turning - (a.blocked + a.turning);
  });

  const counts = {
    properties: cards.length,
    turning: cards.reduce((s, c) => s + c.turning, 0),
    waiting: cards.reduce((s, c) => s + c.waiting, 0),
    done: cards.reduce((s, c) => s + c.done, 0),
    blocked: cards.reduce((s, c) => s + c.blocked, 0),
  };

  const attentionProps = cards.filter((c) => c.health === "attention").length;
  const headline =
    attentionProps > 0
      ? `${attentionProps} ${attentionProps === 1 ? "property needs" : "properties need"} attention`
      : counts.turning > 0
        ? `${counts.turning} units turning across ${counts.properties} properties`
        : counts.properties > 0
          ? `Portfolio clear · ${counts.properties} properties`
          : "No properties yet";

  return {
    ok: true,
    asOf: new Date().toISOString(),
    counts,
    headline,
    properties: cards,
  };
}
