import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  propertiesTable,
  propertyMapsTable,
  propertyUnitsTable,
  clientHubItemsTable,
  jobsTable,
  crewsTable,
  crewCheckinsTable,
  crewPhotosTable,
  invoicesTable,
  invoiceLineItemsTable,
  workRequestsTable,
  jobSummariesTable,
  recapSharesTable,
  notificationsTable,
  activitiesTable,
  type PropertyUnit,
  type ClientHubItem,
  type Job,
} from "@workspace/db";
import {
  GetUnitMapResponse,
  UploadUnitMapImageBody,
  GenerateUnitGridBody,
  CreateUnitBoxBody,
  CreateUnitBoxResponse,
  UpdateUnitBoxBody,
  GetUnitSummaryResponse,
  GetClientHubResponse,
  CreateHubItemBody,
  CreateHubItemResponse,
  UpdateHubItemBody,
  ContactMaintenanceBody,
  ContactMaintenanceResponse,
} from "@workspace/api-zod";
import { resolveViewer, requireWriter, type Viewer } from "./clientBoard";
import { completeText, completeJsonWithImage } from "../lib/ai";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const OFFICE_VIEWER: Viewer = {
  authenticated: true,
  name: "Office",
  email: null,
  role: "office",
  permissions: [],
  readOnly: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function accountByToken(token: string) {
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.dashboardToken, token))
    .limit(1);
  if (!account || account.status !== "active") return undefined;
  return account;
}

/** Resolve (propertyId, viewer) for either mount: token (client) or propertyId (office). */
async function resolveScope(
  req: Request,
  res: Response,
): Promise<{ propertyId: string; viewer: Viewer } | undefined> {
  if (req.params.token) {
    const account = await accountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return undefined;
    }
    return { propertyId: account.propertyId, viewer: await resolveViewer(req, account.propertyId) };
  }
  const propertyId = String(req.params.propertyId);
  if (!UUID_RE.test(propertyId)) {
    res.status(404).json({ error: "Property not found" });
    return undefined;
  }
  const [prop] = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  if (!prop) {
    res.status(404).json({ error: "Property not found" });
    return undefined;
  }
  return { propertyId, viewer: OFFICE_VIEWER };
}

function denyIfReadOnly(viewer: Viewer, res: Response): boolean {
  const denied = requireWriter(viewer);
  if (denied) {
    res.status(403).json({ error: denied });
    return true;
  }
  return false;
}

