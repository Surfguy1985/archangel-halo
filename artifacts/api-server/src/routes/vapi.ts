import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  leadsTable,
  bidsTable,
  bidLineItemsTable,
  propertiesTable,
  priceItemsTable,
  catalogItemsTable,
  activitiesTable,
  notificationsTable,
} from "@workspace/db";
import { completeJson } from "../lib/ai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Vapi phone-agent webhook.
//
// Configure the Vapi assistant's "Server URL" to point at:
//   https://<published-domain>/api/vapi/webhook
// Vapi POSTs an end-of-call-report when a call finishes. We turn that call
// into a HALO lead (source "phone") and, when we can match a property and
// requested services, draft an initial bid from the price book.
// ---------------------------------------------------------------------------

type ExtractedCall = {
  isBusinessLead: boolean;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  propertyName: string | null;
  unitNo: string | null;
  requestSummary: string;
  services: Array<{ service?: string; name?: string; qty?: number }>;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Pull the useful bits out of a Vapi end-of-call-report payload. */
function pickCallFields(msg: Record<string, any>): {
  transcript: string | null;
  summary: string | null;
  callerNumber: string | null;
  callId: string | null;
} {
  const transcript =
    str(msg?.artifact?.transcript) ?? str(msg?.transcript) ?? null;
  const summary =
    str(msg?.analysis?.summary) ?? str(msg?.summary) ?? null;
  const callerNumber =
    str(msg?.call?.customer?.number) ?? str(msg?.customer?.number) ?? null;
  const callId = str(msg?.call?.id) ?? null;
  return { transcript, summary, callerNumber, callId };
}

function tokenScore(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const tb = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n;
}

/** Best-effort service match against price book rows. */
function matchPriceRow<T extends { service: string; detail: string | null; rate: number }>(
  wanted: string,
  rows: T[],
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const score = tokenScore(wanted, `${r.service} ${r.detail ?? ""}`);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

async function nextBidNo(): Promise<string> {
  const rows = await db.select({ bidNo: bidsTable.bidNo }).from(bidsTable);
  let max = 1000;
  for (const r of rows) {
    const m = /^B-(\d+)$/.exec(r.bidNo);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `B-${String(max + 1)}`;
}

/** Seen call ids (per process) so Vapi retries don't create duplicate leads. */
const processedCallIds = new Set<string>();

router.post("/vapi/webhook", async (req, res): Promise<void> => {
  // If a webhook secret is configured, require Vapi's x-vapi-secret header to
  // match. (Set the same value in the Vapi assistant's server settings.)
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (secret && req.headers["x-vapi-secret"] !== secret) {
    logger.warn("Vapi webhook rejected: bad or missing x-vapi-secret header");
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  // Always answer 200 quickly-ish; Vapi retries non-2xx responses.
  const msg = (req.body?.message ?? req.body ?? {}) as Record<string, any>;
  const type = str(msg?.type);
  if (type !== "end-of-call-report") {
    res.json({ ok: true, ignored: type ?? "unknown" });
    return;
  }

  const { transcript, summary, callerNumber, callId } = pickCallFields(msg);
  if (!transcript && !summary) {
    res.json({ ok: true, ignored: "no transcript" });
    return;
  }
  if (callId) {
    if (processedCallIds.has(callId)) {
      res.json({ ok: true, ignored: "duplicate" });
      return;
    }
    processedCallIds.add(callId);
    if (processedCallIds.size > 500) {
      processedCallIds.delete(processedCallIds.values().next().value as string);
    }
  }

  try {
    const props = await db.select().from(propertiesTable);
    const propList = props.map((p) => p.name).join("; ");

    const extracted = await completeJson<ExtractedCall>(
      `You process inbound phone calls for a property-maintenance contractor. Extract structured lead info from the call.
Known properties: ${propList || "(none)"}
Return JSON with EXACTLY these keys (use null when unknown, never omit a key):
{"isBusinessLead": boolean, "contactName": string|null, "contactEmail": string|null, "contactPhone": string|null, "propertyName": string|null, "unitNo": string|null, "requestSummary": string, "services": [{"service": string, "qty": number}]}
Rules:
- isBusinessLead: true only if the caller wants work done, a quote/bid, or is a potential/current client with a service request. Spam, wrong numbers, and vendors selling things are false.
- contactName: the caller's name if they gave one.
- propertyName: EXACTLY one of the known property names if the call clearly refers to it, else null.
- services: the concrete work items requested, each with a qty (default 1). Keep service names short (e.g. "paint", "carpet clean", "full turn"). Empty array if none.
- requestSummary: 1-3 sentences an office manager can act on: who called, what they need, where, and any timeline.
- contactPhone: caller's phone if stated; else null.`,
      `Caller number (from phone system): ${callerNumber ?? "unknown"}
Call summary: ${summary ?? "(none)"}
Transcript:
${(transcript ?? "").slice(0, 12000)}`,
    );

    logger.info({ extracted, callId }, "vapi call extraction");
    if (!extracted?.isBusinessLead) {
      res.json({ ok: true, lead: null, ignored: "not a business lead" });
      return;
    }

    const prop = extracted.propertyName
      ? props.find(
          (p) => p.name.toLowerCase() === extracted.propertyName!.toLowerCase(),
        ) ?? null
      : null;

    // Draft an initial bid when we matched a property and have service asks.
    let bidNote = "";
    let draftBidId: string | null = null;
    if (prop && extracted.services?.length) {
      const propPrices = await db
        .select()
        .from(priceItemsTable)
        .where(eq(priceItemsTable.propertyId, prop.id));
      const catalog = propPrices.length
        ? []
        : await db.select().from(catalogItemsTable);
      const book: Array<{ service: string; detail: string | null; rate: number }> =
        propPrices.length ? propPrices : catalog;

      const lines: Array<{
        service: string;
        description: string | null;
        qty: number;
        unitPrice: number;
        amount: number;
      }> = [];
      for (const want of extracted.services) {
        const wantedName = str(want?.service) ?? str(want?.name);
        if (!wantedName) continue;
        const hit = matchPriceRow(wantedName, book);
        const qty = Number(want.qty) > 0 ? Number(want.qty) : 1;
        const unitPrice = hit?.rate ?? 0;
        lines.push({
          service: str(hit?.service) ?? wantedName,
          description: hit?.detail ?? (hit ? null : "Not in price book — set price"),
          qty,
          unitPrice,
          amount: Math.round(qty * unitPrice * 100) / 100,
        });
      }
      if (lines.length) {
        const amount = lines.reduce((s, l) => s + l.amount, 0);
        const bidNo = await nextBidNo();
        const bidId = await db.transaction(async (tx) => {
          const [bid] = await tx
            .insert(bidsTable)
            .values({
              bidNo,
              propertyId: prop.id,
              unitNo: extracted.unitNo,
              scope: extracted.requestSummary,
              amount,
              status: "draft",
            })
            .returning();
          for (let i = 0; i < lines.length; i++) {
            await tx.insert(bidLineItemsTable).values({
              bidId: bid.id,
              ...lines[i],
              sortOrder: i,
            });
          }
          return bid.id;
        });
        draftBidId = bidId;
        bidNote = ` Draft bid ${bidNo} ($${amount.toFixed(2)}) created from the price book — review before sending.`;
      }
    }

    const [lead] = await db
      .insert(leadsTable)
      .values({
        propertyId: prop?.id ?? null,
        source: "phone",
        status: "new",
        summary: `${extracted.requestSummary}${bidNote}`,
        contactName: extracted.contactName,
        contactEmail: extracted.contactEmail,
        contactPhone: extracted.contactPhone ?? callerNumber,
        callTranscript: transcript,
        lastContactAt: new Date(),
      })
      .returning();

    await db.insert(activitiesTable).values({
      entityType: "lead",
      entityId: lead.id,
      kind: "created",
      body: `Phone call-in lead captured by AI${prop ? ` for ${prop.name}` : ""}${bidNote ? " with a draft bid" : ""}`,
    });
    await db.insert(notificationsTable).values({
      kind: "lead_call_in",
      priority: "urgent",
      entityType: "lead",
      entityId: lead.id,
      title: `New call-in lead${extracted.contactName ? `: ${extracted.contactName}` : ""}`,
      body: `${extracted.requestSummary}${bidNote}`,
    });

    logger.info(
      { leadId: lead.id, draftBidId, callId },
      "vapi call converted to lead",
    );
    res.json({ ok: true, leadId: lead.id, bidId: draftBidId });
  } catch (err) {
    logger.error({ err }, "vapi webhook failed");
    // 200 so Vapi doesn't hammer retries; the failure is logged.
    res.json({ ok: false });
  }
});

export default router;
