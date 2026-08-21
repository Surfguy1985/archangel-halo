/**
 * Grok Site Ops Bot — continuous on-site operations manager.
 *
 * Orchestrates: building-ops (presence), Halo Operator (dispatch),
 * Money Lock (exceptions), work-reviews health.
 * Money mutations stay vendor-side; bot never exposes payouts to Pulse/Portfolio.
 */
import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import { logger } from "./logger";
import { getBuildingOpsPlate } from "./getBuildingOpsPlate";
import { runHaloOperator, getOperatorStatus } from "./haloOperator";
import { runMoneyLock, listMoneyLockExceptions } from "./moneyLock";

export type SiteOpsBrief = {
  at: string;
  propertyId: string | null;
  propertyName: string | null;
  site: {
    headline: string;
    onSite: number;
    offSite: number;
    liveJobs: number;
    densestBuilding: number | null;
    byBuilding: Record<string, number>;
  } | null;
  dispatch: {
    scanned: number;
    autoLocked: number;
    exceptions: number;
    blocked: number;
  } | null;
  moneyLock: {
    exceptions: number;
    message?: string;
  } | null;
  actionsTaken: string[];
  recommendations: string[];
};

type BotState = {
  enabled: boolean;
  intervalMs: number;
  propertyId: string | null;
  lastBrief: SiteOpsBrief | null;
  lastRunAt: number;
  runCount: number;
  history: SiteOpsBrief[];
  timer: ReturnType<typeof setInterval> | null;
};

const state: BotState = {
  enabled: false,
  intervalMs: 5 * 60 * 1000,
  propertyId: process.env.SITE_OPS_PROPERTY_ID || null,
  lastBrief: null,
  lastRunAt: 0,
  runCount: 0,
  history: [],
  timer: null,
};

function pushHistory(b: SiteOpsBrief) {
  state.history.unshift(b);
  if (state.history.length > 40) state.history.length = 40;
}

