import { Router, type IRouter, type Request, type Response } from "express";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  clientConciergeMessagesTable,
  clientConciergeConfirmsTable,
  propertiesTable,
} from "@workspace/db";
import {
  ConciergeChatBody,
  ConfirmConciergeActionBody,
  ConfirmConciergeActionResponse,
  GetConciergeHistoryResponse,
} from "@workspace/api-zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { limits } from "../lib/rateLimit";
import { resolveViewer, type Viewer } from "./clientBoard";
import { localToday } from "../lib/localDate";

const router: IRouter = Router();

const MODEL = "claude-sonnet-4-6";
// Spend guard: cap tool round-trips and output size per message, and cap the
// number of concierge messages per user per day.
const MAX_TOOL_ROUNDS = 6;
const MAX_OUTPUT_TOKENS = 1024;
const DAILY_MESSAGE_CAP = 80;
const CONFIRM_TTL_MS = 10 * 60 * 1000;

async function accountByToken(token: string) {
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.dashboardToken, token))
    .limit(1);
  if (!account || account.status !== "active") return undefined;
  return account;
}

// ---------------------------------------------------------------------------
// Internal API calls — the concierge NEVER touches the database for reads or
// writes on the client's behalf. Every tool goes through the same public
// endpoints the dashboard buttons use, forwarding the caller's cookie and
// bearer so permissions, rate limits, and audit trails apply identically.
// ---------------------------------------------------------------------------
async function apiFetch(
  req: Request,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  const base = `http://127.0.0.1:${process.env.PORT ?? 3000}/api`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = req.headers["cookie"];
  const auth = req.headers["authorization"];
  if (typeof cookie === "string") headers["cookie"] = cookie;
  if (typeof auth === "string") headers["authorization"] = auth;
  const resp = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await resp.json();
  } catch {
    json = null;
  }
  return { status: resp.status, json };
}

// ---------------------------------------------------------------------------
// Confirm tokens — HMAC-signed, stateless, short-lived. Bound to the property
// AND the signed-in user, so a chip can't be replayed by anyone else.
// ---------------------------------------------------------------------------
type PendingAction = {
  j: string; // jti — unique id, consumed on first execution
  p: string; // propertyId
  u: string; // clientUserId
  t: string; // tool
  a: Record<string, unknown>; // args
  e: number; // expiry (ms epoch)
};

function confirmSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not configured");
  return s;
}

function signConfirm(payload: string): string {
  return createHmac("sha256", confirmSecret()).update(`concierge.${payload}`).digest("base64url");
}

function issueConfirmToken(action: PendingAction): string {
  const payload = Buffer.from(JSON.stringify(action)).toString("base64url");
  return `${payload}.${signConfirm(payload)}`;
}

function verifyConfirmToken(token: string): PendingAction | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = signConfirm(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const action = JSON.parse(Buffer.from(payload, "base64url").toString()) as PendingAction;
    if (!action || typeof action !== "object" || action.e < Date.now()) return null;
    return action;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  mutating: boolean;
  requiredPermission?: string;
  chipLabel?: (args: Record<string, unknown>) => string;
};

