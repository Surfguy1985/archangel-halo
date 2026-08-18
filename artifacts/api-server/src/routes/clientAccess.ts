import { deriveWaybill, deriveLaneWaybill, waybillCodeFor } from "../lib/waybill";
import { limits } from "../lib/rateLimit";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  clientUsersTable,
  clientBoardCardsTable,
  clientDashboardCardsTable,
  clientCardCommentsTable,
  propertiesTable,
  activitiesTable,
  notificationsTable,
  workRequestsTable,
  paymentRequestsTable,
  invoicesTable,
  jobsTable,
} from "@workspace/db";
import {
  GetClientAccessResponse,
  UpdateClientAccessUserBody,
  UpdateClientAccessUserResponse,
  CreateClientAccessUserBody,
  CreateClientAccessUserResponse,
  DeleteClientAccessUserResponse,
  GetClientBillingResponse,
  UpdateClientBillingBody,
  PutClientPaymentMethodBody,
  GetClientBoardFeedResponse,
  UpdateClientBoardFeedCardBody,
  UpdateClientBoardFeedCardResponse,
  UpdateClientBoardWebhookBody,
  UpdateClientBoardWebhookResponse,
  GetOfficeClientBoardResponse,
  CreateOfficeClientBoardCardBody,
  CreateOfficeClientBoardCardResponse,
  UpdateOfficeClientBoardCardBody,
  UpdateOfficeClientBoardCardResponse,
  DeleteOfficeClientBoardCardResponse,
  ResolveOfficeInvoiceDisputeBody,
  ResolveOfficeInvoiceDisputeResponse,
  ClientBoardCardActionBody,
  ClientBoardCardActionResponse,
  GetClientBoardInboxResponse,
  RespondClientInboxCardBody,
  ListOfficeCardCommentsResponse,
  AddOfficeCardCommentBody,
  AddOfficeCardCommentResponse,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { attachBoardStream, emitBoardEvent } from "../lib/boardEvents";
import { emitFalkonEvent } from "../lib/falkonEmit";
import { startMakeReadyExecution } from "../lib/falkonMakeReady";
import { raiseClientCard, webhookUrlProblem, ACTION_STATE_KEYS } from "../lib/clientBoard";
import { pushToCrewId } from "../lib/pushNotification";
import { resolveViewer, notifyClientBoard, threadKeysFor, threadMessageDto } from "./clientBoard";
import {
  buildInvoiceModule,
  buildInvoiceBatchModule,
  buildTrackerModule,
  buildFlagsModule,
  buildSummaryModule,
  buildPhotosModule,
  buildBidModule,
  buildCrewMapModule,
} from "../lib/cardModules";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Feature catalog for the client dashboard. The dashboard itself checks these
// keys when it renders; managers toggle them per user from the Admin panel.
// ---------------------------------------------------------------------------
export const CLIENT_FEATURES = [
  { key: "overview", label: "Dashboard overview", description: "Property snapshot, services, and activity" },
  { key: "live_jobs", label: "Live job board", description: "Kanban of jobs in progress across units" },
  { key: "unit_map", label: "Unit status map", description: "Community box view with flagged units" },
  { key: "photos", label: "Before & after photos", description: "Crew photo galleries per job" },
  { key: "summaries", label: "Job summaries & recaps", description: "Service recap documents and flags" },
  { key: "invoices", label: "Invoices & billing", description: "View invoices and balances" },
  { key: "payments", label: "Make payments", description: "Pay open requests by card, ACH, wire, or check" },
  { key: "requests", label: "Submit work requests", description: "Request new work or report an issue" },
  { key: "documents", label: "Documents", description: "Contracts, W-9s, and shared files" },
  { key: "board", label: "Archangel board", description: "Trello-style cards for everything we send — invoices, pay links, recaps, live trackers" },
  { key: "hub", label: "Property Hub", description: "Client-managed links, docs, info cards, employees, and maintenance contacts" },
  { key: "team_admin", label: "Admin — team access", description: "Manage users, roles, and permissions" },
] as const;

const FEATURE_KEYS = new Set(CLIENT_FEATURES.map((f) => f.key as string));

export const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: CLIENT_FEATURES.map((f) => f.key),
  member: [
    "overview",
    "live_jobs",
    "unit_map",
    "photos",
    "summaries",
    "invoices",
    "payments",
    "requests",
    "documents",
    "board",
    "hub",
  ],
  guest: ["overview", "photos", "summaries", "board", "unit_map", "hub"],
};

const ROLES = new Set(["admin", "member", "guest"]);

class SeatError extends Error {}

export function effectivePermissions(user: {
  role: string;
  permissions: string[] | null;
}): string[] {
  if (user.permissions) return user.permissions.filter((k) => FEATURE_KEYS.has(k));
  return ROLE_DEFAULTS[user.role] ?? ROLE_DEFAULTS.member!;
}

function serUser(u: typeof clientUsersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    permissions: effectivePermissions(u),
    customized: u.permissions !== null,
  };
}

async function accountByToken(token: string) {
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.dashboardToken, token))
    .limit(1);
  return account;
}

router.get("/client/:token/access", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account || account.status !== "active") {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, account.propertyId))
    .limit(1);
  const users = await db
    .select()
    .from(clientUsersTable)
    .where(eq(clientUsersTable.propertyId, account.propertyId));
  // The roster is just a directory now (names, emails, roles, preferences); it
  // no longer grants or restricts access. Whoever holds the link is the admin.
  users.sort((a, b) => a.name.localeCompare(b.name));
  res.json(
    GetClientAccessResponse.parse({
      propertyName: prop?.name ?? "Your property",
      logoUrl: account.logoPath ? `/api/storage${account.logoPath}` : null,
      features: CLIENT_FEATURES,
      roleDefaults: ROLE_DEFAULTS,
      users: users.map(serUser),
      seats: seatUsage(account, users),
    }),
  );
});

function seatUsage(
  account: { tier: string; userSeats: number; guestSeats: number },
  users: Array<{ active: boolean; role: string }>,
) {
  return {
    tier: account.tier,
    userSeats: account.userSeats,
    guestSeats: account.guestSeats,
    usedSeats: users.filter((u) => u.active && u.role !== "guest").length,
    usedGuestSeats: users.filter((u) => u.active && u.role === "guest").length,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Add a team member to the directory. The link holder manages the roster; it's
// a directory (names, emails, roles, notification prefs) — no logins, no
// passwords. Still seat-guarded so plan limits hold.
// ---------------------------------------------------------------------------
router.post("/client/:token/access/users", limits.cardAction, async (req, res): Promise<void> => {
  const parsed = CreateClientAccessUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Name, email, and role are required" });
    return;
  }
  const account = await accountByToken(String(req.params.token));
  if (!account || account.status !== "active") {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim().toLowerCase();
  const role = parsed.data.role;
  if (!name || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: "A name and a valid email are required" });
    return;
  }
  if (!ROLES.has(role)) {
    res.status(400).json({ error: "Role must be admin, member, or guest" });
    return;
  }
  let created: typeof clientUsersTable.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const users = await tx
        .select()
        .from(clientUsersTable)
        .where(eq(clientUsersTable.propertyId, account.propertyId))
        .for("update");
      if (users.some((u) => u.email.toLowerCase() === email)) {
        throw new SeatError("A team member with that email already exists");
      }
      const activeSeated = users.filter((u) => u.active && u.role !== "guest").length;
      const activeGuests = users.filter((u) => u.active && u.role === "guest").length;
      if (role !== "guest" && activeSeated >= account.userSeats) {
        throw new SeatError(
          `All ${account.userSeats} user seats are taken — upgrade your plan for more seats`,
        );
      }
      if (role === "guest" && activeGuests >= account.guestSeats) {
        throw new SeatError(
          `All ${account.guestSeats} guest seats are taken — upgrade your plan for more seats`,
        );
      }
      const [row] = await tx
        .insert(clientUsersTable)
        .values({
          propertyId: account.propertyId,
          name,
          email,
          role,
          // Column is NOT NULL but no longer used for auth — store a placeholder.
          passwordHash: "",
        })
        .returning();
      return row!;
    });
  } catch (e) {
    if (e instanceof SeatError) {
      res.status(409).json({ error: e.message });
      return;
    }
    throw e;
  }
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: account.propertyId,
    kind: "note",
    body: `Team directory: added a ${role} entry for ${name} (${email})`,
  });
  res.status(201).json(
    CreateClientAccessUserResponse.parse({
      user: serUser(created),
      emailed: false,
    }),
  );
});

