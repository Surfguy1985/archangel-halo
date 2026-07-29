import { Router, type IRouter } from "express";
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  clientUsersTable,
  clientDashboardCardsTable,
  clientDashboardActionsTable,
  propertiesTable,
  jobsTable,
  crewsTable,
  crewCheckinsTable,
  crewPhotosTable,
  invoicesTable,
  workRequestsTable,
  activitiesTable,
  notificationsTable,
  businessSettingsTable,
  type ClientUser,
  type Job,
} from "@workspace/db";
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
} from "@workspace/api-zod";
import { effectivePermissions } from "./clientAccess";

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

async function accountByToken(token: string) {
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.dashboardToken, token))
    .limit(1);
  if (!account || account.status !== "active") return undefined;
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
router.post("/client/:token/board/login", async (req, res): Promise<void> => {
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
  if (job.status === "scheduled" || job.scheduledOn) return { lane: "scheduled" };
  return { lane: "requested" };
}

function storageUrl(path: string): string {
  // Manual /api asset links must be absolute — never BASE_URL-prefixed.
  return `/api/storage${path}`;
}

function isMakeReady(job: Job): boolean {
  const s = `${job.category ?? ""} ${job.description ?? ""}`.toLowerCase();
  return s.includes("make ready") || s.includes("make-ready") || s.includes("makeready") || s.includes("turn");
}

async function projectBoard(account: typeof clientAccountsTable.$inferSelect) {
  const propertyId = account.propertyId;
  const [jobs, requests, invoices, boardRows] = await Promise.all([
    db.select().from(jobsTable).where(eq(jobsTable.propertyId, propertyId)),
    db.select().from(workRequestsTable).where(eq(workRequestsTable.propertyId, propertyId)),
    db.select().from(invoicesTable).where(eq(invoicesTable.propertyId, propertyId)),
    db
      .select()
      .from(clientDashboardCardsTable)
      .where(eq(clientDashboardCardsTable.propertyId, propertyId)),
  ]);

  const overrides = new Map(
    boardRows.filter((r) => r.kind === "override").map((r) => [r.cardKey, r]),
  );
  const customs = boardRows.filter((r) => r.kind === "custom" && !r.archived);

  const now = Date.now();
  const DAY = 86_400_000;
  const activeJobs = jobs.filter(
    (j) => !j.clearedAt || now - new Date(j.clearedAt).getTime() < 14 * DAY,
  );

  const crewIds = [
    ...new Set(activeJobs.map((j) => j.crewLeaderId).filter((x): x is string => !!x)),
  ];
  const jobIds = activeJobs.map((j) => j.id);
  const [crews, photos, checkins] = await Promise.all([
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

  type CardRow = Record<string, unknown> & { cardKey: string; lane: string; position: number };
  const cards: CardRow[] = [];

  const applyOverride = (card: CardRow) => {
    const o = overrides.get(card.cardKey);
    if (o) {
      if (o.lane && LANE_KEYS.has(o.lane)) card.lane = o.lane;
      card.position = o.position;
      if (o.notes != null) card.notes = o.notes;
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
    cards.push(
      applyOverride({
        cardKey: `job:${job.id}`,
        template: makeReady ? "makeready" : "job",
        title: job.description || `${job.category ?? "Job"} ${job.jobNo}`,
        subtitle: `Job ${job.jobNo}${job.woNo ? ` · WO ${job.woNo}` : ""}`,
        lane,
        position: 0,
        pipeline: makeReady ? MAKEREADY_PIPELINE : JOB_PIPELINE,
        stageIndex,
        status: job.status,
        unitNo: job.unitNo ?? null,
        category: job.category ?? null,
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
      }),
    );

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

  // Invoice cards ----------------------------------------------------------
  for (const inv of invoices) {
    if (inv.status === "paid" && inv.paidAt && now - new Date(inv.paidAt).getTime() > 30 * DAY)
      continue;
    const stageIndex = inv.status === "paid" ? 4 : inv.status === "sent" ? 3 : 1;
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
        actions:
          inv.status === "paid"
            ? []
            : [{ key: "invoice.mark_reviewed", label: "Mark Reviewed", kind: "secondary", href: null }],
        editable: false,
        updatedAt: (inv.paidAt ?? inv.sentAt ?? inv.createdAt).toISOString(),
      }),
    );
  }

  // Work request cards -----------------------------------------------------
  for (const wr of requests) {
    if (wr.status === "accepted") continue; // shows up as a job card instead
    if (wr.status === "declined" && wr.decidedAt && now - new Date(wr.decidedAt).getTime() > 14 * DAY)
      continue;
    cards.push(
      applyOverride({
        cardKey: `request:${wr.id}`,
        template: "request",
        title: wr.serviceLabel,
        subtitle: wr.requesterName ? `Requested by ${wr.requesterName}` : null,
        lane: "requested",
        position: 0,
        pipeline: REQUEST_PIPELINE,
        stageIndex: 0,
        status: wr.status,
        unitNo: wr.unitNo ?? null,
        category: null,
        amount: null,
        priority: null,
        dueOn: wr.neededBy ?? null,
        scheduledOn: null,
        description: wr.notes ?? null,
        notes: null,
        crew: null,
        trackerUrl: null,
        payUrl: null,
        photos: [],
        actions:
          wr.status === "pending"
            ? [{ key: "request.cancel", label: "Cancel Request", kind: "secondary", href: null }]
            : [],
        editable: false,
        updatedAt: (wr.decidedAt ?? wr.createdAt).toISOString(),
      }),
    );
  }

  // Custom client cards ----------------------------------------------------
  for (const c of customs) {
    cards.push({
      cardKey: c.cardKey,
      template: "custom",
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
    });
  }

  cards.sort((a, b) => (a.position as number) - (b.position as number));
  return cards;
}

router.get("/client/:token/board", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
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
  const [cards, audit] = await Promise.all([
    projectBoard(account),
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
    }),
  );
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
  if (!LANE_KEYS.has(body.lane)) {
    res.status(400).json({ error: "Unknown lane" });
    return;
  }
  const [row] = await db
    .insert(clientDashboardCardsTable)
    .values({
      propertyId: account.propertyId,
      cardKey: `custom:${crypto.randomUUID()}`,
      kind: "custom",
      lane: body.lane,
      position: Date.now(),
      title,
      description: body.description ?? null,
      notes: body.notes ?? null,
      priority: body.priority ?? null,
      dueOn: body.dueOn ?? null,
      createdBy: viewer.name,
    })
    .returning();
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

    // HALO-fed card: only notes are client-editable, stored as an override.
    if (body.notes === undefined) {
      res.status(400).json({ error: "Only notes can be edited on HALO cards" });
      return;
    }
    if (existing) {
      const [row] = await db
        .update(clientDashboardCardsTable)
        .set({ notes: body.notes, updatedAt: new Date() })
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
    const [row] = await db
      .insert(clientDashboardCardsTable)
      .values({
        propertyId: account.propertyId,
        cardKey,
        kind: "override",
        notes: body.notes,
        position: Date.now(),
        createdBy: viewer.name,
      })
      .returning();
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
      if (!ctx.cardKey) return { ok: false, blocked: false, reason: "cardKey required" };
      if (!LANE_KEYS.has(lane)) return { ok: false, blocked: false, reason: "Unknown lane" };
      if ((ctx.cardKey.startsWith("job:") || ctx.cardKey.startsWith("crew:")) && lane === "done") {
        return {
          ok: false,
          blocked: true,
          reason: "Only the crew in the field can mark work done — it moves when HALO confirms completion",
        };
      }
      if (ctx.cardKey.startsWith("invoice:") && lane === "done") {
        return {
          ok: false,
          blocked: true,
          reason: "Invoices move to Done when payment clears in HALO",
        };
      }
      if (ctx.cardKey.startsWith("custom:")) {
        await db
          .update(clientDashboardCardsTable)
          .set({ lane, position: Number.isFinite(position) ? position : Date.now(), updatedAt: new Date() })
          .where(
            and(
              eq(clientDashboardCardsTable.propertyId, ctx.account.propertyId),
              eq(clientDashboardCardsTable.cardKey, ctx.cardKey),
            ),
          );
        return { ok: true, blocked: false, message: "Card moved" };
      }
      // Override placement for HALO-fed cards
      await db
        .insert(clientDashboardCardsTable)
        .values({
          propertyId: ctx.account.propertyId,
          cardKey: ctx.cardKey,
          kind: "override",
          lane,
          position: Number.isFinite(position) ? position : Date.now(),
          createdBy: ctx.viewer.name,
        })
        .onConflictDoUpdate({
          target: [clientDashboardCardsTable.propertyId, clientDashboardCardsTable.cardKey],
          set: {
            lane,
            position: Number.isFinite(position) ? position : Date.now(),
            updatedAt: new Date(),
          },
        });
      return { ok: true, blocked: false, message: "Card moved" };
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
};

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
  const [crews, checkins, photos] = await Promise.all([
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
          .limit(20)
      : Promise.resolve([]),
  ]);
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const jobById = new Map(active.map((j) => [j.id, j]));
  const lastByJob = new Map<string, (typeof checkins)[number]>();
  for (const c of checkins) {
    if (c.jobId && !lastByJob.has(c.jobId)) lastByJob.set(c.jobId, c);
  }

  const crewsOut = active
    .filter((j) => j.crewLeaderId)
    .map((j) => {
      const crew = crewById.get(j.crewLeaderId!);
      const last = lastByJob.get(j.id);
      const onSite =
        !!last &&
        last.kind !== "checkout" &&
        now - new Date(last.createdAt).getTime() < 4 * 3_600_000;
      return {
        crewName: crew?.name ?? "Crew",
        crewTrade: crew?.trade ?? null,
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
        lat: last?.lat ?? null,
        lng: last?.lng ?? null,
        accuracy: last?.accuracy ?? null,
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

export default router;