function storageUrl(path: string): string {
  // Manual /api asset links must be absolute — never BASE_URL-prefixed.
  return `/api/storage${path}`;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function serUnit(u: PropertyUnit) {
  return { id: u.id, label: u.label, x: u.x, y: u.y, w: u.w, h: u.h };
}

// ---------------------------------------------------------------------------
// Status engine — map HALO activity to red / yellow / green per unit.
// Matching key: normalized unit label vs jobs.unitNo, work_requests.unitNo,
// invoice line items' unitNo, and job summaries' unitNumber.
// ---------------------------------------------------------------------------
export function normUnit(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(unit|apt|apartment|#)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

type UnitStatus = {
  status: "red" | "yellow" | "green";
  reasons: string[];
  openJobs: number;
  openInvoices: number;
};

const OPEN_JOB = (j: Job) => j.status !== "cancelled" && j.status !== "complete" && !j.clearedAt && !j.completedAt;

export async function computeUnitStatuses(
  propertyId: string,
): Promise<{ byUnit: Map<string, UnitStatus>; display: Map<string, string> }> {
  // Remember the first raw label seen for each normalized key so units that
  // only exist in HALO data (jobs/requests/invoices) can be materialized.
  const display = new Map<string, string>();
  const keyOf = (raw: string | null | undefined): string => {
    const k = normUnit(raw);
    if (k && !display.has(k)) display.set(k, String(raw).trim());
    return k;
  };
  const [jobs, requests, invoices, summaries] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.propertyId, propertyId)),
    db.select().from(workRequestsTable).where(eq(workRequestsTable.propertyId, propertyId)),
    db.select().from(invoicesTable).where(eq(invoicesTable.propertyId, propertyId)),
    db.select().from(jobSummariesTable).where(eq(jobSummariesTable.propertyId, propertyId)),
  ]);
  const invoiceIds = invoices.map((i) => i.id);
  const lineItems = invoiceIds.length
    ? await db
        .select()
        .from(invoiceLineItemsTable)
        .where(inArray(invoiceLineItemsTable.invoiceId, invoiceIds))
    : [];

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  // invoice -> unit keys (via its own line items and via its job's unitNo)
  const invoiceUnits = new Map<string, Set<string>>();
  for (const inv of invoices) {
    const set = new Set<string>();
    const job = inv.jobId ? jobById.get(inv.jobId) : undefined;
    if (job?.unitNo) set.add(keyOf(job.unitNo));
    invoiceUnits.set(inv.id, set);
  }
  for (const li of lineItems) {
    if (!li.unitNo) continue;
    invoiceUnits.get(li.invoiceId)?.add(keyOf(li.unitNo));
  }
  const summaryByJob = new Map(summaries.map((s) => [s.jobId, s]));

  const byUnit = new Map<string, UnitStatus>();
  const get = (key: string): UnitStatus => {
    let s = byUnit.get(key);
    if (!s) {
      s = { status: "green", reasons: [], openJobs: 0, openInvoices: 0 };
      byUnit.set(key, s);
    }
    return s;
  };
  const raise = (s: UnitStatus, level: "yellow" | "red", reason: string) => {
    if (level === "red") s.status = "red";
    else if (s.status !== "red") s.status = "yellow";
    if (!s.reasons.includes(reason)) s.reasons.push(reason);
  };

  const now = Date.now();
  const DAY = 86_400_000;

  for (const job of jobs) {
    const key = keyOf(job.unitNo);
    if (!key) continue;
    const s = get(key);
    if (OPEN_JOB(job)) {
      s.openJobs += 1;
      raise(s, "yellow", job.scheduledOn ? `Job ${job.jobNo} scheduled` : `Job ${job.jobNo} open`);
      if (job.scheduleType === "flex" && job.flexDueBy && new Date(`${job.flexDueBy}T23:59:59`) < new Date()) {
        raise(s, "red", `Job ${job.jobNo} past its due-by date`);
      }
    }
    // Completed but inspection never passed — needs attention.
    if (job.inspectionRequired && job.completedAt && !job.inspectionPassedAt && !job.clearedAt) {
      raise(s, "red", `Job ${job.jobNo} awaiting inspection`);
    }
    const summary = summaryByJob.get(job.id);
    if (summary && (job.completedAt ? now - new Date(job.completedAt).getTime() < 30 * DAY : true)) {
      const flagged = (summary.flags ?? []).filter((f) => f.checked);
      if (summary.overallResult === "followup" || flagged.length) {
        raise(s, "red", flagged[0]?.label ? `Flagged: ${flagged[0].label}` : "Recap flagged for follow-up");
      }
    }
  }

  for (const wr of requests) {
    const key = keyOf(wr.unitNo);
    if (!key || wr.status !== "pending") continue;
    raise(get(key), "yellow", `Work request pending: ${wr.serviceLabel}`);
  }

  for (const inv of invoices) {
    if (inv.status === "paid" || inv.status === "cancelled" || inv.status === "draft") continue;
    const keys = invoiceUnits.get(inv.id);
    if (!keys?.size) continue;
    const pastDue = inv.dueAt && new Date(inv.dueAt).getTime() < now;
    for (const key of keys) {
      const s = get(key);
      s.openInvoices += 1;
      if (pastDue) raise(s, "red", `Invoice ${inv.invoiceNo} past due`);
      else raise(s, "yellow", `Invoice ${inv.invoiceNo} pending`);
    }
  }

  return { byUnit, display };
}

const UNIT_TEMPLATE_SLOTS = 50;