// ---------------------------------------------------------------------------
// Client admin removes a login. Guards: not yourself, not the last admin.
// ---------------------------------------------------------------------------
router.delete("/client/:token/access/:userId", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account || account.status !== "active") {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const userId = String(req.params.userId);
  try {
    await db.transaction(async (tx) => {
      const users = await tx
        .select()
        .from(clientUsersTable)
        .where(eq(clientUsersTable.propertyId, account.propertyId))
        .for("update");
      const target = users.find((u) => u.id === userId);
      if (!target) throw new SeatError("__notfound__");
      await tx.delete(clientUsersTable).where(eq(clientUsersTable.id, userId));
    });
  } catch (e) {
    if (e instanceof SeatError) {
      if (e.message === "__notfound__") res.status(404).json({ error: "User not found" });
      else res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: account.propertyId,
    kind: "note",
    body: `Team directory: removed a member entry`,
  });
  res.json(DeleteClientAccessUserResponse.parse({ ok: true }));
});

router.patch(
  "/client/:token/access/:userId",
  async (req, res): Promise<void> => {
    const parsed = UpdateClientAccessUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const body = parsed.data;
    const account = await accountByToken(String(req.params.token));
    if (!account || account.status !== "active") {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    // Ownership check: the user must belong to this account's property.
    const [user] = await db
      .select()
      .from(clientUsersTable)
      .where(
        and(
          eq(clientUsersTable.id, String(req.params.userId)),
          eq(clientUsersTable.propertyId, account.propertyId),
        ),
      )
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (body.role != null && !ROLES.has(body.role)) {
      res.status(400).json({ error: "Role must be admin, member, or guest" });
      return;
    }
    if (body.permissions) {
      const bad = body.permissions.filter((k) => !FEATURE_KEYS.has(k));
      if (bad.length) {
        res.status(400).json({ error: `Unknown feature: ${bad.join(", ")}` });
        return;
      }
    }
    // The team roster is a directory the link holder manages; there are no
    // passwords or logins to guard any more.
    const nextActive = body.active ?? user.active;
    const nextRole = body.role ?? user.role;
    const nextPermissions = body.resetToRoleDefaults
      ? null
      : body.permissions !== undefined
        ? body.permissions
        : body.role && body.role !== user.role && user.permissions === null
          ? null // still on defaults; follow the new role's defaults
          : user.permissions;
    // Transactional seat guard (mirrors admin.ts): lock the property's user
    // rows so concurrent role changes can't oversubscribe seats.
    let updated: typeof clientUsersTable.$inferSelect | undefined;
    try {
      updated = await db.transaction(async (tx) => {
        const takesSeat =
          (body.role && body.role !== user.role && nextActive) ||
          (body.active === true && !user.active);
        const losesAdmin =
          user.role === "admin" && user.active && (nextRole !== "admin" || !nextActive);
        if (takesSeat || losesAdmin) {
          const others = await tx
            .select()
            .from(clientUsersTable)
            .where(eq(clientUsersTable.propertyId, account.propertyId))
            .for("update");
          if (
            losesAdmin &&
            others.filter((u) => u.id !== user.id && u.active && u.role === "admin").length === 0
          ) {
            throw new SeatError("The board needs at least one admin — promote someone else first");
          }
          if (takesSeat) {
            const activeSeated = others.filter(
              (u) => u.id !== user.id && u.active && u.role !== "guest",
            ).length;
            const activeGuests = others.filter(
              (u) => u.id !== user.id && u.active && u.role === "guest",
            ).length;
            if (nextRole !== "guest" && activeSeated >= account.userSeats) {
              throw new SeatError(
                `All ${account.userSeats} user seats are taken — upgrade your plan for more seats`,
              );
            }
            if (nextRole === "guest" && activeGuests >= account.guestSeats) {
              throw new SeatError(
                `All ${account.guestSeats} guest seats are taken — upgrade your plan for more seats`,
              );
            }
          }
        }
        const [row] = await tx
          .update(clientUsersTable)
          .set({
            role: nextRole,
            permissions: nextPermissions,
            active: nextActive,
          })
          .where(eq(clientUsersTable.id, user.id))
          .returning();
        return row;
      });
    } catch (e) {
      if (e instanceof SeatError) {
        res.status(409).json({ error: e.message });
        return;
      }
      throw e;
    }
    await db.insert(activitiesTable).values({
      entityType: "property",
      entityId: account.propertyId,
      kind: "note",
      body: `Client dashboard access updated for ${user.name} (${nextRole})`,
    });
    res.json(UpdateClientAccessUserResponse.parse(serUser(updated!)));
  },
);

// ---------------------------------------------------------------------------
// Subscription billing — managed by the client's admin from their dashboard.
// Payment info is stored SANITIZED ONLY: last4 + display fields, never full
// card/account numbers, never the CVV (same posture as the Payments Hub).
// ---------------------------------------------------------------------------

export const CLIENT_PLANS = [
  {
    tier: "basic",
    label: "Basic",
    pricePerMonth: 99,
    userSeats: 3,
    guestSeats: 5,
    blurb: "Dashboard, photos, and job summaries for a small team",
  },
  {
    tier: "pro",
    label: "Pro",
    pricePerMonth: 249,
    userSeats: 10,
    guestSeats: 15,
    blurb: "Live job board, invoices & payments, work requests",
  },
  {
    tier: "enterprise",
    label: "Enterprise",
    pricePerMonth: 499,
    userSeats: 25,
    guestSeats: 50,
    blurb: "Every feature, priority support, and the largest team",
  },
] as const;

/** Billing routes work for active AND paused accounts — a paused admin must
 *  still be able to get in and resume. Only cancelled links are dead. */
async function billableAccountByToken(token: string) {
  const account = await accountByToken(token);
  if (!account || account.status === "cancelled") return undefined;
  return account;
}

function nextChargeOn(billingDay: number, status: string): string | null {
  if (status !== "active") return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const candidate = new Date(y, m, billingDay);
  const pull =
    candidate.getDate() === billingDay && candidate >= new Date(y, m, now.getDate())
      ? candidate
      : new Date(y, m + 1, billingDay);
  // Local date parts — never toISOString (timezone day-shift).
  const mm = String(pull.getMonth() + 1).padStart(2, "0");
  const dd = String(pull.getDate()).padStart(2, "0");
  return `${pull.getFullYear()}-${mm}-${dd}`;
}

async function billingView(account: typeof clientAccountsTable.$inferSelect) {
  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, account.propertyId))
    .limit(1);
  const users = await db
    .select()
    .from(clientUsersTable)
    .where(eq(clientUsersTable.propertyId, account.propertyId));
  return {
    propertyName: prop?.name ?? "Your property",
    tier: account.tier,
    status: account.status,
    billingDay: account.billingDay,
    nextChargeOn: nextChargeOn(account.billingDay, account.status),
    plans: CLIENT_PLANS,
    paymentMethod: account.paymentMethod ?? null,
    billingContact: account.billingContact ?? null,
    seatUsage: {
      usersActive: users.filter((u) => u.active && u.role !== "guest").length,
      guestsActive: users.filter((u) => u.active && u.role === "guest").length,
      userSeats: account.userSeats,
      guestSeats: account.guestSeats,
    },
  };
}

