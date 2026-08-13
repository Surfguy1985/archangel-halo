/**
 * PM live-link security + property isolation (pure, no I/O).
 *
 * Authorization → property scope → property-scoped query → model.
 * The model must never receive another property's rows.
 */

import { createHash, randomBytes } from "node:crypto";
import { pmLiveIdentity, type HaloIdentity } from "./enforcerCore";

export const PM_TOKEN_PREFIX = "pmlink_";
export const PM_MESSAGE_MAX_CHARS = 4_000;

export type PmLinkStatus = "valid" | "expired" | "revoked" | "malformed" | "not_found";

export interface PmLinkRecord {
  id: string;
  tokenHash: string;
  tokenPrefix: string;
  propertyId: string;
  permissions: { map: boolean; kanban: boolean; money: boolean };
  expiresAt: string;
  revokedAt: string | null;
  lastAccessedAt: string | null;
}

export interface PropertyFact {
  id: string;
  name: string;
  city: string;
  units: number;
  status: string;
}

export interface JobFact {
  id: string;
  unitNo: string | null;
  propertyId: string;
  status: string;
  boardStatus: string;
  crewLeaderId?: string | null;
  scheduledOn?: string | null;
  marginPct?: number | null;
}

export interface InvoiceFact {
  id: string;
  propertyId: string;
  amount: number;
  status: string;
}

export interface IsolatedSnapshot {
  date: string;
  hour: number;
  propertyId: string;
  propertyName: string;
  todayItems: Array<{ id: string; title: string; tier: string; queue: string; amount: number | null }>;
  properties: PropertyFact[];
  jobs: {
    total: number;
    open: number;
    overdue: number;
    uncrewed: number;
    overBudget: number;
    recentOpen: Array<{
      id: string;
      unitNo: string | null;
      propertyId: string;
      status: string;
      boardStatus: string;
    }>;
  };
  invoices: {
    totalReceivables: number;
    overdueCount: number;
    sentCount: number;
    pendingCrewPay: number;
  };
  crews: { total: number; checkedInToday: number };
  margin: { avgMarginPct: number | null; flaggedCount: number };
  falkonMode: string;
}

export function mintPmToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = PM_TOKEN_PREFIX + randomBytes(24).toString("hex");
  return { token, tokenHash: hashPmToken(token), tokenPrefix: token.slice(0, 14) };
}

export function hashPmToken(token: string): string {
  return createHash("sha256").update(`halo-pm-live:${token}`).digest("hex");
}

export function classifyPmTokenShape(token: unknown): "ok" | "malformed" {
  if (typeof token !== "string") return "malformed";
  const t = token.trim();
  if (!t || t.length > 128) return "malformed";
  if (t.includes("/") || t.includes("..") || t.includes("\0")) return "malformed";
  if (!/^pmlink_[0-9a-f]+$/i.test(t)) return "malformed";
  if (t.length < PM_TOKEN_PREFIX.length + 16) return "malformed";
  return "ok";
}

export function evaluatePmLink(
  token: unknown,
  record: PmLinkRecord | null,
  now: Date,
): { status: PmLinkStatus; link?: PmLinkRecord; identity?: HaloIdentity } {
  if (classifyPmTokenShape(token) === "malformed") return { status: "malformed" };
  if (!record) return { status: "not_found" };
  if (record.revokedAt) return { status: "revoked" };
  if (new Date(record.expiresAt).getTime() <= now.getTime()) return { status: "expired" };
  return {
    status: "valid",
    link: record,
    identity: pmLiveIdentity(record.propertyId),
  };
}

export function parsePmChatMessage(body: unknown): { ok: true; message: string } | { ok: false; error: string } {
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message !== "string" || !message.trim()) return { ok: false, error: "message required" };
  if (message.length > PM_MESSAGE_MAX_CHARS) return { ok: false, error: "message too long" };
  return { ok: true, message: message.trim() };
}

/**
 * Build the ONLY data the model may see for a PM live session.
 * Callers must pass rows already queried with WHERE property_id = this property.
 * Foreign rows are dropped, not trusted.
 */
