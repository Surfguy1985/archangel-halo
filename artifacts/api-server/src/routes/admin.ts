import { Router, type IRouter } from "express";
import { createHash, randomBytes, scryptSync } from "crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  crewPhotosTable,
  jobSummariesTable,
  clientUsersTable,
  clientOnboardingSendsTable,
  propertiesTable,
  contactsTable,
  priceItemsTable,
  invoicesTable,
  jobsTable,
  bidsTable,
  activitiesTable,
  paymentRequestsTable,
  paymentRequestJobsTable,
  clientBoardCardsTable,
  clientCardHistoryTable,
  clientCardCommentsTable,
  clientBoardNotificationsTable,
  clientDashboardCardsTable,
  clientDashboardActionsTable,
  type ClientAccount,
  type ClientUser,
  type ClientOnboardingSend,
} from "@workspace/db";
import {
  ListClientAccountsResponse,
  GetClientAccountResponse,
  UpsertClientAccountBody,
  UpsertClientAccountResponse,
  CreateClientUserBody,
  CreateClientUserResponse,
  UpdateClientUserBody,
  UpdateClientUserResponse,
  ResetClientUserPasswordBody,
  ResetClientUserPasswordResponse,
  DeleteClientUserResponse,
  RegenerateDashboardTokenResponse,
  SendClientOnboardingBody,
  SendClientOnboardingResponse,
  PushClientBoardCardBody,
  PushClientBoardCardResponse,
  GetClientBoardPushQuickPicksResponse,
} from "@workspace/api-zod";
import { raiseClientCard } from "../lib/clientBoard";
import { isUniqueViolation } from "../lib/dbErrors";
import {
  buildInvoiceModule,
  pickInvoiceForPush,
  buildInvoiceBatchModule,
  buildTrackerModule,
  buildFlagsModule,
  buildSummaryModule,
  buildPhotosModule,
  buildLinkModule,
  buildReferralModule,
  buildBidModule,
  buildCrewMapModule,
  buildDocumentModule,
} from "../lib/cardModules";
import { notifyCardPush } from "../lib/clientCardDigest";
import { sendEmail } from "../lib/email";
import { getBusinessSettings } from "../lib/businessSettings";
import { ser } from "../lib/serialize";

const router: IRouter = Router();

const TIERS = new Set(["basic", "pro", "enterprise"]);
const STATUSES = new Set(["active", "paused", "cancelled"]);
const ROLES = new Set(["admin", "member", "guest"]);

class SeatError extends Error {}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

export function newTempPassword(): string {
  // Readable, no ambiguous chars, 10 chars.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function publicBaseUrl(): string {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}` : "";
}

function dashboardUrl(token: string): string {
  const base = publicBaseUrl();
  return base ? `${base}/board/${token}` : `/board/${token}`;
}

async function ensureAccount(propertyId: string): Promise<ClientAccount> {
  const [existing] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.propertyId, propertyId));
  if (existing) return existing;
  const [created] = await db
    .insert(clientAccountsTable)
    .values({ propertyId, dashboardToken: newToken() })
    .onConflictDoNothing({ target: clientAccountsTable.propertyId })
    .returning();
  if (created) return created;
  const [raced] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.propertyId, propertyId));
  return raced;
}

function serAccount(a: ClientAccount) {
  return {
    id: a.id,
    propertyId: a.propertyId,
    tier: a.tier,
    userSeats: a.userSeats,
    guestSeats: a.guestSeats,
    status: a.status,
    notes: a.notes,
    logoPath: a.logoPath,
    servicesOverview: a.servicesOverview,
    dashboardToken: a.dashboardToken,
    dashboardUrl: dashboardUrl(a.dashboardToken),
    notifyNewCards: a.notifyNewCards,
    onboardingStatus: a.onboardingStatus,
    onboardingSentAt: a.onboardingSentAt ? a.onboardingSentAt.toISOString() : null,
    billingDay: a.billingDay,
    paymentMethod: a.paymentMethod ?? null,
    billingContact: a.billingContact ?? null,
  };
}

function serUser(u: ClientUser) {
  return {
    id: u.id,
    propertyId: u.propertyId,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    lastPasswordResetAt: u.lastPasswordResetAt
      ? u.lastPasswordResetAt.toISOString()
      : null,
    createdAt: u.createdAt.toISOString(),
  };
}

