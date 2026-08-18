import { limits } from "../lib/rateLimit";
import { Router, type IRouter, type Response } from "express";
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  clientCardCommentsTable,
  clientBoardNotificationsTable,
  clientUsersTable,
  clientDashboardCardsTable,
  clientDashboardActionsTable,
  clientBoardCardsTable,
  clientCardHistoryTable,
  paymentsTable,
  invoiceLineItemsTable,
  propertiesTable,
  propertyUnitsTable,
  jobsTable,
  jobLineItemsTable,
  crewsTable,
  crewCheckinsTable,
  crewPhotosTable,
  invoicesTable,
  workRequestsTable,
  activitiesTable,
  notificationsTable,
  businessSettingsTable,
  walksTable,
  walkCapturesTable,
  clientPortfolioPropertiesTable,
  type ClientUser,
  type Job,
} from "@workspace/db";
import { resolveClientBoardLink } from "../lib/clientBoardLink";
import { getBusinessSettings } from "../lib/businessSettings";
import { contractorLabel, serviceLabel } from "../lib/crewPinIdentity";
import {
  ClientBoardLoginBody,
  ClientBoardLoginResponse,
  GetClientBoardResponse,
  CreateClientBoardCardBody,
  CreateClientBoardCardResponse,
  UpdateClientBoardCardBody,
  UpdateClientBoardCardResponse,
  DispatchClientBoardActionBody,
  DispatchClientBoardActionResponse,
  GetClientBoardMapResponse,
  AddClientCardCommentBody,
  AddClientCardCommentResponse,
  ListClientCardCommentsResponse,
  SendClientCardToOfficeResponse,
  ListClientBoardNotificationsResponse,
  GetClientBoardKpisResponse,
  ClearClientBoardCardResponse,
  RestoreClientBoardCardResponse,
  GetClientBoardHistoryResponse,
} from "@workspace/api-zod";
import { effectivePermissions } from "./clientAccess";
import { completeJson } from "../lib/ai";
import { raiseClientCard } from "../lib/clientBoard";
import { getPresentationDemoState } from "../lib/presentationDemo";
import {
  buildCrewMapModule,
  buildInvoiceModule,
  pickInvoiceForPush,
  buildInvoiceBatchModule,
  buildBidModule,
  buildTrackerModule,
  buildFlagsModule,
  buildSummaryModule,
} from "../lib/cardModules";
import { bidsTable } from "@workspace/db";
import { computeUnitStatuses, normUnit } from "./clientCms";
import { acceptWorkRequest } from "./workRequests";
import { emitBoardEvent } from "../lib/boardEvents";
import { emitFalkonEvent } from "../lib/falkonEmit";
import { startMakeReadyExecution } from "../lib/falkonMakeReady";
import { deriveLaneWaybill, waybillCodeFor } from "../lib/waybill";
import { pushToCrewId } from "../lib/pushNotification";

// Every projected card gets a network waybill: the FLK code is deterministic
// per cardKey, and the six-dot progress derives from the card's LANE — so a
// drag on either board lights the dots through the normal SSE→refetch path.
function decorateWaybill<T extends { cardKey: string; lane: string }>(card: T) {
  return {
    ...card,
    // Strip the board projection's "push:" prefix so the SAME card shows the
    // SAME FLK code on the client board and the office mirror.
    waybillCode: waybillCodeFor(card.cardKey.replace(/^push:/, "")),
    waybill: deriveLaneWaybill(card.lane, card as Record<string, unknown>),
  };
}

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------
const LANES = [
  { key: "requested", label: "Requested", hint: "New work requests and open jobs" },
  { key: "scheduled", label: "Scheduled", hint: "On the calendar with a crew" },
  { key: "in_progress", label: "In Progress", hint: "Crews on site right now" },
  { key: "done", label: "Done", hint: "Completed work" },
  { key: "billing", label: "Billing", hint: "Invoices in flight" },
] as const;
const LANE_KEYS = new Set(LANES.map((l) => l.key as string));

// Property-management board — the client's own space. No HALO projection;
// every card is client-created (usually from a PM template).
const PM_LANES = [
  { key: "planning", label: "Planning", hint: "Ideas and upcoming work" },
  { key: "todo", label: "To Do", hint: "Committed and ready to start" },
  { key: "doing", label: "In Progress", hint: "Happening now" },
  { key: "done", label: "Done", hint: "Wrapped up" },
] as const;
const PM_LANE_KEYS = new Set(PM_LANES.map((l) => l.key as string));
// Drag-drop validation must accept lanes from either board.
const ANY_LANE_KEYS = new Set([...LANE_KEYS, ...PM_LANE_KEYS]);