router.get("/client/:token/billing", async (req, res): Promise<void> => {
  const account = await billableAccountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  res.json(GetClientBillingResponse.parse(await billingView(account)));
});

router.patch("/client/:token/billing", async (req, res): Promise<void> => {
  const parsed = UpdateClientBillingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const body = parsed.data;
  const account = await billableAccountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  if (body.status != null && !["active", "paused"].includes(body.status)) {
    res.status(400).json({ error: "Status must be active or paused" });
    return;
  }
  if (body.billingDay != null && (body.billingDay < 1 || body.billingDay > 28)) {
    res.status(400).json({ error: "Billing day must be between the 1st and the 28th" });
    return;
  }
  const plan = body.tier != null ? CLIENT_PLANS.find((p) => p.tier === body.tier) : undefined;
  if (body.tier != null && !plan) {
    res.status(400).json({ error: "Unknown plan" });
    return;
  }

  const changes: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const patch: Partial<typeof clientAccountsTable.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (plan && plan.tier !== account.tier) {
        // Seat guard: a downgrade can't strand more active people than the
        // new plan seats. Lock the user rows like every other seat check.
        const users = await tx
          .select()
          .from(clientUsersTable)
          .where(eq(clientUsersTable.propertyId, account.propertyId))
          .for("update");
        const activeSeated = users.filter((u) => u.active && u.role !== "guest").length;
        const activeGuests = users.filter((u) => u.active && u.role === "guest").length;
        if (activeSeated > plan.userSeats || activeGuests > plan.guestSeats) {
          throw new SeatError(
            `The ${plan.label} plan includes ${plan.userSeats} user seats and ${plan.guestSeats} guest seats, but you have ${activeSeated} active users and ${activeGuests} guests. Deactivate people first or pick a bigger plan.`,
          );
        }
        patch.tier = plan.tier;
        patch.userSeats = plan.userSeats;
        patch.guestSeats = plan.guestSeats;
        changes.push(`plan changed to ${plan.label}`);
      }
      if (body.billingDay != null && body.billingDay !== account.billingDay) {
        patch.billingDay = body.billingDay;
        changes.push(`billing day moved to the ${body.billingDay}`);
      }
      if (body.status != null && body.status !== account.status) {
        patch.status = body.status;
        changes.push(body.status === "paused" ? "subscription paused" : "subscription resumed");
      }
      if (body.billingContact !== undefined) {
        patch.billingContact = {
          name: body.billingContact?.name ?? null,
          email: body.billingContact?.email ?? null,
          company: body.billingContact?.company ?? null,
          phone: body.billingContact?.phone ?? null,
        };
        changes.push("billing contact updated");
      }
      await tx
        .update(clientAccountsTable)
        .set(patch)
        .where(eq(clientAccountsTable.id, account.id));
    });
  } catch (e) {
    if (e instanceof SeatError) {
      res.status(409).json({ error: e.message });
      return;
    }
    throw e;
  }
  if (changes.length > 0) {
    await db.insert(activitiesTable).values({
      entityType: "property",
      entityId: account.propertyId,
      kind: "note",
      body: `Client subscription updated from the dashboard: ${changes.join(", ")}`,
    });
  }
  const [fresh] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.id, account.id))
    .limit(1);
  res.json(GetClientBillingResponse.parse(await billingView(fresh!)));
});

router.put(
  "/client/:token/billing/payment-method",
  async (req, res): Promise<void> => {
    const parsed = PutClientPaymentMethodBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payment details" });
      return;
    }
    const body = parsed.data;
    const account = await billableAccountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    const payerName = body.payerName.trim();
    if (!payerName) {
      res.status(400).json({ error: "Name on the account is required" });
      return;
    }
    const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "");
    let stored: NonNullable<typeof account.paymentMethod>;
    if (body.methodType === "card") {
      const num = digits(body.cardNumber);
      if (num.length < 13 || num.length > 19) {
        res.status(400).json({ error: "Card number doesn't look right" });
        return;
      }
      if (!body.cardExp || !/^\d{2}\/\d{2}$/.test(body.cardExp.trim())) {
        res.status(400).json({ error: "Expiration must be MM/YY" });
        return;
      }
      const brand = num.startsWith("4")
        ? "Visa"
        : /^5[1-5]/.test(num) || /^2[2-7]/.test(num)
          ? "Mastercard"
          : num.startsWith("3")
            ? "Amex"
            : num.startsWith("6")
              ? "Discover"
              : "Card";
      stored = {
        methodType: "card",
        last4: num.slice(-4),
        brand,
        bankName: null,
        cardExp: body.cardExp.trim(),
        payerName,
        zip: body.zip?.trim() || null,
        updatedAt: new Date().toISOString(),
      };
    } else if (body.methodType === "ach") {
      const acct = digits(body.accountNumber);
      const routing = digits(body.routingNumber);
      if (acct.length < 4 || acct.length > 17) {
        res.status(400).json({ error: "Account number doesn't look right" });
        return;
      }
      if (routing.length !== 9) {
        res.status(400).json({ error: "Routing number must be 9 digits" });
        return;
      }
      stored = {
        methodType: "ach",
        last4: acct.slice(-4),
        brand: null,
        bankName: body.bankName?.trim() || null,
        cardExp: null,
        payerName,
        zip: body.zip?.trim() || null,
        updatedAt: new Date().toISOString(),
      };
    } else {
      res.status(400).json({ error: "Method must be card or ach" });
      return;
    }
    // Sanitized fields only — the raw numbers and CVV never touch the DB.
    await db
      .update(clientAccountsTable)
      .set({ paymentMethod: stored, updatedAt: new Date() })
      .where(eq(clientAccountsTable.id, account.id));
    await db.insert(activitiesTable).values({
      entityType: "property",
      entityId: account.propertyId,
      kind: "note",
      body: `Client subscription payment method updated (${stored.methodType === "card" ? `${stored.brand} card` : "bank account"} ending ${stored.last4})`,
    });
    const [fresh] = await db
      .select()
      .from(clientAccountsTable)
      .where(eq(clientAccountsTable.id, account.id))
      .limit(1);
    res.json(GetClientBillingResponse.parse(await billingView(fresh!)));
  },
);

// ---------------------------------------------------------------------------
// Client board — the Trello-style "Archangel Contractors" lane. Cards are
// raised automatically by the send pipeline (lib/clientBoard.ts); clients
// move them across columns and wire an optional outbound webhook.
// ---------------------------------------------------------------------------

const BOARD_COLUMNS = new Set(["inbox", "todo", "in_progress", "done"]);

function serCard(c: typeof clientBoardCardsTable.$inferSelect) {
  return {
    id: c.id,
    column: c.column,
    kind: c.kind,
    title: c.title,
    body: c.body,
    actionLabel: c.actionLabel,
    amount: c.amount,
    dueDate: c.dueDate,
    links: (c.links ?? []).map((l) => ({ label: l.label, url: l.url, kind: l.kind ?? null })),
    jobId: c.jobId,
    module: c.module ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    waybillCode: waybillCodeFor(c.id),
    waybill: deriveWaybill(c),
  };
}