async function unitMapView(propertyId: string, viewer: Viewer, extracted?: number) {
  const [[prop], [map], unitsInitial, { byUnit: statuses, display }] = await Promise.all([
    db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId)).limit(1),
    db.select().from(propertyMapsTable).where(eq(propertyMapsTable.propertyId, propertyId)).limit(1),
    db
      .select()
      .from(propertyUnitsTable)
      .where(eq(propertyUnitsTable.propertyId, propertyId))
      .orderBy(asc(propertyUnitsTable.label)),
    computeUnitStatuses(propertyId),
  ]);

  // Materialize units that only exist in HALO data (jobs, requests, invoices)
  // so the standard box template picks them up automatically. Capped at the
  // 50-slot template.
  let units = unitsInitial;
  const known = new Set(units.map((u) => normUnit(u.label)));
  const missing = [...display.entries()].filter(([key]) => !known.has(key));
  const room = UNIT_TEMPLATE_SLOTS - units.length;
  if (missing.length && room > 0) {
    // Stagger default coordinates in a 10-column grid so auto-created units
    // don't stack at (0,0) on the office map canvas.
    const startIdx = units.length;
    await db
      .insert(propertyUnitsTable)
      .values(
        missing.slice(0, room).map(([, label], i) => {
          const slot = startIdx + i;
          return {
            propertyId,
            label,
            x: clamp01((slot % 10) * 0.1 + 0.005),
            y: clamp01(Math.floor(slot / 10) * 0.1 + 0.005),
            w: 0.09,
            h: 0.08,
          };
        }),
      )
      .onConflictDoNothing();
    units = await db
      .select()
      .from(propertyUnitsTable)
      .where(eq(propertyUnitsTable.propertyId, propertyId))
      .orderBy(asc(propertyUnitsTable.label));
  }

  return {
    propertyName: prop?.name ?? "Your property",
    imageUrl: map?.imagePath ? storageUrl(map.imagePath) : null,
    canEdit: viewer.authenticated && !viewer.readOnly,
    unitTarget: prop?.units ?? null,
    extracted: extracted ?? null,
    units: units.map((u) => {
      const s = statuses.get(normUnit(u.label));
      return {
        ...serUnit(u),
        status: s?.status ?? "green",
        reasons: s?.reasons ?? [],
        openJobs: s?.openJobs ?? 0,
        openInvoices: s?.openInvoices ?? 0,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Unit map routes (registered on both mounts via registerScoped below)
// ---------------------------------------------------------------------------
async function handleGetUnitMap(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(req, res);
  if (!scope) return;
  res.json(GetUnitMapResponse.parse(await unitMapView(scope.propertyId, scope.viewer)));
}

type ExtractedBox = { label?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown };

async function extractUnitsFromImage(
  objectPath: string,
  contentType: string | null | undefined,
): Promise<{ label: string; x: number; y: number; w: number; h: number }[]> {
  const file = await objectStorage.getObjectEntityFile(objectPath);
  const response = await objectStorage.downloadObject(file);
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > 8_000_000) throw new Error("Image too large for extraction");
  const headerType = response.headers.get("content-type");
  const mediaType = ([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ].find((t) => t === contentType || t === headerType) ?? "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/gif";
  const raw = await completeJsonWithImage<ExtractedBox[]>(
    `You extract unit layouts from property site plans / maps for a box-grid dashboard.
Identify every distinct unit, apartment, suite, or building-unit visible on the map.
For each, return its label exactly as printed (e.g. "101", "A-3", "Bldg 2 Unit 4") and a bounding box
as FRACTIONS of the full image: x, y = top-left corner (0..1), w, h = width/height (0..1).
Keep boxes small and centered on each unit. Return at most 300 units. If the image is not a
property map or has no distinguishable units, return [].`,
    "Extract the unit boxes from this property map as a JSON array of {label, x, y, w, h}.",
    buf.toString("base64"),
    mediaType,
  );
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: { label: string; x: number; y: number; w: number; h: number }[] = [];
  for (const b of raw.slice(0, 300)) {
    const label = String(b?.label ?? "").trim().slice(0, 40);
    const x = Number(b?.x), y = Number(b?.y), w = Number(b?.w), h = Number(b?.h);
    if (!label || ![x, y, w, h].every(Number.isFinite)) continue;
    const key = normUnit(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      label,
      x: clamp01(x),
      y: clamp01(y),
      w: Math.min(1, Math.max(0.01, w)),
      h: Math.min(1, Math.max(0.01, h)),
    });
  }
  return out;
}

async function handleUploadImage(req: Request, res: Response): Promise<void> {
  const parsed = UploadUnitMapImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (denyIfReadOnly(scope.viewer, res)) return;
  const objectPath = parsed.data.objectPath.trim();
  if (!objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "objectPath must come from the upload flow" });
    return;
  }
  await db
    .insert(propertyMapsTable)
    .values({ propertyId: scope.propertyId, imagePath: objectPath })
    .onConflictDoUpdate({
      target: propertyMapsTable.propertyId,
      set: { imagePath: objectPath, updatedAt: new Date() },
    });

  // AI-assisted extraction — best-effort. A failed extraction never fails the
  // upload; the client still has the manual editor and grid fallback.
  let extracted = 0;
  if (parsed.data.extract !== false) {
    try {
      const boxes = await extractUnitsFromImage(objectPath, parsed.data.contentType);
      if (boxes.length) {
        const existing = await db
          .select()
          .from(propertyUnitsTable)
          .where(eq(propertyUnitsTable.propertyId, scope.propertyId));
        const have = new Set(existing.map((u) => normUnit(u.label)));
        const fresh = boxes.filter((b) => !have.has(normUnit(b.label)));
        if (fresh.length) {
          await db
            .insert(propertyUnitsTable)
            .values(fresh.map((b) => ({ propertyId: scope.propertyId, ...b })));
          extracted = fresh.length;
        }
      }
    } catch (err) {
      req.log.warn({ err }, "Unit extraction from map image failed");
    }
  }
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: scope.propertyId,
    kind: "note",
    body: `Property map uploaded${extracted ? ` — ${extracted} units auto-extracted` : ""} (${scope.viewer.name ?? "client"})`,
  });
  res.json(GetUnitMapResponse.parse(await unitMapView(scope.propertyId, scope.viewer, extracted)));
}

