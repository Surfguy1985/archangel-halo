import { Router, type IRouter } from "express";
import { eq as eqId } from "drizzle-orm";
import {
  db,
  voiceLogsTable,
  propertiesTable,
  jobsTable,
  leadsTable,
  expensesTable,
  activitiesTable,
  crewsTable,
  schedulesTable,
  bidsTable,
  invoicesTable,
  invoiceLineItemsTable,
  inventoryItemsTable,
  vendorsTable,
  priceItemsTable,
  catalogItemsTable,
} from "@workspace/db";
import {
  ParseVoiceBody,
  ParseVoiceResponse,
  ConfirmVoiceBody,
  ConfirmVoiceResponse,
} from "@workspace/api-zod";
import { completeJson } from "../lib/ai";
import { applySopToInvoice } from "./sop";
import { localToday } from "../lib/localDate";
import { recomputeJobFinancials } from "../lib/jobFinance";
import {
  postJournal,
  syncExpenseLedger,
  syncInvoiceLedger,
  syncJobLaborLedger,
  CHART_OF_ACCOUNTS,
} from "../lib/ledger";

const router: IRouter = Router();

type Action = {
  tool: string;
  title: string;
  summary: string;
  confidence: number;
  needsReview?: boolean;
  fields: Record<string, unknown>;
};

const TOOLS = `Available tools and their fields:
- create_property { name, pmcName? (property management company), city?, units? (number), accessNotes? }
- create_crew { name, trade?, phone?, isLeader? (boolean) }
- create_job { description, propertyName, unitNo?, category? }
- schedule_job { jobNo, scheduledOn (date as YYYY-MM-DD), crewName?, windowStart? }
- log_expense { vendor, category, amount (number), propertyName?, jobNo? }
- create_lead { summary, source?, propertyName? }
- create_bid { amount (number), propertyName?, scope?, unitNo? }
- add_note { entityType (property|job), entityRef (name or job number), body }
- complete_job { jobNo }
- create_invoice { amount (number), propertyName, jobNo?, description? (what the work was), poNumber? }
- create_vendor { name, trade?, phone?, email? }
- add_inventory_item { name, qty? (number), reorderAt? (number, restock threshold), unitCost? (number), preferredVendor? }
- adjust_inventory { itemName, delta (number — positive when stock was bought/received, negative when materials were used) }
- set_price { service, rate (number), propertyName? (omit to update the master price list), unit? (each, sqft, hour...), detail? } — add or update a service price on a property's price list or the master price book
- mark_invoice_paid { invoiceNo (like INV-5001), or propertyName + amount when the number is unknown }
- log_bill { vendor, amount (number), dueDate? (YYYY-MM-DD), category?, propertyName?, jobNo? } — an unpaid vendor bill (bought on account / net terms / "I owe them")
- pay_bill { vendor, amount? (number) } — mark an open vendor bill as paid
- create_journal_entry { memo, amount (number), debitAccount (account code or name), creditAccount (account code or name), date? (YYYY-MM-DD) } — for bookkeeping adjustments like owner draws, deposits, loan payments. Accounts: 1000 Cash, 1100 Accounts Receivable, 2000 Accounts Payable, 3000 Owner's Equity, 4000 Service Revenue, 5000 Crew Labor, 5100 Materials & Supplies, 5300 Equipment & Tools, 5400 Vehicle & Fuel, 5500 Insurance & Licenses, 5900 Other Expenses`;