function serSend(s: ClientOnboardingSend) {
  return {
    id: s.id,
    propertyId: s.propertyId,
    channel: s.channel,
    sentTo: s.sentTo,
    link: s.link,
    status: s.status,
    detail: s.detail,
    createdAt: s.createdAt.toISOString(),
  };
}

router.get("/admin/accounts", async (_req, res): Promise<void> => {
  const [props, accounts, users] = await Promise.all([
    db.select().from(propertiesTable).where(eq(propertiesTable.status, "active")),
    db.select().from(clientAccountsTable),
    db.select().from(clientUsersTable),
  ]);
  const accountByProp = new Map(accounts.map((a) => [a.propertyId, a]));
  const seatCount = new Map<string, number>();
  for (const u of users) {
    if (u.active && u.role !== "guest") {
      seatCount.set(u.propertyId, (seatCount.get(u.propertyId) ?? 0) + 1);
    }
  }
  const out = props
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const a = accountByProp.get(p.id);
      return {
        propertyId: p.id,
        propertyName: p.name,
        pmcName: p.pmcName,
        city: p.city,
        units: p.units,
        logoPath: a?.logoPath ?? null,
        tier: a?.tier ?? "basic",
        status: a?.status ?? "active",
        userSeatsUsed: seatCount.get(p.id) ?? 0,
        userSeats: a?.userSeats ?? 3,
        guestSeats: a?.guestSeats ?? 5,
        onboardingStatus: a?.onboardingStatus ?? "not_sent",
        hasAccount: !!a,
      };
    });
  res.json(ListClientAccountsResponse.parse(out));
});

router.get("/admin/accounts/:propertyId", async (req, res): Promise<void> => {
    const propertyId = req.params.propertyId;
    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, req.params.propertyId));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const account = await ensureAccount(property.id);
  const [users, sends, contacts, services] = await Promise.all([
    db
      .select()
      .from(clientUsersTable)
      .where(eq(clientUsersTable.propertyId, propertyId))
      .orderBy(desc(clientUsersTable.createdAt)),
    db
      .select()
      .from(clientOnboardingSendsTable)
      .where(eq(clientOnboardingSendsTable.propertyId, propertyId))
      .orderBy(desc(clientOnboardingSendsTable.createdAt))
      .limit(20),
    db.select().from(contactsTable).where(eq(contactsTable.propertyId, propertyId)),
    db
      .select()
      .from(priceItemsTable)
      .where(eq(priceItemsTable.propertyId, propertyId)),
  ]);
  res.json(
    GetClientAccountResponse.parse({
      account: serAccount(account),
      users: users.map(serUser),
      sends: sends.map(serSend),
      property: {
        id: property.id,
        name: property.name,
        pmcName: property.pmcName,
        address: property.address,
        city: property.city,
        units: property.units,
        brief: property.brief,
      },
      contacts: contacts.map((c) => ser(c)),
      services: services.map((s) => ser(s)),
    }),
  );
});

