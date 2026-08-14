/**
 * comms.sms — office outbound + public Twilio inbound webhook.
 * No worker inbox UI.
 */

import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, crewsTable, haloSmsMessagesTable } from "@workspace/db";
import { getTwilioSettings, sendSms, smsEnabled, smsPublicStatus } from "../lib/sms";
import { getBusinessSettings } from "../lib/businessSettings";
import {
  MAX_SMS_BODY,
  phonesMatch,
  smsBlastAllowed,
  toE164,
  verifyTwilioSignature,
} from "../lib/smsCore";
import { limits } from "../lib/rateLimit";
import { logger } from "../lib/logger";

export const twilioWebhookRouter: IRouter = Router();
const officeRouter: IRouter = Router();

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
  const twilio = await getTwilioSettings();
  const result = await sendSms(destRaw, body);
  await db.insert(haloSmsMessagesTable).values({
    direction: "outbound",
    crewId: null,
    fromE164: toE164(twilio?.phoneNumber ?? "") ?? "unknown",
    toE164: dest,
    body,
    status: result.ok ? "sent" : "failed",
  });
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
  const dest = toE164(crew.phone);
  const settings = await getTwilioSettings();
  const result = await sendSms(crew.phone, body);
  await db.insert(haloSmsMessagesTable).values({
    direction: "outbound",
    crewId: crew.id,
    fromE164: toE164(settings?.phoneNumber ?? "") ?? "unknown",
    toE164: dest ?? crew.phone,
    body,
    status: result.ok ? "sent" : "failed",
  });
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
  const settings = await getTwilioSettings();
  const from = toE164(settings?.phoneNumber ?? "") ?? "unknown";
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
    const result = await sendSms(crew.phone, body);
    await db.insert(haloSmsMessagesTable).values({
      direction: "outbound",
      crewId: crew.id,
      fromE164: from,
      toE164: toE164(crew.phone) ?? crew.phone,
      body,
      status: result.ok ? "sent" : "failed",
    });
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
      at: r.createdAt,
    })),
  });
});

export default officeRouter;