router.get("/client/:token/board/feed", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account || account.status !== "active") {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, account.propertyId))
    .limit(1);
  const cards = await db
    .select()
    .from(clientBoardCardsTable)
    .where(eq(clientBoardCardsTable.propertyId, account.propertyId))
    .orderBy(desc(clientBoardCardsTable.updatedAt));
  res.json(
    GetClientBoardFeedResponse.parse({
      propertyName: prop?.name ?? "Property",
      webhookUrl: account.webhookUrl ?? null,
      cards: cards.map(serCard),
    }),
  );
});

router.patch("/client/:token/board/feed/cards/:cardId", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account || account.status !== "active") {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const parsed = UpdateClientBoardFeedCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!BOARD_COLUMNS.has(parsed.data.column)) {
    res.status(400).json({ error: "Unknown column" });
    return;
  }
  // Ownership: the card must belong to THIS account's property.
  const [card] = await db
    .update(clientBoardCardsTable)
    .set({
      column: parsed.data.column,
      completedAt: parsed.data.column === "done" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientBoardCardsTable.id, String(req.params.cardId)),
        eq(clientBoardCardsTable.propertyId, account.propertyId),
      ),
    )
    .returning();
  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  emitBoardEvent(account.propertyId);
  res.json(UpdateClientBoardFeedCardResponse.parse(serCard(card)));
});