async function handleGenerateGrid(req: Request, res: Response): Promise<void> {
  const parsed = GenerateUnitGridBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (denyIfReadOnly(scope.viewer, res)) return;
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, scope.propertyId))
    .limit(1);
  const count = Math.min(400, Math.max(1, Math.round(parsed.data.count ?? prop?.units ?? 0)));
  if (!count) {
    res.status(400).json({ error: "How many units? Set a count or the property's unit total first." });
    return;
  }
  if (parsed.data.replace) {
    await db.delete(propertyUnitsTable).where(eq(propertyUnitsTable.propertyId, scope.propertyId));
  }
  const existing = await db
    .select()
    .from(propertyUnitsTable)
    .where(eq(propertyUnitsTable.propertyId, scope.propertyId));
  const have = new Set(existing.map((u) => normUnit(u.label)));
  const startAt = Math.max(1, Math.round(parsed.data.startAt ?? 101));
  const cols = Math.ceil(Math.sqrt(count * 1.6)); // wider than tall
  const rows = Math.ceil(count / cols);
  const gap = 0.012;
  const w = (1 - gap * (cols + 1)) / cols;
  const h = (1 - gap * (rows + 1)) / rows;
  const values: (typeof propertyUnitsTable.$inferInsert)[] = [];
  for (let i = 0; i < count; i++) {
    const label = String(startAt + i);
    if (have.has(normUnit(label))) continue;
    const col = i % cols;
    const row = Math.floor(i / cols);
    values.push({
      propertyId: scope.propertyId,
      label,
      x: gap + col * (w + gap),
      y: gap + row * (h + gap),
      w,
      h,
    });
  }
  if (values.length) await db.insert(propertyUnitsTable).values(values);
  res.json(GetUnitMapResponse.parse(await unitMapView(scope.propertyId, scope.viewer)));
}

