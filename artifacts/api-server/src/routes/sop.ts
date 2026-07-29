import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  propertySopRulesTable,
  propertiesTable,
  invoicesTable,
  activitiesTable,
} from "@workspace/db";
import {
  UploadPropertySopDocumentBody,
  GetPropertySopRuleResponse,
} from "@workspace/api-zod";
import { completeJsonWithImage, COMPLEX_MODEL } from "../lib/ai";

const router: IRouter = Router();

/* ----------------------------------------------------------------
   Per-property SOP billing rules (Invoice Wizard).
   Upload an SOP / billing-guideline doc → AI extracts a fixed rule →
   every invoice created for that property must follow it.
   ---------------------------------------------------------------- */

export type SopRuleSet = {
  property?: {
    name?: string | null;
    aliases?: string[];
    client_company?: string | null;
    billing_address?: string | null;
  };
  format?: {
    invoice_number_format?: string | null;
    date_format?: string | null;
    currency?: string | null;
    tax_rate_percent?: number | null;
    payment_terms?: string | null;
    due_days?: number | null;
    po_required?: boolean | null;
    remit_to?: string | null;
    delivery_method?: string | null;
    send_to?: string | null;
  };
  required_fields?: string[];
  line_item_rules?: {
    category?: string | null;
    description_rule?: string | null;
    rate_type?: string | null;
    default_rate?: number | null;
  }[];
  special_instructions?: string[];
};

const EXTRACT_SYSTEM = [
  "You are the rule-extraction stage of an invoice engine for a make-ready / restoration contractor.",
  "The attached document is an SOP / billing guideline from a property management company or client.",
  "Extract every requirement that governs how invoices for this property must be built.",
  'Return JSON exactly this shape (use null when the document does not say; keep arrays short and factual): {"property":{"name":"","aliases":[],"client_company":"","billing_address":""},"format":{"invoice_number_format":"","date_format":"MM/DD/YYYY","currency":"USD","tax_rate_percent":0,"payment_terms":"","due_days":30,"po_required":false,"remit_to":"","delivery_method":"","send_to":""},"required_fields":[],"line_item_rules":[{"category":"","description_rule":"","rate_type":"flat","default_rate":null}],"special_instructions":[]}',
  "invoice_number_format may contain {SEQ} for the running number and {YYYY}/{MM} for date parts.",
  "required_fields = fields the client insists appear on every invoice. special_instructions = anything else the SOP demands (approval steps, photo attachments, threshold limits, formatting demands). Be exhaustive but concise.",
].join("\n");

function normalizeRules(raw: unknown): SopRuleSet {
  const r = (raw ?? {}) as SopRuleSet;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    property: {
      name: r.property?.name ?? null,
      aliases: strArr(r.property?.aliases),
      client_company: r.property?.client_company ?? null,
      billing_address: r.property?.billing_address ?? null,
    },
    format: {
      invoice_number_format: r.format?.invoice_number_format ?? null,
      date_format: r.format?.date_format ?? null,
      currency: r.format?.currency ?? null,
      tax_rate_percent:
        typeof r.format?.tax_rate_percent === "number"
          ? r.format.tax_rate_percent
          : null,
      payment_terms: r.format?.payment_terms ?? null,
      due_days:
        typeof r.format?.due_days === "number" ? r.format.due_days : null,
      po_required: r.format?.po_required === true,
      remit_to: r.format?.remit_to ?? null,
      delivery_method: r.format?.delivery_method ?? null,
      send_to: r.format?.send_to ?? null,
    },
    required_fields: strArr(r.required_fields),
    line_item_rules: Array.isArray(r.line_item_rules)
      ? r.line_item_rules
          .filter((l) => l && typeof l === "object")
          .map((l) => ({
            category: l.category ?? null,
            description_rule: l.description_rule ?? null,
            rate_type: l.rate_type ?? null,
            default_rate:
              typeof l.default_rate === "number" ? l.default_rate : null,
          }))
      : [],
    special_instructions: strArr(r.special_instructions),
  };
}