// ---------------------------------------------------------------------------
// Session tokens — HMAC-signed, stateless. `userId.expiresMs.sig` (base64url
// pieces). Sent by the dashboard as `Authorization: Bearer <token>`.
// ---------------------------------------------------------------------------
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not configured");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function issueSessionToken(userId: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts as [string, string, string];
  const payload = `${userId}.${expStr}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  return userId;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(candidate);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function accountByToken(token: string, preferPropertyId?: string | null) {
  const [direct] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.dashboardToken, token))
    .limit(1);
  if (direct?.status === "active") return direct;

  const link = await resolveClientBoardLink(token);
  if (!link) return undefined;

  const wanted =
    preferPropertyId &&
    (!link.allowedPropertyIds || link.allowedPropertyIds.includes(preferPropertyId))
      ? preferPropertyId
      : link.propertyId;

  if (wanted) {
    const [account] = await db
      .select()
      .from(clientAccountsTable)
      .where(and(eq(clientAccountsTable.propertyId, wanted), eq(clientAccountsTable.status, "active")))
      .limit(1);
    if (account) return account;
  }

  if (link.kind !== "regional") return undefined;
  const linked = await db
    .select({ propertyId: clientPortfolioPropertiesTable.propertyId })
    .from(clientPortfolioPropertiesTable)
    .where(eq(clientPortfolioPropertiesTable.portfolioId, link.portfolioId));
  const ids = linked.map((r) => r.propertyId);
  if (ids.length === 0) return undefined;
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(and(inArray(clientAccountsTable.propertyId, ids), eq(clientAccountsTable.status, "active")))
    .limit(1);
  return account;
}

export type Viewer = {
  authenticated: boolean;
  name: string | null;
  email: string | null;
  role: string;
  permissions: string[];
  readOnly: boolean;
  user?: ClientUser;
};

const GUEST_VIEWER: Viewer = {
  authenticated: false,
  name: null,
  email: null,
  role: "guest",
  permissions: ["overview", "live_jobs", "photos", "unit_map", "hub"],
  readOnly: true,
};

export async function resolveViewer(
  req: { headers: Record<string, unknown> },
  propertyId: string,
): Promise<Viewer> {
  const header = String(req.headers["authorization"] ?? "");
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!bearer) return GUEST_VIEWER;
  const userId = verifySessionToken(bearer);
  if (!userId) return GUEST_VIEWER;
  const [user] = await db
    .select()
    .from(clientUsersTable)
    .where(
      and(eq(clientUsersTable.id, userId), eq(clientUsersTable.propertyId, propertyId)),
    )
    .limit(1);
  if (!user || !user.active) return GUEST_VIEWER;
  const permissions = effectivePermissions(user);
  return {
    authenticated: true,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions,
    // Guests are seated read-only viewers; admins and members can write.
    readOnly: user.role === "guest",
    user,
  };
}

function viewerDto(v: Viewer) {
  return {
    authenticated: v.authenticated,
    name: v.name,
    email: v.email,
    role: v.role,
    permissions: v.permissions,
    readOnly: v.readOnly,
    // Authenticated users carry a server-side "tour seen" flag so the auto
    // tour only offers once across devices. Guests fall back to localStorage.
    tourSeen: v.authenticated ? v.user?.tourSeenAt != null : false,
  };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
router.post("/client/:token/board/login", limits.login, async (req, res): Promise<void> => {
  const parsed = ClientBoardLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "Email and password are required" });
    return;
  }
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const users = await db
    .select()
    .from(clientUsersTable)
    .where(eq(clientUsersTable.propertyId, account.propertyId));
  const user = users.find((u) => u.email.trim().toLowerCase() === email);
  if (!user || !user.active || !verifyPassword(parsed.data.password, user.passwordHash)) {
    res.status(401).json({ error: "That email and password don't match" });
    return;
  }
  const permissions = effectivePermissions(user);
  res.json(
    ClientBoardLoginResponse.parse({
      sessionToken: issueSessionToken(user.id),
      viewer: {
        authenticated: true,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions,
        readOnly: user.role === "guest",
        tourSeen: user.tourSeenAt != null,
      },
    }),
  );
});

// ---------------------------------------------------------------------------
// Guided tour — persist "seen" per signed-in user so the auto-offer holds
// across devices. Guests keep the browser-local behavior.
// ---------------------------------------------------------------------------
router.post("/client/:token/board/tour-seen", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const viewer = await resolveViewer(req, account.propertyId);
  if (!viewer.authenticated || !viewer.user) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  if (!viewer.user.tourSeenAt) {
    await db
      .update(clientUsersTable)
      .set({ tourSeenAt: new Date() })
      .where(eq(clientUsersTable.id, viewer.user.id));
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Board projection
// ---------------------------------------------------------------------------
type Btn = {
  key: string;
  label: string;
  kind: "primary" | "secondary" | "link";
  href: string | null;
};

// Pipelines follow the uploaded halo-board-templates card spec:
// work_order, make_ready, invoice, vendor_crew_live templates.
const JOB_PIPELINE = ["Reported", "Dispatched", "On Site", "Parts Hold", "QC", "Closed"];
const MAKEREADY_PIPELINE = ["Vacated", "Scoped", "Trades", "Punch", "Inspected", "Rent Ready"];
const INVOICE_PIPELINE = ["Received", "Coded", "Approved", "Scheduled", "Paid"];
const REQUEST_PIPELINE = ["Reported", "Dispatched"];
const CREW_PIPELINE = ["Dispatched", "En Route", "On Site", "Wrapping", "Signed Off"];

function jobLane(job: Job): { lane: string } {
  if (job.status === "complete" || job.completedAt || job.clearedAt) return { lane: "done" };
  // Mirror the live vendor board: completed board cards are done; a filled
  // card (crew locked in) reads as scheduled even before a date is set.
  if (job.boardStatus === "completed") return { lane: "done" };
  if (job.status === "scheduled" || job.scheduledOn || job.boardStatus === "filled")
    return { lane: "scheduled" };
  return { lane: "requested" };
}

function storageUrl(path: string): string {
  // Manual /api asset links must be absolute — never BASE_URL-prefixed.
  return `/api/storage${path}`;
}

function legacyTemplateFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  const m = /^\[Template:\s*([a-z0-9_-]{1,32})\]/i.exec(notes);
  return m ? m[1]!.toLowerCase() : null;
}
function isMakeReady(job: Job): boolean {
  const s = `${job.category ?? ""} ${job.description ?? ""}`.toLowerCase();
  return s.includes("make ready") || s.includes("make-ready") || s.includes("makeready") || s.includes("turn");
}

async function projectBoard(account: typeof clientAccountsTable.$inferSelect) {
  const propertyId = account.propertyId;
  const [jobs, requests, invoices, boardRows, pushed] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.propertyId, propertyId)),
    db.select().from(workRequestsTable).where(eq(workRequestsTable.propertyId, propertyId)),
    db.select().from(invoicesTable).where(eq(invoicesTable.propertyId, propertyId)),
    db
      .select()
      .from(clientDashboardCardsTable)
      .where(eq(clientDashboardCardsTable.propertyId, propertyId)),
    db
      .select()
      .from(clientBoardCardsTable)
      .where(eq(clientBoardCardsTable.propertyId, propertyId))
      .orderBy(desc(clientBoardCardsTable.updatedAt)),
  ]);

  const overrides = new Map(
    boardRows.filter((r) => r.kind === "override").map((r) => [r.cardKey, r]),
  );
  // Vendor board only — PM-board cards live in their own projection.
  const customs = boardRows.filter(
    (r) => r.kind === "custom" && !r.archived && r.board === "vendor",
  );

  // Message counts per card, one grouped query. Unread runs both directions:
  // office-authored & unread (client badge) and client-authored & unread
  // (office badge on the mirrored card).
  const commentRows = await db
    .select({
      cardKey: clientCardCommentsTable.cardKey,
      n: sql<number>`count(*)::int`,
      unreadOffice: sql<number>`count(*) filter (where ${clientCardCommentsTable.authorType} = 'office' and ${clientCardCommentsTable.readAt} is null)::int`,
      unreadClient: sql<number>`count(*) filter (where ${clientCardCommentsTable.authorType} = 'client' and ${clientCardCommentsTable.readAt} is null)::int`,
    })
    .from(clientCardCommentsTable)
    .where(eq(clientCardCommentsTable.propertyId, propertyId))
    .groupBy(clientCardCommentsTable.cardKey);
  const commentCountByKey = new Map(commentRows.map((r) => [r.cardKey, r.n]));
  const unreadOfficeByKey = new Map(commentRows.map((r) => [r.cardKey, r.unreadOffice]));
  const unreadClientByKey = new Map(commentRows.map((r) => [r.cardKey, r.unreadClient]));

  // Thread family: a pushed mirror (push:<id>) and its projected source card
  // (<sourceType>:<sourceId>) share ONE thread, so counts sum across both keys
  // and neither the push-dedupe nor lane moves can orphan a conversation.
  const pushKeysBySource = new Map<string, string[]>();
  for (const c of pushed) {
    if (!c.sourceType || !c.sourceId) continue;
    const src = `${c.sourceType}:${c.sourceId}`;
    pushKeysBySource.set(src, [...(pushKeysBySource.get(src) ?? []), `push:${c.id}`]);
  }
  const sourceByPushKey = new Map<string, string>();
  for (const [src, keys] of pushKeysBySource) for (const k of keys) sourceByPushKey.set(k, src);
  const familyKeys = (key: string): string[] => {
    if (key.startsWith("push:")) {
      const src = sourceByPushKey.get(key);
      return src ? [key, src] : [key];
    }
    return [key, ...(pushKeysBySource.get(key) ?? [])];
  };
  const sumFor = (map: Map<string, number>, key: string): number =>
    familyKeys(key).reduce((s, k) => s + (map.get(k) ?? 0), 0);

  const now = Date.now();
  const DAY = 86_400_000;
  const activeJobs = jobs.filter(
    (j) => !j.clearedAt || now - new Date(j.clearedAt).getTime() < 14 * DAY,
  );

  const crewIds = [
    ...new Set(activeJobs.map((j) => j.crewLeaderId).filter((x): x is string => !!x)),
  ];
  const jobIds = activeJobs.map((j) => j.id);
  const [crews, photos, checkins, walkCaps] = await Promise.all([
    crewIds.length
      ? db.select().from(crewsTable).where(inArray(crewsTable.id, crewIds))
      : Promise.resolve([]),
    jobIds.length
      ? db
          .select()
          .from(crewPhotosTable)
          .where(inArray(crewPhotosTable.jobId, jobIds))
          .orderBy(desc(crewPhotosTable.createdAt))
      : Promise.resolve([]),
    jobIds.length
      ? db
          .select()
          .from(crewCheckinsTable)
          .where(inArray(crewCheckinsTable.jobId, jobIds))
          .orderBy(desc(crewCheckinsTable.createdAt))
      : Promise.resolve([]),
    // Walk captures for the property (joined through the walk session).
    // Used to enrich pending work-request cards with any pre-existing
    // inspection photos for the same unit (HALO Walk / Walk app).
    db
      .select({
        unitNo: walkCapturesTable.unitNo,
        photos: walkCapturesTable.photos,
        storagePath: walkCapturesTable.storagePath,
      })
      .from(walkCapturesTable)
      .innerJoin(walksTable, eq(walksTable.id, walkCapturesTable.walkId))
      .where(eq(walksTable.propertyId, propertyId))
      .orderBy(desc(walkCapturesTable.createdAt))
      .limit(60),
  ]);
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const photosByJob = new Map<string, typeof photos>();
  for (const p of photos) {
    if (!p.jobId) continue;
    const list = photosByJob.get(p.jobId) ?? [];
    if (list.length < 6) list.push(p);
    photosByJob.set(p.jobId, list);
  }
  const lastCheckinByJob = new Map<string, (typeof checkins)[number]>();
  for (const c of checkins) {
    if (c.jobId && !lastCheckinByJob.has(c.jobId)) lastCheckinByJob.set(c.jobId, c);
  }

  // Per-unit photo maps for enriching pending work-request cards.
  // Walk captures → keyed by normalised unit, most-recent first, cap 4/unit.
  const walkPhotosByUnit = new Map<string, string[]>();
  for (const wc of walkCaps) {
    if (!wc.unitNo) continue;
    const key = normUnit(wc.unitNo);
    const existing = walkPhotosByUnit.get(key) ?? [];
    if (existing.length >= 4) continue;
    const paths: string[] = Array.isArray(wc.photos)
      ? (wc.photos as string[])
      : wc.storagePath
        ? [wc.storagePath]
        : [];
    walkPhotosByUnit.set(key, [...existing, ...paths.map(storageUrl)].slice(0, 4));
  }
  // Crew photos → keyed by unit of the job, cap 4/unit.
  const crewPhotosByUnit = new Map<string, string[]>();
  for (const p of photos) {
    if (!p.jobId) continue;
    const job = activeJobs.find((j) => j.id === p.jobId);
    if (!job?.unitNo) continue;
    const key = normUnit(job.unitNo);
    const existing = crewPhotosByUnit.get(key) ?? [];
    if (existing.length >= 4) continue;
    crewPhotosByUnit.set(key, [...existing, storageUrl(p.storagePath)].slice(0, 4));
  }

  type CardRow = Record<string, unknown> & { cardKey: string; lane: string; position: number };
  const cards: CardRow[] = [];

  const applyOverride = (card: CardRow) => {
    card.snoozedUntil = null;
    card.commentCount = sumFor(commentCountByKey, card.cardKey);
    card.unreadComments = sumFor(unreadOfficeByKey, card.cardKey);
    card.unreadFromClient = sumFor(unreadClientByKey, card.cardKey);
    const o = overrides.get(card.cardKey);
    if (o) {
      if (o.lane && LANE_KEYS.has(o.lane)) card.lane = o.lane;
      card.position = o.position;
      if (o.notes != null) card.notes = o.notes;
      if (o.snoozedUntil && o.snoozedUntil.getTime() > now)
        card.snoozedUntil = o.snoozedUntil.toISOString();
      // Wekan-style overlays are client-editable even on HALO-fed cards.
      if (Array.isArray(o.labels)) card.labels = o.labels;
      if (Array.isArray(o.checklist)) card.checklist = o.checklist;
    }
    return card;
  };

  // Job + crew cards -------------------------------------------------------
  for (const job of activeJobs) {
    const crew = job.crewLeaderId ? crewById.get(job.crewLeaderId) : undefined;
    const lastCheckin = lastCheckinByJob.get(job.id);
    const onSite =
      !!lastCheckin &&
      lastCheckin.kind !== "checkout" &&
      now - new Date(lastCheckin.createdAt).getTime() < 4 * 3_600_000;
    let { lane } = jobLane(job);
    if (lane !== "done" && onSite) lane = "in_progress";
    // Pending change order: the card sits in Requested on BOTH boards until
    // the office reviews upcharges and reopens it back into the flow.
    const pendingChangeOrder = job.changeOrderStatus === "requested";
    if (pendingChangeOrder) lane = "requested";
    const makeReady = isMakeReady(job);
    // Stage index within the template's own pipeline.
    const stageIndex = makeReady
      ? lane === "done"
        ? 5
        : onSite
          ? 2
          : lane === "scheduled"
            ? 1
            : 0
      : lane === "done"
        ? 5
        : onSite
          ? 2
          : lane === "scheduled"
            ? 1
            : 0;
    const trackerUrl = job.trackerToken ? `/track/${job.trackerToken}` : null;
    const jobPhotos = (photosByJob.get(job.id) ?? []).map((p) => ({
      url: storageUrl(p.storagePath),
      phase: p.phase ?? null,
      note: p.note ?? null,
    }));
    const actions: Btn[] = [];
    if (trackerUrl) actions.push({ key: "tracker", label: "Live Tracker", kind: "link", href: trackerUrl });
    if (lane !== "done") {
      actions.push({ key: "job.request_update", label: "Request Update", kind: "primary", href: null });
    }
    const jobCardRow = applyOverride({
        cardKey: `job:${job.id}`,
        template: makeReady ? "makeready" : "job",
        changeOrder: pendingChangeOrder,
        title: job.description || `${job.category ?? "Job"} ${job.jobNo}`,
        subtitle: `Job ${job.jobNo}${job.woNo ? ` · WO ${job.woNo}` : ""}`,
        lane,
        position: 0,
        pipeline: makeReady ? MAKEREADY_PIPELINE : JOB_PIPELINE,
        stageIndex,
        status: job.status,
        unitNo: job.unitNo ?? null,
        category: job.category ?? null,
        poNumber: job.poNumber ?? null,
        amount: null,
        priority: null,
        dueOn: job.flexDueBy ?? null,
        scheduledOn: job.scheduledOn ?? null,
        description: job.description ?? null,
        notes: null,
        crew: crew
          ? {
              name: crew.name,
              trade: crew.trade ?? null,
              selfieUrl: crew.selfiePath ? storageUrl(crew.selfiePath) : null,
              onSite,
              lastSeenAt: lastCheckin ? lastCheckin.createdAt.toISOString() : null,
            }
          : null,
        trackerUrl,
        payUrl: null,
        photos: jobPhotos,
        actions,
        editable: false,
        updatedAt: (job.completedAt ?? job.createdAt).toISOString(),
      });
    // A pending change order wins over any manual lane override.
    if (pendingChangeOrder) jobCardRow.lane = "requested";
    // Vendor-board completion also wins — once HALO marks the work done, a
    // stale client placement can't hold the card in an active lane.
    else if (jobLane(job).lane === "done") jobCardRow.lane = "done";
    cards.push(jobCardRow);

    // Vendor crew card for assigned, unfinished jobs
    if (crew && lane !== "done") {
      const crewActions: Btn[] = [];
      if (trackerUrl)
        crewActions.push({ key: "tracker", label: "Live Tracker", kind: "link", href: trackerUrl });
      crewActions.push({
        key: "crew.locate_requested",
        label: "Where Are They?",
        kind: "secondary",
        href: null,
      });
      cards.push(
        applyOverride({
          cardKey: `crew:${job.id}`,
          template: "crew",
          title: crew.name,
          subtitle: crew.trade ? `${crew.trade} · Job ${job.jobNo}` : `Job ${job.jobNo}`,
          lane: onSite ? "in_progress" : lane,
          position: 0,
          pipeline: CREW_PIPELINE,
          stageIndex: onSite ? 2 : 0,
          status: onSite ? "on site" : "assigned",
          unitNo: job.unitNo ?? null,
          category: crew.trade ?? null,
          amount: null,
          priority: null,
          dueOn: null,
          scheduledOn: job.scheduledOn ?? null,
          description: job.description ?? null,
          notes: null,
          crew: {
            name: crew.name,
            trade: crew.trade ?? null,
            selfieUrl: crew.selfiePath ? storageUrl(crew.selfiePath) : null,
            onSite,
            lastSeenAt: lastCheckin ? lastCheckin.createdAt.toISOString() : null,
          },
          trackerUrl,
          payUrl: null,
          photos: jobPhotos,
          actions: crewActions,
          editable: false,
          updatedAt: (lastCheckin?.createdAt ?? job.createdAt).toISOString(),
        }),
      );
    }
  }

  // Self-repair: invoice-kind pushed cards that were sent without a linked
  // invoice have no module (plain dumb card). Lazily link them to the unpaid
  // invoice they most likely mean (amount match, else most recent) and
  // persist — one-time fix per card, makes old cards interactive.
  for (const c of pushed) {
    if (c.kind !== "invoice" || c.module || c.sourceType === "invoice") continue;
    const inv = await pickInvoiceForPush(propertyId, c.amount ?? null);
    if (!inv) continue;
    const module = await buildInvoiceModule(propertyId, inv.id);
    if (!module) continue;
    // (sourceType, sourceId) is unique — only claim the invoice identity if
    // no other card already has it; otherwise just attach the module so the
    // card becomes interactive without violating the constraint.
    const taken = pushed.some(
      (o) => o.id !== c.id && o.sourceType === "invoice" && o.sourceId === inv.id,
    );
    try {
      const [updated] = await db
        .update(clientBoardCardsTable)
        .set(
          taken
            ? { module, updatedAt: new Date() }
            : { module, sourceType: "invoice", sourceId: inv.id, updatedAt: new Date() },
        )
        .where(eq(clientBoardCardsTable.id, c.id))
        .returning();
      if (updated) Object.assign(c, updated);
    } catch {
      // Never let a repair attempt break the board read.
      c.module = module;
    }
  }

  // Invoice cards ----------------------------------------------------------
  // When the office pushed an interactive card for an invoice, that card IS
  // the invoice on this board — skip the auto-projected duplicate so the
  // client never sees two cards with the same title and different powers.
  const pushedInvoiceIds = new Set(
    pushed
      .filter(
        (c) =>
          c.sourceType === "invoice" &&
          c.sourceId &&
          (!c.completedAt || now - c.completedAt.getTime() <= 30 * DAY),
      )
      .map((c) => c.sourceId),
  );
  for (const inv of invoices) {
    if (inv.status === "paid" && inv.paidAt && now - new Date(inv.paidAt).getTime() > 30 * DAY)
      continue;
    if (pushedInvoiceIds.has(inv.id)) continue;
    const stageIndex = inv.status === "paid" ? 4 : inv.status === "sent" ? 3 : 1;
    // Billing holds an invoice for 24h max: after that an unpaid invoice is
    // past due and needsAction flips it into the Alerts rail. A client-reported
    // payment ("on its way") keeps it in Billing.
    const billingSince = (inv.sentAt ?? inv.createdAt).getTime();
    const invPastDue =
      inv.status !== "paid" &&
      !inv.clientPaidReportedAt &&
      now - billingSince > 24 * 3_600_000;
    cards.push(
      applyOverride({
        cardKey: `invoice:${inv.id}`,
        template: "invoice",
        title: `Invoice ${inv.invoiceNo}`,
        subtitle: inv.billToName ?? null,
        lane: inv.status === "paid" ? "done" : "billing",
        position: 0,
        pipeline: INVOICE_PIPELINE,
        stageIndex,
        status: inv.status,
        unitNo: null,
        category: null,
        amount: inv.amount + (inv.taxAmount ?? 0),
        priority: null,
        dueOn: inv.dueAt
          ? `${inv.dueAt.getFullYear()}-${String(inv.dueAt.getMonth() + 1).padStart(2, "0")}-${String(inv.dueAt.getDate()).padStart(2, "0")}`
          : null,
        scheduledOn: null,
        description: inv.notes ?? null,
        notes: null,
        crew: null,
        trackerUrl: null,
        payUrl: null,
        photos: [],
        needsAction: invPastDue,
        actions:
          inv.status === "paid"
            ? []
            : inv.paymentChoice
              ? [{ key: "invoice.mark_reviewed", label: "Mark Reviewed", kind: "secondary", href: null }]
              : [
                  { key: "invoice.pay_by_check", label: "Mail a Check", kind: "primary", href: null },
                  { key: "invoice.pay_by_platform", label: "Payment Platform (VendorAccess, etc.)", kind: "secondary", href: null },
                ],
        editable: false,
        // Display-only module so the detail view shows the invoice (amount,
        // status, PDF). Approval/pay-method actions live on pushed cards,
        // which persist client action state.
        module: {
          type: "invoice",
          invoiceId: inv.id,
          invoiceNo: inv.invoiceNo,
          amount: inv.amount + (inv.taxAmount ?? 0),
          status: inv.status,
          dueDate: inv.dueAt
            ? `${inv.dueAt.getFullYear()}-${String(inv.dueAt.getMonth() + 1).padStart(2, "0")}-${String(inv.dueAt.getDate()).padStart(2, "0")}`
            : null,
          payUrl: null,
          pdfUrl: `/api/invoices/${inv.id}/pdf`,
          canApprove: false,
          clientPaidAt: inv.clientPaidReportedAt ? inv.clientPaidReportedAt.toISOString() : null,
          clientPaidBy: inv.clientPaidReportedBy ?? null,
          paymentChoice: inv.paymentChoice ?? null,
          paymentChoicePlatform: inv.paymentChoicePlatform ?? null,
        },
        updatedAt: (inv.paidAt ?? inv.sentAt ?? inv.createdAt).toISOString(),
      }),
    );
  }

  // Work request cards -----------------------------------------------------
  const changeOrderJobNoById = new Map<string, string>();
  for (const wr of requests) {
    if (wr.changeOrderJobId) {
      const src = jobs.find((j) => j.id === wr.changeOrderJobId);
      if (src) changeOrderJobNoById.set(wr.changeOrderJobId, src.jobNo);
    }
  }
  for (const wr of requests) {
    if (wr.status === "accepted") continue; // shows up as a job card instead
    if (wr.status === "declined" && wr.decidedAt && now - new Date(wr.decidedAt).getTime() > 14 * DAY)
      continue;
    const units = Array.isArray(wr.units)
      ? (wr.units as unknown[]).filter((u): u is string => typeof u === "string")
      : [];
    const photoPaths = Array.isArray(wr.photoPaths)
      ? (wr.photoPaths as unknown[]).filter((p): p is string => typeof p === "string")
      : [];
    const coJobNo = wr.changeOrderJobId
      ? changeOrderJobNoById.get(wr.changeOrderJobId)
      : undefined;
    const subtitleBits = [
      coJobNo ? `Change on Job ${coJobNo}` : null,
      units.length > 1 ? `Units ${units.join(", ")}` : null,
      wr.requesterName ? `Requested by ${wr.requesterName}` : null,
    ].filter(Boolean);

    // Combine client-uploaded request photos + any walk/crew photos for the
    // same unit so the PM sees all existing evidence in one place.
    const requestPhotoUrls = photoPaths.map(storageUrl);
    const normU = wr.unitNo ? normUnit(wr.unitNo) : null;
    const walkPhotos = normU ? (walkPhotosByUnit.get(normU) ?? []) : [];
    const crewPhotos = normU ? (crewPhotosByUnit.get(normU) ?? []) : [];
    const allRequestPhotoUrls = [
      ...requestPhotoUrls,
      ...walkPhotos.filter((u) => !requestPhotoUrls.includes(u)),
      ...crewPhotos.filter((u) => !requestPhotoUrls.includes(u)),
    ].slice(0, 8);

    cards.push(
      applyOverride({
        cardKey: `request:${wr.id}`,
        template: "request",
        title: `${wr.emergency ? "🚨 " : ""}${coJobNo ? "Change order: " : ""}${wr.serviceLabel}`,
        subtitle: subtitleBits.length ? subtitleBits.join(" · ") : null,
        lane: "requested",
        position: 0,
        pipeline: REQUEST_PIPELINE,
        stageIndex: 0,
        status: wr.status,
        unitNo: units.length === 1 ? units[0]! : (wr.unitNo ?? null),
        category: null,
        amount: null,
        // Emergency requests render with urgent treatment on both boards.
        priority: wr.emergency ? "urgent" : null,
        dueOn: wr.neededBy ?? null,
        scheduledOn: null,
        description:
          wr.status === "declined"
            ? `Declined${wr.declineReason ? `: ${wr.declineReason}` : ""}${wr.notes ? `\n${wr.notes}` : ""}`
            : wr.notes ?? null,
        notes: null,
        crew: null,
        trackerUrl: null,
        payUrl: null,
        photos: photoPaths.map((p) => ({ url: storageUrl(p), phase: null, note: null })),
        actions:
          wr.status === "pending"
            ? [
                { key: "request.approve", label: "Approve Request", kind: "primary", href: null },
                { key: "request.cancel", label: "Cancel Request", kind: "secondary", href: null },
              ]
            : [],
        editable: false,
        updatedAt: (wr.decidedAt ?? wr.createdAt).toISOString(),
        // Rich module: powers the photo strip + approve button in BoardCardModules.
        module: {
          type: "request",
          requestId: wr.id,
          serviceLabel: wr.serviceLabel,
          unitNo: wr.unitNo ?? null,
          neededBy: wr.neededBy ?? null,
          notes: wr.notes ?? null,
          emergency: wr.emergency ?? false,
          photoUrls: allRequestPhotoUrls,
          // canApprove drives the green Approve button in ModuleDecision.
          canApprove: wr.status === "pending",
          // Stamp approvedAt when the request has been accepted so the card
          // shows "IN PROGRESS" instead of the approve button.
          approvedAt:
            wr.status === "accepted" && wr.decidedAt ? wr.decidedAt.toISOString() : null,
        },
      }),
    );
  }

  // Custom client cards ----------------------------------------------------
  for (const c of customs) {
    cards.push({
      cardKey: c.cardKey,
      // First-class template column; legacy rows encoded it in notes.
      template: c.template ?? legacyTemplateFromNotes(c.notes) ?? "custom",
      title: c.title ?? "Untitled",
      subtitle: c.createdBy ? `Added by ${c.createdBy}` : null,
      lane: c.lane && LANE_KEYS.has(c.lane) ? c.lane : "requested",
      position: c.position,
      pipeline: ["Open", "Done"],
      stageIndex: c.lane === "done" ? 1 : 0,
      status: null,
      unitNo: null,
      category: null,
      amount: null,
      priority: c.priority ?? null,
      dueOn: c.dueOn ?? null,
      scheduledOn: null,
      description: c.description ?? null,
      notes: c.notes ?? null,
      crew: null,
      trackerUrl: null,
      payUrl: null,
      photos: [],
      actions: [{ key: "card.archive", label: "Archive", kind: "secondary", href: null }],
      editable: true,
      updatedAt: c.updatedAt.toISOString(),
      snoozedUntil:
        c.snoozedUntil && c.snoozedUntil.getTime() > now ? c.snoozedUntil.toISOString() : null,
      labels: Array.isArray(c.labels) ? c.labels : [],
      checklist: Array.isArray(c.checklist) ? c.checklist : [],
      commentCount: commentCountByKey.get(c.cardKey) ?? 0,
      unreadComments: unreadOfficeByKey.get(c.cardKey) ?? 0,
      unreadFromClient: unreadClientByKey.get(c.cardKey) ?? 0,
      sentToOffice: c.sentToOfficeAt
        ? {
            sentAt: c.sentToOfficeAt.toISOString(),
            status: c.officeStatus ?? "pending",
            note: c.officeNote ?? null,
          }
        : null,
    });
  }

  // Pushed cards from the office ("From Archangel") ------------------------
  // These are the interactive micro-service modules the contractor pushes:
  // invoice pay/approve, live crew tracker, flagged items, referral asks.
  // Cards land by intent, not by default: money → Billing, end-of-job
  // artifacts → Done, job-linked status cards follow the job's real stage.
  // "Requested" is reserved for things the client actually asked for.
  const jobByIdAll = new Map(jobs.map((j) => [j.id, j]));
  const pushLane = (c: (typeof pushed)[number]): string => {
    if (c.column === "done") return "done";
    if (c.column === "in_progress") return "in_progress";
    if (c.kind === "invoice" || c.kind === "payment_request") return "billing";
    if (c.kind === "summary") return "done";
    const job = c.jobId ? jobByIdAll.get(c.jobId) : undefined;
    if (job) {
      const { lane } = jobLane(job);
      if (lane === "done") return "done";
      const lc = lastCheckinByJob.get(job.id);
      const onSite =
        !!lc && lc.kind !== "checkout" && now - new Date(lc.createdAt).getTime() < 4 * 3_600_000;
      // Mirror the job card's own lane so the two never disagree.
      return onSite ? "in_progress" : lane;
    }
    // Live trackers/photos are always about work underway.
    if (c.kind === "tracker" || c.kind === "photos") return "in_progress";
    return "requested";
  };
  // Waiting on the client: unpaid invoices / unanswered payment requests.
  const pushNeedsAction = (
    c: (typeof pushed)[number],
    module: Record<string, unknown> | null,
  ): boolean => {
    if (c.column === "done" || c.completedAt) return false;
    if (c.kind !== "invoice" && c.kind !== "payment_request") return false;
    if (String(module?.status ?? "").toLowerCase() === "paid") return false;
    // "Payment on its way" stays in Billing, never Alerts.
    if (module?.clientPaidAt) return false;
    // Money cards get 24 hours in Billing before they escalate to Alerts.
    return now - c.createdAt.getTime() > 24 * 3_600_000;
  };
  for (const c of pushed) {
    // Old completed cards fall off after 30 days like paid invoices do.
    if (c.completedAt && now - c.completedAt.getTime() > 30 * DAY) continue;
    const links = (c.links ?? []) as { label: string; url: string; kind?: string | null }[];
    const module = (c.module ?? null) as Record<string, unknown> | null;
    // applyOverride so client/office drags stick — pushed cards were the one
    // card family skipping it, which made their moves silently snap back.
    cards.push(applyOverride({
      cardKey: `push:${c.id}`,
      template: `push_${c.kind}`,
      title: c.title,
      subtitle: "From Archangel",
      lane: pushLane(c),
      position: -1, // pushed cards sort to the top of their lane
      pipeline: ["Sent", "Seen", "Done"],
      stageIndex: c.column === "done" ? 2 : c.column === "inbox" ? 0 : 1,
      status: c.column === "done" ? "done" : "open",
      unitNo: null,
      category: c.kind,
      amount: c.amount ?? (typeof module?.amount === "number" ? (module.amount as number) : null),
      priority: null,
      dueOn: c.dueDate ?? null,
      scheduledOn: null,
      description: c.body ?? null,
      notes: null,
      crew: null,
      trackerUrl: typeof module?.trackerUrl === "string" ? (module.trackerUrl as string) : null,
      payUrl: typeof module?.payUrl === "string" ? (module.payUrl as string) : null,
      photos: [],
      actions: links.map((l, i) => ({ key: `link:${i}`, label: l.label, kind: "link", href: l.url })),
      editable: false,
      module,
      needsAction: pushNeedsAction(c, module),
      updatedAt: c.updatedAt.toISOString(),
      snoozedUntil: null,
    }));
  }

  cards.sort((a, b) => (a.position as number) - (b.position as number));
  // Cards the client cleared into history stay hidden — for every card family
  // (HALO-fed, pushed, custom) the clear is stored as an archived row.
  const clearedKeys = new Set(
    boardRows.filter((r) => r.archived).map((r) => r.cardKey),
  );

  // Auto-archive: any card that reaches Done (completed jobs, paid invoices,
  // finished pushed cards, custom cards moved to Done) is snapshotted into
  // history on the next read and removed from the board — the History tab and
  // its CSV export are the record of completed work. Completed items past the
  // 30-day projection falloff are swept straight from their source rows so
  // the history is complete even for work finished before this feature.
  // A card whose history entry was manually restored is never auto-archived
  // again, and the presentation demo board is exempt so the scripted
  // walkthrough can show cards landing in Done.
  const sweepKeys = cards
    .filter(
      (c) =>
        c.lane === "done" &&
        !c.cardKey.startsWith("push:") &&
        !clearedKeys.has(c.cardKey),
    )
    .map((c) => c.cardKey);
  for (const inv of invoices) {
    if (inv.status === "paid" && inv.paidAt && now - new Date(inv.paidAt).getTime() > 30 * DAY) {
      const key = `invoice:${inv.id}`;
      if (!clearedKeys.has(key)) sweepKeys.push(key);
    }
  }
  // Pushed cards need a CONCRETE completion signal — the projected lane alone
  // can't be trusted (summary cards land in Done by intent the day they're
  // pushed). Sweep only on: office marked done / completedAt stamped, or a
  // money card whose underlying invoice (or module state) is paid.
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  for (const c of pushed) {
    const key = `push:${c.id}`;
    if (clearedKeys.has(key)) continue;
    const module = (c.module ?? null) as Record<string, unknown> | null;
    const srcInv =
      c.sourceType === "invoice" && c.sourceId ? invoiceById.get(c.sourceId) : undefined;
    const moneyPaid =
      (c.kind === "invoice" || c.kind === "payment_request") &&
      (srcInv?.status === "paid" ||
        String(module?.status ?? "").toLowerCase() === "paid");
    if (c.column === "done" || c.completedAt || moneyPaid) sweepKeys.push(key);
  }
  if (sweepKeys.length) {
    try {
      const demo = await getPresentationDemoState();
      if (!(demo.active && demo.propertyId === propertyId)) {
        const restored = await db
          .selectDistinct({ cardKey: clientCardHistoryTable.cardKey })
          .from(clientCardHistoryTable)
          .where(
            and(
              eq(clientCardHistoryTable.propertyId, propertyId),
              isNotNull(clientCardHistoryTable.restoredAt),
              inArray(clientCardHistoryTable.cardKey, sweepKeys),
            ),
          );
        const restoredKeys = new Set(restored.map((r) => r.cardKey));
        for (const key of sweepKeys) {
          if (restoredKeys.has(key)) continue;
          const snap = await snapshotForClear(propertyId, key, null);
          if (!snap) continue;
          await archiveCardToHistory(propertyId, key, snap, null);
          clearedKeys.add(key);
        }
      }
    } catch {
      // Never let the auto-archive sweep break a board read.
    }
  }

  return cards.filter((c) => !clearedKeys.has(c.cardKey)).map(decorateWaybill);
}

// The client's own property-management board: only their cards, no HALO feed.
async function projectPmBoard(account: typeof clientAccountsTable.$inferSelect) {
  const propertyId = account.propertyId;
  const [rows, commentRows] = await Promise.all([
    db
      .select()
      .from(clientDashboardCardsTable)
      .where(
        and(
          eq(clientDashboardCardsTable.propertyId, propertyId),
          eq(clientDashboardCardsTable.board, "pm"),
        ),
      ),
    db
      .select({
        cardKey: clientCardCommentsTable.cardKey,
        n: sql<number>`count(*)::int`,
        unreadOffice: sql<number>`count(*) filter (where ${clientCardCommentsTable.authorType} = 'office' and ${clientCardCommentsTable.readAt} is null)::int`,
        unreadClient: sql<number>`count(*) filter (where ${clientCardCommentsTable.authorType} = 'client' and ${clientCardCommentsTable.readAt} is null)::int`,
      })
      .from(clientCardCommentsTable)
      .where(eq(clientCardCommentsTable.propertyId, propertyId))
      .groupBy(clientCardCommentsTable.cardKey),
  ]);
  const commentCountByKey = new Map(commentRows.map((r) => [r.cardKey, r.n]));
  const pmUnreadOffice = new Map(commentRows.map((r) => [r.cardKey, r.unreadOffice]));
  const pmUnreadClient = new Map(commentRows.map((r) => [r.cardKey, r.unreadClient]));
  const now = Date.now();
  const cards = rows
    .filter((c) => c.kind === "custom" && !c.archived)
    .map((c) => ({
      cardKey: c.cardKey,
      template: c.template ?? "custom",
      title: c.title ?? "Untitled",
      subtitle: c.createdBy ? `Added by ${c.createdBy}` : null,
      lane: c.lane && PM_LANE_KEYS.has(c.lane) ? c.lane : "planning",
      position: c.position,
      pipeline: ["Open", "Done"],
      stageIndex: c.lane === "done" ? 1 : 0,
      status: null,
      unitNo: null,
      category: null,
      amount: null,
      priority: c.priority ?? null,
      dueOn: c.dueOn ?? null,
      scheduledOn: null,
      description: c.description ?? null,
      notes: c.notes ?? null,
      crew: null,
      trackerUrl: null,
      payUrl: null,
      photos: [],
      actions: [{ key: "card.archive", label: "Archive", kind: "secondary", href: null }],
      editable: true,
      updatedAt: c.updatedAt.toISOString(),
      snoozedUntil:
        c.snoozedUntil && c.snoozedUntil.getTime() > now ? c.snoozedUntil.toISOString() : null,
      labels: Array.isArray(c.labels) ? c.labels : [],
      checklist: Array.isArray(c.checklist) ? c.checklist : [],
      commentCount: commentCountByKey.get(c.cardKey) ?? 0,
      unreadComments: pmUnreadOffice.get(c.cardKey) ?? 0,
      unreadFromClient: pmUnreadClient.get(c.cardKey) ?? 0,
      sentToOffice: c.sentToOfficeAt
        ? {
            sentAt: c.sentToOfficeAt.toISOString(),
            status: c.officeStatus ?? "pending",
            note: c.officeNote ?? null,
          }
        : null,
    }))
    .map(decorateWaybill);
  cards.sort((a, b) => a.position - b.position);
  return cards;
}

// ---------------------------------------------------------------------------
// AI card builder — the client asks in plain language, the AI picks the right
// interactive card kind + real HALO entities, and the SERVER builds the module
// deterministically (AI never invents amounts, links, or ids).
// ---------------------------------------------------------------------------
router.post("/client/:token/board/ai-card", async (req, res): Promise<void> => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt || prompt.length > 600) {
    res.status(400).json({ error: "Tell HALO what card to build (up to 600 characters)" });
    return;
  }
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const viewer = await resolveViewer(req, account.propertyId);
  const denied = requireWriter(viewer);
  if (denied) {
    res.status(403).json({ error: denied });
    return;
  }
  const propertyId = account.propertyId;
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  if (!prop) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  const [invoices, jobs, bids] = await Promise.all([
    db.select().from(invoicesTable).where(eq(invoicesTable.propertyId, propertyId)),
    db.select().from(jobsTable).where(eq(jobsTable.propertyId, propertyId)),
    db.select().from(bidsTable).where(eq(bidsTable.propertyId, propertyId)),
  ]);
  const openInvoices = invoices.filter((i) => i.status !== "cancelled");
  const activeJobs = jobs.filter((j) => !j.clearedAt);
  const snapshot = {
    property: { name: prop.name, address: prop.address ?? null },
    invoices: openInvoices.slice(0, 40).map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      amount: i.amount,
      status: i.status,
      dueDate: i.dueAt ? i.dueAt.toISOString().slice(0, 10) : null,
    })),
    jobs: activeJobs.slice(0, 30).map((j) => ({
      id: j.id,
      title: j.description ?? j.jobNo,
      status: j.status,
      scheduledOn: j.scheduledOn ?? null,
    })),
    bids: bids.slice(0, 20).map((b) => ({
      id: b.id,
      bidNo: b.bidNo,
      title: b.scope ?? b.bidNo,
      amount: b.amount,
      status: b.status,
    })),
  };
  type AiPick = {
    kind: string;
    title?: string;
    body?: string;
    invoiceIds?: string[];
    bidId?: string;
    jobId?: string;
    actionLabel?: string;
  };
  let pick: AiPick;
  try {
    pick = await completeJson<AiPick>(
      `You compose ONE interactive card for a property client's board from live HALO data. Pick the best kind for the request:
