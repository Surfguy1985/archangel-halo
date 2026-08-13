import { Router, type IRouter } from "express";
import { getAutoEmails } from "../lib/emailPolicy";
import { isUniqueViolation } from "../lib/dbErrors";
import { desc, eq, asc, and } from "drizzle-orm";
import {
  db,
  leadsTable,
  bidsTable,
  bidLineItemsTable,
  leadCampaignsTable,
  propertiesTable,
  contactsTable,
  type Lead,
  type Bid,
  type LeadCampaign,
  type BusinessSettings,
} from "@workspace/db";
import {
  ListLeadsResponse,
  CreateLeadBody,
  CreateLeadResponse,
  UpdateLeadParams,
  UpdateLeadBody,
  UpdateLeadResponse,
  ListLeadEmailTemplatesParams,
  ListLeadEmailTemplatesResponse,
  SendLeadEmailParams,
  SendLeadEmailBody,
  SendLeadEmailResponse,
  ListLeadCampaignDefsResponse,
  StartLeadCampaignParams,
  StartLeadCampaignBody,
  StartLeadCampaignResponse,
  StopLeadCampaignParams,
  StopLeadCampaignResponse,
  ListBidsResponse,
  ListBidsQueryParams,
  CreateBidBody,
  CreateBidResponse,
  GetBidParams,
  GetBidResponse,
  UpdateBidBody,
  UpdateBidParams,
  UpdateBidResponse,
  DeleteBidParams,
  DeleteLeadParams,
  SendBidParams,
  SendBidBody,
  SendBidResponse,
  NudgeBidParams,
  NudgeBidResponse,
  GetBidAiPricingBody,
  GetBidAiPricingResponse,
} from "@workspace/api-zod";
import { completeJson } from "../lib/ai";
import { logger } from "../lib/logger";
import { ser } from "../lib/serialize";
import { sendEmail } from "../lib/email";
import { getBusinessSettings } from "../lib/businessSettings";
import { generateBidPdf } from "../lib/bidPdf";
import {
  renderTemplates,
  renderTemplate,
  templateBodyToHtml,
  CAMPAIGNS,
  campaignByKind,
  templateName,
  type LeadTemplateContext,
} from "../lib/leadTemplates";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function propertyNames(): Promise<Map<string, string>> {
  const rows = await db.select().from(propertiesTable);
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function nextBidNo(): Promise<string> {
  // Use the max existing number (not row count) so deletions never cause
  // duplicate bid numbers on externally shared proposals.
  const rows = await db.select({ bidNo: bidsTable.bidNo }).from(bidsTable);
  let max = 1000;
  for (const r of rows) {
    const m = /^B-(\d+)$/.exec(r.bidNo);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `B-${String(max + 1)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Prefer manager-ish contacts with an email for outbound sends. */
async function propertyContactWithEmail(
  propertyId: string | null,
): Promise<{ name: string; email: string } | null> {
  if (!propertyId) return null;
  const rows = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.propertyId, propertyId));
  const withEmail = rows.filter((c) => c.email?.trim());
  if (!withEmail.length) return null;
  const managerish = withEmail.find((c) =>
    /manager|pm|property|regional|director/i.test(c.role ?? ""),
  );
  const pick = managerish ?? withEmail[0];
  return { name: pick.name, email: pick.email!.trim() };
}

async function leadTemplateContext(
  lead: Lead,
  settings: BusinessSettings,
): Promise<LeadTemplateContext> {
  let contactName = lead.contactName;
  let propertyName: string | null = null;
  if (lead.propertyId) {
    const [prop] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, lead.propertyId));
    propertyName = prop?.name ?? null;
    if (!contactName) {
      const contact = await propertyContactWithEmail(lead.propertyId);
      contactName = contact?.name ?? null;
    }
  }
  return {
    contactName,
    propertyName,
    summary: lead.summary,
    companyName: settings.companyName,
    tagline: settings.tagline,
    phone: settings.phone,
    email: settings.email,
    attn: settings.attn,
  };
}

export async function resolveLeadRecipient(
  lead: Lead,
): Promise<{ name: string | null; email: string } | null> {
  if (lead.contactEmail?.trim()) {
    return { name: lead.contactName ?? null, email: lead.contactEmail.trim() };
  }
  const contact = await propertyContactWithEmail(lead.propertyId);
  return contact ? { name: contact.name, email: contact.email } : null;
}

function brandedEmailHtml(
  settings: BusinessSettings,
  bodyHtml: string,
): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#17181c;border-top:4px solid #b98a2f;padding:18px 24px;border-radius:8px 8px 0 0">
    <div style="color:#fff;font-size:17px;font-weight:bold">${escapeHtml(settings.companyName)}</div>
    <div style="color:#b98a2f;font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-top:2px">${escapeHtml(settings.tagline)}</div>
  </div>
  <div style="background:#fdfcf8;border:1px solid #e5e2d9;border-top:none;padding:24px;border-radius:0 0 8px 8px">
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e5e2d9;margin:20px 0 12px"/>
    <div style="color:#8b8577;font-size:11px;line-height:1.5">${escapeHtml(settings.companyName)} · ${escapeHtml(settings.street)}, ${escapeHtml(settings.city)}${settings.phone ? ` · ${escapeHtml(settings.phone)}` : ""} · ${escapeHtml(settings.email)}</div>
  </div>
</div>`;
}

export async function sendCampaignStepEmail(
  lead: Lead,
  templateKey: string,
): Promise<{ sent: boolean; to: string | null; error?: string }> {
  const recipient = await resolveLeadRecipient(lead);
  if (!recipient) {
    return {
      sent: false,
      to: null,
      error:
        "No contact email on this lead or its property. Add a contact email first.",
    };
  }
  const settings = await getBusinessSettings();
  const ctx = await leadTemplateContext(lead, settings);
  if (recipient.name && !ctx.contactName) ctx.contactName = recipient.name;
  const tpl = renderTemplate(templateKey, ctx);
  if (!tpl) {
    return { sent: false, to: recipient.email, error: "Unknown template" };
  }
  const result = await sendEmail({
    to: recipient.email,
    subject: tpl.subject,
    html: brandedEmailHtml(settings, templateBodyToHtml(tpl.body)),
  });
  if (!result.ok) {
    return { sent: false, to: recipient.email, error: result.error };
  }
  await db
    .update(leadsTable)
    .set({ lastContactAt: new Date() })
    .where(eq(leadsTable.id, lead.id));
  return { sent: true, to: recipient.email };
}

async function activeCampaignsByLead(): Promise<Map<string, LeadCampaign>> {
  const rows = await db
    .select()
    .from(leadCampaignsTable)
    .orderBy(desc(leadCampaignsTable.startedAt));
  const map = new Map<string, LeadCampaign>();
  for (const c of rows) {
    if (!map.has(c.leadId)) map.set(c.leadId, c);
  }
  return map;
}

function leadJson(
  lead: Lead,
  names: Map<string, string>,
  campaign?: LeadCampaign | null,
): Record<string, unknown> {
  return {
    ...ser(lead),
    propertyName: lead.propertyId
      ? (names.get(lead.propertyId) ?? null)
      : null,
    campaignKind: campaign?.kind ?? null,
    campaignStatus: campaign?.status ?? null,
    campaignStepIndex: campaign?.stepIndex ?? null,
    campaignNextSendAt:
      campaign?.status === "active" && campaign.nextSendAt
        ? campaign.nextSendAt.toISOString()
        : null,
  };
}

async function loadLead(id: string): Promise<Lead | null> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  return lead ?? null;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

router.get("/leads", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(leadsTable)
    .orderBy(desc(leadsTable.createdAt));
  const names = await propertyNames();
  const campaigns = await activeCampaignsByLead();
  res.json(
    ListLeadsResponse.parse(
      rows.map((r) => leadJson(r, names, campaigns.get(r.id))),
    ),
  );
});

router.post("/leads", async (req, res): Promise<void> => {
  const body = CreateLeadBody.parse(req.body);
  const [row] = await db.insert(leadsTable).values(body).returning();
  const names = await propertyNames();
  res.status(201).json(CreateLeadResponse.parse(leadJson(row, names)));
});

router.patch("/leads/:id", async (req, res): Promise<void> => {
  const { id } = UpdateLeadParams.parse(req.params);
  const body = UpdateLeadBody.parse(req.body);
  const [row] = await db
    .update(leadsTable)
    .set(body)
    .where(eq(leadsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const names = await propertyNames();
  const campaigns = await activeCampaignsByLead();
  res.json(UpdateLeadResponse.parse(leadJson(row, names, campaigns.get(id))));
});

router.get("/leads/:id/templates", async (req, res): Promise<void> => {
  const { id } = ListLeadEmailTemplatesParams.parse(req.params);
  const lead = await loadLead(id);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const settings = await getBusinessSettings();
  const ctx = await leadTemplateContext(lead, settings);
  res.json(ListLeadEmailTemplatesResponse.parse(renderTemplates(ctx)));
});

router.post("/leads/:id/email", async (req, res): Promise<void> => {
  const { id } = SendLeadEmailParams.parse(req.params);
  const body = SendLeadEmailBody.parse(req.body);
  const lead = await loadLead(id);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const effectiveLead = body.to?.trim()
    ? { ...lead, contactEmail: body.to.trim() }
    : lead;
  const result = await sendCampaignStepEmail(effectiveLead, body.templateKey);
  // Mark the lead as contacted when the send succeeded.
  if (result.sent && lead.status === "new") {
    await db
      .update(leadsTable)
      .set({ status: "contacted" })
      .where(eq(leadsTable.id, id));
  }
  res.json(SendLeadEmailResponse.parse(result));
});

router.get("/lead-campaigns", async (_req, res): Promise<void> => {
  res.json(
    ListLeadCampaignDefsResponse.parse(
      CAMPAIGNS.map((c) => ({
        kind: c.kind,
        name: c.name,
        description: c.description,
        steps: c.steps.map((s) => ({
          dayOffset: s.dayOffset,
          templateKey: s.templateKey,
          templateName: templateName(s.templateKey),
        })),
      })),
    ),
  );
});

router.post("/leads/:id/campaign", async (req, res): Promise<void> => {
  const { id } = StartLeadCampaignParams.parse(req.params);
  const body = StartLeadCampaignBody.parse(req.body);
  const lead = await loadLead(id);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const def = campaignByKind(body.kind);
  if (!def) {
    res.status(400).json({ error: "Unknown campaign" });
    return;
  }
  // Check the live DB setting; refuse up front so starting a campaign doesn't
  // immediately send step 0 when the feature is toggled off.
  const pipelinePolicy = await getAutoEmails();
  if (!pipelinePolicy.leadNurtureDrip) {
    res.status(400).json({
      error:
        "Automatic lead nurture emails are currently turned off. Enable them in Settings → Automatic emails, or use a one-off email from the templates instead.",
    });
    return;
  }
  const recipient = await resolveLeadRecipient(lead);
  if (!recipient) {
    res.status(400).json({
      error:
        "No contact email on this lead or its property. Add a contact email first.",
    });
    return;
  }

  const now = new Date();
  // Persist campaign state BEFORE sending so an email can never go out
  // without a matching campaign row. Step 0 is scheduled a few minutes out
  // so the background scheduler won't race the synchronous send below; if
  // the process dies mid-send, the scheduler retries step 0 then.
  const campaignId = await db.transaction(async (tx) => {
    // Stop any previously-active campaign for this lead.
    await tx
      .update(leadCampaignsTable)
      .set({ status: "stopped", nextSendAt: null })
      .where(eq(leadCampaignsTable.leadId, id));
    const [created] = await tx
      .insert(leadCampaignsTable)
      .values({
        leadId: id,
        kind: def.kind,
        status: "active",
        stepIndex: 0,
        nextSendAt: new Date(now.getTime() + 5 * 60 * 1000),
        startedAt: now,
      })
      .returning();
    return created.id;
  });

  const first = await sendCampaignStepEmail(lead, def.steps[0].templateKey);
  if (!first.sent) {
    await db
      .update(leadCampaignsTable)
      .set({ status: "stopped", nextSendAt: null })
      .where(eq(leadCampaignsTable.id, campaignId));
    res.status(502).json({ error: first.error ?? "Email failed to send" });
    return;
  }

  const nextStep = def.steps[1];
  const nextSendAt = nextStep
    ? new Date(now.getTime() + nextStep.dayOffset * 24 * 60 * 60 * 1000)
    : null;

  await db.transaction(async (tx) => {
    await tx
      .update(leadCampaignsTable)
      .set({
        stepIndex: 1,
        status: nextStep ? "active" : "completed",
        nextSendAt,
        completedAt: nextStep ? null : new Date(),
      })
      .where(
        and(
          eq(leadCampaignsTable.id, campaignId),
          eq(leadCampaignsTable.stepIndex, 0),
          eq(leadCampaignsTable.status, "active"),
        ),
      );
    if (lead.status === "new") {
      await tx
        .update(leadsTable)
        .set({ status: "contacted" })
        .where(eq(leadsTable.id, id));
    }
  });

  const [updated] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  const names = await propertyNames();
  const campaigns = await activeCampaignsByLead();
  res.json(
    StartLeadCampaignResponse.parse(leadJson(updated, names, campaigns.get(id))),
  );
});

router.post("/leads/:id/campaign/stop", async (req, res): Promise<void> => {
  const { id } = StopLeadCampaignParams.parse(req.params);
  const lead = await loadLead(id);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  await db
    .update(leadCampaignsTable)
    .set({ status: "stopped", nextSendAt: null })
    .where(eq(leadCampaignsTable.leadId, id));
  const names = await propertyNames();
  const campaigns = await activeCampaignsByLead();
  res.json(
    StopLeadCampaignResponse.parse(leadJson(lead, names, campaigns.get(id))),
  );
});

// ---------------------------------------------------------------------------
// Bids
// ---------------------------------------------------------------------------

interface BidLineItemInputRow {
  service: string;
  description?: string;
  qty: number;
  unitPrice: number;
}

async function replaceLineItems(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  bidId: string,
  items: BidLineItemInputRow[],
): Promise<number> {
  await tx.delete(bidLineItemsTable).where(eq(bidLineItemsTable.bidId, bidId));
  let total = 0;
  if (items.length) {
    await tx.insert(bidLineItemsTable).values(
      items.map((it, idx) => {
        const amount = Math.round(it.qty * it.unitPrice * 100) / 100;
        total += amount;
        return {
          bidId,
          service: it.service,
          description: it.description ?? null,
          qty: it.qty,
          unitPrice: it.unitPrice,
          amount,
          sortOrder: idx,
        };
      }),
    );
  }
  return Math.round(total * 100) / 100;
}

async function bidDetailJson(bid: Bid): Promise<Record<string, unknown>> {
  const items = await db
    .select()
    .from(bidLineItemsTable)
    .where(eq(bidLineItemsTable.bidId, bid.id))
    .orderBy(asc(bidLineItemsTable.sortOrder));
  let propertyName: string | null = null;
  let propertyAddress: string | null = null;
  let propertyCity: string | null = null;
  let contactName: string | null = null;
  let contactEmail: string | null = null;
  if (bid.propertyId) {
    const [prop] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, bid.propertyId));
    if (prop) {
      propertyName = prop.name;
      propertyAddress = prop.address ?? null;
      propertyCity = prop.city ?? null;
    }
    const contact = await propertyContactWithEmail(bid.propertyId);
    if (contact) {
      contactName = contact.name;
      contactEmail = contact.email;
    }
  }
  return {
    ...ser(bid),
    propertyName,
    propertyAddress,
    propertyCity,
    contactName,
    contactEmail,
    lineItems: items.map((it) => ({
      id: it.id,
      service: it.service,
      description: it.description,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
      sortOrder: it.sortOrder,
    })),
  };
}

async function bidPdfBytes(bid: Bid): Promise<Uint8Array> {
  const detail = await bidDetailJson(bid);
  const settings = await getBusinessSettings();
  return generateBidPdf({
    bidNo: bid.bidNo,
    company: {
      name: settings.companyName,
      tagline: settings.tagline,
      street: settings.street,
      city: settings.city,
      attn: settings.attn,
      phone: settings.phone || null,
      email: settings.email,
    },
    paymentInstructions: settings.paymentInstructions,
    preparedForName: (detail.contactName as string | null) ?? null,
    propertyName: (detail.propertyName as string | null) ?? null,
    propertyAddress:
      (detail.propertyAddress as string | null) ??
      (detail.propertyCity as string | null),
    unitNo: bid.unitNo,
    scope: bid.scope,
    welcomeMessage: bid.welcomeMessage,
    sentAt: bid.sentAt ? bid.sentAt.toISOString() : null,
    amount: bid.amount,
    lineItems: (
      detail.lineItems as {
        service: string;
        description: string | null;
        qty: number;
        unitPrice: number;
        amount: number;
      }[]
    ).map((it) => ({
      service: it.service,
      description: it.description,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
    })),
  });
}

router.get("/bids", async (req, res): Promise<void> => {
  const { status } = ListBidsQueryParams.parse(req.query);
  const rows = await db
    .select()
    .from(bidsTable)
    .orderBy(desc(bidsTable.createdAt));
  const names = await propertyNames();
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  res.json(
    ListBidsResponse.parse(
      filtered.map((r) => ({
        ...ser(r),
        propertyName: r.propertyId ? (names.get(r.propertyId) ?? null) : null,
      })),
    ),
  );
});

router.post("/bids", async (req, res): Promise<void> => {
  const body = CreateBidBody.parse(req.body);
  const { lineItems, status, ...rest } = body;
  const effectiveStatus = status ?? "sent";
  // bid_no is DB-unique; concurrent creates retry with a fresh number.
  let row: typeof bidsTable.$inferSelect | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const bidNo = await nextBidNo();
    try {
      row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(bidsTable)
          .values({
            ...rest,
            bidNo,
            status: effectiveStatus,
            sentAt: effectiveStatus === "draft" ? null : new Date(),
          })
          .returning();
        if (lineItems?.length) {
          const total = await replaceLineItems(tx, created.id, lineItems);
          if (total > 0 && Math.abs(total - created.amount) > 0.005) {
            const [updated] = await tx
              .update(bidsTable)
              .set({ amount: total })
              .where(eq(bidsTable.id, created.id))
              .returning();
            return updated;
          }
        }
        return created;
      });
      break;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue;
      throw err;
    }
  }
  if (!row) {
    res.status(500).json({ error: "Couldn't allocate a bid number — try again" });
    return;
  }
  res.status(201).json(CreateBidResponse.parse(await bidDetailJson(row)));
});