// ---------------------------------------------------------------------------
// Card module actions — each card is a self-contained mini-app. The client
// taps a button ON the card (approve invoice, schedule flagged work, refer a
// property, acknowledge); the action is recorded on the card's module, the
// office is notified, and both boards see the new state on their next sync.
// ---------------------------------------------------------------------------
router.post("/client/:token/board/cards/:cardId/action", limits.cardAction, async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account || account.status !== "active") {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  // Writes require an authenticated, non-read-only board user — the same
  // rule every other board write follows. The link token alone is view-only.
  const viewer = await resolveViewer(req, account.propertyId);
  if (!viewer.authenticated || viewer.readOnly) {
    res.status(403).json({ error: "Sign in to take actions on cards" });
    return;
  }
  const parsed = ClientBoardCardActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const actorName = ("name" in body ? body.name?.trim() : null) || viewer.name || null;
  // The board projection exposes pushed cards as "push:<id>" — accept both.
  const rawCardId = String(req.params.cardId).replace(/^push:/, "");
  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, account.propertyId))
    .limit(1);
  const propName = prop?.name ?? "a property";
  const now = new Date();
  const nowIso = now.toISOString();

  // Auto-projected invoice cards ("invoice:<id>") have no board-card row —
  // mark_paid stamps the invoice itself and the projection picks it up.
  if (String(req.params.cardId).startsWith("invoice:") ) {
    if (body.action !== "mark_paid") {
      res.status(400).json({ error: "This card only supports mark paid" });
      return;
    }
    const invId = String(req.params.cardId).slice("invoice:".length);
    const [inv] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invId), eq(invoicesTable.propertyId, account.propertyId)));
    if (!inv) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    if (inv.status === "paid") {
      res.status(409).json({ error: "This invoice is already paid" });
      return;
    }
    // Guarded UPDATE — only the caller whose update actually flips the null
    // stamp emits side effects, so a double-tap can't double-notify.
    const stamped = await db
      .update(invoicesTable)
      .set({ clientPaidReportedAt: now, clientPaidReportedBy: actorName })
      .where(and(eq(invoicesTable.id, invId), isNull(invoicesTable.clientPaidReportedAt)))
      .returning({ id: invoicesTable.id });
    if (stamped.length > 0) {
      await db.insert(activitiesTable).values({
        entityType: "property",
        entityId: account.propertyId,
        kind: "note",
        body: `Invoice ${inv.invoiceNo} marked paid by ${propName}${actorName ? ` (${actorName})` : ""} — payment on its way.`,
      });
      await db.insert(notificationsTable).values({
        kind: "client_board",
        priority: "high",
        entityType: "property",
        entityId: account.propertyId,
        title: `Payment on its way from ${propName}`,
        body: `Invoice ${inv.invoiceNo} was marked paid on their board. Confirm it in Money when the payment lands.`,
      });
      emitBoardEvent(account.propertyId);
    }
    const cardKey = `invoice:${inv.id}`;
    res.json(
      ClientBoardCardActionResponse.parse({
        id: cardKey,
        column: "in_progress",
        kind: "invoice",
        title: `Invoice ${inv.invoiceNo}`,
        body: null,
        actionLabel: null,
        amount: inv.amount + (inv.taxAmount ?? 0),
        dueDate: null,
        links: [],
        jobId: null,
        module: {
          type: "invoice",
          invoiceId: inv.id,
          invoiceNo: inv.invoiceNo,
          amount: inv.amount + (inv.taxAmount ?? 0),
          status: inv.status,
          dueDate: null,
          payUrl: null,
          pdfUrl: `/api/invoices/${inv.id}/pdf`,
          canApprove: false,
          clientPaidAt: (inv.clientPaidReportedAt ?? now).toISOString(),
          clientPaidBy: inv.clientPaidReportedBy ?? actorName,
        },
        completedAt: null,
        createdAt: inv.createdAt.toISOString(),
        updatedAt: nowIso,
        waybillCode: waybillCodeFor(cardKey),
        waybill: deriveLaneWaybill("billing", { updatedAt: nowIso, status: inv.status }),
      }),
    );
    return;
  }

  // Everything inside one transaction with the card row locked, so a
  // double-click can't approve twice or create duplicate work requests.
  let status = 200;
  let payload: unknown = null;
  const walkPush: Array<{ crewId: string; jobId: string; jobNo: string | null }> = [];
  await db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(clientBoardCardsTable)
      .where(
        and(
          eq(clientBoardCardsTable.id, rawCardId),
          eq(clientBoardCardsTable.propertyId, account.propertyId),
        ),
      )
      .for("update");
    if (!card) {
      status = 404;
      payload = { error: "Card not found" };
      return;
    }
    const module = { ...(card.module ?? {}) } as Record<string, unknown>;

    if (body.action === "approve_walk") {
      // Walk-findings card: the PM approves the found work — the card moves
      // to In progress on their board and the approval is stamped once.
      if (card.sourceType !== "walk_job" || module.type !== "photos") {
        status = 400;
        payload = { error: "Only walk-findings cards can be approved this way" };
        return;
      }
      if (!module.clientApprovedAt) {
        module.clientApprovedAt = nowIso;
        module.clientApprovedBy = actorName;
        await tx
          .update(clientBoardCardsTable)
          .set({ module, column: "in_progress" })
          .where(eq(clientBoardCardsTable.id, card.id));
        await tx.insert(activitiesTable).values({
          entityType: "property",
          entityId: account.propertyId,
          kind: "note",
          body: `Walk findings${card.title ? ` (${card.title})` : ""} approved from the client board by ${propName}${actorName ? ` (${actorName})` : ""}.`,
        });
        await tx.insert(notificationsTable).values({
          kind: "client_board",
          priority: "high",
          entityType: "property",
          entityId: account.propertyId,
          title: `Walk findings approved by ${propName}`,
          body: `${card.title || "Walk findings"} — approved on their board; work is a go.`,
        });
        // Notify the assigned crew so their portal approval badge increments.
        const jobId = typeof (card.sourceId) === "string" ? card.sourceId : null;
        if (jobId && card.sourceType === "walk_job") {
          const [walkJob] = await tx
            .select({ crewLeaderId: jobsTable.crewLeaderId, jobNo: jobsTable.jobNo })
            .from(jobsTable)
            .where(eq(jobsTable.id, jobId))
            .limit(1);
          if (walkJob?.crewLeaderId) {
            await tx.insert(activitiesTable).values({
              entityType: "crew",
              entityId: walkJob.crewLeaderId,
              kind: "walk_approved",
              body: `Walk findings approved for job ${walkJob.jobNo ?? jobId} — work is a go`,
            });
            walkPush.push({ crewId: walkJob.crewLeaderId, jobId, jobNo: walkJob.jobNo ?? null });
          }
          // Falkon Ops: client-board walk approval also fires the resident-ready
          // signal so Falkon receives it regardless of which surface approves.
          if (jobId) {
            void emitFalkonEvent("job.walk_approved", "job", jobId, {
              jobId,
              jobNo: walkJob?.jobNo,
              propertyId: account.propertyId,
              approvedBy: actorName ?? "Client",
              approvedAt: nowIso,
              source: "client_board",
            });
            // Falkon Make-Ready: auto-start an execution so dispatch can track
            // this unit through the 12-phase pipeline without manual setup.
            void startMakeReadyExecution(jobId);
          }
        }
      } else {
        // Idempotent: a double-tap still lands the card in In progress.
        await tx
          .update(clientBoardCardsTable)
          .set({ column: "in_progress" })
          .where(eq(clientBoardCardsTable.id, card.id));
      }
      payload = { ok: true };
      return;
    }

    if (body.action === "approve") {
      if (module.type !== "invoice") {
        status = 400;
        payload = { error: "Only invoice cards can be approved" };
        return;
      }
      if (!module.approvedAt) {
        module.approvedAt = nowIso;
        module.approvedBy = actorName;
        // Also unlock the pay flow if a payment request backs this invoice.
        if (typeof module.payUrl === "string") {
          const token = module.payUrl.split("/pay/")[1];
          if (token) {
            await tx
              .update(paymentRequestsTable)
              .set({ approvedAt: now })
              .where(and(eq(paymentRequestsTable.token, token), isNull(paymentRequestsTable.approvedAt)));
          }
        }
        await tx.insert(activitiesTable).values({
          entityType: "property",
          entityId: account.propertyId,
          kind: "note",
          body: `Invoice ${module.invoiceNo ?? ""} approved from the client board by ${propName}${actorName ? ` (${actorName})` : ""}.`,
        });
        await tx.insert(notificationsTable).values({
          kind: "client_board",
          priority: "high",
          entityType: "property",
          entityId: account.propertyId,
          title: `Invoice approved by ${propName}`,
          body: `Invoice ${module.invoiceNo ?? ""} was approved on their board${typeof module.payUrl === "string" ? " — pay link is unlocked" : ""}.`,
        });
      }
    } else if (body.action === "schedule") {
      // Turn flagged items into a real work request in the office Pipeline —
      // the same flow the Requests page uses. Only flags cards offer this.
      if (module.type !== "flags") {
        status = 400;
        payload = { error: "Only flagged-items cards can schedule work" };
        return;
      }
      if (!module.requestedAt) {
        const label =
          body.note?.trim() ||
          `Schedule flagged work: ${((module.items as { unit: string | null; label: string }[] | undefined) ?? [])
            .slice(0, 3)
            .map((i) => `${i.unit ? `Unit ${i.unit} — ` : ""}${i.label}`)
            .join("; ") || card.title}`;
        // NOTE: flags-card scheduling intentionally skips the PO gate — these
        // originate from office-flagged items and land in Pipeline as pending,
        // where the office manually approves (the card shows "No PO").
        const [rowReq] = await tx
          .insert(workRequestsTable)
          .values({
            propertyId: account.propertyId,
            requesterName: actorName,
            serviceLabel: label.slice(0, 300),
            unitNo: body.unitNo?.trim() || null,
            notes: body.note?.trim() || `Requested from the "${card.title}" card on the client board.`,
            neededBy: body.neededBy && /^\d{4}-\d{2}-\d{2}$/.test(body.neededBy) ? body.neededBy : null,
          })
          .returning();
        module.requestedAt = nowIso;
        module.requestId = rowReq!.id;
        await tx.insert(notificationsTable).values({
          kind: "work_request",
          priority: "high",
          entityType: "work_request",
          entityId: rowReq!.id,
          title: `New work request from ${propName}`,
          body: `${rowReq!.serviceLabel}. Sent from the "${card.title}" card — review it in Pipeline.`,
        });
        await tx.insert(activitiesTable).values({
          entityType: "property",
          entityId: account.propertyId,
          kind: "note",
          body: `${propName} requested work from their board card "${card.title}".`,
        });
      }
    } else if (body.action === "pay_method") {
      if (module.type !== "invoice") {
        status = 400;
        payload = { error: "Only invoice cards take a payment method" };
        return;
      }
      const method = body.method === "ach" || body.method === "check" ? body.method : null;
      if (!method) {
        status = 400;
        payload = { error: "Choose ACH or check" };
        return;
      }
      if (String(module.status ?? "").toLowerCase() === "paid") {
        status = 409;
        payload = { error: "This invoice is already paid" };
        return;
      }
      // Idempotent: re-choosing the same method is a no-op — no duplicate
      // notifications or activity from double-taps or retries.
      if (module.payMethod === method) {
        const [same] = await tx
          .select()
          .from(clientBoardCardsTable)
          .where(eq(clientBoardCardsTable.id, card.id));
        payload = ClientBoardCardActionResponse.parse(serCard(same!));
        return;
      }
      // Method choice implies approval — record both so the office sees one
      // coherent state, and the pay flow unlocks either way.
      if (!module.approvedAt) {
        module.approvedAt = nowIso;
        module.approvedBy = actorName;
        if (typeof module.payUrl === "string") {
          const prToken = module.payUrl.split("/pay/")[1];
          if (prToken) {
            await tx
              .update(paymentRequestsTable)
              .set({ approvedAt: now })
              .where(and(eq(paymentRequestsTable.token, prToken), isNull(paymentRequestsTable.approvedAt)));
          }
        }
      }
      module.payMethod = method;
      module.payMethodAt = nowIso;
      module.payMethodBy = actorName;
      const methodLabel = method === "ach" ? "ACH through the Pay Hub" : "a mailed check";
      await tx.insert(activitiesTable).values({
        entityType: "property",
        entityId: account.propertyId,
        kind: "note",
        body: `Invoice ${module.invoiceNo ?? ""} — ${propName}${actorName ? ` (${actorName})` : ""} chose to pay by ${methodLabel} from their board.`,
      });
      await tx.insert(notificationsTable).values({
        kind: "client_board",
        priority: "high",
        entityType: "property",
        entityId: account.propertyId,
        title: `${propName} is paying ${module.invoiceNo ?? "an invoice"} by ${method === "ach" ? "ACH" : "check"}`,
        body:
          method === "check"
            ? `Expect a check for invoice ${module.invoiceNo ?? ""}. Chosen on the "${card.title}" card.`
            : `They opened the Pay Hub link for invoice ${module.invoiceNo ?? ""} from the "${card.title}" card.`,
      });
    } else if (body.action === "refer") {
      if (module.type !== "referral") {
        status = 400;
        payload = { error: "This card doesn't take referrals" };
        return;
      }
      const contact = body.contact?.trim();
      if (!contact) {
        status = 400;
        payload = { error: "Add the contact for the referral" };
        return;
      }
      if (!module.referredAt) {
        module.referredAt = nowIso;
        await tx.insert(activitiesTable).values({
          entityType: "property",
          entityId: account.propertyId,
          kind: "note",
          body: `Referral from ${propName}: ${body.name?.trim() || "a contact"} — ${contact}${body.note?.trim() ? ` — ${body.note.trim()}` : ""}`,
        });
        await tx.insert(notificationsTable).values({
          kind: "client_board",
          priority: "high",
          entityType: "property",
          entityId: account.propertyId,
          title: `New referral from ${propName}`,
          body: `${body.name?.trim() || "A contact"} — ${contact}${body.note?.trim() ? `. "${body.note.trim()}"` : ""}`,
        });
      }
    } else if (body.action === "dispute") {
      // One-field dispute: flags the invoice office-side (urgent notification
      // + activity) without blocking the card — the office follows up.
      if (module.type !== "invoice") {
        status = 400;
        payload = { error: "Only invoice cards can be disputed" };
        return;
      }
      if (String(module.status ?? "").toLowerCase() === "paid") {
        status = 409;
        payload = { error: "This invoice is already paid" };
        return;
      }
      const note = body.note?.trim();
      if (!note) {
        status = 400;
        payload = { error: "Tell us what looks wrong" };
        return;
      }
      if (!module.disputedAt) {
        module.disputedAt = nowIso;
        module.disputeNote = note.slice(0, 500);
        module.disputedBy = actorName;
        await tx.insert(activitiesTable).values({
          entityType: "property",
          entityId: account.propertyId,
          kind: "note",
          body: `Invoice ${module.invoiceNo ?? ""} DISPUTED by ${propName}${actorName ? ` (${actorName})` : ""}: ${note.slice(0, 300)}`,
        });
        await tx.insert(notificationsTable).values({
          kind: "client_board",
          priority: "urgent",
          entityType: "property",
          entityId: account.propertyId,
          title: `Invoice ${module.invoiceNo ?? ""} disputed by ${propName}`,
          body: `"${note.slice(0, 300)}" — from the "${card.title}" card. Review and respond before it can be approved.`,
        });
      }
    } else if (body.action === "mark_paid") {
      // Client says payment was sent — "payment on its way" until the office
      // confirms the money landed. Idempotent on repeat taps.
      if (module.type !== "invoice") {
        status = 400;
        payload = { error: "Only invoice cards can be marked paid" };
        return;
      }
      if (String(module.status ?? "").toLowerCase() === "paid") {
        status = 409;
        payload = { error: "This invoice is already paid" };
        return;
      }
      if (!module.clientPaidAt) {
        module.clientPaidAt = nowIso;
        module.clientPaidBy = actorName;
        // Stamp the underlying invoice too so the Money pages see it.
        if (card.sourceType === "invoice" && card.sourceId) {
          await tx
            .update(invoicesTable)
            .set({ clientPaidReportedAt: now, clientPaidReportedBy: actorName })
            .where(
              and(
                eq(invoicesTable.id, card.sourceId),
                eq(invoicesTable.propertyId, account.propertyId),
                isNull(invoicesTable.clientPaidReportedAt),
              ),
            );
        }
        await tx.insert(activitiesTable).values({
          entityType: "property",
          entityId: account.propertyId,
          kind: "note",
          body: `Invoice ${module.invoiceNo ?? ""} marked paid by ${propName}${actorName ? ` (${actorName})` : ""} — payment on its way.`,
        });
        await tx.insert(notificationsTable).values({
          kind: "client_board",
          priority: "high",
          entityType: "property",
          entityId: account.propertyId,
          title: `Payment on its way from ${propName}`,
          body: `Invoice ${module.invoiceNo ?? ""} was marked paid on the "${card.title}" card. Confirm it in Money when the payment lands.`,
        });
      }
    } else if (body.action === "acknowledge") {
      // Module-less cards (plain manual pushes) must STAY module-less: a bare
      // { acknowledgedAt } object has no `type`, which violates the
      // discriminated ClientCardModule union and 500s the response parse.
      // The Done move below carries the acknowledgement for those cards.
      if (card.module) module.acknowledgedAt = nowIso;
    } else {
      status = 400;
      payload = { error: "Unknown action" };
      return;
    }

    const moveDone = body.action === "acknowledge";
    const [updated] = await tx
      .update(clientBoardCardsTable)
      .set({
        module: card.module ? module : null,
        updatedAt: now,
        ...(moveDone ? { column: "done", completedAt: now } : {}),
      })
      .where(eq(clientBoardCardsTable.id, card.id))
      .returning();
    payload = ClientBoardCardActionResponse.parse(serCard(updated!));
  });
  const walk = walkPush[0];
  if (walk) {
    void pushToCrewId(walk.crewId, {
      title: "✅ Walk approved — work is a go",
      body: `Walk findings approved for job ${walk.jobNo ?? walk.jobId}.`,
      data: { kind: "walk_approved", jobId: walk.jobId },
    });
  }
  if (status === 200) emitBoardEvent(account.propertyId);
  res.status(status).json(payload);
});

