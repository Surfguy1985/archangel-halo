import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  clientUsersTable,
  clientBoardCardsTable,
  propertiesTable,
  activitiesTable,
} from "@workspace/db";
import {
  GetClientAccessResponse,
  UpdateClientAccessUserBody,
  UpdateClientAccessUserResponse,
  GetClientBillingResponse,
  UpdateClientBillingBody,
  PutClientPaymentMethodBody,
  GetClientBoardResponse,
  UpdateClientBoardCardBody,
  UpdateClientBoardCardResponse,
  UpdateClientBoardWebhookBody,
  UpdateClientBoardWebhookResponse,
  GetOfficeClientBoardResponse,
  CreateOfficeClientBoardCardBody,
  CreateOfficeClientBoardCardResponse,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { raiseClientCard, webhookUrlProblem } from "../lib/clientBoard";

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
  ],
  guest: ["overview", "photos", "summaries", "board"],
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
  users.sort((a, b) => a.name.localeCompare(b.name));
  res.json(
    GetClientAccessResponse.parse({
      propertyName: prop?.name ?? "Your property",
      logoUrl: account.logoPath ? `/api/storage${account.logoPath}` : null,
      features: CLIENT_FEATURES,
      roleDefaults: ROLE_DEFAULTS,
      users: users.map(serUser),
    }),
  );
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
        if (body.role && body.role !== user.role && user.active) {
          const others = await tx
            .select()
            .from(clientUsersTable)
            .where(eq(clientUsersTable.propertyId, account.propertyId))
            .for("update");
          const activeSeated = others.filter(
            (u) => u.id !== user.id && u.active && u.role !== "guest",
          ).length;
          const activeGuests = others.filter(
            (u) => u.id !== user.id && u.active && u.role === "guest",
          ).length;
          if (nextRole !== "guest" && activeSeated >= account.userSeats) {
            throw new SeatError(
              `All ${account.userSeats} user seats are taken — ask us to raise the seat count`,
            );
          }
          if (nextRole === "guest" && activeGuests >= account.guestSeats) {
            throw new SeatError(
              `All ${account.guestSeats} guest seats are taken — ask us to raise the seat count`,
            );
          }
        }
        const [row] = await tx
          .update(clientUsersTable)
          .set({ role: nextRole, permissions: nextPermissions })
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
    completedAt: c.completedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

router.get("/client/:token/board", async (req, res): Promise<void> => {
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
    GetClientBoardResponse.parse({
      propertyName: prop?.name ?? "Property",
      webhookUrl: account.webhookUrl ?? null,
      cards: cards.map(serCard),
    }),
  );
});

router.patch("/client/:token/board/cards/:cardId", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account || account.status !== "active") {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const parsed = UpdateClientBoardCardBody.safeParse(req.body);
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
  res.json(UpdateClientBoardCardResponse.parse(serCard(card)));
});

router.patch("/client/:token/board/webhook", async (req, res): Promise<void> => {
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
  const path = `/client/${token}/board`;
  return domain ? `https://${domain}${path}` : path;
}

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

export default router;