// AI market-rate check: suggested bid price for a service. The model has no
// live web access — it's a knowledge-based estimate, and the response says so.
router.post("/bids/ai-pricing", async (req, res): Promise<void> => {
  const parsed = GetBidAiPricingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { service, details, city, qty } = parsed.data;
  try {
    const out = await completeJson<{
      suggested: number;
      marketLow: number;
      marketHigh: number;
      wholesaleNotes: string | null;
      rationale: string;
    }>(
      "You are a pricing analyst for a property-maintenance contractor bidding work to apartment property managers in the US.",
      [
        `Service to price: ${service}`,
        details ? `Scope details: ${details}` : null,
        city ? `Market: ${city}` : null,
        typeof qty === "number" && qty > 1 ? `Quantity: ${qty} (price PER UNIT)` : null,
        "Estimate the typical local market price range a contractor charges (marketLow, marketHigh, USD per unit), a suggested competitive bid price (suggested — near the middle, slightly above median for quality work), and wholesaleNotes: 1-2 sentences on typical materials/wholesale costs a contractor should expect (name typical supplier categories, not specific stores' live prices).",
        "rationale: 2 short sentences on how you priced it. Be honest that these are typical-market estimates, not live quotes.",
        'Respond ONLY with JSON: {"suggested":number,"marketLow":number,"marketHigh":number,"wholesaleNotes":string,"rationale":string}',
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (
      typeof out?.suggested !== "number" ||
      typeof out?.marketLow !== "number" ||
      typeof out?.marketHigh !== "number"
    ) {
      res.status(502).json({ error: "AI pricing came back malformed — try again or price manually" });
      return;
    }
    res.json(
      GetBidAiPricingResponse.parse({
        suggested: Math.round(out.suggested * 100) / 100,
        marketLow: Math.round(out.marketLow * 100) / 100,
        marketHigh: Math.round(out.marketHigh * 100) / 100,
        wholesaleNotes: typeof out.wholesaleNotes === "string" ? out.wholesaleNotes : null,
        rationale: typeof out.rationale === "string" ? out.rationale : "Typical market estimate.",
      }),
    );
  } catch (err) {
    logger.error({ err }, "bid ai pricing failed");
    res.status(502).json({ error: "AI pricing is unavailable right now — type a price manually" });
  }
});

router.get("/bids/:id", async (req, res): Promise<void> => {
  const { id } = GetBidParams.parse(req.params);
  const [bid] = await db.select().from(bidsTable).where(eq(bidsTable.id, id));
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  res.json(GetBidResponse.parse(await bidDetailJson(bid)));
});

router.patch("/bids/:id", async (req, res): Promise<void> => {
  const { id } = UpdateBidParams.parse(req.params);
  const body = UpdateBidBody.parse(req.body);
  const { lineItems, ...rest } = body;
  const [existing] = await db
    .select()
    .from(bidsTable)
    .where(eq(bidsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { ...rest };
    if (rest.status === "won" || rest.status === "lost") {
      patch.decidedAt = new Date();
    }
    if (rest.status === "sent" && !existing.sentAt) {
      patch.sentAt = new Date();
    }
    if (lineItems) {
      const total = await replaceLineItems(tx, id, lineItems);
      if (rest.amount === undefined) {
        patch.amount = total;
      }
    }
    const [updated] = await tx
      .update(bidsTable)
      .set(patch)
      .where(eq(bidsTable.id, id))
      .returning();
    return updated;
  });
  res.json(UpdateBidResponse.parse(await bidDetailJson(row)));
});

router.delete("/leads/:id", async (req, res): Promise<void> => {
  const { id } = DeleteLeadParams.parse(req.params);
  const [existing] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(leadCampaignsTable)
      .where(eq(leadCampaignsTable.leadId, id));
    await tx.delete(leadsTable).where(eq(leadsTable.id, id));
  });
  res.status(204).end();
});