/** One full ops cycle: site presence → operator pass → money-lock dry awareness. */
export async function runSiteOpsCycle(opts?: {
  propertyId?: string | null;
  dryRun?: boolean;
  operatorLimit?: number;
}): Promise<SiteOpsBrief> {
  const dryRun = opts?.dryRun === true;
  const propertyId = opts?.propertyId ?? state.propertyId;
  const actionsTaken: string[] = [];
  const recommendations: string[] = [];

  let propertyName: string | null = null;
  let site: SiteOpsBrief["site"] = null;

  if (propertyId) {
    try {
      const plate = await getBuildingOpsPlate(propertyId);
      if (plate) {
        propertyName = plate.propertyName;
        const densest = Object.entries(plate.byBuilding || {}).sort((a, b) => b[1] - a[1])[0];
        site = {
          headline: plate.summary.headline,
          onSite: plate.summary.onSite,
          offSite: plate.summary.offSite,
          liveJobs: plate.summary.liveJobs,
          densestBuilding: densest ? Number(densest[0]) : null,
          byBuilding: plate.byBuilding || {},
        };
        actionsTaken.push(`site_scan: ${plate.summary.headline}`);
        if (plate.summary.onSite === 0 && plate.summary.liveJobs > 0) {
          recommendations.push(
            `${plate.summary.liveJobs} live jobs but 0 crews on site — check check-ins / GPS`
          );
        }
        if (site.densestBuilding != null) {
          recommendations.push(
            `Densest activity: Building ${site.densestBuilding} — good focus for Site Twin`
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, "siteOpsBot site plate failed");
      recommendations.push("Site plate failed — is propertyId valid?");
    }
  } else {
    recommendations.push("Set propertyId (POST /api/site-ops-bot/config) for live site presence");
  }

  let dispatch: SiteOpsBrief["dispatch"] = null;
  try {
    const op = await runHaloOperator({
      dryRun,
      limit: opts?.operatorLimit ?? 80,
    });
    const ml = (op as any).moneyLock || (op as any).summary?.moneyLock || {};
    dispatch = {
      scanned: Number(ml.scanned ?? 0),
      autoLocked: Number(ml.autoApproved ?? 0),
      exceptions: Number(ml.exceptions ?? 0),
      blocked: Number(ml.blocked ?? 0),
    };
    actionsTaken.push(
      dryRun
        ? `operator_dry: scanned ${dispatch.scanned}`
        : `operator_run: locked ${dispatch.autoLocked}, exceptions ${dispatch.exceptions}, actions ${(op as any).actions?.length ?? 0}`
    );
    if (dispatch.exceptions > 0) {
      recommendations.push(
        `${dispatch.exceptions} dispatch exceptions need pricing/crew/invoice lines before auto-lock`
      );
    }
  } catch (err) {
    logger.warn({ err }, "siteOpsBot operator failed");
    recommendations.push("Halo Operator pass failed");
  }

  let moneyLock: SiteOpsBrief["moneyLock"] = null;
  try {
    if (!dryRun) {
      const ml = await runMoneyLock({ dryRun: true, limit: 80 });
      moneyLock = {
        exceptions: Number(ml.exceptions ?? 0),
        message: `dry-run scanned ${ml.scanned ?? 0}`,
      };
    } else {
      const ex = await listMoneyLockExceptions().catch(() => []);
      moneyLock = { exceptions: Array.isArray(ex) ? ex.length : 0 };
    }
    actionsTaken.push(`money_lock_awareness: ${moneyLock.exceptions} exceptions`);
  } catch (err) {
    logger.warn({ err }, "siteOpsBot money lock failed");
  }

  const brief: SiteOpsBrief = {
    at: new Date().toISOString(),
    propertyId: propertyId || null,
    propertyName,
    site,
    dispatch,
    moneyLock,
    actionsTaken,
    recommendations,
  };

  state.lastBrief = brief;
  state.lastRunAt = Date.now();
  state.runCount += 1;
  pushHistory(brief);
  logger.info(
    {
      propertyId,
      onSite: site?.onSite,
      exceptions: dispatch?.exceptions,
      dryRun,
    },
    "siteOpsBot cycle complete"
  );
  return brief;
}

export function getSiteOpsBotStatus() {
  return {
    ok: true,
    service: "site-ops-bot",
    version: 1,
    role: "Grok on-site operations manager",
    enabled: state.enabled,
    intervalMs: state.intervalMs,
    propertyId: state.propertyId,
    runCount: state.runCount,
    lastRunAt: state.lastRunAt ? new Date(state.lastRunAt).toISOString() : null,
    lastBrief: state.lastBrief,
    operator: getOperatorStatus(),
    policy: {
      autoOperatorPass: true,
      moneyLockAwarenessOnly: true,
      autoSendToInvoice: process.env.AUTO_SEND_TO_INVOICE === "true",
      continuous: state.enabled,
    },
  };
}

export function configureSiteOpsBot(opts: {
  propertyId?: string | null;
  intervalMs?: number;
  enabled?: boolean;
}) {
  if (opts.propertyId !== undefined) state.propertyId = opts.propertyId;
  if (opts.intervalMs != null && opts.intervalMs >= 30_000) {
    state.intervalMs = opts.intervalMs;
  }
  if (opts.enabled === true) startSiteOpsBot();
  if (opts.enabled === false) stopSiteOpsBot();
  return getSiteOpsBotStatus();
}

export function startSiteOpsBot() {
  if (state.timer) clearInterval(state.timer);
  state.enabled = true;
  state.timer = setInterval(() => {
    runSiteOpsCycle({ dryRun: false }).catch((err) =>
      logger.error({ err }, "siteOpsBot interval failed")
    );
  }, state.intervalMs);
  // kick once soon
  runSiteOpsCycle({ dryRun: false }).catch(() => {});
  logger.info({ intervalMs: state.intervalMs, propertyId: state.propertyId }, "siteOpsBot started");
  return getSiteOpsBotStatus();
}

export function stopSiteOpsBot() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.enabled = false;
  logger.info("siteOpsBot stopped");
  return getSiteOpsBotStatus();
}

export function getSiteOpsHistory(limit = 10) {
  return state.history.slice(0, limit);
}

/**
 * Natural-language command surface for Grok / Command chat.
 * Returns structured action + result (no free-form code exec).
 */
export async function siteOpsChat(message: string, propertyId?: string) {
  const msg = (message || "").toLowerCase().trim();
  const pid = propertyId || state.propertyId;

  if (!msg) {
    return { ok: false, reply: "Say what you want managed: status, run, start, stop, site, exceptions…" };
  }

  if (/\b(status|how are we|brief)\b/.test(msg)) {
    return { ok: true, reply: "Site Ops status", data: getSiteOpsBotStatus() };
  }
  if (/\b(start|enable|go continuous|always on)\b/.test(msg)) {
    if (pid) state.propertyId = pid;
    return { ok: true, reply: "Site Ops Bot continuous mode ON", data: startSiteOpsBot() };
  }
  if (/\b(stop|disable|pause)\b/.test(msg)) {
    return { ok: true, reply: "Site Ops Bot stopped", data: stopSiteOpsBot() };
  }
  if (/\b(run|scan|manage|cycle|sweep)\b/.test(msg)) {
    const brief = await runSiteOpsCycle({
      propertyId: pid,
      dryRun: /\bdry\b/.test(msg),
    });
    return {
      ok: true,
      reply: [
        brief.site?.headline || "Site scan done",
        brief.dispatch
          ? `Dispatch: scanned ${brief.dispatch.scanned}, locked ${brief.dispatch.autoLocked}, exceptions ${brief.dispatch.exceptions}`
          : null,
        ...(brief.recommendations || []),
      ]
        .filter(Boolean)
        .join(" · "),
      data: brief,
    };
  }
  if (/\b(site|crew|on.?site|presence|twin)\b/.test(msg)) {
    if (!pid) {
      return { ok: false, reply: "Set a propertyId first (config or mention property)" };
    }
    const plate = await getBuildingOpsPlate(pid);
    return {
      ok: true,
      reply: plate?.summary.headline || "No plate",
      data: plate
        ? {
            onSite: plate.summary.onSite,
            byBuilding: plate.byBuilding,
            presence: (plate.presence || []).filter((p) => p.onSite),
          }
        : null,
    };
  }
  if (/\b(exception|money.?lock|invoice|pricing)\b/.test(msg)) {
    const brief = await runSiteOpsCycle({ propertyId: pid, dryRun: true });
    return {
      ok: true,
      reply: `${brief.dispatch?.exceptions ?? "?"} exceptions · ${brief.moneyLock?.exceptions ?? "?"} money-lock flags`,
      data: brief,
    };
  }
  if (/\b(help|what can you)\b/.test(msg)) {
    return {
      ok: true,
      reply:
        "I manage on-site ops: presence, dispatch lock, exception triage. Commands: status | run | start | stop | site | exceptions",
      data: { commands: ["status", "run", "start", "stop", "site", "exceptions"] },
    };
  }

  // default: full cycle
  const brief = await runSiteOpsCycle({ propertyId: pid, dryRun: false });
  return {
    ok: true,
    reply: brief.site?.headline || "Ops cycle complete",
    data: brief,
  };
}

/** Resolve first property if none configured (demo convenience). */
export async function ensureDefaultProperty(): Promise<string | null> {
  if (state.propertyId) return state.propertyId;
  const rows = await db.select({ id: propertiesTable.id }).from(propertiesTable).limit(1);
  if (rows[0]?.id) {
    state.propertyId = rows[0].id;
    return rows[0].id;
  }
  return null;
}