async function handleCreateUnit(req: Request, res: Response): Promise<void> {
  const parsed = CreateUnitBoxBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (denyIfReadOnly(scope.viewer, res)) return;
  const label = parsed.data.label.trim().slice(0, 40);
  if (!label) {
    res.status(400).json({ error: "Label is required" });
    return;
  }
  const existing = await db
    .select()
    .from(propertyUnitsTable)
    .where(eq(propertyUnitsTable.propertyId, scope.propertyId));
  if (existing.some((u) => normUnit(u.label) === normUnit(label))) {
    res.status(409).json({ error: `Unit "${label}" is already on the map` });
    return;
  }
  const [row] = await db
    .insert(propertyUnitsTable)
    .values({
      propertyId: scope.propertyId,
      label,
      x: clamp01(parsed.data.x ?? 0.02),
      y: clamp01(parsed.data.y ?? 0.02),
      w: Math.min(1, Math.max(0.01, parsed.data.w ?? 0.1)),
      h: Math.min(1, Math.max(0.01, parsed.data.h ?? 0.08)),
    })
    .returning();
  res.status(201).json(CreateUnitBoxResponse.parse(serUnit(row!)));
}

async function handleUpdateUnit(req: Request, res: Response): Promise<void> {
  const parsed = UpdateUnitBoxBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (denyIfReadOnly(scope.viewer, res)) return;
  const [unit] = await db
    .select()
    .from(propertyUnitsTable)
    .where(
      and(
        eq(propertyUnitsTable.id, String(req.params.unitId)),
        eq(propertyUnitsTable.propertyId, scope.propertyId),
      ),
    )
    .limit(1);
  if (!unit) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  const body = parsed.data;
  let label = unit.label;
  if (body.label != null && body.label.trim()) {
    label = body.label.trim().slice(0, 40);
    if (normUnit(label) !== normUnit(unit.label)) {
      const siblings = await db
        .select()
        .from(propertyUnitsTable)
        .where(eq(propertyUnitsTable.propertyId, scope.propertyId));
      if (siblings.some((u) => u.id !== unit.id && normUnit(u.label) === normUnit(label))) {
        res.status(409).json({ error: `Unit "${label}" is already on the map` });
        return;
      }
    }
  }
  const [row] = await db
    .update(propertyUnitsTable)
    .set({
      label,
      x: body.x != null ? clamp01(body.x) : unit.x,
      y: body.y != null ? clamp01(body.y) : unit.y,
      w: body.w != null ? Math.min(1, Math.max(0.01, body.w)) : unit.w,
      h: body.h != null ? Math.min(1, Math.max(0.01, body.h)) : unit.h,
      updatedAt: new Date(),
    })
    .where(eq(propertyUnitsTable.id, unit.id))
    .returning();
  res.json(CreateUnitBoxResponse.parse(serUnit(row!)));
}