router.delete("/bids/:id", async (req, res): Promise<void> => {
  const { id } = DeleteBidParams.parse(req.params);
  await db.transaction(async (tx) => {
    await tx.delete(bidLineItemsTable).where(eq(bidLineItemsTable.bidId, id));
    await tx.delete(bidsTable).where(eq(bidsTable.id, id));
  });
  res.status(204).end();
});

router.get("/bids/:id/pdf", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [bid] = await db.select().from(bidsTable).where(eq(bidsTable.id, id));
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  const bytes = await bidPdfBytes(bid);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${bid.bidNo}-proposal.pdf"`,
  );
  res.end(Buffer.from(bytes));
});

router.post("/bids/:id/send", async (req, res): Promise<void> => {
  const { id } = SendBidParams.parse(req.params);
  const body = SendBidBody.parse(req.body ?? {});
  const [bid] = await db.select().from(bidsTable).where(eq(bidsTable.id, id));
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  const detail = await bidDetailJson(bid);
  const to =
    body.to?.trim() || ((detail.contactEmail as string | null) ?? null);
  if (!to) {
    res.json(
      SendBidResponse.parse({
        sent: false,
        to: null,
        error:
          "No recipient email. Add a property contact with an email or enter one manually.",
      }),
    );
    return;
  }
  const settings = await getBusinessSettings();
  const pdf = await bidPdfBytes(bid);
  const propertyName = (detail.propertyName as string | null) ?? "your property";
  const contactName = (detail.contactName as string | null) ?? null;
  const custom = body.message?.trim();
  const intro = custom
    ? escapeHtml(custom).replace(/\n/g, "<br/>")
    : `Please find attached our proposal <strong>${escapeHtml(bid.bidNo)}</strong> for ${escapeHtml(propertyName)}${bid.unitNo ? ` (Unit ${escapeHtml(bid.unitNo)})` : ""}, totaling <strong>$${bid.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>. We're happy to walk through the breakdown or adjust scope any time.`;
  const bodyHtml = `<p style="margin:0 0 14px;color:#2c2d31;font-size:14px;line-height:1.6">${contactName ? `Hi ${escapeHtml(contactName.split(" ")[0])},` : "Hello,"}</p>
<p style="margin:0 0 14px;color:#2c2d31;font-size:14px;line-height:1.6">${intro}</p>
<p style="margin:0 0 14px;color:#2c2d31;font-size:14px;line-height:1.6">Best regards,<br/>${escapeHtml(settings.attn.replace(/^ATTN:\s*/i, ""))}<br/>${escapeHtml(settings.companyName)}</p>`;
  const result = await sendEmail({
    to,
    subject: `Proposal ${bid.bidNo} — ${propertyName} — ${settings.companyName}`,
    html: brandedEmailHtml(settings, bodyHtml),
    attachments: [
      {
        filename: `${bid.bidNo}-proposal.pdf`,
        content: Buffer.from(pdf).toString("base64"),
      },
    ],
  });
  if (!result.ok) {
    res.json(
      SendBidResponse.parse({ sent: false, to, error: result.error }),
    );
    return;
  }
  await db
    .update(bidsTable)
    .set({
      status: bid.status === "draft" ? "sent" : bid.status,
      sentAt: bid.sentAt ?? new Date(),
      lastNudgeAt: bid.sentAt ? new Date() : bid.lastNudgeAt,
    })
    .where(eq(bidsTable.id, id));
  res.json(SendBidResponse.parse({ sent: true, to }));
});