router.put("/admin/accounts/:propertyId", async (req, res): Promise<void> => {
  const propertyId = req.params.propertyId;
  const body = UpsertClientAccountBody.parse(req.body);
  const [property] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  if (body.tier != null && !TIERS.has(body.tier)) {
    res.status(400).json({ error: "Tier must be basic, pro, or enterprise" });
    return;
  }
  if (body.status != null && !STATUSES.has(body.status)) {
    res.status(400).json({ error: "Status must be active, paused, or cancelled" });
    return;
  }
  if (
    body.paymentMethod &&
    body.paymentMethod.methodType !== "card" &&
    body.paymentMethod.methodType !== "ach"
  ) {
    res.status(400).json({ error: "Payment method type must be card or ach" });
    return;
  }
  const account = await ensureAccount(propertyId);
  // Token rotation lives ONLY in /admin/accounts/:propertyId/token/regenerate —
  // an ordinary save must never invalidate the client's dashboard link.
  const [updated] = await db
    .update(clientAccountsTable)
    .set({
      ...(body.tier != null ? { tier: body.tier } : {}),
      ...(body.userSeats != null
        ? { userSeats: Math.max(0, Math.round(body.userSeats)) }
        : {}),
      ...(body.guestSeats != null
        ? { guestSeats: Math.max(0, Math.round(body.guestSeats)) }
        : {}),
      ...(body.status != null ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.logoPath !== undefined ? { logoPath: body.logoPath } : {}),
      ...(body.servicesOverview !== undefined
        ? { servicesOverview: body.servicesOverview }
        : {}),
      ...(body.notifyNewCards != null ? { notifyNewCards: body.notifyNewCards } : {}),
      ...(body.billingDay != null
        ? { billingDay: Math.min(28, Math.max(1, Math.round(body.billingDay))) }
        : {}),
      ...(body.billingContact !== undefined
        ? { billingContact: body.billingContact }
        : {}),
      // Sanitized display fields only (last4 etc.) — full numbers are never
      // accepted on the office side; keep any existing updatedAt semantics.
      ...(body.paymentMethod !== undefined
        ? {
            paymentMethod: body.paymentMethod
              ? {
                  methodType: body.paymentMethod.methodType as "card" | "ach",
                  last4: body.paymentMethod.last4.slice(-4),
                  brand: body.paymentMethod.brand ?? null,
                  bankName: body.paymentMethod.bankName ?? null,
                  cardExp: body.paymentMethod.cardExp ?? null,
                  payerName: body.paymentMethod.payerName,
                  zip: body.paymentMethod.zip ?? null,
                  updatedAt: new Date().toISOString(),
                }
              : null,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(clientAccountsTable.id, account.id))
    .returning();
  res.json(UpsertClientAccountResponse.parse(serAccount(updated)));
});

router.post(
  "/admin/accounts/:propertyId/users",
  async (req, res): Promise<void> => {
    const propertyId = req.params.propertyId;
    const body = CreateClientUserBody.parse(req.body);
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Enter a valid email address" });
      return;
    }
    const role = body.role != null && ROLES.has(body.role) ? body.role : "member";
    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, req.params.propertyId));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const account = await ensureAccount(property.id);
    const tempPassword = newTempPassword();
    let user: ClientUser;
    try {
      user = await db.transaction(async (tx) => {
        // Lock this property's rows for the seat check (serialize concurrent creates).
        const users = await tx
          .select()
          .from(clientUsersTable)
          .where(eq(clientUsersTable.propertyId, propertyId))
          .for("update");
        if (users.some((u) => u.email.toLowerCase() === email)) {
          throw new SeatError("A login with that email already exists");
        }
        const activeSeated = users.filter((u) => u.active && u.role !== "guest").length;
        const activeGuests = users.filter((u) => u.active && u.role === "guest").length;
        if (role !== "guest" && activeSeated >= account.userSeats) {
          throw new SeatError(
            `All ${account.userSeats} user seats are taken — raise the seat count or deactivate a user first`,
          );
        }
        if (role === "guest" && activeGuests >= account.guestSeats) {
          throw new SeatError(
            `All ${account.guestSeats} guest seats are taken — raise the guest seat count first`,
          );
        }
        const [created] = await tx
          .insert(clientUsersTable)
          .values({
            propertyId,
            name: body.name.trim(),
            email,
            role,
            passwordHash: hashPassword(tempPassword),
          })
          .returning();
        return created;
      });
    } catch (e) {
      if (e instanceof SeatError) {
        res.status(400).json({ error: e.message });
        return;
      }
      if (isUniqueViolation(e)) {
        res.status(400).json({ error: "A login with that email already exists" });
        return;
      }
      throw e;
    }
    let emailed = false;
    if (body.sendEmail) {
      emailed = await emailCredentials(user, tempPassword, account);
    }
    res
      .status(201)
      .json(
        CreateClientUserResponse.parse({
          user: serUser(user),
          tempPassword,
          emailed,
        }),
      );
  },
);