const TOOLS: ToolDef[] = [
  {
    name: "get_board",
    description:
      "Fetch the client's live board: every card (jobs, make readys, crews, invoices, requests) with lane, unit, tracker link, photos, and invoice/pay state. Use this first for almost any question about work status, crews, invoices, or photos.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    mutating: false,
  },
  {
    name: "get_kpis",
    description: "Fetch the board KPI summary — open work, money in flight, unit health.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    mutating: false,
  },
  {
    name: "get_request_options",
    description:
      "Fetch the service list the property can request work from (price book services with labels). Use before filing a request_work so serviceLabel matches a real service when possible.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    mutating: false,
  },
  {
    name: "request_work",
    description:
      "File a work request / bid request / change order / emergency with the office. Mutating — the client must confirm.",
    input_schema: {
      type: "object",
      properties: {
        serviceLabel: { type: "string", description: "What work is needed" },
        unitNo: { type: "string", description: "Unit label if unit-specific" },
        notes: { type: "string" },
        neededBy: { type: "string", description: "YYYY-MM-DD" },
        emergency: { type: "boolean" },
        poNumber: {
          type: "string",
          description:
            "Client's PO number. REQUIRED unless emergency=true — ask the client for it before calling this tool. Emergencies may omit it (office approves manually).",
        },
      },
      required: ["serviceLabel"],
      // PO is conditionally required: normal requests must carry one,
      // emergencies may omit it (office approves manually).
      anyOf: [
        { required: ["poNumber"] },
        { properties: { emergency: { const: true } }, required: ["emergency"] },
      ],
      additionalProperties: false,
    },
    mutating: true,
    chipLabel: (a) => `Request: ${String(a.serviceLabel ?? "work")}${a.unitNo ? ` (unit ${a.unitNo})` : ""}`,
  },
  {
    name: "card_action",
    description:
      "Run a board card action: 'job.request_update' (ask the office for a status update), 'crew.locate_requested' (ping the crew for their location), 'request.cancel' (cancel a pending work request). Mutating — the client must confirm.",
    input_schema: {
      type: "object",
      properties: {
        cardKey: { type: "string" },
        action: {
          type: "string",
          enum: ["job.request_update", "crew.locate_requested", "request.cancel"],
        },
        note: { type: "string" },
      },
      required: ["cardKey", "action"],
      additionalProperties: false,
    },
    mutating: true,
    chipLabel: (a) =>
      a.action === "crew.locate_requested"
        ? "Ping the crew for their location"
        : a.action === "request.cancel"
          ? "Cancel this request"
          : "Request a status update",
  },
  {
    name: "approve_invoice",
    description:
      "Approve an invoice card (unlocks its pay flow). cardKey must be an invoice-module card key from get_board (push:<id>). Mutating — the client must confirm; include the invoice amount in your summary.",
    input_schema: {
      type: "object",
      properties: {
        cardKey: { type: "string" },
        summary: { type: "string", description: "e.g. 'Approve $1,840 invoice INV-5012'" },
      },
      required: ["cardKey", "summary"],
      additionalProperties: false,
    },
    mutating: true,
    chipLabel: (a) => String(a.summary ?? "Approve invoice"),
  },
  {
    name: "post_message",
    description:
      "Post a message to a card's thread with the office (e.g. a revision request on an invoice, a question about a job). Mutating — the client must confirm.",
    input_schema: {
      type: "object",
      properties: {
        cardKey: { type: "string" },
        body: { type: "string", maxLength: 2000 },
      },
      required: ["cardKey", "body"],
      additionalProperties: false,
    },
    mutating: true,
    chipLabel: () => "Send message to the office",
  },
];

const CARD_KEY_RE = /^[a-z_]+:[A-Za-z0-9-]{1,64}$/;

// Trim board cards so the model sees what matters without blowing the context.
function trimCard(card: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (card[k] !== undefined && card[k] !== null) out[k] = card[k];
    return out;
  };
  const out = pick(
    "cardKey",
    "template",
    "title",
    "lane",
    "unitLabel",
    "jobLabel",
    "stage",
    "stageIndex",
    "pipeline",
    "trackerUrl",
    "crewName",
    "amount",
    "status",
    "snoozedUntil",
    "notes",
  );
  const photos = card["photos"];
  if (Array.isArray(photos) && photos.length) {
    out["photos"] = photos.slice(0, 3);
    out["photoCount"] = photos.length;
  }
  const module = card["module"] as Record<string, unknown> | undefined;
  if (module && typeof module === "object") {
    const m: Record<string, unknown> = {};
    for (const k of [
      "type",
      "invoiceNo",
      "amount",
      "total",
      "invoiceStatus",
      "approvedAt",
      "payUrl",
      "trackerUrl",
      "crewName",
      "dueAt",
    ]) {
      if (module[k] !== undefined && module[k] !== null) m[k] = module[k];
    }
    if (Object.keys(m).length) out["module"] = m;
  }
  return out;
}

async function runReadTool(
  req: Request,
  token: string,
  name: string,
): Promise<unknown> {
  if (name === "get_board") {
    const { status, json } = await apiFetch(req, `/client/${token}/board`);
    if (status !== 200) return { error: `Board unavailable (${status})` };
    const board = json as { cards?: Record<string, unknown>[]; propertyName?: string };
    return {
      propertyName: board.propertyName,
      cards: (board.cards ?? []).map(trimCard),
    };
  }
  if (name === "get_kpis") {
    const { status, json } = await apiFetch(req, `/client/${token}/board/kpis`);
    return status === 200 ? json : { error: `KPIs unavailable (${status})` };
  }
  if (name === "get_request_options") {
    const { status, json } = await apiFetch(req, `/client/${token}/request-options`);
    return status === 200 ? json : { error: `Options unavailable (${status})` };
  }
  return { error: `Unknown tool ${name}` };
}

function systemPrompt(propertyName: string, _viewer: Viewer): string {
  return `You are the concierge on the ${propertyName} client board for HALO (ArchAngel Contractors' operations platform). The person chatting holds the board link, which gives them full board rights.

You answer questions about their property's work using the tools, and you can take actions on their behalf.

Rules:
- Always ground answers in tool data. Never invent jobs, amounts, crews, or dates. If the board has no matching card, say so plainly.
- Keep answers short and warm — a couple of sentences, no headers, no bullet walls. Format money like $1,840.
- Units: "1601 make ready" means the card whose unit label or title matches 1601. Match loosely (e.g. "#1601", "Unit 1601").
- When you reference a specific card, embed a link EXACTLY like [[card:CARDKEY|SHORT LABEL]] using the card's cardKey. The board turns these into tappable buttons.
- Live crew location: share the card's trackerUrl as a [[card:...]] link and offer crew.locate_requested to ping them.
- Mutating tools NEVER run immediately: the client sees a confirm button first. After calling one, tell them to tap the confirmation below. Never claim an action is done.
- This person can take actions.
- Today's date is ${localToday()}.`;
}