router.post("/bids/:id/nudge", async (req, res): Promise<void> => {
  const { id } = NudgeBidParams.parse(req.params);
  const [bid] = await db.select().from(bidsTable).where(eq(bidsTable.id, id));
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  const detail = await bidDetailJson(bid);
  const to = (detail.contactEmail as string | null) ?? null;
  const names = await propertyNames();
  const propName =
    (detail.propertyName as string | null) ?? "your property";
  if (!to) {
    res.status(400).json({
      error:
        "No contact email on this bid's property. Add a property contact with an email first.",
    });
    return;
  }
  const settings = await getBusinessSettings();
  const contactName = (detail.contactName as string | null) ?? null;
  const bodyHtml = `<p style="margin:0 0 14px;color:#2c2d31;font-size:14px;line-height:1.6">${contactName ? `Hi ${escapeHtml(contactName.split(" ")[0])},` : "Hello,"}</p>
<p style="margin:0 0 14px;color:#2c2d31;font-size:14px;line-height:1.6">Just checking in on our proposal <strong>${escapeHtml(bid.bidNo)}</strong>${bid.scope ? ` (${escapeHtml(bid.scope)})` : ""} for ${escapeHtml(propName)} — $${bid.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}. Happy to answer any questions or adjust scope.</p>
<p style="margin:0 0 14px;color:#2c2d31;font-size:14px;line-height:1.6">Best regards,<br/>${escapeHtml(settings.attn.replace(/^ATTN:\s*/i, ""))}<br/>${escapeHtml(settings.companyName)}</p>`;
  const emailResult = await sendEmail({
    to,
    subject: `Following up on proposal ${bid.bidNo} for ${propName}`,
    html: brandedEmailHtml(settings, bodyHtml),
  });
  if (!emailResult.ok) {
    res.status(502).json({ error: emailResult.error ?? "Email failed to send" });
    return;
  }
  const [row] = await db
    .update(bidsTable)
    .set({ lastNudgeAt: new Date() })
    .where(eq(bidsTable.id, id))
    .returning();
  res.json(
    NudgeBidResponse.parse({
      ...ser(row),
      propertyName: row.propertyId ? (names.get(row.propertyId) ?? null) : null,
    }),
  );
});

export default router;