router.post("/voice/parse", async (req, res): Promise<void> => {
  const { transcript } = ParseVoiceBody.parse(req.body);
  const props = await db.select().from(propertiesTable);
  const jobs = await db.select().from(jobsTable);
  const crews = await db.select().from(crewsTable);
  const inventory = await db.select().from(inventoryItemsTable);
  const vendors = await db.select().from(vendorsTable);
  const today = localToday();

  let actions: Action[] = [];
  try {
    const result = await completeJson<{ actions: Action[] }>(
      `You are HALO's voice intake. Convert a contractor's spoken note into structured actions. ${TOOLS}
Today's date is ${today}. Convert relative dates like "tomorrow" or "next Monday" into an absolute YYYY-MM-DD date.
Known properties: ${props.map((p) => p.name).join(", ") || "none"}.
Known jobs: ${jobs.map((j) => j.jobNo).join(", ") || "none"}.
Known crews: ${crews.map((c) => c.name).join(", ") || "none"}.
Known inventory items: ${inventory.map((i) => i.name).join(", ") || "none"}.
Known vendors: ${vendors.map((v) => v.name).join(", ") || "none"}.
Use create_property when the user describes a new property/building not in the known list. Use create_crew when they mention adding a new crew member or subcontractor. Use schedule_job when they want to set a date for existing work. Use create_bid when they quoted or want to quote a price/proposal for work — the bid is saved as a draft for review, never sent automatically.
Use set_price when they state, set, or change what they charge for a service ("make readys at Willow Creek are now 275", "paint is 3 dollars a square foot") — one set_price action per service mentioned; include propertyName when a property is named, omit it for their general/standard pricing. If the service matches one already on that list it will be updated, otherwise added.
Use mark_invoice_paid when they say a check/payment came in for an invoice. Use log_bill (not log_expense) when they OWE a vendor and have not paid yet; use pay_bill when they pay a bill they logged earlier. Use create_journal_entry only for pure bookkeeping moves (owner put money in, owner draw, moving money between accounts) — regular purchases are log_expense, not journal entries. Use create_invoice when work is done and they want to bill for it — the invoice is saved as a draft for review, never sent automatically. Use create_vendor for a new supplier or subcontracting company. Use adjust_inventory when they mention using or buying materials that match a known inventory item (negative delta for materials used, positive for stock received); use add_inventory_item for a material they want tracked that is not in the known list. A purchase of materials can be both a log_expense and an inventory adjustment when it matches a tracked item.
For each action include: tool, title (short), summary (one sentence of what will happen), confidence (0-1), needsReview (true if amounts/names are uncertain), and fields. Return {"actions": [...]}. If nothing actionable, return {"actions": []}.`,
      transcript,
      2048,
    );
    actions = Array.isArray(result.actions) ? result.actions : [];
  } catch {
    actions = [];
  }

  const [log] = await db
    .insert(voiceLogsTable)
    .values({ transcript, actions })
    .returning();

  res.json(
    ParseVoiceResponse.parse({
      transcript,
      voiceLogId: log.id,
      actions: actions.map((a) => ({
        tool: a.tool,
        title: a.title,
        summary: a.summary,
        confidence: a.confidence ?? 0.5,
        needsReview: a.needsReview ?? false,
        fields: a.fields ?? {},
      })),
    }),
  );
});