// Live push: one SSE stream per open client board. Events are content-free
// pings — the client refetches its board query when one arrives.
router.get("/client/:token/board/events", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account || account.status !== "active") {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  attachBoardStream(account.propertyId, res);
});

router.patch("/client/:token/board/feed/webhook", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account || account.status !== "active") {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const parsed = UpdateClientBoardWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const raw = parsed.data.webhookUrl?.trim() || null;
  if (raw) {
    const problem = await webhookUrlProblem(raw);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
  }
  await db
    .update(clientAccountsTable)
    .set({ webhookUrl: raw, updatedAt: new Date() })
    .where(eq(clientAccountsTable.id, account.id));
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: account.propertyId,
    kind: "note",
    body: raw
      ? "Client connected an outbound webhook for their board"
      : "Client removed their board webhook",
  });
  res.json(UpdateClientBoardWebhookResponse.parse({ webhookUrl: raw }));
});

// ---------------------------------------------------------------------------
// Office window into a client's board — see exactly what the client sees on
// /client/:token/board, and drop an ad-hoc manual card on it.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function officeDashboardUrl(token: string): string {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  const path = `/board/${token}`;
  return domain ? `https://${domain}${path}` : path;
}

// Live push for the office mirror of a client's board.
router.get(
  "/admin/accounts/:propertyId/board/events",
  async (req, res): Promise<void> => {
    const propertyId = String(req.params.propertyId);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    attachBoardStream(propertyId, res);
  },
);

router.get("/admin/accounts/:propertyId/board", async (req, res): Promise<void> => {
  const propertyId = String(req.params.propertyId);
  if (!UUID_RE.test(propertyId)) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  if (!prop) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.propertyId, propertyId))
    .limit(1);
  const cards = await db
    .select()
    .from(clientBoardCardsTable)
    .where(eq(clientBoardCardsTable.propertyId, propertyId))
    .orderBy(desc(clientBoardCardsTable.updatedAt));
  res.json(
    GetOfficeClientBoardResponse.parse({
      propertyName: prop.name,
      accountStatus: account?.status ?? "active",
      dashboardUrl:
        account && account.status === "active"
          ? officeDashboardUrl(account.dashboardToken)
          : null,
      webhookConnected: !!account?.webhookUrl,
      cards: cards.map(serCard),
    }),
  );
});

router.post(
  "/admin/accounts/:propertyId/board/cards",
  async (req, res): Promise<void> => {
    const parsed = CreateOfficeClientBoardCardBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const body = parsed.data;
    const title = body.title.trim();
    if (!title) {
      res.status(400).json({ error: "The card needs a title" });
      return;
    }
    if (body.dueDate != null && body.dueDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
      res.status(400).json({ error: "Due date must be YYYY-MM-DD" });
      return;
    }
    const links = (body.links ?? [])
      .map((l) => ({ label: l.label.trim(), url: l.url.trim(), kind: l.kind ?? null }))
      .filter((l) => l.label && l.url);
    for (const l of links) {
      let u: URL;
      try {
        u = new URL(l.url);
      } catch {
        res.status(400).json({ error: `Link "${l.label}" must be a valid URL` });
        return;
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        res.status(400).json({ error: `Link "${l.label}" must be an http(s) URL` });
        return;
      }
    }
    const propertyId = String(req.params.propertyId);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const [prop] = await db
      .select({ name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId))
      .limit(1);
    if (!prop) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const card = await raiseClientCard({
      propertyId,
      kind: "manual",
      title,
      body: body.body?.trim() || null,
      dueDate: body.dueDate || null,
      links,
      sourceType: "manual",
      sourceId: randomUUID(), // every manual card is its own card — never merged
    });
    if (!card) {
      res.status(500).json({ error: "Could not create the card" });
      return;
    }
    await db.insert(activitiesTable).values({
      entityType: "property",
      entityId: propertyId,
      kind: "note",
      body: `Card sent to the client board: ${title}`,
    });
    res.json(CreateOfficeClientBoardCardResponse.parse(serCard(card)));
  },
);