async function handleDeleteUnit(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (denyIfReadOnly(scope.viewer, res)) return;
  const deleted = await db
    .delete(propertyUnitsTable)
    .where(
      and(
        eq(propertyUnitsTable.id, String(req.params.unitId)),
        eq(propertyUnitsTable.propertyId, scope.propertyId),
      ),
    )
    .returning();
  if (!deleted.length) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  res.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Unit summary — live facts + AI-composed narrative + smart links
// ---------------------------------------------------------------------------
async function handleUnitSummary(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(req, res);
  if (!scope) return;
  const [unit] = await db
    .select()
    .from(propertyUnitsTable)
    .where(
      and(
        eq(propertyUnitsTable.id, String(req.params.unitId)),
        eq(propertyUnitsTable.propertyId, scope.propertyId),
      ),
    )
    .limit(1);
  if (!unit) {
    res.status(404).json({ error: "Unit not found" });
    return;
  }
  const key = normUnit(unit.label);
  const { byUnit: statuses } = await computeUnitStatuses(scope.propertyId);
  const status = statuses.get(key) ?? { status: "green" as const, reasons: [], openJobs: 0, openInvoices: 0 };

  const jobs = (
    await db.select().from(jobsTable).where(eq(jobsTable.propertyId, scope.propertyId))
  ).filter((j) => normUnit(j.unitNo) === key);
  const jobIds = jobs.map((j) => j.id);
  const now = Date.now();
  const DAY = 86_400_000;
  const recentJobs = jobs.filter(
    (j) => OPEN_JOB(j) || (j.completedAt && now - new Date(j.completedAt).getTime() < 60 * DAY),
  );

  const [crews, checkins, photos, summaries, recaps, invoices, requests] = await Promise.all([
    (() => {
      const ids = [...new Set(recentJobs.map((j) => j.crewLeaderId).filter((x): x is string => !!x))];
      return ids.length ? db.select().from(crewsTable).where(inArray(crewsTable.id, ids)) : Promise.resolve([]);
    })(),
    jobIds.length
      ? db
          .select()
          .from(crewCheckinsTable)
          .where(inArray(crewCheckinsTable.jobId, jobIds))
          .orderBy(desc(crewCheckinsTable.createdAt))
          .limit(50)
      : Promise.resolve([]),
    jobIds.length
      ? db
          .select()
          .from(crewPhotosTable)
          .where(inArray(crewPhotosTable.jobId, jobIds))
          .orderBy(desc(crewPhotosTable.createdAt))
          .limit(8)
      : Promise.resolve([]),
    jobIds.length
      ? db.select().from(jobSummariesTable).where(inArray(jobSummariesTable.jobId, jobIds))
      : Promise.resolve([]),
    jobIds.length
      ? db
          .select()
          .from(recapSharesTable)
          .where(inArray(recapSharesTable.jobId, jobIds))
          .orderBy(desc(recapSharesTable.createdAt))
          .limit(3)
      : Promise.resolve([]),
    db.select().from(invoicesTable).where(eq(invoicesTable.propertyId, scope.propertyId)),
    db.select().from(workRequestsTable).where(eq(workRequestsTable.propertyId, scope.propertyId)),
  ]);
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const lastCheckinByJob = new Map<string, (typeof checkins)[number]>();
  for (const c of checkins) if (c.jobId && !lastCheckinByJob.has(c.jobId)) lastCheckinByJob.set(c.jobId, c);

  const jobIdSet = new Set(jobIds);
  const unitInvoices = invoices.filter(
    (i) => i.jobId && jobIdSet.has(i.jobId) && i.status !== "cancelled" && i.status !== "draft",
  );
  const unitRequests = requests.filter((r) => normUnit(r.unitNo) === key && r.status === "pending");

  const facts: string[] = [];
  const links: { label: string; url: string; kind: string }[] = [];

  for (const job of recentJobs) {
    const crew = job.crewLeaderId ? crewById.get(job.crewLeaderId) : undefined;
    const last = lastCheckinByJob.get(job.id);
    const onSite = !!last && last.kind !== "checkout" && now - new Date(last.createdAt).getTime() < 4 * 3_600_000;
    const state = job.completedAt
      ? "completed"
      : onSite
        ? "crew on site now"
        : job.scheduledOn
          ? `scheduled for ${job.scheduledOn}`
          : "open";
    facts.push(
      `Job ${job.jobNo}: ${job.description ?? job.category ?? "work"} — ${state}${crew ? ` (crew: ${crew.name})` : ""}`,
    );
    if (!job.completedAt && job.trackerToken) {
      links.push({ label: `Live tracker — Job ${job.jobNo}`, url: `/track/${job.trackerToken}`, kind: "tracker" });
    }
  }
  for (const s of summaries) {
    if (s.status === "sent" || s.overallResult === "followup" || (s.flags ?? []).some((f) => f.checked)) {
      facts.push(
        `Service recap "${s.title}"${s.overallResult === "followup" ? " — flagged for follow-up" : ""}`,
      );
      links.push({ label: `Vendor report — ${s.title}`, url: `/summary/${s.token}`, kind: "summary" });
    }
  }
  for (const r of recaps) {
    links.push({ label: `Work recap — ${r.subject}`, url: `/recap/${r.token}`, kind: "recap" });
  }
  for (const inv of unitInvoices) {
    const pastDue = inv.dueAt && new Date(inv.dueAt).getTime() < now && inv.status !== "paid";
    facts.push(
      `Invoice ${inv.invoiceNo} — $${(inv.amount + (inv.taxAmount ?? 0)).toFixed(2)} ${inv.status === "paid" ? "paid" : pastDue ? "PAST DUE" : inv.status}`,
    );
  }
  for (const wr of unitRequests) {
    facts.push(`Pending work request: ${wr.serviceLabel}${wr.neededBy ? ` (needed by ${wr.neededBy})` : ""}`);
  }

  const photosOut = photos.map((p) => ({ url: storageUrl(p.storagePath), phase: p.phase ?? null }));
  if (photosOut.length) facts.push(`${photosOut.length} recent crew photos (before/after)`);

  // AI narrative only when there is something to talk about — keep quiet units cheap.
  let summaryText = "All quiet — no open work, requests, or billing on this unit right now.";
  if (facts.length) {
    try {
      summaryText = await completeText(
        `You brief a property manager on one unit of their property in 2-3 short sentences.
Be concrete and calm; lead with what needs their attention (red flags, past-due items), then what's in motion.
No markdown, no greetings, no unit number repetition.`,
        `Unit ${unit.label} — status ${status.status.toUpperCase()}.\nFacts:\n${facts.join("\n")}\nFlags: ${status.reasons.join("; ") || "none"}`,
        300,
      );
    } catch {
      summaryText = status.reasons.length
        ? `Needs attention: ${status.reasons.join("; ")}.`
        : "Work is in motion on this unit — see the activity below.";
    }
  }

  res.json(
    GetUnitSummaryResponse.parse({
      unitLabel: unit.label,
      status: status.status,
      summary: summaryText,
      facts,
      links: links.slice(0, 8),
      photos: photosOut,
    }),
  );
}

// ---------------------------------------------------------------------------
// Property Hub CMS
// ---------------------------------------------------------------------------
const HUB_SECTIONS = new Set(["link", "doc", "card", "employee", "maintenance"]);

function serHubItem(i: ClientHubItem) {
  return {
    id: i.id,
    section: i.section,
    title: i.title,
    subtitle: i.subtitle,
    url: i.url,
    fileUrl: i.storagePath ? storageUrl(i.storagePath) : null,
    body: i.body,
    phone: i.phone,
    email: i.email,
    createdBy: i.createdBy,
    createdAt: i.createdAt.toISOString(),
  };
}

function urlProblem(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "Links must be http(s) URLs";
    return null;
  } catch {
    return "That link isn't a valid URL";
  }
}