router.post("/voice/confirm", async (req, res): Promise<void> => {
  const body = ConfirmVoiceBody.parse(req.body);
  const props = await db.select().from(propertiesTable);
  const jobs = await db.select().from(jobsTable);
  const propByName = new Map(
    props.map((p) => [p.name.toLowerCase(), p]),
  );
  const jobByNo = new Map(jobs.map((j) => [j.jobNo.toLowerCase(), j]));
  const crews = await db.select().from(crewsTable);
  const crewByName = new Map(crews.map((c) => [c.name.toLowerCase(), c]));
  const inventory = await db.select().from(inventoryItemsTable);
  const itemByName = new Map(inventory.map((i) => [i.name.toLowerCase(), i]));
  const messages: string[] = [];
  let applied = 0;

  for (const a of body.actions) {
    const f = a.fields as Record<string, unknown>;
    try {
      if (a.tool === "log_expense") {
        const prop = f.propertyName
          ? propByName.get(String(f.propertyName).toLowerCase())
          : undefined;
        const job = f.jobNo
          ? jobByNo.get(String(f.jobNo).toLowerCase())
          : undefined;
        const [expRow] = await db
          .insert(expensesTable)
          .values({
            vendor: f.vendor ? String(f.vendor) : null,
            category: f.category ? String(f.category) : null,
            amount: Number(f.amount ?? 0),
            propertyId: prop?.id ?? null,
            jobId: job?.id ?? null,
            source: "voice",
          })
          .returning();
        if (expRow.jobId) await recomputeJobFinancials(expRow.jobId);
        await syncExpenseLedger(expRow.id);
        applied++;
        messages.push(`Logged expense $${Number(f.amount ?? 0)}`);
      } else if (a.tool === "create_lead") {
        const prop = f.propertyName
          ? propByName.get(String(f.propertyName).toLowerCase())
          : undefined;
        await db.insert(leadsTable).values({
          summary: String(f.summary ?? a.summary),
          source: f.source ? String(f.source) : "voice",
          propertyId: prop?.id ?? null,
        });
        applied++;
        messages.push("Created lead");
      } else if (a.tool === "create_property") {
        const name = String(f.name ?? "").trim();
        if (!name) {
          messages.push("Skipped property — no name given");
          continue;
        }
        const units = Number(f.units);
        const [newProp] = await db
          .insert(propertiesTable)
          .values({
            name,
            pmcName: f.pmcName ? String(f.pmcName) : null,
            city: f.city ? String(f.city) : null,
            units: Number.isFinite(units) ? Math.round(units) : null,
            accessNotes: f.accessNotes ? String(f.accessNotes) : null,
          })
          .returning();
        // Make the new property visible to later actions in the same batch
        // (e.g. "new building on Oak St, and unit 3 there needs paint").
        propByName.set(name.toLowerCase(), newProp);
        applied++;
        messages.push(`Added property ${name}`);
      } else if (a.tool === "create_crew") {
        const name = String(f.name ?? "").trim();
        if (!name) {
          messages.push("Skipped crew — no name given");
          continue;
        }
        const [newCrew] = await db
          .insert(crewsTable)
          .values({
            name,
            trade: f.trade ? String(f.trade) : null,
            phone: f.phone ? String(f.phone) : null,
            isLeader: f.isLeader === true || String(f.isLeader).toLowerCase() === "true",
          })
          .returning();
        // Make the new crew assignable by later actions in the same batch.
        crewByName.set(name.toLowerCase(), newCrew);
        applied++;
        messages.push(`Added crew ${name}`);
      } else if (a.tool === "schedule_job") {
        const job = f.jobNo
          ? jobByNo.get(String(f.jobNo).toLowerCase())
          : undefined;
        if (!job) {
          messages.push(`Skipped schedule — unknown job "${f.jobNo}"`);
          continue;
        }
        const scheduledOn = String(f.scheduledOn ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledOn)) {
          messages.push(`Skipped schedule — no valid date for ${job.jobNo}`);
          continue;
        }
        const crew = f.crewName
          ? crewByName.get(String(f.crewName).toLowerCase())
          : undefined;
        await db.insert(schedulesTable).values({
          jobId: job.id,
          scheduledOn,
          windowStart: f.windowStart ? String(f.windowStart) : null,
          crewLeaderId: crew?.id ?? null,
        });
        await db
          .update(jobsTable)
          .set({ scheduledOn, crewLeaderId: crew?.id ?? job.crewLeaderId })
          .where(eqId(jobsTable.id, job.id));
        applied++;
        messages.push(`Scheduled ${job.jobNo} for ${scheduledOn}`);
      } else if (a.tool === "create_job") {
        const prop = f.propertyName
          ? propByName.get(String(f.propertyName).toLowerCase())
          : undefined;
        if (!prop) {
          messages.push(`Skipped job — unknown property "${f.propertyName}"`);
          continue;
        }
        const count = (await db.select().from(jobsTable)).length;
        await db.insert(jobsTable).values({
          jobNo: `J-${2000 + count + 1}`,
          propertyId: prop.id,
          description: String(f.description ?? a.summary),
          unitNo: f.unitNo ? String(f.unitNo) : null,
          category: f.category ? String(f.category) : null,
        });
        applied++;
        messages.push("Created job");
      } else if (a.tool === "complete_job") {
        const job = f.jobNo
          ? jobByNo.get(String(f.jobNo).toLowerCase())
          : undefined;
        if (!job) {
          messages.push(`Skipped — unknown job "${f.jobNo}"`);
          continue;
        }
        await db
          .update(jobsTable)
          .set({ status: "complete", completedAt: new Date() })
          .where(eqId(jobsTable.id, job.id));
        await recomputeJobFinancials(job.id);
        await syncJobLaborLedger(job.id);
        applied++;
        messages.push(`Completed ${job.jobNo}`);
      } else if (a.tool === "create_bid") {
        const amount = Number(f.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          messages.push("Skipped bid — no valid amount given");
          continue;
        }
        const prop = f.propertyName
          ? propByName.get(String(f.propertyName).toLowerCase())
          : undefined;
        // Max-based bid numbering (matches pipeline route) so deletions
        // never cause duplicate bid numbers on shared proposals.
        const bidRows = await db.select({ bidNo: bidsTable.bidNo }).from(bidsTable);
        let maxNo = 1000;
        for (const r of bidRows) {
          const m = /^B-(\d+)$/.exec(r.bidNo);
          if (m) maxNo = Math.max(maxNo, Number(m[1]));
        }
        const bidNo = `B-${String(maxNo + 1)}`;
        await db.insert(bidsTable).values({
          bidNo,
          propertyId: prop?.id ?? null,
          unitNo: f.unitNo ? String(f.unitNo) : null,
          scope: f.scope ? String(f.scope) : null,
          amount,
          status: "draft",
          sentAt: null,
        });
        applied++;
        messages.push(`Drafted bid ${bidNo} for $${amount.toLocaleString()}`);
      } else if (a.tool === "add_note") {
        const ref = String(f.entityRef ?? "");
        const prop = propByName.get(ref.toLowerCase());
        const job = jobByNo.get(ref.toLowerCase());
        const entity = prop
          ? { type: "property", id: prop.id }
          : job
            ? { type: "job", id: job.id }
            : null;
        if (!entity) {
          messages.push(`Skipped note — unknown "${ref}"`);
          continue;
        }
        await db.insert(activitiesTable).values({
          entityType: entity.type,
          entityId: entity.id,
          kind: "note",
          body: String(f.body ?? a.summary),
        });
        applied++;
        messages.push("Added note");
      } else if (a.tool === "create_invoice") {
        const amount = Number(f.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          messages.push("Skipped invoice — no valid amount given");
          continue;
        }
        const prop = f.propertyName
          ? propByName.get(String(f.propertyName).toLowerCase())
          : undefined;
        if (!prop) {
          messages.push(`Skipped invoice — unknown property "${f.propertyName ?? ""}"`);
          continue;
        }
        const job = f.jobNo
          ? jobByNo.get(String(f.jobNo).toLowerCase())
          : undefined;
        // Max-based numbering so deletions never cause duplicate invoice numbers.
        const invRows = await db
          .select({ invoiceNo: invoicesTable.invoiceNo })
          .from(invoicesTable);
        let maxNo = 5000;
        for (const r of invRows) {
          const m = /^INV-(\d+)$/.exec(r.invoiceNo);
          if (m) maxNo = Math.max(maxNo, Number(m[1]));
        }
        let invoiceNo = `INV-${String(maxNo + 1)}`;
        const description = f.description ? String(f.description) : null;
        const issuedOn = localToday();
        let dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        let terms = "Net 30";
        let sopNotes: string | null = null;
        let sopBillToName: string | null = null;
        let sopPropertyAddress: string | null = null;
        let sopPaymentInstructions: string | null = null;
        let sopTaxAmount: number | null = null;
        // SOP rule enforcement — voice-created invoices follow it too.
        const sopApplied = await applySopToInvoice(prop.id, {
          issuedOn,
          poNumber: f.poNumber ? String(f.poNumber) : null,
          terms: null,
          dueProvided: false,
          notes: description,
          taxAmount: null,
          total: amount,
        });
        if (sopApplied && !sopApplied.ok) {
          messages.push(`Skipped invoice for ${prop.name} — ${sopApplied.error}`);
          continue;
        }
        if (sopApplied?.ok) {
          if (sopApplied.invoiceNo) invoiceNo = sopApplied.invoiceNo;
          if (sopApplied.dueAt) dueAt = sopApplied.dueAt;
          if (sopApplied.terms) terms = sopApplied.terms;
          sopNotes = sopApplied.notes;
          sopBillToName = sopApplied.billToName;
          sopPropertyAddress = sopApplied.propertyAddress;
          sopPaymentInstructions = sopApplied.paymentInstructions;
          sopTaxAmount = sopApplied.taxAmount;
        }
        await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(invoicesTable)
            .values({
              invoiceNo,
              propertyId: prop.id,
              jobId: job?.id ?? null,
              amount,
              status: "draft",
              terms,
              issuedOn,
              dueAt,
              poNumber: f.poNumber ? String(f.poNumber) : null,
              // SOP bill-to wins; otherwise same defaults as the main route.
              billToName: sopBillToName ?? prop.pmcName ?? prop.name,
              propertyAddress:
                sopPropertyAddress ??
                ([prop.name, prop.city].filter(Boolean).join(", ") || null),
              paymentInstructions: sopPaymentInstructions,
              taxAmount: sopTaxAmount ?? undefined,
              notes: description ?? sopNotes,
            })
            .returning();
          await tx.insert(invoiceLineItemsTable).values({
            invoiceId: created.id,
            typeOfWork: description ?? "Work performed",
            qty: 1,
            unitPrice: amount,
            amount,
            sortOrder: 0,
          });
        });
        applied++;
        messages.push(`Drafted invoice ${invoiceNo} for $${amount.toLocaleString()}`);
      } else if (a.tool === "create_vendor") {
        const name = String(f.name ?? "").trim();
        if (!name) {
          messages.push("Skipped vendor — no name given");
          continue;
        }
        await db.insert(vendorsTable).values({
          name,
          trade: f.trade ? String(f.trade) : null,
          phone: f.phone ? String(f.phone) : null,
          email: f.email ? String(f.email) : null,
        });
        applied++;
        messages.push(`Added vendor ${name}`);
      } else if (a.tool === "add_inventory_item") {
        const name = String(f.name ?? "").trim();
        if (!name) {
          messages.push("Skipped inventory item — no name given");
          continue;
        }
        if (itemByName.has(name.toLowerCase())) {
          messages.push(`Skipped — inventory item "${name}" already exists`);
          continue;
        }
        const qty = Number(f.qty);
        const reorderAt = Number(f.reorderAt);
        const unitCost = Number(f.unitCost);
        if (
          (f.qty != null && (!Number.isFinite(qty) || qty < 0)) ||
          (f.reorderAt != null && (!Number.isFinite(reorderAt) || reorderAt < 0)) ||
          (f.unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0))
        ) {
          messages.push(`Skipped inventory item ${name} — invalid quantity or cost`);
          continue;
        }
        const [newItem] = await db
          .insert(inventoryItemsTable)
          .values({
            name,
            qty: Number.isFinite(qty) ? qty : 0,
            reorderAt: Number.isFinite(reorderAt) ? reorderAt : 0,
            unitCost: Number.isFinite(unitCost) ? unitCost : null,
            preferredVendor: f.preferredVendor ? String(f.preferredVendor) : null,
          })
          .returning();
        // Make the new item adjustable by later actions in the same batch.
        itemByName.set(name.toLowerCase(), newItem);
        applied++;
        messages.push(`Added inventory item ${name}`);
      } else if (a.tool === "adjust_inventory") {
        const ref = String(f.itemName ?? "").trim();
        const item = itemByName.get(ref.toLowerCase());
        if (!item) {
          messages.push(`Skipped inventory adjustment — unknown item "${ref}"`);
          continue;
        }
        const delta = Number(f.delta);
        if (!Number.isFinite(delta) || delta === 0) {
          messages.push(`Skipped inventory adjustment — no valid quantity for ${item.name}`);
          continue;
        }
        // Match /inventory/:id/adjust semantics — allow going below zero so
        // shortages surface instead of being silently clamped away.
        const newQty = item.qty + delta;
        const [updated] = await db
          .update(inventoryItemsTable)
          .set({ qty: newQty })
          .where(eqId(inventoryItemsTable.id, item.id))
          .returning();
        itemByName.set(item.name.toLowerCase(), updated);
        applied++;
        messages.push(
          `${delta > 0 ? "Added" : "Used"} ${Math.abs(delta)} ${item.name} (now ${newQty})`,
        );
      } else if (a.tool === "log_bill") {
        const amount = Number(f.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          messages.push("Skipped bill — no valid amount given");
          continue;
        }
        const prop = f.propertyName
          ? propByName.get(String(f.propertyName).toLowerCase())
          : undefined;
        const job = f.jobNo ? jobByNo.get(String(f.jobNo).toLowerCase()) : undefined;
        const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(f.dueDate ?? ""))
          ? String(f.dueDate)
          : null;
        const [billRow] = await db
          .insert(expensesTable)
          .values({
            vendor: f.vendor ? String(f.vendor) : null,
            category: f.category ? String(f.category) : null,
            amount,
            propertyId: prop?.id ?? null,
            jobId: job?.id ?? null,
            source: "voice",
            paymentStatus: "open",
            dueDate,
          })
          .returning();
        if (billRow.jobId) await recomputeJobFinancials(billRow.jobId);
        await syncExpenseLedger(billRow.id);
        applied++;
        messages.push(
          `Logged bill — ${f.vendor ?? "vendor"} $${amount.toLocaleString()}${dueDate ? ` due ${dueDate}` : ""}`,
        );
      } else if (a.tool === "pay_bill") {
        const vendor = String(f.vendor ?? "").trim().toLowerCase();
        const amount = Number(f.amount);
        const open = await db
          .select()
          .from(expensesTable)
          .where(eqId(expensesTable.paymentStatus, "open"));
        const candidates = open.filter(
          (e) =>
            (!vendor || (e.vendor ?? "").toLowerCase().includes(vendor)) &&
            (!Number.isFinite(amount) || Math.abs(e.amount - amount) < 0.01),
        );
        if (candidates.length !== 1) {
          messages.push(
            candidates.length === 0
              ? `No open bill found${vendor ? ` for "${f.vendor}"` : ""}`
              : `Multiple open bills match${vendor ? ` "${f.vendor}"` : ""} — pay it from the Money page`,
          );
          continue;
        }
        const bill = candidates[0];
        const [paidBill] = await db
          .update(expensesTable)
          .set({ paymentStatus: "paid", paidAt: new Date() })
          .where(eqId(expensesTable.id, bill.id))
          .returning();
        await syncExpenseLedger(paidBill.id);
        applied++;
        messages.push(
          `Paid ${bill.vendor ?? "bill"} — $${bill.amount.toLocaleString()}`,
        );
      } else if (a.tool === "set_price") {
        const serviceName = String(f.service ?? "").trim();
        const rate = Number(f.rate);
        if (!serviceName || !Number.isFinite(rate) || rate < 0) {
          messages.push("Skipped price — missing service name or a valid rate");
          continue;
        }
        const norm = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        const detail = f.detail ? String(f.detail) : null;
        const unit = f.unit ? String(f.unit) : null;
        const prop = f.propertyName
          ? propByName.get(String(f.propertyName).toLowerCase())
          : undefined;
        if (f.propertyName && !prop) {
          messages.push(`Skipped price — unknown property "${f.propertyName}"`);
          continue;
        }
        if (prop) {
          const items = await db.select().from(priceItemsTable);
          const existing = items.find(
            (p) => p.propertyId === prop.id && norm(p.service) === norm(serviceName),
          );
          if (existing) {
            await db
              .update(priceItemsTable)
              .set({
                rate,
                detail: detail ?? existing.detail,
                unit: unit ?? existing.unit,
              })
              .where(eqId(priceItemsTable.id, existing.id));
            messages.push(
              `Updated ${existing.service} at ${prop.name} to $${rate.toLocaleString()}`,
            );
          } else {
            await db.insert(priceItemsTable).values({
              propertyId: prop.id,
              service: serviceName,
              detail,
              unit,
              rate,
            });
            messages.push(
              `Added ${serviceName} at $${rate.toLocaleString()} to ${prop.name}'s price list`,
            );
          }
        } else {
          const items = await db.select().from(catalogItemsTable);
          const existing = items.find((c) => norm(c.service) === norm(serviceName));
          if (existing) {
            await db
              .update(catalogItemsTable)
              .set({
                rate,
                detail: detail ?? existing.detail,
                unit: unit ?? existing.unit,
              })
              .where(eqId(catalogItemsTable.id, existing.id));
            messages.push(
              `Updated ${existing.service} on the master price list to $${rate.toLocaleString()}`,
            );
          } else {
            await db.insert(catalogItemsTable).values({
              service: serviceName,
              detail,
              unit,
              rate,
            });
            messages.push(
              `Added ${serviceName} at $${rate.toLocaleString()} to the master price list`,
            );
          }
        }
        applied++;
      } else if (a.tool === "mark_invoice_paid") {
        const allInvoices = await db.select().from(invoicesTable);
        const no = String(f.invoiceNo ?? "").trim().toLowerCase();
        let inv = no
          ? allInvoices.find((i) => i.invoiceNo.toLowerCase() === no)
          : undefined;
        if (!inv && f.propertyName) {
          const prop = propByName.get(String(f.propertyName).toLowerCase());
          const amount = Number(f.amount);
          const candidates = allInvoices.filter(
            (i) =>
              i.status !== "paid" &&
              (!prop || i.propertyId === prop.id) &&
              (!Number.isFinite(amount) || Math.abs(i.amount - amount) < 0.01),
          );
          if (candidates.length === 1) inv = candidates[0];
        }
        if (!inv) {
          messages.push(
            `Couldn't find that invoice${f.invoiceNo ? ` ("${f.invoiceNo}")` : ""} — mark it paid from the Money page`,
          );
          continue;
        }
        if (inv.status === "paid") {
          messages.push(`${inv.invoiceNo} is already marked paid`);
          continue;
        }
        const [updatedInv] = await db
          .update(invoicesTable)
          .set({ status: "paid", paidAt: new Date() })
          .where(eqId(invoicesTable.id, inv.id))
          .returning();
        if (updatedInv.jobId) await recomputeJobFinancials(updatedInv.jobId);
        await syncInvoiceLedger(updatedInv.id);
        applied++;
        messages.push(`Marked ${inv.invoiceNo} paid — $${inv.amount.toLocaleString()}`);
      } else if (a.tool === "create_journal_entry") {
        const amount = Number(f.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          messages.push("Skipped journal entry — no valid amount given");
          continue;
        }
        const resolve = (ref: unknown): string | undefined => {
          const r = String(ref ?? "").trim().toLowerCase();
          if (!r) return undefined;
          const hit = CHART_OF_ACCOUNTS.find(
            (acc) => acc.code === r || acc.name.toLowerCase() === r,
          );
          if (hit) return hit.code;
          const partial = CHART_OF_ACCOUNTS.filter((acc) =>
            acc.name.toLowerCase().includes(r),
          );
          return partial.length === 1 ? partial[0].code : undefined;
        };
        const debitCode = resolve(f.debitAccount);
        const creditCode = resolve(f.creditAccount);
        if (!debitCode || !creditCode || debitCode === creditCode) {
          messages.push("Skipped journal entry — couldn't match the accounts");
          continue;
        }
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(f.date ?? ""))
          ? String(f.date)
          : undefined;
        await postJournal({
          entryDate: date,
          memo: f.memo ? String(f.memo) : a.summary,
          refType: "manual",
          source: "voice",
          lines: [
            { accountCode: debitCode, debit: amount },
            { accountCode: creditCode, credit: amount },
          ],
        });
        applied++;
        messages.push(`Posted journal entry — $${amount.toLocaleString()}`);
      } else {
        messages.push(`Unknown action "${a.tool}"`);
      }
    } catch {
      messages.push(`Failed to apply "${a.title}"`);
    }
  }

  if (body.voiceLogId) {
    await db
      .update(voiceLogsTable)
      .set({ appliedAt: new Date() })
      .where(eqId(voiceLogsTable.id, body.voiceLogId));
  }

  res.json(ConfirmVoiceResponse.parse({ applied, messages }));
});

export default router;