export async function emailCredentials(
  user: ClientUser,
  tempPassword: string,
  account: ClientAccount,
): Promise<boolean> {
  const settings = await getBusinessSettings();
  const company = settings.companyName || "ArchAngel Contractors";
  const link = dashboardUrl(account.dashboardToken);
  const result = await sendEmail({
    to: user.email,
    subject: `Your ${company} dashboard login`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101318">
        <h2 style="margin-bottom:4px">Your dashboard login</h2>
        <p>Hi ${escHtml(user.name)},</p>
        <p>Here are your login details for the ${escHtml(company)} property dashboard:</p>
        <p style="background:#f4f5f7;border-radius:8px;padding:14px 16px">
          <b>Email:</b> ${escHtml(user.email)}<br/>
          <b>Temporary password:</b> <code>${tempPassword}</code>
        </p>
        <p><a href="${link}" style="background:#B4FF44;color:#000;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:10px;display:inline-block">Open your board</a></p>
        <p style="color:#667085;font-size:13px">Keep this password safe — you can ask us for a reset any time.</p>
      </div>`,
  });
  return result.ok;
}

router.patch("/admin/client-users/:id", async (req, res): Promise<void> => {
    const body = UpdateClientUserBody.parse(req.body);
    const [user] = await db
      .select()
      .from(clientUsersTable)
      .where(eq(clientUsersTable.id, req.params.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (body.role != null && !ROLES.has(body.role)) {
    res.status(400).json({ error: "Role must be admin, member, or guest" });
    return;
  }
  const nextRole = body.role ?? user.role;
  const nextActive = body.active ?? user.active;
  try {
    const updated = await db.transaction(async (tx) => {
      // Re-check seat caps whenever the user would (re)occupy a seat.
      const becomesSeated =
        nextActive && (!user.active || user.role !== nextRole);
      if (becomesSeated) {
        const account = await ensureAccount(user.propertyId);
        const others = await tx
          .select()
          .from(clientUsersTable)
          .where(eq(clientUsersTable.propertyId, user.propertyId))
          .for("update");
        const activeSeated = others.filter(
          (u) => u.id !== user.id && u.active && u.role !== "guest",
        ).length;
        const activeGuests = others.filter(
          (u) => u.id !== user.id && u.active && u.role === "guest",
        ).length;
        if (nextRole !== "guest" && activeSeated >= account.userSeats) {
          throw new SeatError(
            `All ${account.userSeats} user seats are taken — raise the seat count or deactivate a user first`,
          );
        }
        if (nextRole === "guest" && activeGuests >= account.guestSeats) {
          throw new SeatError(
            `All ${account.guestSeats} guest seats are taken — raise the guest seat count first`,
          );
        }
      }
      const [row] = await tx
        .update(clientUsersTable)
        .set({
          ...(body.name != null ? { name: body.name.trim() } : {}),
          ...(body.email != null
            ? { email: body.email.trim().toLowerCase() }
            : {}),
          ...(body.role != null ? { role: body.role } : {}),
          ...(body.active != null ? { active: body.active } : {}),
        })
        .where(eq(clientUsersTable.id, user.id))
        .returning();
      return row;
    });
    res.json(UpdateClientUserResponse.parse(serUser(updated)));
  } catch (e) {
    if (e instanceof SeatError) {
      res.status(400).json({ error: e.message });
      return;
    }
    if (isUniqueViolation(e)) {
      res.status(400).json({ error: "A login with that email already exists" });
      return;
    }
    throw e;
  }
});

router.delete("/admin/client-users/:id", async (req, res): Promise<void> => {
  const [deleted] = await db
    .delete(clientUsersTable)
    .where(eq(clientUsersTable.id, req.params.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(DeleteClientUserResponse.parse({ ok: true }));
});

router.post(
  "/admin/client-users/:id/reset-password",
  async (req, res): Promise<void> => {
    const body = ResetClientUserPasswordBody.parse(req.body);
    const [user] = await db
      .select()
      .from(clientUsersTable)
      .where(eq(clientUsersTable.id, req.params.id));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const tempPassword = newTempPassword();
    const [updated] = await db
      .update(clientUsersTable)
      .set({
        passwordHash: hashPassword(tempPassword),
        lastPasswordResetAt: new Date(),
      })
      .where(eq(clientUsersTable.id, user.id))
      .returning();
    let emailed = false;
    if (body.sendEmail) {
      const account = await ensureAccount(user.propertyId);
      emailed = await emailCredentials(updated, tempPassword, account);
    }
    res.json(
      ResetClientUserPasswordResponse.parse({
        user: serUser(updated),
        tempPassword,
        emailed,
      }),
    );
  },
);

router.post(
  "/admin/accounts/:propertyId/token/regenerate",
  async (req, res): Promise<void> => {
    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, req.params.propertyId));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const account = await ensureAccount(property.id);
    const [updated] = await db
      .update(clientAccountsTable)
      .set({ dashboardToken: newToken(), updatedAt: new Date() })
      .where(eq(clientAccountsTable.id, account.id))
      .returning();
    res.json(RegenerateDashboardTokenResponse.parse(serAccount(updated)));
  },
);

// Office-gated maintenance: wipe every stored client-board row for a property
// (pushed/override cards, history, comments, notifications, and the legacy
// dashboard cards/actions) so the board reads as brand-new for a fresh send.
// HALO-derived cards are recomputed on read, so this never touches jobs,
// invoices, price items, or the account row itself.
router.post(
  "/admin/accounts/:propertyId/board-reset",
  async (req, res): Promise<void> => {
    const propertyId = req.params.propertyId;
    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const deleted: Record<string, number> = {};
    await db.transaction(async (tx) => {
      const wipe = async (name: string, table: any) => {
        const rows = await tx
          .delete(table)
          .where(eq(table.propertyId, propertyId))
          .returning({ id: table.id });
        deleted[name] = rows.length;
      };
      await wipe("boardCards", clientBoardCardsTable);
      await wipe("cardHistory", clientCardHistoryTable);
      await wipe("cardComments", clientCardCommentsTable);
      await wipe("notifications", clientBoardNotificationsTable);
      await wipe("dashboardCards", clientDashboardCardsTable);
      await wipe("dashboardActions", clientDashboardActionsTable);
    });
    res.json({ ok: true, deleted });
  },
);

const PUSH_KINDS = new Set([
  "invoice",
  "payment_request",
  "summary",
  "tracker",
  "photos",
  "flag",
  "manual",
  "referral",
  "crewmap",
  "invoice_batch",
  "bid",
  "document",
]);

router.post(
  "/admin/accounts/:propertyId/board/push",
  async (req, res): Promise<void> => {
    const body = PushClientBoardCardBody.parse(req.body);
    if (!PUSH_KINDS.has(body.kind)) {
      res.status(400).json({ error: "Unknown card type" });
      return;
    }
    const title = body.title.trim();
    if (!title) {
      res.status(400).json({ error: "Card needs a title" });
      return;
    }
    if (body.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
      res.status(400).json({ error: "Due date must be YYYY-MM-DD" });
      return;
    }
    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, req.params.propertyId));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    // Board link must exist for the client to land somewhere.
    await ensureAccount(property.id);
    let links: { label: string; url: string }[] = [];
    if (body.linkUrl?.trim()) {
      const raw = body.linkUrl.trim();
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        res.status(400).json({ error: "Link must be a valid URL" });
        return;
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        res.status(400).json({ error: "Link must be an http(s) URL" });
        return;
      }
      links = [{ label: body.linkLabel?.trim() || "Open", url: raw }];
    }
    // Uploaded file attachments become open-able links on the card. Only our
    // own storage paths or https URLs are allowed — never arbitrary schemes.
    for (const att of body.attachments ?? []) {
      const name = att.name.trim() || "Attachment";
      const url = att.url.trim();
      const isStorage = url.startsWith("/api/storage/") || url.startsWith("/api/invoices/");
      let isHttp = false;
      if (!isStorage) {
        try {
          const u = new URL(url);
          isHttp = u.protocol === "https:" || u.protocol === "http:";
        } catch {
          isHttp = false;
        }
      }
      if (!isStorage && !isHttp) {
        res.status(400).json({ error: `Attachment "${name}" has an invalid URL` });
        return;
      }
      if (links.length >= 8) break; // keep cards sane
      links.push({ label: name, url });
    }
    // "referral" is a composer template, stored as a manual card whose module
    // carries the interactive refer-us form.
    const cardKind = (
      body.kind === "referral" || body.kind === "document"
        ? "manual"
        : body.kind === "crewmap"
          ? "tracker"
          : body.kind === "invoice_batch"
            ? "invoice"
            : body.kind === "bid"
              ? "manual"
              : body.kind
    ) as "invoice" | "payment_request" | "summary" | "tracker" | "photos" | "flag" | "manual";
    // Build the self-contained module snapshot for this card.
    let module: Record<string, unknown> | null = null;
    let sourceType = body.sourceType?.trim() || "office_push";
    let sourceId = body.sourceId?.trim() || "";
    if (body.kind === "crewmap") {
      module = await buildCrewMapModule(property.id);
      if (!module) {
        res.status(404).json({ error: "Property not found" });
        return;
      }
      sourceType = "crewmap";
      sourceId = property.id; // one live crew-map card per property — re-push refreshes it
    } else if (body.kind === "invoice_batch") {
      const ids = (body.sourceIds ?? []).filter((x): x is string => !!x);
      module = await buildInvoiceBatchModule(property.id, ids);
      if (!module) {
        res.status(400).json({ error: "Pick at least one invoice for the batch" });
        return;
      }
      sourceType = "invoice_batch";
      sourceId = sourceId || createHash("sha1").update([...ids].sort().join(",")).digest("hex").slice(0, 32);
    } else if (body.kind === "bid" && (body.sourceId || body.sourceIds?.[0])) {
      const bidId = body.sourceId || body.sourceIds![0]!;
      module = await buildBidModule(property.id, bidId);
      if (!module) {
        res.status(404).json({ error: "Bid not found on this property" });
        return;
      }
      sourceType = "bid";
      sourceId = bidId;
    } else if (body.kind === "document") {
      // A pasted link or an uploaded file both satisfy the document card.
      module = buildDocumentModule(links[0]?.url ?? null, links[0]?.label ?? null);
      if (!module) {
        res.status(400).json({ error: "A document card needs a file link or an uploaded file" });
        return;
      }
    } else if (body.kind === "invoice" && body.sourceType === "invoice" && body.sourceId) {
      module = await buildInvoiceModule(property.id, body.sourceId);
    } else if ((body.kind === "tracker" || body.sourceType === "tracker") && (body.jobId || body.sourceId)) {
      module = await buildTrackerModule(property.id, body.jobId || body.sourceId!);
    } else if (body.kind === "flag") {
      module = await buildFlagsModule(property.id);
    } else if (body.kind === "referral") {
      module = buildReferralModule();
    } else if (body.kind === "summary" && body.sourceType === "summary" && body.sourceId) {
      module = await buildSummaryModule(property.id, body.sourceId);
    } else if (body.kind === "photos" && body.sourceType === "photos" && body.sourceId) {
      module = await buildPhotosModule(property.id, body.sourceId);
    } else if (body.kind === "photos" || body.kind === "summary") {
      module = buildLinkModule("link", links[0]?.url ?? null, links[0]?.label ?? null);
    } else if (body.kind === "invoice") {
      // Office pushed an invoice card without explicitly linking an invoice —
      // auto-link the unpaid invoice it most likely refers to (amount match,
      // else most recent) so the client gets the full approve/pay flow.
      const inv = await pickInvoiceForPush(property.id, body.amount ?? null);
      if (inv) {
        module = await buildInvoiceModule(property.id, inv.id);
        if (module) {
          sourceType = "invoice";
          sourceId = inv.id;
        }
      }
    }
    const card = await raiseClientCard({
      propertyId: property.id,
      kind: cardKind,
      module,
      title,
      body: body.body?.trim() || null,
      actionLabel: body.actionLabel?.trim() || null,
      amount: body.amount ?? null,
      dueDate: body.dueDate ?? null,
      links,
      sourceType,
      sourceId: sourceId || randomBytes(12).toString("hex"),
      jobId: body.jobId ?? null,
    });
    if (!card) {
      res.status(400).json({ error: "Couldn't create the card" });
      return;
    }
    const notify = await notifyCardPush(property.id, card);
    res.json(
      PushClientBoardCardResponse.parse({
        cardId: card.id,
        notified: notify.notified,
        notifiedTo: notify.notifiedTo,
        notifySkippedReason: notify.skippedReason,
      }),
    );
  },
);

// Real entities the Push Card composer can prefill from in one tap.
router.get(
  "/admin/accounts/:propertyId/board/push/quick-picks",
  async (req, res): Promise<void> => {
    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, req.params.propertyId));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const base = publicBaseUrl();

    // Unpaid invoices — sent but not paid (past_due is virtual on "sent").
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.propertyId, property.id), eq(invoicesTable.status, "sent")))
      .orderBy(desc(invoicesTable.createdAt));

    // Pay links: latest unpaid payment request that covers each invoice.
    const payUrlByInvoice = new Map<string, string>();
    if (invoices.length > 0) {
      const linkRows = await db
        .select({
          invoiceId: paymentRequestJobsTable.invoiceId,
          token: paymentRequestsTable.token,
          status: paymentRequestsTable.status,
          createdAt: paymentRequestsTable.createdAt,
        })
        .from(paymentRequestJobsTable)
        .innerJoin(
          paymentRequestsTable,
          eq(paymentRequestJobsTable.requestId, paymentRequestsTable.id),
        )
        .where(
          inArray(
            paymentRequestJobsTable.invoiceId,
            invoices.map((i) => i.id),
          ),
        )
        .orderBy(desc(paymentRequestsTable.createdAt));
      for (const row of linkRows) {
        if (!row.invoiceId) continue;
        if (row.status === "paid" || row.status === "returned") continue;
        if (!payUrlByInvoice.has(row.invoiceId)) {
          payUrlByInvoice.set(row.invoiceId, `${base}/pay/${row.token}`);
        }
      }
    }

    // Active jobs — not completed/cleared. Ensure each has its stable tracker
    // token (atomic first-wins, same as the job tracker share flow).
    const activeJobs = await db
      .select()
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.propertyId, property.id),
          isNull(jobsTable.completedAt),
          isNull(jobsTable.clearedAt),
        ),
      )
      .orderBy(desc(jobsTable.createdAt));
    const trackers: {
      jobId: string;
      jobNo: string;
      description: string | null;
      unitNo: string | null;
      trackerUrl: string;
    }[] = [];
    for (const job of activeJobs) {
      let token = job.trackerToken;
      if (!token) {
        const candidate = randomBytes(18).toString("base64url");
        const updated = await db
          .update(jobsTable)
          .set({ trackerToken: candidate })
          .where(and(eq(jobsTable.id, job.id), isNull(jobsTable.trackerToken)))
          .returning({ trackerToken: jobsTable.trackerToken });
        if (updated.length > 0) {
          token = candidate;
          await db.insert(activitiesTable).values({
            entityType: "job",
            entityId: job.id,
            kind: "note",
            body: `Live tracker link created for job ${job.jobNo}.`,
          });
        } else {
          const [fresh] = await db
            .select({ trackerToken: jobsTable.trackerToken })
            .from(jobsTable)
            .where(eq(jobsTable.id, job.id));
          token = fresh?.trackerToken ?? candidate;
        }
      }
      trackers.push({
        jobId: job.id,
        jobNo: job.jobNo,
        description: job.description ?? null,
        unitNo: job.unitNo ?? null,
        trackerUrl: `${base}/track/${token}`,
      });
    }

    // Sent job recaps — pushable as interactive summary cards.
    const summaryRows = await db
      .select()
      .from(jobSummariesTable)
      .where(eq(jobSummariesTable.propertyId, property.id))
      .orderBy(desc(jobSummariesTable.updatedAt))
      .limit(20);
    const summaries = summaryRows.map((s) => ({
      id: s.id,
      title: s.title,
      unitNo: s.unitNumber ?? null,
      serviceDate: s.serviceDate ?? null,
      result: s.overallResult,
      status: s.status,
    }));

    // Jobs that have crew photos — pushable as photo-set cards.
    const photoCounts = await db
      .select({ jobId: crewPhotosTable.jobId, count: sql<number>`count(*)::int` })
      .from(crewPhotosTable)
      .innerJoin(jobsTable, eq(crewPhotosTable.jobId, jobsTable.id))
      .where(eq(jobsTable.propertyId, property.id))
      .groupBy(crewPhotosTable.jobId);
    const photoJobIds = photoCounts.map((p) => p.jobId).filter((x): x is string => !!x);
    const photoJobRows = photoJobIds.length
      ? await db.select().from(jobsTable).where(inArray(jobsTable.id, photoJobIds))
      : [];
    const countByJob = new Map(photoCounts.map((p) => [p.jobId, p.count]));
    const photoJobs = photoJobRows
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      .slice(0, 20)
      .map((j) => ({
        jobId: j.id,
        jobNo: j.jobNo,
        unitNo: j.unitNo ?? null,
        description: j.description ?? null,
        photoCount: countByJob.get(j.id) ?? 0,
      }));

    // Bids on this property — pushable as proposal cards with a PDF view.
    const bidRows = await db
      .select()
      .from(bidsTable)
      .where(eq(bidsTable.propertyId, property.id))
      .orderBy(desc(bidsTable.createdAt))
      .limit(20);
    const bids = bidRows.map((b) => ({
      id: b.id,
      bidNo: b.bidNo,
      amount: b.amount,
      status: b.status,
      unitNo: b.unitNo ?? null,
      scope: b.scope ?? null,
    }));

    res.json(
      GetClientBoardPushQuickPicksResponse.parse({
        summaries,
        photoJobs,
        bids,
        invoices: invoices.map((inv) => ({
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          amount: inv.amount + (inv.taxAmount ?? 0),
          status: inv.status,
          dueDate: inv.dueAt
            ? `${inv.dueAt.getFullYear()}-${String(inv.dueAt.getMonth() + 1).padStart(2, "0")}-${String(inv.dueAt.getDate()).padStart(2, "0")}`
            : null,
          payUrl: payUrlByInvoice.get(inv.id) ?? null,
          billToName: inv.billToName ?? null,
        })),
        trackers,
      }),
    );
  },
);

router.post(
  "/admin/accounts/:propertyId/onboarding/send",
  async (req, res): Promise<void> => {
    const body = SendClientOnboardingBody.parse(req.body);
    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, req.params.propertyId));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    if (body.channel !== "email" && body.channel !== "sms") {
      res.status(400).json({ error: "Channel must be email or sms" });
      return;
    }
    const to = body.to.trim();
    if (!to) {
      res.status(400).json({ error: "Enter where to send the link" });
      return;
    }
    const account = await ensureAccount(property.id);
    const link = dashboardUrl(account.dashboardToken);
    const settings = await getBusinessSettings();
    const company = settings.companyName || "ArchAngel Contractors";

    let ok = false;
    let detail: string | null = null;
    if (body.channel === "email") {
      const note = body.message
        ? `<p style="background:#f4f5f7;border-radius:8px;padding:12px 14px">${escHtml(body.message)}</p>`
        : "";
      const result = await sendEmail({
        to,
        subject: `${property.name} — your ${company} property dashboard`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101318">
            <h2 style="margin-bottom:4px">Welcome to your property dashboard</h2>
            <p>${escHtml(company)} set up a live dashboard for <b>${escHtml(property.name)}</b> —
            track work orders, crews on site, invoices, and photos in real time.
            Open it on your phone and add it to your home screen to install the app.</p>
            ${note}
            <p><a href="${link}" style="background:#B4FF44;color:#000;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px;display:inline-block">Open your board</a></p>
            <p style="color:#667085;font-size:13px">Or copy this link: ${link}</p>
          </div>`,
      });
      ok = result.ok;
      detail = result.ok ? null : (result.error ?? "Email delivery failed");
    } else {
      // SMS delivery is not wired up yet (Twilio helper pending).
      ok = false;
      detail = "SMS delivery is not set up yet — send by email for now";
    }

    const [send] = await db
      .insert(clientOnboardingSendsTable)
      .values({
        propertyId: property.id,
        channel: body.channel,
        sentTo: to,
        link,
        status: ok ? "sent" : "failed",
        detail,
      })
      .returning();

    if (ok) {
      await db
        .update(clientAccountsTable)
        .set({
          onboardingStatus: "sent",
          onboardingSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(clientAccountsTable.id, account.id));
    }
    if (!ok) {
      res.status(400).json({ error: detail ?? "Delivery failed" });
      return;
    }
    res.json(SendClientOnboardingResponse.parse(serSend(send)));
  },
);

export default router;