export function buildIsolatedSnapshot(input: {
  now: Date;
  property: PropertyFact;
  jobs: JobFact[];
  invoices: InvoiceFact[];
  crewsOnSite: number;
  permissions: { map: boolean; kanban: boolean; money: boolean };
  falkonMode?: string;
}): IsolatedSnapshot {
  const propertyId = input.property.id;
  const jobs = input.jobs.filter((j) => j.propertyId === propertyId);
  const invoices = input.invoices.filter((i) => i.propertyId === propertyId);
  const todayStr = input.now.toISOString().slice(0, 10);
  const openStatuses = ["open", "pending", "scheduled", "in_progress", "active"];
  const openJobs = jobs.filter((j) => openStatuses.includes(j.status) || openStatuses.includes(j.boardStatus));
  const overdueJobs = openJobs.filter((j) => j.scheduledOn && j.scheduledOn < todayStr);
  const uncrewedJobs = openJobs.filter((j) => !j.crewLeaderId);
  const overBudgetJobs = jobs.filter((j) => typeof j.marginPct === "number" && (j.marginPct as number) < 0.25);
  const money = input.permissions.money === true;
  const receivables = invoices.filter((i) => i.status === "sent" || i.status === "overdue");
  const margins = jobs.filter((j) => typeof j.marginPct === "number").map((j) => j.marginPct as number);

  return {
    date: todayStr,
    hour: input.now.getHours(),
    propertyId,
    propertyName: input.property.name,
    todayItems: [],
    properties: [
      {
        id: input.property.id,
        name: input.property.name,
        city: input.property.city,
        units: input.property.units,
        status: input.property.status,
      },
    ],
    jobs: {
      total: jobs.length,
      open: openJobs.length,
      overdue: overdueJobs.length,
      uncrewed: uncrewedJobs.length,
      overBudget: overBudgetJobs.length,
      recentOpen: openJobs.slice(0, 8).map((j) => ({
        id: j.id,
        unitNo: j.unitNo ?? null,
        propertyId,
        status: j.status,
        boardStatus: j.boardStatus,
      })),
    },
    invoices: {
      totalReceivables: money ? receivables.reduce((s, i) => s + (i.amount ?? 0), 0) : 0,
      overdueCount: money ? invoices.filter((i) => i.status === "overdue").length : 0,
      sentCount: money ? receivables.length : 0,
      pendingCrewPay: 0,
    },
    crews: { total: input.crewsOnSite, checkedInToday: input.crewsOnSite },
    margin: {
      avgMarginPct: money && margins.length ? margins.reduce((s, m) => s + m, 0) / margins.length : null,
      flaggedCount: money ? overBudgetJobs.length : 0,
    },
    falkonMode: input.falkonMode ?? "SHADOW",
  };
}

export function snapshotLeaksProperty(
  snapshot: IsolatedSnapshot,
  foreignPropertyId: string,
  foreignName?: string,
): boolean {
  const blob = JSON.stringify(snapshot).toLowerCase();
  if (snapshot.propertyId === foreignPropertyId) return true;
  if (snapshot.properties.some((p) => p.id === foreignPropertyId)) return true;
  if (snapshot.jobs.recentOpen.some((j) => j.propertyId === foreignPropertyId)) return true;
  if (foreignName && blob.includes(foreignName.toLowerCase())) return true;
  return blob.includes(foreignPropertyId.toLowerCase());
}

export function pmSystemPrompt(snapshot: IsolatedSnapshot): string {
  const p = snapshot.properties[0];
  return `You are HALO answering a property manager over a read-only live link.
You may discuss ONLY this property: ${p?.name ?? snapshot.propertyName} (id ${snapshot.propertyId}).
You have no data about any other property. If asked about another site, say you can only see this property.
You cannot create jobs, assign crews, change schedules, send invoices, change pricing, start or approve payments, or edit operational data.
Live snapshot (${snapshot.date}): ${snapshot.jobs.open} open jobs, ${snapshot.crews.checkedInToday} crews on site.
Units: ${p?.units ?? 0}. City: ${p?.city ?? ""}.`;
}