// Edit any office-pushed card in place. Content fields only — module data can
// be refreshed from the card's original source (refreshModule), and the
// client's action state (approvedAt, requestedAt, …) is never touched.
router.patch(
  "/admin/accounts/:propertyId/board/cards/:cardId",
  async (req, res): Promise<void> => {
    const parsed = UpdateOfficeClientBoardCardBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const body = parsed.data;
    const title = body.title.trim();
    if (!title) {
      res.status(400).json({ error: "The card needs a title" });
      return;
    }
    if (body.dueDate != null && body.dueDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
      res.status(400).json({ error: "Due date must be YYYY-MM-DD" });
      return;
    }
    const links = (body.links ?? [])
      .map((l) => ({ label: l.label.trim(), url: l.url.trim(), kind: l.kind ?? null }))
      .filter((l) => l.label && l.url);
    for (const l of links) {
      let u: URL;
      try {
        u = new URL(l.url);
      } catch {
        res.status(400).json({ error: `Link "${l.label}" must be a valid URL` });
        return;
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        res.status(400).json({ error: `Link "${l.label}" must be an http(s) URL` });
        return;
      }
    }
    const propertyId = String(req.params.propertyId);
    const cardId = String(req.params.cardId);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    // Ownership: the card must belong to THIS property.
    const [existing] = await db
      .select()
      .from(clientBoardCardsTable)
      .where(
        and(
          eq(clientBoardCardsTable.id, cardId),
          eq(clientBoardCardsTable.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    // Optionally rebuild the module snapshot from the card's original source,
    // preserving the client's action state — same contract as a re-push.
    let module = existing.module;
    if (body.refreshModule) {
      let fresh: Record<string, unknown> | null = null;
      if (existing.sourceType === "invoice" && existing.sourceId) {
        fresh = await buildInvoiceModule(existing.propertyId, existing.sourceId);
      } else if (existing.sourceType === "tracker" && existing.sourceId) {
        fresh = await buildTrackerModule(existing.propertyId, existing.sourceId);
      } else if (existing.sourceType === "summary" && existing.sourceId) {
        fresh = await buildSummaryModule(existing.propertyId, existing.sourceId);
      } else if (existing.sourceType === "photos" && existing.sourceId) {
        fresh = await buildPhotosModule(existing.propertyId, existing.sourceId);
      } else if (existing.sourceType === "crewmap") {
        fresh = await buildCrewMapModule(existing.propertyId);
      } else if (existing.sourceType === "invoice_batch") {
        const ids = ((existing.module as Record<string, unknown> | null)?.invoiceIds ?? []) as string[];
        fresh = await buildInvoiceBatchModule(existing.propertyId, ids);
      } else if (existing.sourceType === "bid" && existing.sourceId) {
        fresh = await buildBidModule(existing.propertyId, existing.sourceId);
      } else if (existing.kind === "flag") {
        fresh = await buildFlagsModule(existing.propertyId);
      }
      if (fresh) {
        const state = (existing.module ?? {}) as Record<string, unknown>;
        for (const key of ACTION_STATE_KEYS) {
          if (state[key] !== undefined) fresh[key] = state[key];
        }
        module = fresh;
      }
    }
    const [card] = await db
      .update(clientBoardCardsTable)
      .set({
        title,
        body: body.body?.trim() || null,
        dueDate: body.dueDate || null,
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.actionLabel !== undefined ? { actionLabel: body.actionLabel?.trim() || null } : {}),
        links,
        module,
        updatedAt: new Date(),
      })
      .where(eq(clientBoardCardsTable.id, existing.id))
      .returning();
    await db.insert(activitiesTable).values({
      entityType: "property",
      entityId: propertyId,
      kind: "note",
      body: `Client-board card edited: ${title}`,
    });
    emitBoardEvent(propertyId);
    res.json(UpdateOfficeClientBoardCardResponse.parse(serCard(card)));
  },
);

router.delete(
  "/admin/accounts/:propertyId/board/cards/:cardId",
  async (req, res): Promise<void> => {
    const propertyId = String(req.params.propertyId);
    const cardId = String(req.params.cardId);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientBoardCardsTable)
      .where(
        and(
          eq(clientBoardCardsTable.id, cardId),
          eq(clientBoardCardsTable.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    await db
      .delete(clientBoardCardsTable)
      .where(eq(clientBoardCardsTable.id, existing.id));
    await db.insert(activitiesTable).values({
      entityType: "property",
      entityId: propertyId,
      kind: "note",
      body: `Card taken back from the client board: ${existing.title}`,
    });
    emitBoardEvent(propertyId);
    res.json(DeleteOfficeClientBoardCardResponse.parse({ ok: true }));
  },
);

// Office clears an invoice dispute: the disputed banner comes off the client's
// card, an optional response note lands in the card's thread, and the
// resolution is recorded in the activity log.
router.post(
  "/admin/accounts/:propertyId/board/cards/:cardId/dispute/resolve",
  async (req, res): Promise<void> => {
    const parsed = ResolveOfficeInvoiceDisputeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const note = parsed.data.note?.trim() || null;
    if (note && note.length > 1000) {
      res.status(400).json({ error: "Keep the response under 1000 characters" });
      return;
    }
    const propertyId = String(req.params.propertyId);
    const cardId = String(req.params.cardId);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientBoardCardsTable)
      .where(
        and(
          eq(clientBoardCardsTable.id, cardId),
          eq(clientBoardCardsTable.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const module = { ...((existing.module ?? {}) as Record<string, unknown>) };
    if (module.type !== "invoice") {
      res.status(400).json({ error: "Only invoice cards carry disputes" });
      return;
    }
    if (!module.disputedAt) {
      res.status(409).json({ error: "This invoice isn't disputed" });
      return;
    }
    const disputeNote = typeof module.disputeNote === "string" ? module.disputeNote : null;
    const nowIso = new Date().toISOString();
    delete module.disputedAt;
    delete module.disputeNote;
    delete module.disputedBy;
    module.disputeResolvedAt = nowIso;
    module.disputeResponse = note;
    const [card] = await db
      .update(clientBoardCardsTable)
      .set({ module, updatedAt: new Date() })
      .where(eq(clientBoardCardsTable.id, existing.id))
      .returning();
    const [prop] = await db
      .select({ name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId))
      .limit(1);
    const propName = prop?.name ?? "the client";
    const invoiceNo = typeof module.invoiceNo === "string" ? module.invoiceNo : "";
    await db.insert(activitiesTable).values({
      entityType: "property",
      entityId: propertyId,
      kind: "note",
      body: `Invoice ${invoiceNo} dispute RESOLVED for ${propName}${note ? ` — response: ${note.slice(0, 300)}` : ""}${disputeNote ? ` (was: "${disputeNote.slice(0, 200)}")` : ""}`,
    });
    // The response note goes into the card's client ↔ office thread so the
    // client sees it exactly where they raised the dispute.
    if (note) {
      const { canonical } = await threadKeysFor(propertyId, `push:${existing.id}`);
      await db.insert(clientCardCommentsTable).values({
        propertyId,
        cardKey: canonical,
        authorType: "office",
        authorName: "Archangel",
        body: note,
      });
    }
    await notifyClientBoard(
      propertyId,
      "dispute_resolved",
      `Dispute on invoice ${invoiceNo || "your invoice"} resolved`,
      note ? note.slice(0, 300) : "The office reviewed your dispute and cleared it.",
      `push:${existing.id}`,
    );
    emitBoardEvent(propertyId, "dashboard");
    res.json(ResolveOfficeInvoiceDisputeResponse.parse(serCard(card!)));
  },
);

// ---------------------------------------------------------------------------
// Client → office inbox: cards the client sent from their board, plus the
// two-way comment threads on any board card.
// ---------------------------------------------------------------------------
router.get(
  "/admin/accounts/:propertyId/board/inbox",
  async (req, res): Promise<void> => {
    const propertyId = String(req.params.propertyId);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const rows = await db
      .select()
      .from(clientDashboardCardsTable)
      .where(
        and(
          eq(clientDashboardCardsTable.propertyId, propertyId),
          eq(clientDashboardCardsTable.kind, "custom"),
          isNotNull(clientDashboardCardsTable.sentToOfficeAt),
        ),
      )
      .orderBy(desc(clientDashboardCardsTable.sentToOfficeAt))
      .limit(50);
    const keys = rows.map((r) => r.cardKey);
    const counts = keys.length
      ? await db
          .select({
            cardKey: clientCardCommentsTable.cardKey,
            n: sql<number>`count(*)::int`,
          })
          .from(clientCardCommentsTable)
          .where(
            and(
              eq(clientCardCommentsTable.propertyId, propertyId),
              inArray(clientCardCommentsTable.cardKey, keys),
            ),
          )
          .groupBy(clientCardCommentsTable.cardKey)
      : [];
    const countByKey = new Map(counts.map((c) => [c.cardKey, c.n]));
    res.json(
      GetClientBoardInboxResponse.parse({
        cards: rows.map((r) => ({
          cardKey: r.cardKey,
          title: r.title ?? "Untitled",
          description: r.description ?? null,
          priority: r.priority ?? null,
          dueOn: r.dueOn ?? null,
          createdBy: r.createdBy ?? null,
          labels: Array.isArray(r.labels) ? (r.labels as string[]) : [],
          checklist: Array.isArray(r.checklist)
            ? (r.checklist as { id: string; text: string; done: boolean }[])
            : [],
          sentAt: r.sentToOfficeAt!.toISOString(),
          status: r.officeStatus ?? "pending",
          note: r.officeNote ?? null,
          commentCount: countByKey.get(r.cardKey) ?? 0,
        })),
      }),
    );
  },
);

router.post(
  "/admin/accounts/:propertyId/board/inbox/:cardKey/respond",
  async (req, res): Promise<void> => {
    const parsed = RespondClientInboxCardBody.safeParse(req.body);
    if (!parsed.success || !["accepted", "declined"].includes(parsed.data.status)) {
      res.status(400).json({ error: "status must be accepted or declined" });
      return;
    }
    const propertyId = String(req.params.propertyId);
    const cardKey = String(req.params.cardKey);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const { status, note } = parsed.data;
    // Guarded transition: only a pending send can be decided (first decision wins).
    const updated = await db
      .update(clientDashboardCardsTable)
      .set({ officeStatus: status, officeNote: note ?? null, updatedAt: new Date() })
      .where(
        and(
          eq(clientDashboardCardsTable.propertyId, propertyId),
          eq(clientDashboardCardsTable.cardKey, cardKey),
          eq(clientDashboardCardsTable.officeStatus, "pending"),
        ),
      )
      .returning();
    if (!updated.length) {
      res.status(409).json({ error: "This card was already decided or was never sent" });
      return;
    }
    const card = updated[0]!;
    // Side effects after the decision commits must never turn it into a 500.
    await notifyClientBoard(
      propertyId,
      "card_response",
      `Office ${status} your card "${card.title ?? "Untitled"}"`,
      note ?? null,
      cardKey,
    );
    try {
      await db.insert(activitiesTable).values({
        entityType: "property",
        entityId: propertyId,
        kind: "note",
        body: `Office ${status} client card "${card.title ?? "Untitled"}"${note ? ` — ${note}` : ""}`,
      });
    } catch (err) {
      console.error("inbox respond activity log failed:", err);
    }
    res.json({ ok: true });
  },
);

router.get(
  "/admin/accounts/:propertyId/board/comments/:cardKey",
  async (req, res): Promise<void> => {
    const propertyId = String(req.params.propertyId);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const { keys } = await threadKeysFor(propertyId, String(req.params.cardKey));
    const comments = await db
      .select()
      .from(clientCardCommentsTable)
      .where(
        and(
          eq(clientCardCommentsTable.propertyId, propertyId),
          inArray(clientCardCommentsTable.cardKey, keys),
        ),
      )
      .orderBy(clientCardCommentsTable.createdAt);
    res.json(
      ListOfficeCardCommentsResponse.parse({
        comments: comments.map(threadMessageDto),
      }),
    );
  },
);

router.post(
  "/admin/accounts/:propertyId/board/comments/:cardKey",
  async (req, res): Promise<void> => {
    const parsed = AddOfficeCardCommentBody.safeParse(req.body);
    const body = parsed.success ? parsed.data.body.trim() : "";
    const attachmentName = (parsed.success && parsed.data.attachmentName?.trim()) || null;
    const attachmentPath = (parsed.success && parsed.data.attachmentPath?.trim()) || null;
    // Object-storage entity paths only — the thread can't link arbitrary URLs.
    if (attachmentPath && !/^\/objects\/(?!.*\.\.)[A-Za-z0-9._/-]{1,390}$/.test(attachmentPath)) {
      res.status(400).json({ error: "Invalid attachment" });
      return;
    }
    if ((!body && !attachmentPath) || body.length > 4000) {
      res.status(400).json({ error: "Write a message or attach a photo (max 4000 chars)" });
      return;
    }
    const propertyId = String(req.params.propertyId);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const cardKey = String(req.params.cardKey);
    const { canonical } = await threadKeysFor(propertyId, cardKey);
    const [row] = await db
      .insert(clientCardCommentsTable)
      .values({
        propertyId,
        cardKey: canonical,
        authorType: "office",
        authorName: "Archangel",
        body,
        attachmentName: attachmentPath ? (attachmentName ?? "Photo") : null,
        attachmentPath,
      })
      .returning();
    await notifyClientBoard(
      propertyId,
      "comment",
      "New reply from Archangel",
      (body || attachmentName || "Photo").slice(0, 300),
      canonical,
    );
    emitBoardEvent(propertyId, "dashboard");
    res.status(201).json(AddOfficeCardCommentResponse.parse(threadMessageDto(row!)));
  },
);

// Office opened the thread — client messages in this family are now read.
router.post(
  "/admin/accounts/:propertyId/board/comments/:cardKey/seen",
  async (req, res): Promise<void> => {
    const propertyId = String(req.params.propertyId);
    if (!UUID_RE.test(propertyId)) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const { keys } = await threadKeysFor(propertyId, String(req.params.cardKey));
    await db
      .update(clientCardCommentsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(clientCardCommentsTable.propertyId, propertyId),
          inArray(clientCardCommentsTable.cardKey, keys),
          eq(clientCardCommentsTable.authorType, "client"),
          isNull(clientCardCommentsTable.readAt),
        ),
      );
    res.json({ ok: true });
  },
);

export default router;
