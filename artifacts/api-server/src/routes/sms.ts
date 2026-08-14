/**
 * comms.sms — office outbound + public Twilio inbound/status webhooks.
 * No worker inbox UI.
 *
 * Outbound rows are written centrally by lib/sms.sendSms so that every sender
 * (autopilot, dispatch, job board, voice, …) lands in the same log, not just
 * the routes below.
 */

import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, notInArray, or } from "drizzle-orm";
import { db, activitiesTable, crewsTable, haloSmsMessagesTable } from "@workspace/db";
import { getTwilioSettings, sendSms, smsEnabled, smsPublicStatus } from "../lib/sms";
import { getBusinessSettings } from "../lib/businessSettings";
import {
  MAX_SMS_BODY,
  describeSmsError,
  phonesMatch,
  smsBlastAllowed,
  toE164,
  verifyTwilioSignature,
} from "../lib/smsCore";
import { limits } from "../lib/rateLimit";
import { logger } from "../lib/logger";

export const twilioWebhookRouter: IRouter = Router();
const officeRouter: IRouter = Router();

/** Statuses Twilio actually emits on a message resource. */
const TWILIO_STATUSES = new Set([
  "accepted",
  "scheduled",
  "queued",
  "sending",
  "sent",
  "delivering",
  "delivered",
  "undelivered",
  "failed",
  "canceled",
  "read",
]);

/** Once a row reaches one of these, later callbacks must not move it. */
const TERMINAL_STATUSES = ["delivered", "undelivered", "failed", "canceled"];

function emptyTwiml(res: { status: (n: number) => typeof res; type: (t: string) => typeof res; send: (b: string) => void }) {
  res.status(200).type("application/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
}

twilioWebhookRouter.post("/twilio/webhook", limits.checkinWrite, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, string>;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === "string") params[k] = v;
  }

  const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "https";
  const host = (req.headers["x-forwarded-host"] as string) ?? req.get("host");
  const url = `${proto}://${host}${req.originalUrl}`;

  const settings = await getTwilioSettings();
  if (!settings?.authToken) {
    logger.warn("twilio.webhook: no auth token — fail closed");
    res.status(503).type("text/plain").send("unavailable");
    return;
  }
  const signature = req.header("x-twilio-signature") ?? "";
  if (!verifyTwilioSignature({ authToken: settings.authToken, signature, url, params })) {
    logger.warn({ from: params.From }, "twilio.webhook: bad signature");
    res.status(403).type("text/plain").send("forbidden");
    return;
  }

  const from = toE164(params.From);
  const to = toE164(params.To) ?? settings.phoneNumber ?? "";
  const twilioSid = params.MessageSid || params.SmsMessageSid || "";
  const text = (params.Body ?? "").slice(0, MAX_SMS_BODY);
  if (!from || !twilioSid) {
    emptyTwiml(res);
    return;
  }

  const existing = await db
    .select({ id: haloSmsMessagesTable.id })
    .from(haloSmsMessagesTable)
    .where(eq(haloSmsMessagesTable.twilioSid, twilioSid))
    .limit(1);
  if (existing[0]) {
    emptyTwiml(res);
    return;
  }

  const crews = await db.select({ id: crewsTable.id, phone: crewsTable.phone }).from(crewsTable);
  const crew = crews.find((c) => phonesMatch(c.phone, from));

  await db.insert(haloSmsMessagesTable).values({
    direction: "inbound",
    crewId: crew?.id ?? null,
    fromE164: from,
    toE164: to || from,
    body: text,
    twilioSid,
    status: "received",
  });

  emptyTwiml(res);
});

/**
 * Delivery receipt. Twilio returning 201 on send only means "accepted"; this is
 * where the carrier's actual verdict arrives, and the only place an
 * undelivered message becomes visible.
 *
 * The connector authenticates with an API key and stores no auth token, so
 * X-Twilio-Signature cannot be verified. Instead the callback URL carries a
 * 128-bit nonce minted per message: possessing it proves the callback belongs
 * to a message we sent, and it can only ever settle that one row.
 */