- "crewmap": live crews on site / who's working / where (also covers addresses & site activity)
- "invoice": ONE specific invoice (set invoiceIds to exactly that id)
- "invoice_batch": several invoices / "all my invoices" / balances due (set invoiceIds)
- "bid": a bid/proposal (set bidId)
- "tracker": live progress of ONE job (set jobId)
- "flag": items flagged for attention across units
- "summary": recap of a completed job (set jobId)
- "note": anything else — plain informational card (put content in body)
Use ONLY ids present in the data. Title ≤ 60 chars, client-friendly. Body: 1-2 sentences referencing real facts (amounts in dollars, the address, dates). Return JSON: {"kind","title","body","invoiceIds","bidId","jobId","actionLabel"}.`,
      `Client request: ${JSON.stringify(prompt)}\n\nLive HALO data for ${prop.name}:\n${JSON.stringify(snapshot)}`,
      1500,
    );
  } catch {
    res.status(502).json({ error: "HALO couldn't compose that card — try rephrasing" });
    return;
  }
  const title = (pick.title ?? "").trim().slice(0, 80) || "From HALO";
  const bodyText = (pick.body ?? "").trim().slice(0, 500) || null;
  const invoiceIds = (pick.invoiceIds ?? []).filter((x) => invoices.some((i) => i.id === x));
  const jobOk = pick.jobId && jobs.some((j) => j.id === pick.jobId);
  const bidOk = pick.bidId && bids.some((b) => b.id === pick.bidId);
  // Build the module deterministically from validated ids only.
  let module: Record<string, unknown> | null = null;
  let cardKind: "invoice" | "tracker" | "flag" | "summary" | "manual" = "manual";
  let sourceType = "ai";
  let sourceId = `ai:${Date.now()}`;
  try {
    if (pick.kind === "crewmap") {
      module = await buildCrewMapModule(propertyId);
      cardKind = "tracker";
      sourceType = "crewmap";
      sourceId = propertyId;
    } else if (pick.kind === "invoice" && invoiceIds.length === 1) {
      module = await buildInvoiceModule(propertyId, invoiceIds[0]!);
      cardKind = "invoice";
      sourceType = "invoice";
      sourceId = invoiceIds[0]!;
    } else if ((pick.kind === "invoice_batch" || pick.kind === "invoice") && invoiceIds.length > 0) {
      module = await buildInvoiceBatchModule(propertyId, invoiceIds);
      cardKind = "invoice";
      sourceType = "invoice_batch";
      sourceId = createHmac("sha1", "ai").update([...invoiceIds].sort().join(",")).digest("hex").slice(0, 32);
    } else if (pick.kind === "bid" && bidOk) {
      module = await buildBidModule(propertyId, pick.bidId!);
      sourceType = "bid";
      sourceId = pick.bidId!;
    } else if (pick.kind === "tracker" && jobOk) {
      module = await buildTrackerModule(propertyId, pick.jobId!);
      cardKind = "tracker";
      sourceType = "tracker";
      sourceId = pick.jobId!;
    } else if (pick.kind === "flag") {
      module = await buildFlagsModule(propertyId);
      cardKind = "flag";
      sourceType = "flag";
      sourceId = propertyId;
    } else if (pick.kind === "summary" && jobOk) {
      module = await buildSummaryModule(propertyId, pick.jobId!);
      cardKind = "summary";
      sourceType = "summary";
      sourceId = pick.jobId!;
    }
  } catch {
    module = null;
  }
  const card = await raiseClientCard({
    propertyId,
    kind: cardKind,
    module,
    title,
    body: bodyText,
    actionLabel: (pick.actionLabel ?? "").trim().slice(0, 40) || null,
    amount: null,
    dueDate: null,
    links: [],
    sourceType,
    sourceId,
    jobId: jobOk ? pick.jobId! : null,
  });
  if (!card) {
    res.status(400).json({ error: "Couldn't create the card" });
    return;
  }
  res.status(201).json({ cardId: card.id, title: card.title, kind: card.kind });
});

router.get(["/client/:token/board", "/client/:token/board/pm"], async (req, res): Promise<void> => {
  const prefer = typeof req.query.property === "string" ? req.query.property : null;
  const account = await accountByToken(String(req.params.token), prefer);
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const viewer = await resolveViewer(req, account.propertyId);
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, account.propertyId))
    .limit(1);
  const [biz] = await db.select().from(businessSettingsTable).limit(1);
  const boardKind = req.path.endsWith("/pm") ? "pm" : "vendor";
  const [cards, audit] = await Promise.all([
    boardKind === "pm" ? projectPmBoard(account) : projectBoard(account),
    db
      .select()
      .from(clientDashboardActionsTable)
      .where(eq(clientDashboardActionsTable.propertyId, account.propertyId))
      .orderBy(desc(clientDashboardActionsTable.createdAt))
      .limit(20),
  ]);
  res.json(
    GetClientBoardResponse.parse({
      propertyName: prop?.name ?? "Your property",
      propertyAddress: prop?.address ?? null,
      logoUrl: account.logoPath ? storageUrl(account.logoPath) : null,
      servicesOverview: account.servicesOverview ?? null,
      businessName: biz?.companyName ?? null,
      viewer: viewerDto(viewer),
      lanes: boardKind === "pm" ? PM_LANES : LANES,
      cards,
      unreadMessages: (cards as Array<Record<string, unknown>>).reduce<number>(
        (s, c) => s + (typeof c.unreadComments === "number" ? c.unreadComments : 0),
        0,
      ),
      audit: audit.map((a) => ({
        action: a.action,
        cardKey: a.cardKey,
        actorName: a.actorName,
        actorRole: a.actorRole,
        ok: a.ok,
        blocked: a.blocked,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
    }),
  );
});

// ---------------------------------------------------------------------------
// Office full board — the SAME projected vendor board the client sees, served
// to the admin apps so the office view is pixel-identical and always in sync.
// ---------------------------------------------------------------------------
// Office-side full board projection for a property. Extracted so other
// surfaces (Presentation Mode's public demo office-board endpoint) render the
// exact same office view. Returns null when the property has no client account.
export async function getOfficeBoardFull(
  propertyId: string,
): Promise<Record<string, unknown> | null> {
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.propertyId, propertyId))
    .limit(1);
  if (!account) return null;
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  const [biz] = await db.select().from(businessSettingsTable).limit(1);
  const [cards, audit] = await Promise.all([
    projectBoard(account),
    db
      .select()
      .from(clientDashboardActionsTable)
      .where(eq(clientDashboardActionsTable.propertyId, propertyId))
      .orderBy(desc(clientDashboardActionsTable.createdAt))
      .limit(20),
  ]);
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  const dashboardUrl =
    account.status === "active"
      ? domain
        ? `https://${domain}/board/${account.dashboardToken}`
        : `/board/${account.dashboardToken}`
      : null;
  return {
    propertyName: prop?.name ?? "Property",
    dashboardUrl,
    board: {
      propertyName: prop?.name ?? "Your property",
      propertyAddress: prop?.address ?? null,
      logoUrl: account.logoPath ? storageUrl(account.logoPath) : null,
      servicesOverview: account.servicesOverview ?? null,
      businessName: biz?.companyName ?? null,
      viewer: {
        authenticated: true,
        name: "Archangel Office",
        email: null,
        role: "office",
        permissions: [],
        readOnly: false,
        tourSeen: true,
      },
      lanes: LANES,
      cards,
      audit: audit.map((a) => ({
        action: a.action,
        cardKey: a.cardKey,
        actorName: a.actorName,
        actorRole: a.actorRole,
        ok: a.ok,
        blocked: a.blocked,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
    },
  };
}

router.get("/admin/accounts/:propertyId/board/full", async (req, res): Promise<void> => {
  const propertyId = String(req.params.propertyId);
  const full = await getOfficeBoardFull(propertyId);
  if (!full) {
    res.status(404).json({ error: "No client account for this property yet" });
    return;
  }
  res.json(full);
});

// ---------------------------------------------------------------------------
// Custom cards
// ---------------------------------------------------------------------------
export function requireWriter(viewer: Viewer): string | null {
  if (!viewer.authenticated) return "Sign in to make changes";
  if (viewer.readOnly) return "Your access is view-only";
  return null;
}

router.post("/client/:token/board/cards", async (req, res): Promise<void> => {
  const parsed = CreateClientBoardCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const viewer = await resolveViewer(req, account.propertyId);
  const denied = requireWriter(viewer);
  if (denied) {
    res.status(403).json({ error: denied });
    return;
  }
  const body = parsed.data;
  const title = body.title.trim();
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  const board = body.board === "pm" ? "pm" : "vendor";
  const laneOk = board === "pm" ? PM_LANE_KEYS.has(body.lane) : LANE_KEYS.has(body.lane);
  if (!laneOk) {
    res.status(400).json({ error: "Unknown lane" });
    return;
  }
  const [row] = await db
    .insert(clientDashboardCardsTable)
    .values({
      propertyId: account.propertyId,
      cardKey: `custom:${crypto.randomUUID()}`,
      kind: "custom",
      board,
      lane: body.lane,
      position: Date.now(),
      title,
      template: body.template && TEMPLATE_KEY_RE.test(body.template) ? body.template : null,
      description: body.description ?? null,
      notes: body.notes ?? null,
      priority: body.priority ?? null,
      dueOn: body.dueOn ?? null,
      labels: Array.isArray(body.labels) ? body.labels : undefined,
      checklist: Array.isArray(body.checklist) ? body.checklist : undefined,
      createdBy: viewer.name,
    })
    .returning();
  emitBoardEvent(account.propertyId, "dashboard");
  res.status(201).json(
    CreateClientBoardCardResponse.parse({
      cardKey: row!.cardKey,
      lane: row!.lane,
      title: row!.title,
      notes: row!.notes,
    }),
  );
});

router.patch(
  "/client/:token/board/cards/:cardKey",
  async (req, res): Promise<void> => {
    const parsed = UpdateClientBoardCardBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const account = await accountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    const viewer = await resolveViewer(req, account.propertyId);
    const denied = requireWriter(viewer);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }
    const cardKey = String(req.params.cardKey);
    const body = parsed.data;
    const isCustom = cardKey.startsWith("custom:");

    const [existing] = await db
      .select()
      .from(clientDashboardCardsTable)
      .where(
        and(
          eq(clientDashboardCardsTable.propertyId, account.propertyId),
          eq(clientDashboardCardsTable.cardKey, cardKey),
        ),
      )
      .limit(1);

    if (isCustom) {
      if (!existing) {
        res.status(404).json({ error: "Card not found" });
        return;
      }
      const [row] = await db
        .update(clientDashboardCardsTable)
        .set({
          title: body.title !== undefined && body.title !== null ? body.title : existing.title,
          description: body.description !== undefined ? body.description : existing.description,
          notes: body.notes !== undefined ? body.notes : existing.notes,
          priority: body.priority !== undefined ? body.priority : existing.priority,
          dueOn: body.dueOn !== undefined ? body.dueOn : existing.dueOn,
          archived: body.archived ?? existing.archived,
          labels: body.labels !== undefined ? body.labels : existing.labels,
          checklist: body.checklist !== undefined ? body.checklist : existing.checklist,
          updatedAt: new Date(),
        })
        .where(eq(clientDashboardCardsTable.id, existing.id))
        .returning();
      res.json(
        UpdateClientBoardCardResponse.parse({
          cardKey: row!.cardKey,
          lane: row!.lane,
          title: row!.title,
          notes: row!.notes,
        }),
      );
      return;
    }

    // HALO-fed card: notes, labels, and checklist are client-editable,
    // stored as an override. Everything else is HALO's to compute.
    if (body.notes === undefined && body.labels === undefined && body.checklist === undefined) {
      res.status(400).json({ error: "Only notes, labels, and checklist can be edited on HALO cards" });
      return;
    }
    const overlay: Partial<typeof clientDashboardCardsTable.$inferInsert> = {};
    if (body.notes !== undefined) overlay.notes = body.notes;
    if (body.labels !== undefined) overlay.labels = body.labels;
    if (body.checklist !== undefined) overlay.checklist = body.checklist;
    if (existing) {
      const [row] = await db
        .update(clientDashboardCardsTable)
        .set({ ...overlay, updatedAt: new Date() })
        .where(eq(clientDashboardCardsTable.id, existing.id))
        .returning();
      emitBoardEvent(account.propertyId, "dashboard");
      res.json(
        UpdateClientBoardCardResponse.parse({
          cardKey: row!.cardKey,
          lane: row!.lane,
          title: row!.title,
          notes: row!.notes,
        }),
      );
      return;
    }
    const [row] = await db
      .insert(clientDashboardCardsTable)
      .values({
        propertyId: account.propertyId,
        cardKey,
        kind: "override",
        ...overlay,
        position: Date.now(),
        createdBy: viewer.name,
      })
      .returning();
    emitBoardEvent(account.propertyId, "dashboard");
    res.json(
      UpdateClientBoardCardResponse.parse({
        cardKey: row!.cardKey,
        lane: row!.lane,
        title: row!.title,
        notes: row!.notes,
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// Action registry — every board button resolves to one named action here.
// Guards can block with a reason; everything is audited.
// ---------------------------------------------------------------------------
type ActionCtx = {
  account: typeof clientAccountsTable.$inferSelect;
  viewer: Viewer;
  cardKey: string | null;
  payload: Record<string, unknown>;
};
type ActionOutcome = {
  ok: boolean;
  blocked: boolean;
  reason?: string;
  message?: string;
  result?: Record<string, unknown>;
};

async function jobFromCardKey(
  ctx: ActionCtx,
  prefix: "job" | "crew",
): Promise<Job | undefined> {
  if (!ctx.cardKey?.startsWith(`${prefix}:`)) return undefined;
  const jobId = ctx.cardKey.slice(prefix.length + 1);
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.propertyId, ctx.account.propertyId)))
    .limit(1);
  return job;
}

// Current lane check for the "can't drag into Done" guards: a card already
// sitting in Done (via client override or HALO's own computed lane) may be
// reordered within Done.
async function cardCurrentlyInDone(ctx: ActionCtx): Promise<boolean> {
  if (!ctx.cardKey) return false;
  const [override] = await db
    .select()
    .from(clientDashboardCardsTable)
    .where(
      and(
        eq(clientDashboardCardsTable.propertyId, ctx.account.propertyId),
        eq(clientDashboardCardsTable.cardKey, ctx.cardKey),
      ),
    )
    .limit(1);
  if (override?.lane) return override.lane === "done";
  if (ctx.cardKey.startsWith("job:") || ctx.cardKey.startsWith("crew:")) {
    const job = await jobFromCardKey(ctx, ctx.cardKey.startsWith("job:") ? "job" : "crew");
    return !!job && jobLane(job).lane === "done";
  }
  if (ctx.cardKey.startsWith("invoice:")) {
    const id = ctx.cardKey.slice("invoice:".length);
    const [inv] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, id), eq(invoicesTable.propertyId, ctx.account.propertyId)))
      .limit(1);
    return !!inv && inv.status === "paid";
  }
  return false;
}