// ---------------------------------------------------------------------------
// Chat — SSE. Events: status {text}, delta {text}, chips {chips}, done {}.
// ---------------------------------------------------------------------------
router.post("/client/:token/concierge", limits.cardAction, async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const parsed = ConciergeChatBody.safeParse(req.body);
  const message = parsed.success ? parsed.data.message.trim() : "";
  if (!message || message.length > 2000) {
    res.status(400).json({ error: "Write a message (max 2000 chars)" });
    return;
  }
  const viewer = await resolveViewer(req, account.propertyId);

  // Daily spend guard per property (all link holders share the bucket).
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clientConciergeMessagesTable)
    .where(
      and(
        eq(clientConciergeMessagesTable.propertyId, account.propertyId),
        eq(clientConciergeMessagesTable.role, "user"),
        gte(clientConciergeMessagesTable.createdAt, dayStart),
      ),
    );
  if (n >= DAILY_MESSAGE_CAP) {
    res.status(429).json({ error: "The concierge is taking a breather — try again tomorrow" });
    return;
  }

  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, account.propertyId))
    .limit(1);
  const propertyName = prop?.name ?? "your property";

  // Prior conversation — scoped to this board's link-holder identity.
  const history = await db
    .select()
    .from(clientConciergeMessagesTable)
    .where(
      and(
        eq(clientConciergeMessagesTable.propertyId, account.propertyId),
        eq(clientConciergeMessagesTable.clientUserId, viewer.user!.id),
      ),
    )
    .orderBy(asc(clientConciergeMessagesTable.createdAt))
    .then((rows) => rows.slice(-16));

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const canAct = viewer.authenticated && !viewer.readOnly && !!viewer.user;
  type Chip = { id: string; label: string; summary: string; confirmToken: string; expiresAt: string };
  const chips: Chip[] = [];

  const anthropicTools = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as never,
  }));

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    ...history.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: message },
  ];

  // Stop burning model/tool budget if the client disconnects mid-stream.
  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  let finalText = "";
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS && !aborted; round++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemPrompt(propertyName, viewer),
        tools: anthropicTools as never,
        messages: messages as never,
      });
      const toolUses = resp.content.filter((b) => b.type === "tool_use");
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b) => ("text" in b ? b.text : ""))
        .join("")
        .trim();

      if (resp.stop_reason !== "tool_use" || toolUses.length === 0 || round === MAX_TOOL_ROUNDS) {
        finalText = text || finalText || "Sorry — I couldn't put an answer together. Try rephrasing?";
        break;
      }

      messages.push({ role: "assistant", content: resp.content });
      const results: unknown[] = [];
      for (const tu of toolUses) {
        const def = TOOLS.find((t) => t.name === tu.name);
        const args = (tu.input ?? {}) as Record<string, unknown>;
        let result: unknown;
        if (!def) {
          result = { error: "Unknown tool" };
        } else if (!def.mutating) {
          send("status", { text: "Checking your board…" });
          result = await runReadTool(req, String(req.params.token), def.name);
        } else if (!canAct) {
          result = {
            queued: false,
            error: "The client is not signed in with write access — ask them to sign in first.",
          };
        } else {
          // Never execute during the loop — mint a confirm chip instead.
          const cardKey = args.cardKey != null ? String(args.cardKey) : null;
          if (cardKey && !CARD_KEY_RE.test(cardKey)) {
            result = { queued: false, error: "Invalid cardKey" };
          } else {
            const exp = Date.now() + CONFIRM_TTL_MS;
            const chip: Chip = {
              id: randomUUID(),
              label: def.chipLabel ? def.chipLabel(args) : def.name,
              summary: String(args.summary ?? args.notes ?? args.body ?? ""),
              confirmToken: issueConfirmToken({
                j: randomUUID(),
                p: account.propertyId,
                u: viewer.user!.id,
                t: def.name,
                a: args,
                e: exp,
              }),
              expiresAt: new Date(exp).toISOString(),
            };
            chips.push(chip);
            send("status", { text: "Setting up a confirmation…" });
            result = {
              queued: true,
              note: "A confirm button is now shown to the client. It will only run if they tap it — do not claim it is done.",
            };
          }
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch {
    finalText = finalText || "Something went wrong on my end — give it another try in a moment.";
  }

  // Stream the answer in small chunks so long answers render progressively.
  for (let i = 0; i < finalText.length; i += 80) {
    send("delta", { text: finalText.slice(i, i + 80) });
  }
  if (chips.length) send("chips", { chips });
  send("done", {});
  res.end();

  // Persist after responding, scoped to this board's link-holder identity.
  const uid = viewer.user!.id;
  await db.insert(clientConciergeMessagesTable).values([
    { propertyId: account.propertyId, clientUserId: uid, role: "user", content: message },
    {
      propertyId: account.propertyId,
      clientUserId: uid,
      role: "assistant",
      content: finalText,
      meta: chips.length ? { chips } : null,
    },
  ]);
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
router.get("/client/:token/concierge/history", async (req, res): Promise<void> => {
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const viewer = await resolveViewer(req, account.propertyId);
  const rows = await db
    .select()
    .from(clientConciergeMessagesTable)
    .where(
      and(
        eq(clientConciergeMessagesTable.propertyId, account.propertyId),
        eq(clientConciergeMessagesTable.clientUserId, viewer.user!.id),
      ),
    )
    .orderBy(asc(clientConciergeMessagesTable.createdAt));
  const recent = rows.slice(-30);
  res.json(
    GetConciergeHistoryResponse.parse({
      messages: recent.map((m) => ({
        id: m.id,
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
        chips: Array.isArray((m.meta as { chips?: unknown[] } | null)?.chips)
          ? ((m.meta as { chips: unknown[] }).chips as never[])
          : [],
        createdAt: m.createdAt.toISOString(),
      })),
    }),
  );
});

// ---------------------------------------------------------------------------
// Confirm — executes through the SAME endpoint the equivalent button uses,
// forwarding the caller's own credentials, so permissions/audit/rate limits
// are identical to tapping the button by hand.
// ---------------------------------------------------------------------------
router.post(
  "/client/:token/concierge/confirm",
  limits.cardAction,
  async (req, res): Promise<void> => {
    const token = String(req.params.token);
    const account = await accountByToken(token);
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    const viewer = await resolveViewer(req, account.propertyId);
    const parsed = ConfirmConciergeActionBody.safeParse(req.body);
    const action = parsed.success ? verifyConfirmToken(parsed.data.confirmToken) : null;
    if (!action || action.p !== account.propertyId || action.u !== viewer.user!.id) {
      res.status(400).json({ error: "This confirmation has expired — ask the concierge again" });
      return;
    }
    // One-time use: claim the token's jti BEFORE executing. The primary key
    // makes this atomic across instances — a replay or double-click hits a
    // duplicate key and is rejected, so the action can never run twice.
    try {
      await db
        .insert(clientConciergeConfirmsTable)
        .values({ jti: String(action.j), propertyId: account.propertyId });
    } catch {
      res.status(400).json({ error: "This was already confirmed" });
      return;
    }
    const a = action.a;
    let out: { status: number; json: unknown };
    if (action.t === "request_work") {
      out = await apiFetch(req, `/client/${token}/requests`, {
        method: "POST",
        body: {
          serviceLabel: String(a.serviceLabel ?? "Work request"),
          unitNo: a.unitNo != null ? String(a.unitNo) : null,
          notes: a.notes != null ? String(a.notes) : null,
          neededBy: a.neededBy != null ? String(a.neededBy) : null,
          emergency: a.emergency === true,
          poNumber: a.poNumber != null ? String(a.poNumber) : null,
          requesterName: viewer.name,
        },
      });
    } else if (action.t === "card_action") {
      out = await apiFetch(req, `/client/${token}/board/actions`, {
        method: "POST",
        body: {
          action: String(a.action ?? ""),
          cardKey: String(a.cardKey ?? ""),
          payload: a.note != null ? { note: String(a.note) } : {},
        },
      });
    } else if (action.t === "approve_invoice") {
      out = await apiFetch(
        req,
        `/client/${token}/board/cards/${encodeURIComponent(String(a.cardKey ?? ""))}/action`,
        { method: "POST", body: { action: "approve", name: viewer.name } },
      );
    } else if (action.t === "post_message") {
      out = await apiFetch(
        req,
        `/client/${token}/board/cards/${encodeURIComponent(String(a.cardKey ?? ""))}/comments`,
        { method: "POST", body: { body: String(a.body ?? "") } },
      );
    } else {
      res.status(400).json({ error: "Unknown action" });
      return;
    }
    const j = (out.json ?? {}) as Record<string, unknown>;
    const ok = out.status >= 200 && out.status < 300 && j.ok !== false;
    const blocked = j.blocked === true;
    const message = ok
      ? String(j.message ?? "Done — the office has it")
      : String(j.reason ?? j.error ?? "That didn't go through");
    res.status(ok || blocked ? 200 : 400).json(
      ConfirmConciergeActionResponse.parse({ ok, blocked, message }),
    );
  },
);

export default router;