function ruleDetail(row: typeof propertySopRulesTable.$inferSelect) {
  return {
    id: row.id,
    propertyId: row.propertyId,
    fileName: row.fileName,
    mediaType: row.mediaType,
    rules: row.rules as SopRuleSet,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Load the SOP rule governing a property, or null. Shared with invoice creation. */
export async function getSopRule(
  propertyId: string,
): Promise<SopRuleSet | null> {
  const [row] = await db
    .select()
    .from(propertySopRulesTable)
    .where(eq(propertySopRulesTable.propertyId, propertyId))
    .limit(1);
  return row ? (row.rules as SopRuleSet) : null;
}

/**
 * Apply a property's SOP rule to an invoice draft. Returns an error string
 * when the draft violates a hard requirement (caller responds 400), else
 * the SOP-completed field values. Explicit user values always win — the SOP
 * fills what was left blank and blocks what it forbids.
 */
export async function applySopToInvoice(
  propertyId: string,
  draft: {
    issuedOn: string;
    poNumber?: string | null;
    terms?: string | null;
    dueProvided: boolean;
    billToName?: string | null;
    propertyAddress?: string | null;
    paymentInstructions?: string | null;
    notes?: string | null;
    taxAmount?: number | null;
    total: number;
  },
): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      invoiceNo: string | null;
      dueAt: Date | null;
      terms: string | null;
      billToName: string | null;
      propertyAddress: string | null;
      paymentInstructions: string | null;
      notes: string | null;
      taxAmount: number | null;
      rule: SopRuleSet;
    }
  | null
> {
  const rule = await getSopRule(propertyId);
  if (!rule) return null;
  const f = rule.format ?? {};
  if (f.po_required && !draft.poNumber?.trim()) {
    return {
      ok: false,
      error:
        "This property's SOP requires a PO number on every invoice. Add the PO number and try again.",
    };
  }
  // Invoice number from the SOP's format, sequenced per property.
  let invoiceNo: string | null = null;
  if (f.invoice_number_format) {
    // Max-based sequencing (like INV numbering elsewhere): scan this
    // property's existing numbers for the highest {SEQ} in this format so
    // deletions and near-concurrent creates don't produce duplicates.
    const existing = await db
      .select({ invoiceNo: invoicesTable.invoiceNo })
      .from(invoicesTable)
      .where(eq(invoicesTable.propertyId, propertyId));
    const pattern = f.invoice_number_format
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace("\\{SEQ\\}", "(\\d+)")
      .replace("\\{YYYY\\}", "\\d{4}")
      .replace("\\{MM\\}", "\\d{2}");
    const re = new RegExp(`^${pattern}$`);
    let maxSeq = 0;
    for (const r of existing) {
      const m = re.exec(r.invoiceNo);
      if (m?.[1]) maxSeq = Math.max(maxSeq, Number(m[1]));
    }
    invoiceNo = f.invoice_number_format
      .replace("{SEQ}", String(maxSeq + 1).padStart(4, "0"))
      .replace("{YYYY}", draft.issuedOn.slice(0, 4))
      .replace("{MM}", draft.issuedOn.slice(5, 7));
  }
  let dueAt: Date | null = null;
  if (!draft.dueProvided && f.due_days != null) {
    const d = new Date(`${draft.issuedOn}T00:00:00`);
    d.setDate(d.getDate() + f.due_days);
    dueAt = d;
  }
  const taxAmount =
    draft.taxAmount == null && f.tax_rate_percent != null && f.tax_rate_percent > 0
      ? // Tax-inclusive, matching resolveTaxAmount: tax = total * r / (1 + r).
        Math.round(
          ((draft.total * (f.tax_rate_percent / 100)) /
            (1 + f.tax_rate_percent / 100)) *
            100,
        ) / 100
      : null;
  const notes =
    !draft.notes && (rule.special_instructions?.length ?? 0) > 0
      ? (rule.special_instructions ?? []).map((s) => `• ${s}`).join("\n")
      : null;
  return {
    ok: true,
    invoiceNo,
    dueAt,
    terms: !draft.terms && f.payment_terms ? f.payment_terms : null,
    billToName:
      !draft.billToName && rule.property?.client_company
        ? rule.property.client_company
        : null,
    propertyAddress:
      !draft.propertyAddress && rule.property?.billing_address
        ? rule.property.billing_address
        : null,
    paymentInstructions:
      !draft.paymentInstructions && f.remit_to ? `Remit to: ${f.remit_to}` : null,
    notes,
    taxAmount,
    rule,
  };
}

router.get("/properties/:id/sop-rule", async (req, res): Promise<void> => {
  const propertyId = String(req.params.id);
  const [row] = await db
    .select()
    .from(propertySopRulesTable)
    .where(eq(propertySopRulesTable.propertyId, propertyId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "No SOP rule for this property yet" });
    return;
  }
  res.json(GetPropertySopRuleResponse.parse(ruleDetail(row)));
});