const ACTIONS: Record<
  string,
  { requiresWrite: boolean; run: (ctx: ActionCtx) => Promise<ActionOutcome> }
> = {
  // Drag between lanes. HALO owns real completion — jobs can't be dragged to
  // Done from the client side; that's a guard, not an error.
  "card.moved": {
    requiresWrite: true,
    run: async (ctx) => {
      const lane = String(ctx.payload.lane ?? "");
      const position = Number(ctx.payload.position ?? Date.now());
      // Full order of the target lane after the drop (drop-position support).
      // When present, every card in the lane gets position = its index, so the
      // moved card's `position` payload is the literal drop index.
      const orderedCardKeys = Array.isArray(ctx.payload.orderedCardKeys)
        ? (ctx.payload.orderedCardKeys as unknown[]).filter(
            (k): k is string => typeof k === "string" && k.length > 0,
          )
        : null;
      if (!ctx.cardKey) return { ok: false, blocked: false, reason: "cardKey required" };
      if (!ANY_LANE_KEYS.has(lane)) return { ok: false, blocked: false, reason: "Unknown lane" };
      // Lanes are board-specific: a PM card can only move within PM lanes,
      // everything else (HALO-fed + vendor customs) within vendor lanes.
      let cardBoard = "vendor";
      if (ctx.cardKey.startsWith("custom:")) {
        const [row] = await db
          .select({ board: clientDashboardCardsTable.board })
          .from(clientDashboardCardsTable)
          .where(
            and(
              eq(clientDashboardCardsTable.propertyId, ctx.account.propertyId),
              eq(clientDashboardCardsTable.cardKey, ctx.cardKey),
            ),
          )
          .limit(1);
        if (row?.board === "pm") cardBoard = "pm";
      }
      const boardLaneOk = cardBoard === "pm" ? PM_LANE_KEYS.has(lane) : LANE_KEYS.has(lane);
      if (!boardLaneOk) return { ok: false, blocked: false, reason: "Unknown lane" };
      // Dropping INTO Done is HALO's call — but reordering a card that is
      // already in Done stays allowed (same-lane drops target "done" too).
      const alreadyInDone = lane === "done" ? await cardCurrentlyInDone(ctx) : false;
      if (
        (ctx.cardKey.startsWith("job:") || ctx.cardKey.startsWith("crew:")) &&
        lane === "done" &&
        !alreadyInDone
      ) {
        return {
          ok: false,
          blocked: true,
          reason: "Only the crew in the field can mark work done — it moves when HALO confirms completion",
        };
      }
      if (ctx.cardKey.startsWith("invoice:") && lane === "done" && !alreadyInDone) {
        return {
          ok: false,
          blocked: true,
          reason: "Invoices move to Done when payment clears in HALO",
        };
      }
      const movedPosition = orderedCardKeys
        ? Math.max(0, orderedCardKeys.indexOf(ctx.cardKey))
        : Number.isFinite(position)
          ? position
          : Date.now();
      if (ctx.cardKey.startsWith("custom:")) {
        await db
          .update(clientDashboardCardsTable)
          .set({ lane, position: movedPosition, updatedAt: new Date() })
          .where(
            and(
              eq(clientDashboardCardsTable.propertyId, ctx.account.propertyId),
              eq(clientDashboardCardsTable.cardKey, ctx.cardKey),
            ),
          );
      } else {
        // Override placement for HALO-fed cards
        await db
          .insert(clientDashboardCardsTable)
          .values({
            propertyId: ctx.account.propertyId,
            cardKey: ctx.cardKey,
            kind: "override",
            lane,
            position: movedPosition,
            createdBy: ctx.viewer.name,
          })
          .onConflictDoUpdate({
            target: [clientDashboardCardsTable.propertyId, clientDashboardCardsTable.cardKey],
            set: {
              lane,
              position: movedPosition,
              updatedAt: new Date(),
            },
          });
      }
      // Re-index the rest of the target lane so the drop order sticks. These
      // writes touch position ONLY — never lane — so HALO keeps recomputing
      // lanes for cards the client didn't move.
      if (orderedCardKeys) {
        for (let i = 0; i < orderedCardKeys.length; i++) {
          const key = orderedCardKeys[i]!;
          if (key === ctx.cardKey) continue;
          await db
            .insert(clientDashboardCardsTable)
            .values({
              propertyId: ctx.account.propertyId,
              cardKey: key,
              kind: "override",
              position: i,
              createdBy: ctx.viewer.name,
            })
            .onConflictDoUpdate({
              target: [
                clientDashboardCardsTable.propertyId,
                clientDashboardCardsTable.cardKey,
              ],
              set: { position: i, updatedAt: new Date() },
            });
        }
      }
      return { ok: true, blocked: false, message: "Card moved" };
    },
  },

  // Triage "Defer" — snooze a card out of the triage queue server-side so it
  // stays hidden across refreshes and devices, then returns when it expires.
  "card.snoozed": {
    requiresWrite: true,
    run: async (ctx) => {
      if (!ctx.cardKey) return { ok: false, blocked: false, reason: "cardKey required" };
      const rawDays = Number(ctx.payload.days ?? 1);
      const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 30) : 1;
      const until = new Date(Date.now() + days * 86_400_000);
      if (ctx.cardKey.startsWith("custom:")) {
        const updated = await db
          .update(clientDashboardCardsTable)
          .set({ snoozedUntil: until, updatedAt: new Date() })
          .where(
            and(
              eq(clientDashboardCardsTable.propertyId, ctx.account.propertyId),
              eq(clientDashboardCardsTable.cardKey, ctx.cardKey),
            ),
          )
          .returning();
        if (!updated.length) return { ok: false, blocked: false, reason: "Card not found" };
      } else {
        // Snooze rides on the same override row used for lane placement.
        await db
          .insert(clientDashboardCardsTable)
          .values({
            propertyId: ctx.account.propertyId,
            cardKey: ctx.cardKey,
            kind: "override",
            snoozedUntil: until,
            createdBy: ctx.viewer.name,
          })
          .onConflictDoUpdate({
            target: [clientDashboardCardsTable.propertyId, clientDashboardCardsTable.cardKey],
            set: { snoozedUntil: until, updatedAt: new Date() },
          });
      }
      return {
        ok: true,
        blocked: false,
        message: `Deferred for ${days} day${days === 1 ? "" : "s"}`,
        result: { snoozedUntil: until.toISOString() },
      };
    },
  },

  "card.archive": {
    requiresWrite: true,
    run: async (ctx) => {
      if (!ctx.cardKey?.startsWith("custom:"))
        return { ok: false, blocked: true, reason: "Only your own cards can be archived" };
      const updated = await db
        .update(clientDashboardCardsTable)
        .set({ archived: true, updatedAt: new Date() })
        .where(
          and(
            eq(clientDashboardCardsTable.propertyId, ctx.account.propertyId),
            eq(clientDashboardCardsTable.cardKey, ctx.cardKey),
          ),
        )
        .returning();
      if (!updated.length) return { ok: false, blocked: false, reason: "Card not found" };
      return { ok: true, blocked: false, message: "Card archived" };
    },
  },

  // PM approves HALO Walk findings from the client board → moves the
  // card to In Progress and marks the underlying job as PM-approved so
  // the office job board can show a gold flash.
  "walk.approve": {
    requiresWrite: true,
    run: async (ctx) => {
      if (!ctx.cardKey?.startsWith("push:"))
        return { ok: false, blocked: false, reason: "Not a walk findings card" };
      const cardId = ctx.cardKey.slice("push:".length);
      const jobId = typeof ctx.payload.jobId === "string" ? ctx.payload.jobId : null;
      if (!jobId) return { ok: false, blocked: false, reason: "jobId required" };
      // Verify the job belongs to this property.
      const [job] = await db
        .select()
        .from(jobsTable)
        .where(
          and(eq(jobsTable.id, jobId), eq(jobsTable.propertyId, ctx.account.propertyId)),
        )
        .limit(1);
      if (!job) return { ok: false, blocked: true, reason: "Job not found" };
      // Mark the job PM-approved (idempotent).
      // Cast: walkApprovedAt was added in a schema migration; the compiled
      // project-reference declarations lag until the next clean lib/db build,
      // but the column exists in the DB and the runtime behaviour is correct.
      if (!(job as any).walkApprovedAt) {
        await db
          .update(jobsTable)
          .set({ walkApprovedAt: new Date() } as any)
          .where(eq(jobsTable.id, jobId));
      }
      // Move the push card to in_progress and stamp approvedAt on the module
      // so the card knows it is approved on next read.
      const [card] = await db
        .select()
        .from(clientBoardCardsTable)
        .where(
          and(
            eq(clientBoardCardsTable.id, cardId),
            eq(clientBoardCardsTable.propertyId, ctx.account.propertyId),
          ),
        )
        .limit(1);
      if (card) {
        const updatedModule = {
          ...(card.module ?? {}),
          approvedAt: new Date().toISOString(),
          approvedBy: ctx.viewer.name ?? "Property Manager",
          canApprove: false,
        };
        await db
          .update(clientBoardCardsTable)
          .set({ column: "in_progress", module: updatedModule, updatedAt: new Date() })
          .where(eq(clientBoardCardsTable.id, cardId));
      }
      await db.insert(activitiesTable).values({
        entityType: "job",
        entityId: jobId,
        kind: "note",
        body: `${ctx.viewer.name ?? "Property Manager"} approved HALO Walk findings — job is now in the work queue`,
      });
      // Notify the assigned crew so their portal badge increments.
      if (job.crewLeaderId) {
        await db.insert(activitiesTable).values({
          entityType: "crew",
          entityId: job.crewLeaderId,
          kind: "walk_approved",
          body: `Walk findings approved for job ${job.jobNo ?? jobId} — work is a go`,
        });
        void pushToCrewId(job.crewLeaderId, {
          title: "✅ Walk approved — work is a go",
          body: `Walk findings approved for job ${job.jobNo ?? jobId}.`,
          data: { kind: "walk_approved", jobId },
        });
      }
      // Falkon Ops: resident-ready signal — the highest-value event in the
      // make-ready pipeline.  Fire-and-forget; never throws.
      void emitFalkonEvent("job.walk_approved", "job", jobId, {
        jobId,
        jobNo: job.jobNo,
        propertyId: job.propertyId,
        unitNo: job.unitNo,
        approvedBy: ctx.viewer.name ?? "Property Manager",
        approvedAt: new Date().toISOString(),
      });
      // Falkon Make-Ready: auto-start an execution so dispatch can track
      // this unit through the 12-phase pipeline without manual setup.
      void startMakeReadyExecution(jobId);
      return {
        ok: true,
        blocked: false,
        message: "Walk findings approved — this job is now in your work queue.",
      };
    },
  },

  // Real HALO action: client approves a pending work request from their board.
  // Calls the same acceptWorkRequest() path the office uses, creates a job,
  // then sets an in_progress lane override so the card surfaces in the correct
  // column on both the client board and the office mirror immediately.
  "request.approve": {
    requiresWrite: true,
    run: async (ctx) => {
      if (!ctx.cardKey?.startsWith("request:"))
        return { ok: false, blocked: false, reason: "Not a request card" };
      const id = ctx.cardKey.slice("request:".length);
      // Confirm the request belongs to this property before accepting.
      const [wr] = await db
        .select()
        .from(workRequestsTable)
        .where(
          and(
            eq(workRequestsTable.id, id),
            eq(workRequestsTable.propertyId, ctx.account.propertyId),
          ),
        )
        .limit(1);
      if (!wr) return { ok: false, blocked: false, reason: "Request not found" };
      if (wr.status !== "pending")
        return {
          ok: false,
          blocked: true,
          reason: `This request was already ${wr.status}`,
        };

      let jobId: string;
      let jobNo: string;
      try {
        ({ jobId, jobNo } = await acceptWorkRequest(id, {}));
      } catch (e) {
        if (e instanceof Error && e.message === "ALREADY_DECIDED")
          return { ok: false, blocked: true, reason: "Request was already decided" };
        throw e;
      }

      // Place the new job card immediately in the In Progress column so both
      // the client and the office see it there without waiting for a crew
      // check-in (an override record is cheaply overwritten if the office moves
      // it later).
      await db
        .insert(clientDashboardCardsTable)
        .values({
          propertyId: ctx.account.propertyId,
          cardKey: `job:${jobId}`,
          kind: "override",
          board: "vendor",
          lane: "in_progress",
          position: 0,
        })
        .onConflictDoUpdate({
          target: [clientDashboardCardsTable.propertyId, clientDashboardCardsTable.cardKey],
          set: { lane: "in_progress", updatedAt: new Date() },
        });

      // Notify the office that the client approved the work.
      await db.insert(notificationsTable).values({
        kind: "client_dashboard",
        title: `Client approved work request — Job ${jobNo} created`,
        body: `${ctx.viewer.name ?? "Property Manager"} approved "${wr.serviceLabel}"${wr.unitNo ? ` on unit ${wr.unitNo}` : ""} from the client dashboard. Job ${jobNo} is now in the work queue.`,
        entityType: "job",
        entityId: jobId,
      });

      // emitBoardEvent already fired inside acceptWorkRequest; no second call needed.
      return {
        ok: true,
        blocked: false,
        message: `Approved — Job ${jobNo} is now in your work queue. Our team will be in touch soon.`,
      };
    },
  },

  // Real HALO action: cancel a pending work request.
  "request.cancel": {
    requiresWrite: true,
    run: async (ctx) => {
      if (!ctx.cardKey?.startsWith("request:"))
        return { ok: false, blocked: false, reason: "Not a request card" };
      const id = ctx.cardKey.slice("request:".length);
      const [wr] = await db
        .select()
        .from(workRequestsTable)
        .where(
          and(
            eq(workRequestsTable.id, id),
            eq(workRequestsTable.propertyId, ctx.account.propertyId),
          ),
        )
        .limit(1);
      if (!wr) return { ok: false, blocked: false, reason: "Request not found" };
      if (wr.status !== "pending")
        return { ok: false, blocked: true, reason: `This request was already ${wr.status}` };
      await db
        .update(workRequestsTable)
        .set({
          status: "declined",
          declineReason: `Cancelled by ${ctx.viewer.name ?? "client"} from the dashboard`,
          decidedAt: new Date(),
        })
        .where(eq(workRequestsTable.id, wr.id));
      await db.insert(activitiesTable).values({
        entityType: "property",
        entityId: ctx.account.propertyId,
        kind: "note",
        body: `Client cancelled work request "${wr.serviceLabel}" from their dashboard`,
      });
      return { ok: true, blocked: false, message: "Request cancelled" };
    },
  },

  // Real HALO action: ping the office for a status update on a job.
  "job.request_update": {
    requiresWrite: true,
    run: async (ctx) => {
      const job = (await jobFromCardKey(ctx, "job")) ?? (await jobFromCardKey(ctx, "crew"));
      if (!job) return { ok: false, blocked: false, reason: "Job not found" };
      const who = ctx.viewer.name ?? "A client";
      await Promise.all([
        db.insert(activitiesTable).values({
          entityType: "job",
          entityId: job.id,
          kind: "note",
          body: `${who} requested a status update on Job ${job.jobNo} from the client dashboard`,
        }),
        db.insert(notificationsTable).values({
          kind: "client_dashboard",
          title: `Client wants an update on Job ${job.jobNo}`,
          body: `${who} asked for a status update${job.unitNo ? ` (unit ${job.unitNo})` : ""} from the client dashboard.`,
          entityType: "job",
          entityId: job.id,
        }),
      ]);
      return { ok: true, blocked: false, message: "The office has been notified — expect an update shortly" };
    },
  },

  // Real HALO action: ask where the crew is right now.
  "crew.locate_requested": {
    requiresWrite: true,
    run: async (ctx) => {
      const job = (await jobFromCardKey(ctx, "crew")) ?? (await jobFromCardKey(ctx, "job"));
      if (!job) return { ok: false, blocked: false, reason: "Job not found" };
      const who = ctx.viewer.name ?? "A client";
      await db.insert(notificationsTable).values({
        kind: "client_dashboard",
        title: `Client asked where the crew is (Job ${job.jobNo})`,
        body: `${who} asked for the crew's location on Job ${job.jobNo} from the client dashboard.`,
        entityType: "job",
        entityId: job.id,
      });
      return {
        ok: true,
        blocked: false,
        message: "We pinged the crew — check the live tracker for their latest location",
      };
    },
  },

  "invoice.mark_reviewed": {
    requiresWrite: true,
    run: async (ctx) => {
      if (!ctx.cardKey?.startsWith("invoice:"))
        return { ok: false, blocked: false, reason: "Not an invoice card" };
      const id = ctx.cardKey.slice("invoice:".length);
      const [inv] = await db
        .select()
        .from(invoicesTable)
        .where(
          and(eq(invoicesTable.id, id), eq(invoicesTable.propertyId, ctx.account.propertyId)),
        )
        .limit(1);
      if (!inv) return { ok: false, blocked: false, reason: "Invoice not found" };
      await db.insert(activitiesTable).values({
        entityType: "invoice",
        entityId: inv.id,
        kind: "note",
        body: `${ctx.viewer.name ?? "Client"} marked Invoice ${inv.invoiceNo} reviewed on the client dashboard`,
      });
      return { ok: true, blocked: false, message: `Invoice ${inv.invoiceNo} marked reviewed` };
    },
  },
  "invoice.pay_by_check": {
    requiresWrite: true,
    run: (ctx) => choosePaymentRoute(ctx, "check"),
  },
  "invoice.pay_by_platform": {
    requiresWrite: true,
    run: (ctx) => choosePaymentRoute(ctx, "platform"),
  },
};

