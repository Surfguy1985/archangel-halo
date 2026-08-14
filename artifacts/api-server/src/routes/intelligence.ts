/**
 * GET /api/command/intelligence
 *
 * Returns a structured operational briefing for the HALO Intelligence View —
 * a predictive AI summary (Claude Opus-5) plus live metrics, attention items,
 * active jobs, and open invoices.  Cached in-process for 90 s to avoid
 * hammering the AI on every panel load.
 */

import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  db, jobsTable, invoicesTable, propertiesTable,
  crewsTable, crewCheckinsTable,
} from "@workspace/db";
import { eq, and, inArray, gte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { computeQueues } from "../lib/queues";

const router = Router();

// ─── In-process cache (90 s) ─────────────────────────────────────────────────
let cached: { ts: number; data: IntelligencePayload } | null = null;
const CACHE_TTL = 90_000;

// ─── Types ────────────────────────────────────────────────────────────────────
interface IntelligencePayload {
  briefing: string;
  metrics: {
    activeJobs: number;
    pendingRevenue: number;
    crewOnSite: number;
    urgentCount: number;
    overdueInvoices: number;
  };
  attention: Array<{ id: string; text: string; severity: "urgent" | "warning" | "info"; category: string }>;
  jobs: Array<{
    id: string; title: string; status: string;
    propertyName: string; scheduledOn: string | null;
    crewName: string | null; marginPct: number | null;
  }>;
  invoices: Array<{
    id: string; invoiceNo: string; amount: number | null;
    status: string; propertyName: string; dueAt: string | null;
  }>;
}

// ─── Predictive briefing (Claude Opus-5) ────────────────────────────────────
async function generateBriefing(summary: string): Promise<string> {
  try {
    const resp = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 512,
      system: `You are HALO — an elite operational AI for a property management company.
Given this live business snapshot, write a concise 2–3 sentence predictive briefing for the office manager.
Be specific: cite real numbers. Surface the single most critical risk AND the highest-value opportunity visible right now.
Tone: calm, precise, executive. No filler phrases like "It looks like" or "It seems". Start directly.`,
      messages: [{ role: "user", content: summary }],
    });
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    return text || "All systems nominal. No critical items detected at this time.";
  } catch (err) {
    logger.warn({ err }, "intelligence: briefing AI call failed");
    return "HALO is monitoring all systems. Check attention items below for priority actions.";
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────
router.get("/command/intelligence", async (_req, res): Promise<void> => {
  try {
    // Return cached payload if fresh
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.json(cached.data);
      return;
    }

    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const todayMidnight = new Date(`${todayStr}T00:00:00`);

    const OPEN = ["open", "pending", "scheduled", "in_progress", "active"];

    const [props, jobs, invoices, checkins, crews, { feed }] = await Promise.all([
      db.select({ id: propertiesTable.id, name: propertiesTable.name }).from(propertiesTable),
      db.select({
        id: jobsTable.id, jobNo: jobsTable.jobNo, description: jobsTable.description,
        status: jobsTable.status, propertyId: jobsTable.propertyId,
        crewLeaderId: jobsTable.crewLeaderId, scheduledOn: jobsTable.scheduledOn,
        marginPct: jobsTable.marginPct, boardStatus: jobsTable.boardStatus,
      }).from(jobsTable).where(inArray(jobsTable.status, OPEN)),
      db.select({
        id: invoicesTable.id, invoiceNo: invoicesTable.invoiceNo, amount: invoicesTable.amount,
        status: invoicesTable.status, propertyId: invoicesTable.propertyId,
        dueAt: invoicesTable.dueAt,
      }).from(invoicesTable).where(inArray(invoicesTable.status, ["sent", "overdue", "draft"])),
      db.select({ crewId: crewCheckinsTable.crewId })
        .from(crewCheckinsTable)
        .where(and(eq(crewCheckinsTable.kind, "checkin"), gte(crewCheckinsTable.createdAt, todayMidnight))),
      db.select({ id: crewsTable.id, name: crewsTable.name }).from(crewsTable),
      computeQueues(),
    ]);

    const propMap = new Map(props.map((p) => [p.id, p.name]));
    const crewMap = new Map(crews.map((c) => [c.id, c.name]));
    const crewOnSite = new Set(checkins.map((c) => c.crewId)).size;

    const overdue = invoices.filter((i) => i.status === "overdue");
    const pending = invoices.filter((i) => i.status === "sent");
    const pendingRevenue = pending.reduce((s, i) => s + (i.amount ?? 0), 0);
    const overdueAmount = overdue.reduce((s, i) => s + (i.amount ?? 0), 0);

    const overdueJobs = jobs.filter(
      (j) => j.scheduledOn && j.scheduledOn < todayStr,
    );
    const uncrewedJobs = jobs.filter((j) => !j.crewLeaderId);
    const thinMarginJobs = jobs.filter(
      (j) => typeof j.marginPct === "number" && j.marginPct < 0.25,
    );

    const urgentFeed = feed.filter((f) => f.tier === "now" || f.tier === "urgent");

    // ── Attention items ───────────────────────────────────────────────────────
    const attention: IntelligencePayload["attention"] = [];

    if (overdue.length > 0) {
      attention.push({
        id: "overdue-invoices",
        text: `${overdue.length} overdue invoice${overdue.length !== 1 ? "s" : ""} totalling $${Math.round(overdueAmount).toLocaleString()}`,
        severity: "urgent",
        category: "Billing",
      });
    }
    const jobLabel = (j: { jobNo: string; description: string | null; id: string }) =>
      j.description ? j.description.slice(0, 50) : j.jobNo;

    overdueJobs.forEach((j) => {
      attention.push({
        id: `job-overdue-${j.id}`,
        text: `Job "${jobLabel(j)}" at ${propMap.get(j.propertyId ?? "") ?? "Unknown"} is past scheduled date`,
        severity: "urgent",
        category: "Operations",
      });
    });
    uncrewedJobs.slice(0, 3).forEach((j) => {
      attention.push({
        id: `job-uncrewed-${j.id}`,
        text: `"${jobLabel(j)}" has no crew assigned`,
        severity: "warning",
        category: "Staffing",
      });
    });
    thinMarginJobs.slice(0, 2).forEach((j) => {
      attention.push({
        id: `margin-${j.id}`,
        text: `"${jobLabel(j)}" margin at ${Math.round((j.marginPct ?? 0) * 100)}% — below floor`,
        severity: "warning",
        category: "Finance",
      });
    });
    urgentFeed.slice(0, 3).forEach((f) => {
      attention.push({
        id: `feed-${f.id}`,
        text: f.title,
        severity: f.tier === "now" ? "urgent" : "warning",
        category: f.queue ?? "General",
      });
    });
    if (crewOnSite > 0 && checkins.length === 0) {
      attention.push({
        id: "no-checkins",
        text: "No crew check-ins recorded today",
        severity: "info",
        category: "Field",
      });
    }

    // ── Jobs for UI ───────────────────────────────────────────────────────────
    const jobCards: IntelligencePayload["jobs"] = jobs.slice(0, 8).map((j) => ({
      id: j.id,
      title: j.description ? j.description.slice(0, 60) : j.jobNo,
      status: j.status,
      propertyName: propMap.get(j.propertyId ?? "") ?? "—",
      scheduledOn: j.scheduledOn ?? null,
      crewName: j.crewLeaderId ? (crewMap.get(j.crewLeaderId) ?? null) : null,
      marginPct: typeof j.marginPct === "number" ? j.marginPct : null,
    }));

    // ── Invoices for UI ───────────────────────────────────────────────────────
    const invoiceCards: IntelligencePayload["invoices"] = invoices
      .filter((i) => i.status !== "draft")
      .slice(0, 8)
      .map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        amount: i.amount ?? null,
        status: i.status,
        propertyName: propMap.get(i.propertyId ?? "") ?? "—",
        dueAt: i.dueAt ? i.dueAt.toISOString().slice(0, 10) : null,
      }));

    // ── Build briefing prompt ─────────────────────────────────────────────────
    const summaryText = [
      `Date: ${todayStr}`,
      `Active jobs: ${jobs.length} (${overdueJobs.length} overdue, ${uncrewedJobs.length} uncrewed)`,
      `Crew on site today: ${crewOnSite}`,
      `Open invoices: ${pending.length} pending ($${Math.round(pendingRevenue).toLocaleString()}), ${overdue.length} overdue ($${Math.round(overdueAmount).toLocaleString()})`,
      `Thin-margin jobs: ${thinMarginJobs.length}`,
      `Urgent feed items: ${urgentFeed.length}`,
      ...(overdueJobs.length > 0 ? [`Overdue jobs: ${overdueJobs.slice(0, 3).map((j) => j.description ?? j.jobNo).join(", ")}`] : []),
    ].join("\n");

    const briefing = await generateBriefing(summaryText);

    const payload: IntelligencePayload = {
      briefing,
      metrics: {
        activeJobs: jobs.length,
        pendingRevenue,
        crewOnSite,
        urgentCount: attention.filter((a) => a.severity === "urgent").length,
        overdueInvoices: overdue.length,
      },
      attention: attention.slice(0, 10),
      jobs: jobCards,
      invoices: invoiceCards,
    };

    cached = { ts: Date.now(), data: payload };
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "intelligence: failed");
    res.status(500).json({ error: "Intelligence fetch failed" });
  }
});

export default router;