async function handleGetHub(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(req, res);
  if (!scope) return;
  const [[prop], items] = await Promise.all([
    db.select({ name: propertiesTable.name }).from(propertiesTable).where(eq(propertiesTable.id, scope.propertyId)).limit(1),
    db
      .select()
      .from(clientHubItemsTable)
      .where(eq(clientHubItemsTable.propertyId, scope.propertyId))
      .orderBy(asc(clientHubItemsTable.position), asc(clientHubItemsTable.createdAt)),
  ]);
  res.json(
    GetClientHubResponse.parse({
      propertyName: prop?.name ?? "Your property",
      canEdit: scope.viewer.authenticated && !scope.viewer.readOnly,
      items: items.map(serHubItem),
    }),
  );
}

async function handleCreateHubItem(req: Request, res: Response): Promise<void> {
  const parsed = CreateHubItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (denyIfReadOnly(scope.viewer, res)) return;
  const body = parsed.data;
  if (!HUB_SECTIONS.has(body.section)) {
    res.status(400).json({ error: "Section must be link, doc, card, employee, or maintenance" });
    return;
  }
  const title = body.title.trim();
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  const problem = urlProblem(body.url);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  if (body.storagePath && !body.storagePath.startsWith("/objects/")) {
    res.status(400).json({ error: "storagePath must come from the upload flow" });
    return;
  }
  const [row] = await db
    .insert(clientHubItemsTable)
    .values({
      propertyId: scope.propertyId,
      section: body.section,
      title,
      subtitle: body.subtitle?.trim() || null,
      url: body.url?.trim() || null,
      storagePath: body.storagePath || null,
      body: body.body?.trim() || null,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      position: Date.now(),
      createdBy: scope.viewer.name,
    })
    .returning();
  res.status(201).json(CreateHubItemResponse.parse(serHubItem(row!)));
}