/** Resolve the invoice behind a card key — live (invoice:<id>) or pushed (push:<rowId>). */
async function invoiceFromCardKey(cardKey: string | null, propertyId: string) {
  let invoiceId: string | null = null;
  if (cardKey?.startsWith("invoice:")) invoiceId = cardKey.slice("invoice:".length);
  else if (cardKey?.startsWith("push:")) {
    const [row] = await db
      .select()
      .from(clientBoardCardsTable)
      .where(eq(clientBoardCardsTable.id, cardKey.slice("push:".length)))
      .limit(1);
    if (row?.sourceType === "invoice") invoiceId = row.sourceId;
  }
  if (!invoiceId) return null;
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.propertyId, propertyId)))
    .limit(1);
  return inv ?? null;
}

/**
 * Client picked how they'll pay ("mail a check" / "upload to payment
 * platform"). Records the choice on the invoice and moves the job card to
 * the Billing rail on the office board — payment now pending.
 */
async function choosePaymentRoute(
  ctx: ActionCtx,
  method: "check" | "platform",
): Promise<ActionOutcome> {
  const inv = await invoiceFromCardKey(ctx.cardKey, ctx.account.propertyId);
  if (!inv) return { ok: false, blocked: false, reason: "Invoice not found" };
  if (inv.status === "paid")
    return { ok: false, blocked: false, reason: "Invoice is already paid" };
  await db
    .update(invoicesTable)
    .set({
      paymentChoice: method,
      paymentChoicePlatform: method === "platform" ? "client platform" : null,
      paymentChoiceAt: new Date(),
    })
    .where(eq(invoicesTable.id, inv.id));
  if (inv.jobId) {
    await db
      .update(jobsTable)
      .set({ boardStatus: "billing" })
      .where(eq(jobsTable.id, inv.jobId));
  }
  await db.insert(activitiesTable).values({
    entityType: "invoice",
    entityId: inv.id,
    kind: "note",
    body: `${ctx.viewer.name ?? "Client"} chose to pay Invoice ${inv.invoiceNo} ${method === "check" ? "by mailing a check" : "through their payment platform"}`,
  });
  return {
    ok: true,
    blocked: false,
    message:
      method === "check"
        ? "Got it — we'll watch the mail for your check."
        : "Got it — we'll watch for the payment on your platform.",
  };
}