twilioWebhookRouter.post("/twilio/status/:nonce", limits.checkinWrite, async (req, res): Promise<void> => {
  const nonce = String(req.params.nonce ?? "");
  if (!/^[0-9a-f]{32}$/.test(nonce)) {
    emptyTwiml(res);
    return;
  }
  const body = (req.body ?? {}) as Record<string, string>;
  const status = (body.MessageStatus || body.SmsStatus || "").trim().toLowerCase();
  // Ignore anything that isn't a status Twilio actually emits, so a malformed
  // or hostile callback cannot write junk into the log.
  if (!TWILIO_STATUSES.has(status)) {
    emptyTwiml(res);
    return;
  }
  const sid = (body.MessageSid || body.SmsSid || "").trim();
  if (!sid) {
    emptyTwiml(res);
    return;
  }
  const parsedCode = Number.parseInt(body.ErrorCode ?? "", 10);
  const errorCode = Number.isFinite(parsedCode) ? parsedCode : null;

  const reason = describeSmsError(errorCode);
  const updated = await db
    .update(haloSmsMessagesTable)
    .set({
      status,
      errorCode,
      errorMessage: reason,
      twilioSid: sid,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(haloSmsMessagesTable.callbackNonce, nonce),
        // Terminal verdicts are final. This makes Twilio's retries and
        // out-of-order callbacks no-ops instead of letting a late "sent"
        // overwrite "undelivered" — and keeps the activity below one-shot.
        notInArray(haloSmsMessagesTable.status, TERMINAL_STATUSES),
        // Bind to the SID recorded at send time, so a leaked nonce cannot be
        // replayed against a different message.
        or(
          isNull(haloSmsMessagesTable.twilioSid),
          eq(haloSmsMessagesTable.twilioSid, sid),
        ),
      ),
    )
    .returning({
      id: haloSmsMessagesTable.id,
      to: haloSmsMessagesTable.toE164,
      crewId: haloSmsMessagesTable.crewId,
    });

  const row = updated[0];
  if (row && (status === "undelivered" || status === "failed")) {
    const toLast4 = row.to.slice(-4);
    logger.warn(
      { toLast4, status, errorCode, reason },
      "sms was accepted by twilio but not delivered",
    );
    // Surface it where the office already looks, so a dropped text is visible
    // without anyone thinking to open the SMS log.
    try {
      await db.insert(activitiesTable).values({
        entityType: row.crewId ? "crew" : "sms",
        entityId: row.crewId ?? row.id,
        kind: "sms_undelivered",
        body: `Text to •${toLast4} was not delivered. ${reason ?? "Carrier gave no reason."}`,
      });
    } catch (err) {
      logger.warn({ err }, "failed to log undelivered sms activity");
    }
  }

  emptyTwiml(res);
});

officeRouter.get("/sms/status", async (_req, res): Promise<void> => {
  const status = await smsPublicStatus();
  res.json({ ok: true, ...status });
});

officeRouter.post("/sms/admin", async (req, res): Promise<void> => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > MAX_SMS_BODY) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  if (!(await smsEnabled())) {
    res.status(503).json({ error: "SMS not configured" });
    return;
  }
  const settingsRow = await getBusinessSettings();
  const destRaw = typeof req.body?.to === "string" && req.body.to.trim() ? req.body.to.trim() : (settingsRow.phone ?? "");
  const dest = toE164(destRaw);
  if (!dest) {
    res.status(404).json({ error: "No admin phone on file — add it in business settings" });
    return;
  }
  const result = await sendSms(destRaw, body);
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, capability: "comms.sms", toLast4: dest.slice(-4) });
});

officeRouter.post("/sms/send", async (req, res): Promise<void> => {
  const crewId = typeof req.body?.crewId === "string" ? req.body.crewId : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!crewId || !body || body.length > MAX_SMS_BODY) {
    res.status(400).json({ error: "crewId and body are required" });
    return;
  }
  if (!(await smsEnabled())) {
    res.status(503).json({ error: "SMS not configured" });
    return;
  }
  const [crew] = await db
    .select({ id: crewsTable.id, name: crewsTable.name, phone: crewsTable.phone })
    .from(crewsTable)
    .where(eq(crewsTable.id, crewId));
  if (!crew?.phone) {
    res.status(404).json({ error: "Crew not found or has no phone" });
    return;
  }
  const result = await sendSms(crew.phone, body, { crewId: crew.id });
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, capability: "comms.sms", crewId: crew.id, crewName: crew.name });
});

officeRouter.post("/sms/blast", async (req, res): Promise<void> => {
  const rawIds = Array.isArray(req.body?.crewIds) ? req.body.crewIds : [];
  const crewIds = rawIds.filter((id: unknown): id is string => typeof id === "string");
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > MAX_SMS_BODY || !smsBlastAllowed(crewIds.length)) {
    res.status(400).json({ error: `Provide 1–25 crewIds and a body` });
    return;
  }
  if (!(await smsEnabled())) {
    res.status(503).json({ error: "SMS not configured" });
    return;
  }
  let sent = 0;
  const failures: string[] = [];
  for (const id of crewIds) {
    const [crew] = await db
      .select({ id: crewsTable.id, phone: crewsTable.phone })
      .from(crewsTable)
      .where(eq(crewsTable.id, id));
    if (!crew?.phone) {
      failures.push(id);
      continue;
    }
    const result = await sendSms(crew.phone, body, { crewId: crew.id });
    if (result.ok) sent += 1;
    else failures.push(id);
  }
  res.json({ ok: true, capability: "comms.sms", sent, failed: failures.length, failures });
});

officeRouter.get("/sms/recent", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(haloSmsMessagesTable)
    .orderBy(desc(haloSmsMessagesTable.createdAt))
    .limit(50);
  res.json({
    ok: true,
    messages: rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      crewId: r.crewId,
      from: r.fromE164,
      to: r.toE164,
      body: r.body,
      status: r.status,
      // Delivery outcome — "sent" is not "delivered", so surface the failure.
      delivered: r.status === "delivered",
      undelivered: r.status === "undelivered" || r.status === "failed",
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      at: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
});

export default officeRouter;