router.post("/properties/:id/sop-rule", async (req, res): Promise<void> => {
  const propertyId = String(req.params.id);
  const parsed = UploadPropertySopDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid upload" });
    return;
  }
  const body = parsed.data;
  // base64 of a 6 MB file ≈ 8 MB — hard cap so extraction stays reliable.
  if (body.data.length > 8 * 1024 * 1024) {
    res.status(400).json({
      error: "Document is over 6 MB. Export a smaller PDF or a page image.",
    });
    return;
  }
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  if (!prop) {
    res.status(400).json({ error: "Property not found" });
    return;
  }
  let rules: SopRuleSet;
  try {
    const raw = await completeJsonWithImage(
      EXTRACT_SYSTEM,
      `Extract the billing rule from this SOP document. The property it governs in our system is named "${prop.name}"${prop.pmcName ? ` (managed by ${prop.pmcName})` : ""} — include that name or the document's own property name, plus any aliases.`,
      body.data,
      body.mediaType,
      2048,
      COMPLEX_MODEL,
    );
    rules = normalizeRules(raw);
  } catch (err) {
    console.error("SOP extraction failed:", err);
    res.status(502).json({
      error:
        "Couldn't read the SOP document. Try a clearer scan or a smaller file.",
    });
    return;
  }
  if (!rules.property?.name) {
    rules.property = { ...(rules.property ?? {}), name: prop.name };
  }
  const [existing] = await db
    .select({ id: propertySopRulesTable.id })
    .from(propertySopRulesTable)
    .where(eq(propertySopRulesTable.propertyId, propertyId))
    .limit(1);
  const values = {
    propertyId,
    fileName: body.fileName,
    mediaType: body.mediaType,
    fileData: body.data,
    rules,
  };
  const [row] = existing
    ? await db
        .update(propertySopRulesTable)
        .set(values)
        .where(eq(propertySopRulesTable.id, existing.id))
        .returning()
    : await db.insert(propertySopRulesTable).values(values).returning();
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: propertyId,
    kind: "note",
    body: `SOP billing rule ${existing ? "replaced" : "created"} for ${prop.name} from "${body.fileName}" — all invoices for this property now follow it`,
  });
  res.json(GetPropertySopRuleResponse.parse(ruleDetail(row!)));
});

// Source document download (manual route — served as the original file).
router.get(
  "/properties/:id/sop-rule/source",
  async (req, res): Promise<void> => {
    const propertyId = String(req.params.id);
    const [row] = await db
      .select()
      .from(propertySopRulesTable)
      .where(eq(propertySopRulesTable.propertyId, propertyId))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "No SOP rule for this property" });
      return;
    }
    res.setHeader("Content-Type", row.mediaType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${row.fileName.replace(/"/g, "")}"`,
    );
    res.send(Buffer.from(row.fileData, "base64"));
  },
);

router.delete("/properties/:id/sop-rule", async (req, res): Promise<void> => {
  const propertyId = String(req.params.id);
  const [row] = await db
    .select()
    .from(propertySopRulesTable)
    .where(eq(propertySopRulesTable.propertyId, propertyId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "No SOP rule for this property" });
    return;
  }
  await db
    .delete(propertySopRulesTable)
    .where(eq(propertySopRulesTable.id, row.id));
  res.status(204).end();
});

export default router;