// Office dispatch — the admin apps move/act on client-board cards as the
// office. Same ACTIONS table as the client route, but with a synthetic
// office viewer (full write, no client session needed — no-auth posture).
router.post(
  "/admin/accounts/:propertyId/board/actions",
  async (req, res): Promise<void> => {
    const parsed = DispatchClientBoardActionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const propertyId = String(req.params.propertyId);
    const [account] = await db
      .select()
      .from(clientAccountsTable)
      .where(eq(clientAccountsTable.propertyId, propertyId))
      .limit(1);
    if (!account) {
      res.status(404).json({ error: "No client account for this property yet" });
      return;
    }
    const viewer: Viewer = {
      authenticated: true,
      name: "Office",
      email: null,
      role: "office",
      permissions: [],
      readOnly: false,
    };
    const { action, cardKey, payload } = parsed.data;
    const def = ACTIONS[action];
    if (!def) {
      res.status(400).json({ error: `Unknown action: ${action}` });
      return;
    }
    let outcome: ActionOutcome;
    try {
      outcome = await def.run({
        account,
        viewer,
        cardKey: cardKey ?? null,
        payload: (payload ?? {}) as Record<string, unknown>,
      });
    } catch (e) {
      outcome = { ok: false, blocked: false, reason: (e as Error).message };
    }
    await db.insert(clientDashboardActionsTable).values({
      propertyId,
      action,
      cardKey: cardKey ?? null,
      actorName: "Office",
      actorRole: "office",
      payload: payload ?? null,
      ok: outcome.ok,
      blocked: outcome.blocked,
      reason: outcome.reason ?? null,
      result: outcome.result ?? null,
    });
    if (outcome.ok && def.requiresWrite) {
      emitBoardEvent(propertyId, "dashboard");
    }
    res.json(
      DispatchClientBoardActionResponse.parse({
        ok: outcome.ok,
        blocked: outcome.blocked,
        action,
        reason: outcome.reason ?? null,
        message: outcome.message ?? null,
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// Clear-to-history: the little trash icon. Snapshot the card, hide it from
// the board, keep everything queryable in the History tab + CSV export.
// ---------------------------------------------------------------------------
type HistorySnapshot = {
  title: string;
  template: string | null;
  status: "completed" | "paid" | "cleared";
  amountPaid: number;
  unitLabel: string | null;
  jobLabel: string | null;
  summary: string | null;
  frequency: "one_time" | "recurring";
};

async function paidTotalForInvoice(inv: typeof invoicesTable.$inferSelect): Promise<number> {
  if (inv.status === "paid") return inv.amount + (inv.taxAmount ?? 0);
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)::float` })
    .from(paymentsTable)
    .where(eq(paymentsTable.invoiceId, inv.id));
  return rows[0]?.total ?? 0;
}

async function snapshotForClear(
  propertyId: string,
  cardKey: string,
  fallbackTitle: string | null,
): Promise<HistorySnapshot | null> {
  const jobSnapshot = async (jobId: string, template: string): Promise<HistorySnapshot | null> => {
    const [job] = await db
      .select()
      .from(jobsTable)
      .where(and(eq(jobsTable.id, jobId), eq(jobsTable.propertyId, propertyId)))
      .limit(1);
    if (!job) return null;
    const invs = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.jobId, job.id), eq(invoicesTable.propertyId, propertyId)));
    let paid = 0;
    for (const inv of invs) paid += await paidTotalForInvoice(inv);
    const done = job.status === "complete" || job.status === "paid";
    return {
      title: job.description || `${job.category ?? "Job"} ${job.jobNo}`,
      template,
      status: paid > 0 ? "paid" : done ? "completed" : "cleared",
      amountPaid: paid,
      unitLabel: job.unitNo ?? null,
      jobLabel: `Job ${job.jobNo}`,
      summary: job.description ?? null,
      frequency: job.isRecurring ? "recurring" : "one_time",
    };
  };

  if (cardKey.startsWith("job:")) return jobSnapshot(cardKey.slice(4), "job");
  if (cardKey.startsWith("crew:")) return jobSnapshot(cardKey.slice(5), "crew");

  if (cardKey.startsWith("invoice:")) {
    const [inv] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, cardKey.slice(8)), eq(invoicesTable.propertyId, propertyId)))
      .limit(1);
    if (!inv) return null;
    const paid = await paidTotalForInvoice(inv);
    const lines = await db
      .select()
      .from(invoiceLineItemsTable)
      .where(eq(invoiceLineItemsTable.invoiceId, inv.id));
    const units = [...new Set(lines.map((l) => l.unitNo).filter((u): u is string => !!u))];
    let jobLabel: string | null = null;
    let recurring = false;
    if (inv.jobId) {
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, inv.jobId)).limit(1);
      if (job) {
        jobLabel = `Job ${job.jobNo}`;
        recurring = !!job.isRecurring;
      }
    }
    return {
      title: `Invoice ${inv.invoiceNo}`,
      template: "invoice",
      status: inv.status === "paid" ? "paid" : "cleared",
      amountPaid: paid,
      unitLabel: units.join(", ") || null,
      jobLabel,
      summary: inv.notes ?? lines[0]?.description ?? null,
      frequency: recurring ? "recurring" : "one_time",
    };
  }

  if (cardKey.startsWith("request:")) {
    const [reqRow] = await db
      .select()
      .from(workRequestsTable)
      .where(and(eq(workRequestsTable.id, cardKey.slice(8)), eq(workRequestsTable.propertyId, propertyId)))
      .limit(1);
    if (!reqRow) return null;
    return {
      title: reqRow.serviceLabel,
      template: "request",
      status: reqRow.status === "accepted" ? "completed" : "cleared",
      amountPaid: 0,
      unitLabel: reqRow.unitNo ?? null,
      jobLabel: null,
      summary: reqRow.notes ?? null,
      frequency: "one_time",
    };
  }

  if (cardKey.startsWith("push:")) {
    const [row] = await db
      .select()
      .from(clientBoardCardsTable)
      .where(and(eq(clientBoardCardsTable.id, cardKey.slice(5)), eq(clientBoardCardsTable.propertyId, propertyId)))
      .limit(1);
    if (!row) return null;
    // Money cards snapshot the real paid total from their source invoice (or
    // module state) so the History tab / CSV reflects what was actually paid.
    const module = (row.module ?? null) as Record<string, unknown> | null;
    let amountPaid = 0;
    let paid = false;
    if (row.sourceType === "invoice" && row.sourceId) {
      const [inv] = await db
        .select()
        .from(invoicesTable)
        .where(and(eq(invoicesTable.id, row.sourceId), eq(invoicesTable.propertyId, propertyId)))
        .limit(1);
      if (inv) {
        amountPaid = await paidTotalForInvoice(inv);
        paid = inv.status === "paid";
      }
    }
    if (!paid && String(module?.status ?? "").toLowerCase() === "paid") {
      paid = true;
      if (!amountPaid) {
        const modAmount = typeof module?.amount === "number" ? (module.amount as number) : 0;
        amountPaid = row.amount ?? modAmount;
      }
    }
    return {
      title: row.title,
      template: `push_${row.kind}`,
      status: paid ? "paid" : row.column === "done" || row.completedAt ? "completed" : "cleared",
      amountPaid,
      unitLabel: null,
      jobLabel: null,
      summary: row.body ?? null,
      frequency: "one_time",
    };
  }

  if (cardKey.startsWith("custom:")) {
    const [row] = await db
      .select()
      .from(clientDashboardCardsTable)
      .where(
        and(
          eq(clientDashboardCardsTable.propertyId, propertyId),
          eq(clientDashboardCardsTable.cardKey, cardKey),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      title: row.title ?? "Card",
      template: row.template ?? "custom",
      status: row.lane === "done" ? "completed" : "cleared",
      amountPaid: 0,
      unitLabel: null,
      jobLabel: null,
      summary: row.description ?? null,
      frequency: "one_time",
    };
  }

  if (!fallbackTitle) return null;
  return {
    title: fallbackTitle,
    template: null,
    status: "cleared",
    amountPaid: 0,
    unitLabel: null,
    jobLabel: null,
    summary: null,
    frequency: "one_time",
  };
}

function historyDto(row: typeof clientCardHistoryTable.$inferSelect) {
  return {
    id: row.id,
    cardKey: row.cardKey,
    title: row.title,
    template: row.template,
    status: row.status,
    amountPaid: row.amountPaid,
    unitLabel: row.unitLabel,
    jobLabel: row.jobLabel,
    summary: row.summary,
    frequency: row.frequency,
    clearedBy: row.clearedBy,
    clearedAt: row.clearedAt.toISOString(),
    restoredBy: row.restoredBy,
    restoredAt: row.restoredAt ? row.restoredAt.toISOString() : null,
  };
}

// Only real board card families can be cleared — anything else is a 404, so
// the endpoint can't be used to mint synthetic history rows.
const CLEARABLE_KEY = /^(job|crew|invoice|request|push|custom):[\w:.-]{1,80}$/;

// Shared by the manual clear endpoint and the auto-archive sweep: snapshot a
// card into history and hide it behind an archived row. Idempotent — if the
// card is already archived (double-tap, or a concurrent board read swept it
// first) the existing history entry is returned instead of a duplicate.
async function archiveCardToHistory(
  propertyId: string,
  cardKey: string,
  snap: HistorySnapshot,
  clearedBy: string | null,
): Promise<{ entry: typeof clientCardHistoryTable.$inferSelect; duplicate: boolean }> {
  return db.transaction(async (tx) => {
    const latestEntry = async () => {
      const [prev] = await tx
        .select()
        .from(clientCardHistoryTable)
        .where(
          and(
            eq(clientCardHistoryTable.propertyId, propertyId),
            eq(clientCardHistoryTable.cardKey, cardKey),
          ),
        )
        .orderBy(desc(clientCardHistoryTable.clearedAt))
        .limit(1);
      return prev ?? null;
    };
    const [existing] = await tx
      .select()
      .from(clientDashboardCardsTable)
      .where(
        and(
          eq(clientDashboardCardsTable.propertyId, propertyId),
          eq(clientDashboardCardsTable.cardKey, cardKey),
        ),
      )
      .limit(1)
      .for("update");
    if (existing?.archived) {
      const prev = await latestEntry();
      if (prev) return { entry: prev, duplicate: true };
    }
    if (existing) {
      await tx
        .update(clientDashboardCardsTable)
        .set({ archived: true, updatedAt: new Date() })
        .where(eq(clientDashboardCardsTable.id, existing.id));
    } else {
      // Unique (propertyId, cardKey) — if a concurrent sweep beat us to the
      // insert, reuse its history entry instead of writing a duplicate.
      const ins = await tx
        .insert(clientDashboardCardsTable)
        .values({ propertyId, cardKey, kind: "override", archived: true })
        .onConflictDoNothing()
        .returning();
      if (!ins.length) {
        const prev = await latestEntry();
        if (prev) return { entry: prev, duplicate: true };
      }
    }
    const inserted = await tx
      .insert(clientCardHistoryTable)
      .values({
        propertyId,
        cardKey,
        title: snap.title,
        template: snap.template,
        status: snap.status,
        amountPaid: snap.amountPaid,
        unitLabel: snap.unitLabel,
        jobLabel: snap.jobLabel,
        summary: snap.summary,
        frequency: snap.frequency,
        clearedBy,
      })
      .returning();
    return { entry: inserted[0]!, duplicate: false };
  });
}

router.post(
  "/client/:token/board/cards/:cardKey/clear",
  limits.cardAction,
  async (req, res): Promise<void> => {
    const account = await accountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    const viewer = await resolveViewer(req, account.propertyId);
    const denied = requireWriter(viewer);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }
    const cardKey = String(req.params.cardKey);
    if (!CLEARABLE_KEY.test(cardKey)) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const snap = await snapshotForClear(account.propertyId, cardKey, null);
    if (!snap) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const result = await archiveCardToHistory(
      account.propertyId,
      cardKey,
      snap,
      viewer.name ?? null,
    );
    if (!result.duplicate) {
      await db.insert(clientDashboardActionsTable).values({
        propertyId: account.propertyId,
        action: "card.clear",
        cardKey,
        actorName: viewer.name,
        actorRole: viewer.authenticated ? viewer.role : "guest",
        ok: true,
        blocked: false,
      });
      emitBoardEvent(account.propertyId, "dashboard");
    }
    res.json(ClearClientBoardCardResponse.parse(historyDto(result.entry)));
  },
);

// Restore a cleared card: remove/unset the archived override so the card
// reappears on the board. The history entry stays as a paper trail, stamped
// with who restored it and when.
router.post(
  "/client/:token/board/history/:id/restore",
  limits.cardAction,
  async (req, res): Promise<void> => {
    const account = await accountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    const viewer = await resolveViewer(req, account.propertyId);
    const denied = requireWriter(viewer);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(404).json({ error: "History entry not found" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(clientCardHistoryTable)
        .where(
          and(
            eq(clientCardHistoryTable.id, id),
            eq(clientCardHistoryTable.propertyId, account.propertyId),
          ),
        )
        .limit(1)
        .for("update");
      if (!entry) return null;
      // Idempotent: already restored just returns the entry as-is.
      if (entry.restoredAt) return { entry, duplicate: true };
      const [row] = await tx
        .select()
        .from(clientDashboardCardsTable)
        .where(
          and(
            eq(clientDashboardCardsTable.propertyId, account.propertyId),
            eq(clientDashboardCardsTable.cardKey, entry.cardKey),
          ),
        )
        .limit(1)
        .for("update");
      if (row?.archived) {
        if (row.kind === "custom") {
          // Custom cards own their row — just unset the archived flag.
          await tx
            .update(clientDashboardCardsTable)
            .set({ archived: false, updatedAt: new Date() })
            .where(eq(clientDashboardCardsTable.id, row.id));
        } else {
          // HALO-fed / pushed families hide via an archived override row —
          // delete it so the recomputed card shows again.
          await tx
            .delete(clientDashboardCardsTable)
            .where(eq(clientDashboardCardsTable.id, row.id));
        }
      }
      const [updated] = await tx
        .update(clientCardHistoryTable)
        .set({ restoredAt: new Date(), restoredBy: viewer.name ?? null })
        .where(eq(clientCardHistoryTable.id, entry.id))
        .returning();
      return { entry: updated!, duplicate: false };
    });
    if (!result) {
      res.status(404).json({ error: "History entry not found" });
      return;
    }
    if (!result.duplicate) {
      await db.insert(clientDashboardActionsTable).values({
        propertyId: account.propertyId,
        action: "card.restore",
        cardKey: result.entry.cardKey,
        actorName: viewer.name,
        actorRole: viewer.authenticated ? viewer.role : "guest",
        ok: true,
        blocked: false,
      });
      emitBoardEvent(account.propertyId, "dashboard");
    }
    res.json(RestoreClientBoardCardResponse.parse(historyDto(result.entry)));
  },
);

router.get("/client/:token/board/history", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const rows = await db
    .select()
    .from(clientCardHistoryTable)
    .where(eq(clientCardHistoryTable.propertyId, account.propertyId))
    .orderBy(desc(clientCardHistoryTable.clearedAt))
    .limit(500);
  res.json(GetClientBoardHistoryResponse.parse({ entries: rows.map(historyDto) }));
});

// CSV export — flat rows plus totals categorized by unit, job, and frequency.
// Shared by the client-token and office mounts so the formula-injection guard
// and summary sections can never drift between the two views.
function sendHistoryCsv(
  res: Response,
  rows: (typeof clientCardHistoryTable.$inferSelect)[],
): void {
  const esc = (v: unknown): string => {
    let s = v == null ? "" : String(v);
    // Neutralize spreadsheet formula injection (=, +, -, @, tab/CR prefixes).
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const money = (n: number) => n.toFixed(2);
  const lines: string[] = [];
  lines.push("Date cleared,Card,Status,Amount paid,Unit,Job,Summary,Frequency");
  for (const r of rows) {
    lines.push(
      [
        r.clearedAt.toISOString().slice(0, 10),
        esc(r.title),
        r.status,
        money(r.amountPaid),
        esc(r.unitLabel),
        esc(r.jobLabel),
        esc(r.summary),
        r.frequency === "recurring" ? "Recurring" : "One time",
      ].join(","),
    );
  }
  const sumBy = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.amountPaid);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  lines.push("", "Amounts paid by unit");
  for (const [k, v] of sumBy((r) => r.unitLabel || "No unit")) lines.push(`${esc(k)},${money(v)}`);
  lines.push("", "Amounts paid by job");
  for (const [k, v] of sumBy((r) => r.jobLabel || "No job")) lines.push(`${esc(k)},${money(v)}`);
  lines.push("", "Amounts paid by frequency");
  for (const [k, v] of sumBy((r) => (r.frequency === "recurring" ? "Recurring" : "One time")))
    lines.push(`${esc(k)},${money(v)}`);
  lines.push("", "Amounts paid by status");
  for (const [k, v] of sumBy((r) => r.status)) lines.push(`${esc(k)},${money(v)}`);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="board-history.csv"');
  res.send(lines.join("\n"));
}

router.get("/client/:token/board/history.csv", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const rows = await db
    .select()
    .from(clientCardHistoryTable)
    .where(eq(clientCardHistoryTable.propertyId, account.propertyId))
    .orderBy(desc(clientCardHistoryTable.clearedAt));
  sendHistoryCsv(res, rows);
});

// Office mirror of the cleared-card history — same rows, keyed by propertyId
// instead of the client dashboard token (no-auth posture, office mount).
router.get(
  "/admin/accounts/:propertyId/board/history",
  async (req, res): Promise<void> => {
    const propertyId = String(req.params.propertyId);
    const [account] = await db
      .select()
      .from(clientAccountsTable)
      .where(eq(clientAccountsTable.propertyId, propertyId))
      .limit(1);
    if (!account) {
      res.status(404).json({ error: "No client account for this property yet" });
      return;
    }
    const rows = await db
      .select()
      .from(clientCardHistoryTable)
      .where(eq(clientCardHistoryTable.propertyId, propertyId))
      .orderBy(desc(clientCardHistoryTable.clearedAt))
      .limit(500);
    res.json(GetClientBoardHistoryResponse.parse({ entries: rows.map(historyDto) }));
  },
);

// Office CSV export — identical output to the client export (kept in the same
// file as the client route so the formula-injection guard is shared).
router.get(
  "/admin/accounts/:propertyId/board/history.csv",
  async (req, res): Promise<void> => {
    const propertyId = String(req.params.propertyId);
    const [account] = await db
      .select()
      .from(clientAccountsTable)
      .where(eq(clientAccountsTable.propertyId, propertyId))
      .limit(1);
    if (!account) {
      res.status(404).json({ error: "No client account for this property yet" });
      return;
    }
    const rows = await db
      .select()
      .from(clientCardHistoryTable)
      .where(eq(clientCardHistoryTable.propertyId, propertyId))
      .orderBy(desc(clientCardHistoryTable.clearedAt));
    sendHistoryCsv(res, rows);
  },
);

router.post("/client/:token/board/actions", async (req, res): Promise<void> => {
  const parsed = DispatchClientBoardActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const viewer = await resolveViewer(req, account.propertyId);
  const { action, cardKey, payload } = parsed.data;
  const def = ACTIONS[action];
  if (!def) {
    res.status(400).json({ error: `Unknown action: ${action}` });
    return;
  }
  const denied = def.requiresWrite ? requireWriter(viewer) : null;
  let outcome: ActionOutcome;
  if (denied) {
    outcome = { ok: false, blocked: true, reason: denied };
  } else {
    try {
      outcome = await def.run({
        account,
        viewer,
        cardKey: cardKey ?? null,
        payload: (payload ?? {}) as Record<string, unknown>,
      });
    } catch (e) {
      outcome = { ok: false, blocked: false, reason: (e as Error).message };
    }
  }
  // Audit everything — allowed, blocked, and failed.
  await db.insert(clientDashboardActionsTable).values({
    propertyId: account.propertyId,
    action,
    cardKey: cardKey ?? null,
    actorName: viewer.name,
    actorRole: viewer.authenticated ? viewer.role : "guest",
    payload: payload ?? null,
    ok: outcome.ok,
    blocked: outcome.blocked,
    reason: outcome.reason ?? null,
    result: outcome.result ?? null,
  });
  if (denied) {
    res.status(403).json({ error: denied });
    return;
  }
  // A successful write action changed the board — ping every open stream
  // (the client's own tabs AND the office mirror pick up the move live).
  if (outcome.ok && def.requiresWrite) {
    emitBoardEvent(account.propertyId, "dashboard");
  }
  res.json(
    DispatchClientBoardActionResponse.parse({
      ok: outcome.ok,
      blocked: outcome.blocked,
      action,
      reason: outcome.reason ?? null,
      message: outcome.message ?? null,
    }),
  );
});

// ---------------------------------------------------------------------------
// Map view — property + live crew activity
// ---------------------------------------------------------------------------
router.get("/client/:token/board/map", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, account.propertyId))
    .limit(1);
  const jobs = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.propertyId, account.propertyId));
  const now = Date.now();
  const active = jobs.filter((j) => !j.clearedAt && j.status !== "complete");
  const crewIds = [
    ...new Set(active.map((j) => j.crewLeaderId).filter((x): x is string => !!x)),
  ];
  const jobIds = active.map((j) => j.id);
  const [crews, checkins, photos, lineItems] = await Promise.all([
    crewIds.length
      ? db.select().from(crewsTable).where(inArray(crewsTable.id, crewIds))
      : Promise.resolve([]),
    jobIds.length
      ? db
          .select()
          .from(crewCheckinsTable)
          .where(inArray(crewCheckinsTable.jobId, jobIds))
          .orderBy(desc(crewCheckinsTable.createdAt))
          .limit(200)
      : Promise.resolve([]),
    jobIds.length
      ? db
          .select()
          .from(crewPhotosTable)
          .where(inArray(crewPhotosTable.jobId, jobIds))
          .orderBy(desc(crewPhotosTable.createdAt))
          .limit(150)
      : Promise.resolve([]),
    jobIds.length
      ? db
          .select()
          .from(jobLineItemsTable)
          .where(inArray(jobLineItemsTable.jobId, jobIds))
      : Promise.resolve([]),
  ]);
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const jobById = new Map(active.map((j) => [j.id, j]));

  // Group photos and line items by jobId for O(1) lookup.
  const photosByJobId = new Map<string, (typeof photos)[number][]>();
  for (const p of photos) {
    if (!p.jobId) continue;
    const list = photosByJobId.get(p.jobId) ?? [];
    list.push(p);
    photosByJobId.set(p.jobId, list);
  }
  const lineItemsByJobId = new Map<string, (typeof lineItems)[number][]>();
  for (const li of lineItems) {
    const list = lineItemsByJobId.get(li.jobId) ?? [];
    list.push(li);
    lineItemsByJobId.set(li.jobId, list);
  }

  // Per-job trail: up to 30 newest events for EACH job independently (the
  // shared 200-row checkins query above can starve older jobs on busy
  // properties, so the trail uses its own windowed query).
  const trailByJob = new Map<
    string,
    { kind: string; at: string; label: string | null; lat: number | null; lng: number | null }[]
  >();
  if (jobIds.length) {
    const trailRows = await db.execute(sql`
      select job_id, kind, label, lat, lng, created_at
      from (
        select *, row_number() over (partition by job_id order by created_at desc) as rn
        from crew_checkins
        where job_id in (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})
      ) t
      where rn <= 30
      order by created_at desc
    `);
    for (const r of trailRows.rows as Record<string, unknown>[]) {
      const jobId = String(r.job_id);
      const list = trailByJob.get(jobId) ?? [];
      list.push({
        kind: r.kind === "checkout" ? "checkout" : "checkin",
        at: new Date(r.created_at as string).toISOString(),
        label: (r.label as string | null) ?? null,
        lat: r.lat != null ? Number(r.lat) : null,
        lng: r.lng != null ? Number(r.lng) : null,
      });
      trailByJob.set(jobId, list);
    }
  }

  // Today's 30-second GPS breadcrumb trail per job (oldest first).
  const gpsTrailByJob = new Map<string, { lat: number; lng: number; at: string }[]>();
  if (jobIds.length) {
    // Node-local midnight, same basis as the ping-gate's local day.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const gpsRows = await db.execute(sql`
      select job_id, lat, lng, created_at
      from crew_track_points
      where created_at >= ${dayStart}
        and job_id in (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})
      order by created_at asc
      limit 20000
    `);
    for (const r of gpsRows.rows as Record<string, unknown>[]) {
      const jobId = String(r.job_id);
      const list = gpsTrailByJob.get(jobId) ?? [];
      list.push({
        lat: Number(r.lat),
        lng: Number(r.lng),
        at: new Date(r.created_at as string).toISOString(),
      });
      gpsTrailByJob.set(jobId, list);
    }
  }

  const lastByJob = new Map<string, (typeof checkins)[number]>();
  for (const c of checkins) {
    if (c.jobId && !lastByJob.has(c.jobId)) lastByJob.set(c.jobId, c);
  }

  const inHouse = await getBusinessSettings()
    .then((s) => s.companyName)
    .catch(() => null);

  const crewsOut = active
    .filter((j) => j.crewLeaderId)
    .map((j) => {
      const crew = crewById.get(j.crewLeaderId!);
      const last = lastByJob.get(j.id);
      const gpsTrail = gpsTrailByJob.get(j.id) ?? [];
      const tip = gpsTrail.length ? gpsTrail[gpsTrail.length - 1] : null;
      const tipNewer =
        !!tip && (!last || new Date(tip.at).getTime() > new Date(last.createdAt).getTime());
      const onSite =
        !!last &&
        last.kind !== "checkout" &&
        now - new Date(last.createdAt).getTime() < 4 * 3_600_000;
      const services = (lineItemsByJobId.get(j.id) ?? []).map((li) => ({
        id: li.id,
        service: li.service,
        done: !!li.completedAt,
      }));
      return {
        crewName: crew?.name ?? "Crew",
        crewTrade: crew?.trade ?? null,
        contractor: contractorLabel(crew?.company, inHouse),
        serviceLabel: serviceLabel({
          services,
          jobDescription: j.description ?? null,
          trade: crew?.trade ?? null,
        }),
        selfieUrl: crew?.selfiePath ? storageUrl(crew.selfiePath) : null,
        jobId: j.id,
        jobNo: j.jobNo,
        description: j.description ?? null,
        unitNo: j.unitNo ?? null,
        status: onSite ? "on site" : j.scheduledOn ? "scheduled" : "assigned",
        onSite,
        trackerUrl: j.trackerToken ? `/track/${j.trackerToken}` : null,
        lastCheckinKind: last?.kind ?? null,
        lastCheckinAt: last ? last.createdAt.toISOString() : null,
        lat: tipNewer ? tip.lat : (last?.lat ?? null),
        lng: tipNewer ? tip.lng : (last?.lng ?? null),
        accuracy: tipNewer ? null : (last?.accuracy ?? null),
        // Full check-in/check-out trail (newest first) so the client can see
        // exactly when the crew arrived and left, not just the latest ping.
        events: trailByJob.get(j.id) ?? [],
        trail: gpsTrail,
        photos: (photosByJobId.get(j.id) ?? []).slice(0, 8).map((p) => ({
          id: p.id,
          url: storageUrl(p.storagePath),
          phase: p.phase ?? null,
          note: p.note ?? null,
        })),
        services,
      };
    });

  const happenings: { at: string; text: string }[] = [];
  for (const c of checkins.slice(0, 15)) {
    const job = c.jobId ? jobById.get(c.jobId) : undefined;
    const crew = crewById.get(c.crewId);
    const verb =
      c.kind === "checkout" ? "checked out of" : c.kind === "arrival" ? "arrived at" : "checked in at";
    happenings.push({
      at: c.createdAt.toISOString(),
      text: `${crew?.name ?? "Crew"} ${verb} ${job ? `Job ${job.jobNo}` : "the property"}${job?.unitNo ? ` (unit ${job.unitNo})` : ""}`,
    });
  }
  for (const p of photos.slice(0, 10)) {
    const job = p.jobId ? jobById.get(p.jobId) : undefined;
    happenings.push({
      at: p.createdAt.toISOString(),
      text: `${crewById.get(p.crewId)?.name ?? "Crew"} uploaded a ${p.phase === "before" ? "before" : p.phase === "after" ? "after" : "work"} photo${job ? ` on Job ${job.jobNo}` : ""}`,
    });
  }
  happenings.sort((a, b) => (a.at < b.at ? 1 : -1));

  res.json(
    GetClientBoardMapResponse.parse({
      propertyName: prop?.name ?? "Your property",
      propertyAddress: prop?.address ?? null,
      lat: prop?.latitude ?? null,
      lng: prop?.longitude ?? null,
      crews: crewsOut,
      happenings: happenings.slice(0, 20),
    }),
  );
});

// ---------------------------------------------------------------------------
// Wekan-style layer: comments, send-to-office, live notifications, KPIs
// ---------------------------------------------------------------------------

/** Raise a live notification on the client board bell. Never breaks the caller. */
export async function notifyClientBoard(
  propertyId: string,
  type: string,
  title: string,
  body: string | null,
  cardKey: string | null,
): Promise<void> {
  try {
    await db.insert(clientBoardNotificationsTable).values({
      propertyId,
      audience: "client",
      type,
      title,
      body,
      cardKey,
    });
  } catch {
    /* notification must never break the action that raised it */
  }
}

const CARD_KEY_RE = /^[a-z_]+:[A-Za-z0-9-]{1,64}$/;
// Object-storage paths from the upload flow ("/objects/..."); anything else
// is rejected so the thread can't be used to link arbitrary URLs.
const ATTACHMENT_PATH_RE = /^\/objects\/(?!.*\.\.)[A-Za-z0-9._/-]{1,390}$/;

/**
 * Stable thread family for a card key. A pushed mirror (push:<rowId>) and the
 * projected card for the same HALO entity (<sourceType>:<sourceId>) share ONE
 * thread: reads query every key in the family, writes land on the canonical
 * key (the source identity when one exists) so the projected/pushed dedupe
 * and lane moves never orphan a conversation.
 */
export async function threadKeysFor(
  propertyId: string,
  cardKey: string,
): Promise<{ canonical: string; keys: string[] }> {
  if (cardKey.startsWith("push:")) {
    const id = cardKey.slice(5);
    const [row] = await db
      .select()
      .from(clientBoardCardsTable)
      .where(
        and(
          eq(clientBoardCardsTable.propertyId, propertyId),
          eq(clientBoardCardsTable.id, id),
        ),
      )
      .limit(1);
    if (row?.sourceType && row.sourceId) {
      const canonical = `${row.sourceType}:${row.sourceId}`;
      if (CARD_KEY_RE.test(canonical)) return { canonical, keys: [canonical, cardKey] };
    }
    return { canonical: cardKey, keys: [cardKey] };
  }
  // Reverse direction: the projected key may have pushed mirrors.
  const mirrors = await db
    .select({ id: clientBoardCardsTable.id })
    .from(clientBoardCardsTable)
    .where(
      and(
        eq(clientBoardCardsTable.propertyId, propertyId),
        sql`${clientBoardCardsTable.sourceType} || ':' || ${clientBoardCardsTable.sourceId} = ${cardKey}`,
      ),
    );
  return { canonical: cardKey, keys: [cardKey, ...mirrors.map((m) => `push:${m.id}`)] };
}

export function threadMessageDto(c: typeof clientCardCommentsTable.$inferSelect) {
  return {
    id: c.id,
    authorType: c.authorType,
    authorName: c.authorName,
    body: c.body,
    attachmentName: c.attachmentName ?? null,
    attachmentUrl: c.attachmentPath ? storageUrl(c.attachmentPath) : null,
    read: !!c.readAt,
    createdAt: c.createdAt.toISOString(),
  };
}

router.get(
  "/client/:token/board/cards/:cardKey/comments",
  async (req, res): Promise<void> => {
    const account = await accountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    const cardKey = String(req.params.cardKey);
    const { keys } = await threadKeysFor(account.propertyId, cardKey);
    const comments = await db
      .select()
      .from(clientCardCommentsTable)
      .where(
        and(
          eq(clientCardCommentsTable.propertyId, account.propertyId),
          inArray(clientCardCommentsTable.cardKey, keys),
        ),
      )
      .orderBy(clientCardCommentsTable.createdAt);
    res.json(
      ListClientCardCommentsResponse.parse({
        comments: comments.map(threadMessageDto),
      }),
    );
  },
);

router.post(
  "/client/:token/board/cards/:cardKey/comments",
  limits.cardAction,
  async (req, res): Promise<void> => {
    const parsed = AddClientCardCommentBody.safeParse(req.body);
    const body = parsed.success ? parsed.data.body.trim() : "";
    const attachmentName = (parsed.success && parsed.data.attachmentName?.trim()) || null;
    const attachmentPath = (parsed.success && parsed.data.attachmentPath?.trim()) || null;
    if (attachmentPath && !ATTACHMENT_PATH_RE.test(attachmentPath)) {
      res.status(400).json({ error: "Invalid attachment" });
      return;
    }
    if ((!body && !attachmentPath) || body.length > 4000) {
      res.status(400).json({ error: "Write a message or attach a photo (max 4000 chars)" });
      return;
    }
    const account = await accountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    const viewer = await resolveViewer(req, account.propertyId);
    const denied = requireWriter(viewer);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }
    const cardKey = String(req.params.cardKey);
    if (!CARD_KEY_RE.test(cardKey)) {
      res.status(400).json({ error: "Invalid card" });
      return;
    }
    const { canonical } = await threadKeysFor(account.propertyId, cardKey);
    const [row] = await db
      .insert(clientCardCommentsTable)
      .values({
        propertyId: account.propertyId,
        cardKey: canonical,
        authorType: "client",
        authorName: viewer.name ?? "Client",
        body,
        attachmentName: attachmentPath ? (attachmentName ?? "Photo") : null,
        attachmentPath,
      })
      .returning();
    // Office bell (existing office notification center) — never fail the post.
    try {
      await db.insert(notificationsTable).values({
        kind: "client_dashboard",
        title: `${viewer.name ?? "Client"} sent a message on a board card`,
        body: (body || attachmentName || "Photo").slice(0, 300),
        entityType: "property",
        entityId: account.propertyId,
      });
    } catch (err) {
      console.error("office comment notification failed:", err);
    }
    emitBoardEvent(account.propertyId, "dashboard");
    res.status(201).json(AddClientCardCommentResponse.parse(threadMessageDto(row!)));
  },
);

// Client opened the thread — office messages in this family are now read.
router.post(
  "/client/:token/board/cards/:cardKey/comments/seen",
  limits.cardAction,
  async (req, res): Promise<void> => {
    const account = await accountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    // Read receipts are state: only an authenticated writer may clear unread
    // (guests with the link must not silently suppress badges and digests).
    const viewer = await resolveViewer(req, account.propertyId);
    const denied = requireWriter(viewer);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }
    const { keys } = await threadKeysFor(account.propertyId, String(req.params.cardKey));
    await db
      .update(clientCardCommentsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(clientCardCommentsTable.propertyId, account.propertyId),
          inArray(clientCardCommentsTable.cardKey, keys),
          eq(clientCardCommentsTable.authorType, "office"),
          isNull(clientCardCommentsTable.readAt),
        ),
      );
    res.json({ ok: true });
  },
);

router.post(
  "/client/:token/board/cards/:cardKey/send-to-office",
  async (req, res): Promise<void> => {
    const account = await accountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    const viewer = await resolveViewer(req, account.propertyId);
    const denied = requireWriter(viewer);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }
    const cardKey = String(req.params.cardKey);
    if (!cardKey.startsWith("custom:")) {
      res.status(404).json({ error: "Only your own cards can be sent to the office" });
      return;
    }
    // Guarded claim: first send wins; re-sends after a decline re-open it.
    const updated = await db
      .update(clientDashboardCardsTable)
      .set({
        sentToOfficeAt: new Date(),
        officeStatus: "pending",
        officeNote: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clientDashboardCardsTable.propertyId, account.propertyId),
          eq(clientDashboardCardsTable.cardKey, cardKey),
          eq(clientDashboardCardsTable.kind, "custom"),
          sql`(${clientDashboardCardsTable.officeStatus} IS DISTINCT FROM 'pending')`,
        ),
      )
      .returning();
    if (!updated.length) {
      const [existing] = await db
        .select()
        .from(clientDashboardCardsTable)
        .where(
          and(
            eq(clientDashboardCardsTable.propertyId, account.propertyId),
            eq(clientDashboardCardsTable.cardKey, cardKey),
          ),
        )
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Card not found" });
        return;
      }
      res.status(409).json({ error: "This card is already with the office" });
      return;
    }
    const card = updated[0]!;
    try {
      await db.insert(notificationsTable).values({
        kind: "client_dashboard",
        title: `Client sent you a card: ${card.title ?? "Untitled"}`,
        body: `${viewer.name ?? "A client"} sent "${card.title ?? "Untitled"}" to the office from their board.`,
        entityType: "property",
        entityId: account.propertyId,
      });
    } catch (err) {
      console.error("send-to-office notification failed:", err);
    }
    res.json(
      SendClientCardToOfficeResponse.parse({
        ok: true,
        blocked: false,
        action: "card.sent_to_office",
        reason: null,
        message: "Sent to the office — you'll hear back here",
      }),
    );
  },
);

router.get("/client/:token/board/notifications", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const [rows, [unread]] = await Promise.all([
    db
      .select()
      .from(clientBoardNotificationsTable)
      .where(
        and(
          eq(clientBoardNotificationsTable.propertyId, account.propertyId),
          eq(clientBoardNotificationsTable.audience, "client"),
        ),
      )
      .orderBy(desc(clientBoardNotificationsTable.createdAt))
      .limit(50),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(clientBoardNotificationsTable)
      .where(
        and(
          eq(clientBoardNotificationsTable.propertyId, account.propertyId),
          eq(clientBoardNotificationsTable.audience, "client"),
          isNull(clientBoardNotificationsTable.readAt),
        ),
      ),
  ]);
  res.json(
    ListClientBoardNotificationsResponse.parse({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        cardKey: n.cardKey,
        read: n.readAt != null,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: unread?.n ?? 0,
    }),
  );
});

router.post("/client/:token/board/notifications/read", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  await db
    .update(clientBoardNotificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(clientBoardNotificationsTable.propertyId, account.propertyId),
        eq(clientBoardNotificationsTable.audience, "client"),
        isNull(clientBoardNotificationsTable.readAt),
      ),
    );
  res.json({ ok: true });
});

// Property-management KPI strip (Open Property style) for the board header.
router.get("/client/:token/board/kpis", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const propertyId = account.propertyId;

  // Resolve viewer to enforce financial permission server-side.
  // Guests and viewers without the 'invoices' permission receive
  // zeroed invoice fields — the query is still run for unit/job KPIs.
  const viewer = await resolveViewer(req, propertyId);
  const hasFinancialAccess = viewer.permissions.includes("invoices");

  const [jobs, requests, invoices, mappedUnits, { byUnit: unitStatuses }] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.propertyId, propertyId)),
    db.select().from(workRequestsTable).where(eq(workRequestsTable.propertyId, propertyId)),
    // Only fetch invoices when the viewer is entitled; skip the query otherwise.
    hasFinancialAccess
      ? db.select().from(invoicesTable).where(eq(invoicesTable.propertyId, propertyId))
      : Promise.resolve([] as (typeof invoicesTable.$inferSelect)[]),
    db
      .select({ label: propertyUnitsTable.label })
      .from(propertyUnitsTable)
      .where(eq(propertyUnitsTable.propertyId, propertyId)),
    computeUnitStatuses(propertyId),
  ]);
  const now = Date.now();
  const DAY = 86_400_000;
  const open = jobs.filter((j) => j.status !== "complete" && !j.completedAt && !j.clearedAt);
  const scheduled = open.filter((j) => j.scheduledOn);
  const nextVisit =
    scheduled
      .map((j) => j.scheduledOn!)
      .filter((d) => d >= new Date(now).toISOString().slice(0, 10))
      .sort()[0] ?? null;

  // Financial aggregates — zeroed for viewers without the invoices permission.
  let outstanding = 0;
  let overdue = 0;
  let paidLast30 = 0;
  if (hasFinancialAccess) {
    const unpaid = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled");
    outstanding = unpaid.reduce((s, i) => s + i.amount + (i.taxAmount ?? 0), 0);
    overdue = unpaid
      .filter((i) => i.dueAt && i.dueAt.getTime() < now)
      .reduce((s, i) => s + i.amount + (i.taxAmount ?? 0), 0);
    paidLast30 = invoices
      .filter((i) => i.status === "paid" && i.paidAt && now - i.paidAt.getTime() < 30 * DAY)
      .reduce((s, i) => s + i.amount + (i.taxAmount ?? 0), 0);
  }

  // Unit health from the same status source as the Units page (/unit-map):
  // union of mapped units and units seen in HALO data, each colored by
  // computeUnitStatuses (red/yellow/green keyed by normalized unit label).
  const unitKeys = new Set<string>();
  for (const u of mappedUnits) {
    const k = normUnit(u.label);
    if (k) unitKeys.add(k);
  }
  for (const k of unitStatuses.keys()) if (k) unitKeys.add(k);
  let unitsUrgent = 0;
  let unitsAttention = 0;
  for (const k of unitKeys) {
    const status = unitStatuses.get(k)?.status ?? "green";
    if (status === "red") unitsUrgent += 1;
    else if (status === "yellow") unitsAttention += 1;
  }
  const unitsTotal = unitKeys.size;
  res.json(
    GetClientBoardKpisResponse.parse({
      unitsTotal,
      unitsOk: Math.max(unitsTotal - unitsAttention - unitsUrgent, 0),
      unitsAttention,
      unitsUrgent,
      openJobs: open.length,
      scheduledJobs: scheduled.length,
      pendingRequests: requests.filter((r) => r.status === "pending").length,
      invoicesOutstanding: outstanding,
      invoicesOverdue: overdue,
      paidLast30,
      nextVisit,
    }),
  );
});

// ---------------------------------------------------------------------------
// Client briefing — client-safe structured brief for the property
// ---------------------------------------------------------------------------

router.get("/client/:token/briefing", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const propertyId = account.propertyId;
  const DAY = 86_400_000;
  const now = Date.now();

  // Resolve viewer so financial items can be enforced server-side.
  // Guests and viewers without the 'invoices' permission receive a briefing
  // with invoice-category items omitted and budget amounts redacted.
  const viewer = await resolveViewer(req, propertyId);
  const hasFinancialAccess = viewer.permissions.includes("invoices");

  const [prop, jobs, requests, invoices] = await Promise.all([
    db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId)).limit(1),
    db.select().from(jobsTable).where(eq(jobsTable.propertyId, propertyId)),
    db.select().from(workRequestsTable).where(eq(workRequestsTable.propertyId, propertyId)),
    // Only fetch invoices for entitled viewers.
    hasFinancialAccess
      ? db.select().from(invoicesTable).where(eq(invoicesTable.propertyId, propertyId))
      : Promise.resolve([] as (typeof invoicesTable.$inferSelect)[]),
  ]);
  const jobIds = jobs.map((j) => j.id);
  const checkins = jobIds.length
    ? await db
        .select()
        .from(crewCheckinsTable)
        .where(inArray(crewCheckinsTable.jobId, jobIds))
        .orderBy(desc(crewCheckinsTable.createdAt))
        .limit(50)
    : [];

  type ClientBriefItem = {
    tier: "now" | "today" | "week";
    urgency: number;
    category: string;
    title: string;
    body: string;
    entityType?: string | null;
    entityId?: string | null;
    actionLabel?: string | null;
    actionKey?: string | null;
    amount?: number | null;
    customerImpact?: boolean;
  };

  const items: ClientBriefItem[] = [];

  // Pending work requests
  for (const r of requests.filter((r) => r.status === "pending")) {
    items.push({
      tier: r.emergency ? "now" : "today",
      urgency: r.emergency ? 90 : 60,
      category: "Requests",
      title: `Request in review: ${r.serviceLabel}`,
      body: r.neededBy ? `Needed by ${r.neededBy}` : "Under review by operations team",
      entityType: "work_request",
      entityId: r.id,
      actionLabel: null,
      actionKey: null,
      // Budget estimates are financial data — only expose to entitled viewers.
      amount: hasFinancialAccess ? (r.budgetEstimate ?? null) : null,
      customerImpact: true,
    });
  }

  // Overdue invoices — only visible to viewers with financial access.
  // The invoices array is already empty for non-entitled viewers (skipped query above).
  for (const i of invoices.filter((inv) => inv.status !== "paid" && inv.status !== "cancelled" && inv.dueAt && inv.dueAt.getTime() < now)) {
    const late = Math.floor((now - i.dueAt!.getTime()) / DAY);
    items.push({
      tier: late > 30 ? "now" : "today",
      urgency: late > 30 ? 85 : 55,
      category: "Invoices",
      title: `Invoice overdue: ${i.invoiceNo}`,
      body: `${late} day${late === 1 ? "" : "s"} past due`,
      entityType: "invoice",
      entityId: i.id,
      actionLabel: "View invoice",
      actionKey: "openInvoice",
      amount: i.amount + (i.taxAmount ?? 0),
      customerImpact: false,
    });
  }

  // Crew currently on site (checked in within 4h)
  const latestByJob = new Map<string, typeof checkins[number]>();
  for (const c of checkins) {
    if (c.jobId && !latestByJob.has(c.jobId)) latestByJob.set(c.jobId, c);
  }
  for (const [jobId, c] of latestByJob) {
    const j = jobs.find((job) => job.id === jobId);
    if (!j) continue;
    const onSite = c.kind === "checkin" && now - c.createdAt.getTime() < 4 * 60 * 60 * 1000;
    if (!onSite) continue;
    items.push({
      tier: "now",
      urgency: 70,
      category: "Crew Activity",
      title: `Crew on site: ${j.description ?? j.jobNo}`,
      body: j.unitNo ? `Unit ${j.unitNo}` : "Work in progress",
      entityType: "job",
      entityId: jobId,
      actionLabel: j.trackerToken ? "Watch live" : null,
      actionKey: j.trackerToken ? "openTracker" : null,
      amount: null,
      customerImpact: true,
    });
  }

  // Upcoming scheduled jobs (next 7 days)
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const weekStr = new Date(now + 7 * DAY).toISOString().slice(0, 10);
  for (const j of jobs.filter((j) => j.scheduledOn && j.scheduledOn >= todayStr && j.scheduledOn <= weekStr && j.status !== "cancelled")) {
    items.push({
      tier: "today",
      urgency: 40,
      category: "Upcoming Work",
      title: `Work scheduled: ${j.description ?? j.jobNo}`,
      body: `On ${j.scheduledOn}${j.unitNo ? ` · Unit ${j.unitNo}` : ""}`,
      entityType: "job",
      entityId: j.id,
      actionLabel: null,
      actionKey: null,
      amount: null,
      customerImpact: true,
    });
  }

  items.sort((a, b) => b.urgency - a.urgency);

  res.json({
    items,
    propertyName: prop[0]?.name ?? "Your property",
    generatedAt: new Date().toISOString(),
  });
});

export default router;

const TEMPLATE_KEY_RE = /^[a-z0-9_-]{1,32}$/i;