async function handleUpdateHubItem(req: Request, res: Response): Promise<void> {
  const parsed = UpdateHubItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (denyIfReadOnly(scope.viewer, res)) return;
  const [item] = await db
    .select()
    .from(clientHubItemsTable)
    .where(
      and(
        eq(clientHubItemsTable.id, String(req.params.itemId)),
        eq(clientHubItemsTable.propertyId, scope.propertyId),
      ),
    )
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const body = parsed.data;
  const problem = urlProblem(body.url ?? undefined);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  if (body.storagePath && !body.storagePath.startsWith("/objects/")) {
    res.status(400).json({ error: "storagePath must come from the upload flow" });
    return;
  }
  const [row] = await db
    .update(clientHubItemsTable)
    .set({
      title: body.title !== undefined && body.title !== null && body.title.trim() ? body.title.trim() : item.title,
      subtitle: body.subtitle !== undefined ? body.subtitle : item.subtitle,
      url: body.url !== undefined ? body.url : item.url,
      storagePath: body.storagePath !== undefined ? body.storagePath : item.storagePath,
      body: body.body !== undefined ? body.body : item.body,
      phone: body.phone !== undefined ? body.phone : item.phone,
      email: body.email !== undefined ? body.email : item.email,
      updatedAt: new Date(),
    })
    .where(eq(clientHubItemsTable.id, item.id))
    .returning();
  res.json(CreateHubItemResponse.parse(serHubItem(row!)));
}

async function handleDeleteHubItem(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(req, res);
  if (!scope) return;
  if (denyIfReadOnly(scope.viewer, res)) return;
  const deleted = await db
    .delete(clientHubItemsTable)
    .where(
      and(
        eq(clientHubItemsTable.id, String(req.params.itemId)),
        eq(clientHubItemsTable.propertyId, scope.propertyId),
      ),
    )
    .returning();
  if (!deleted.length) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json({ ok: true });
}

// Contact maintenance — any dashboard visitor can reach the office. This is a
// help line, not a data write, so it is deliberately open to guests too.
router.post("/client/:token/hub/contact-maintenance", async (req, res): Promise<void> => {
  const parsed = ContactMaintenanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const message = parsed.data.message.trim().slice(0, 2000);
  if (!message) {
    res.status(400).json({ error: "Tell us what you need" });
    return;
  }
  const viewer = await resolveViewer(req, account.propertyId);
  const who = parsed.data.contactName?.trim() || viewer.name || "A client";
  const unit = parsed.data.unitNo?.trim();
  await Promise.all([
    db.insert(notificationsTable).values({
      kind: "client_dashboard",
      title: `Maintenance request from ${who}${unit ? ` (unit ${unit})` : ""}`,
      body: message,
      entityType: "property",
      entityId: account.propertyId,
    }),
    db.insert(activitiesTable).values({
      entityType: "property",
      entityId: account.propertyId,
      kind: "note",
      body: `${who} contacted maintenance from the Property Hub${unit ? ` (unit ${unit})` : ""}: ${message.slice(0, 200)}`,
    }),
  ]);
  res.json(
    ContactMaintenanceResponse.parse({
      ok: true,
      message: "The office has been notified — we'll reach out shortly",
    }),
  );
});

// ---------------------------------------------------------------------------
// Route registration — same handlers on the client (token) and office
// (propertyId) mounts. Office writes are open by the app's no-auth posture,
// matching every other /admin route.
// ---------------------------------------------------------------------------
for (const base of ["/client/:token", "/admin/accounts/:propertyId"]) {
  router.get(`${base}/unit-map`, handleGetUnitMap);
  router.post(`${base}/unit-map/image`, handleUploadImage);
  router.post(`${base}/unit-map/grid`, handleGenerateGrid);
  router.post(`${base}/unit-map/units`, handleCreateUnit);
  router.patch(`${base}/unit-map/units/:unitId`, handleUpdateUnit);
  router.delete(`${base}/unit-map/units/:unitId`, handleDeleteUnit);
  router.get(`${base}/unit-map/units/:unitId/summary`, handleUnitSummary);
  router.get(`${base}/hub`, handleGetHub);
  router.post(`${base}/hub/items`, handleCreateHubItem);
  router.patch(`${base}/hub/items/:itemId`, handleUpdateHubItem);
  router.delete(`${base}/hub/items/:itemId`, handleDeleteHubItem);
}

export default router;
