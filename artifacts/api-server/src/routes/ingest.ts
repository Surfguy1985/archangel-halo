import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  propertiesTable,
  jobsTable,
  invoicesTable,
  expensesTable,
  inventoryItemsTable,
  importUploadsTable,
  priceItemsTable,
  catalogItemsTable,
  type Property,
} from "@workspace/db";
import {
  ParseIngestBody,
  ParseIngestResponse,
  CommitIngestBody,
  CommitIngestResponse,
  ScanIngestBody,
  ExtractReceiptBody,
  ExtractReceiptResponse,
  ListImportHistoryResponse,
} from "@workspace/api-zod";
import { completeJson, completeJsonWithImage } from "../lib/ai";
import { plaidPost, getPlaidItem } from "../lib/plaidClient";

const router: IRouter = Router();

type IngestRecord = {
  target: string;
  label?: string;
  confidence?: number;
  fields: Record<string, unknown>;
};

function decodeContent(content: string, mimeType?: string | null): string {
  const isText =
    !mimeType ||
    mimeType.startsWith("text/") ||
    mimeType.includes("csv") ||
    mimeType.includes("json");
  if (isText) return content;
  try {
    return Buffer.from(content, "base64").toString("utf-8");
  } catch {
    return content;
  }
}

router.post("/ingest/parse", async (req, res): Promise<void> => {
  const body = ParseIngestBody.parse(req.body);
  const text = decodeContent(body.content, body.mimeType).slice(0, 40000);

  let parsed: { detectedTarget: string; summary?: string; records: IngestRecord[] };
  try {
    parsed = await completeJson<{
      detectedTarget: string;
      summary?: string;
      records: IngestRecord[];
    }>(
      `You are HALO's file intake. Read the uploaded file content and extract structured records for a property-maintenance contractor.
Valid targets: properties, jobs, invoices, expenses, inventory, price_items.
Fields by target:
- properties { name, pmcName?, city?, units? (number) }
- jobs { description, propertyName?, unitNo?, category? }
- invoices { invoiceNo?, propertyName?, amount (number), issuedOn? (YYYY-MM-DD), poNumber?, billToName?, notes? }
- expenses { vendor?, category?, amount (number), propertyName? }
- inventory { name, qty (number), reorderAt? (number), unitCost? (number), preferredVendor? }
- price_items { service, rate (number), propertyName?, unit? (each, sqft, hour, unit...), detail? }
A price list, rate sheet, price book, or bid sheet is target price_items — one record per service line, rate is the price as a number.
For price_items include propertyName only when the document names a specific property/community the prices belong to; leave it out for a general/master price list.
For invoices, "amount" is the invoice total. Put the billed customer/company in billToName and any work description in notes.
Always include propertyName when the document mentions a property, building, community, or job-site name.
${body.target && body.target !== "auto" ? `The user says these are: ${body.target}.` : "Detect the best target."}
Return {"detectedTarget": "...", "summary": "one sentence", "records": [{ "target", "label" (human readable), "confidence" (0-1), "fields" {...} }]}.`,
      `Filename: ${body.filename}\n\nContent:\n${text}`,
      8192,
    );
  } catch {
    parsed = {
      detectedTarget: body.target && body.target !== "auto" ? body.target : "unknown",
      summary: "Could not parse the file automatically.",
      records: [],
    };
  }

  res.json(
    ParseIngestResponse.parse({
      detectedTarget: parsed.detectedTarget ?? "unknown",
      summary: parsed.summary ?? null,
      records: (parsed.records ?? []).map((r) => ({
        target: r.target,
        label: r.label,
        confidence: r.confidence ?? 0.6,
        fields: r.fields ?? {},
      })),
    }),
  );
});

const scanHits = new Map<string, number[]>();
const SCAN_WINDOW_MS = 60_000;
const SCAN_MAX_PER_WINDOW = 20;
const SCAN_MAX_BASE64_CHARS = 14_000_000;

router.post("/ingest/scan", async (req, res): Promise<void> => {
  const body = ScanIngestBody.parse(req.body);

  if (body.image.length > SCAN_MAX_BASE64_CHARS) {
    res.status(413).json({ error: "Image too large. Please retake the photo." });
    return;
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(body.image.slice(0, 1000))) {
    res.status(400).json({ error: "Invalid image data." });
    return;
  }

  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const hits = (scanHits.get(ip) ?? []).filter((t) => now - t < SCAN_WINDOW_MS);
  if (hits.length >= SCAN_MAX_PER_WINDOW) {
    res.status(429).json({ error: "Too many scans. Wait a minute and try again." });
    return;
  }
  hits.push(now);
  scanHits.set(ip, hits);
  if (scanHits.size > 1000) {
    for (const [k, v] of scanHits) {
      if (v.every((t) => now - t >= SCAN_WINDOW_MS)) scanHits.delete(k);
    }
  }

  let parsed: { detectedTarget: string; summary?: string; records: IngestRecord[] };
  try {
    parsed = await completeJsonWithImage<{
      detectedTarget: string;
      summary?: string;
      records: IngestRecord[];
    }>(
      `You are HALO's document scanner — an expert OCR reader for a property-maintenance contractor. Read the photographed receipt, invoice, or document and extract structured records.
Reading rules:
- Read every line of the document carefully, even if the photo is rotated, skewed, dim, blurry, wrinkled, or partially cut off. Mentally rotate/deskew before reading.
- Transcribe names, numbers, and amounts EXACTLY as printed — never invent or round values.
- For any amount, cross-check digits (e.g. subtotal + tax = total). Prefer the printed TOTAL.
- If a specific field is truly unreadable, omit it rather than guessing.
Valid targets: properties, jobs, invoices, expenses, inventory, price_items.
Fields by target:
- properties { name, pmcName?, city?, units? (number) }
- jobs { description, propertyName?, unitNo?, category? }
- invoices { invoiceNo?, propertyName?, amount (number), issuedOn? (YYYY-MM-DD), poNumber?, billToName?, notes? }
- expenses { vendor?, category?, amount (number), propertyName? }
- inventory { name, qty (number), reorderAt? (number), unitCost? (number), preferredVendor? }
- price_items { service, rate (number), propertyName?, unit?, detail? } — use for a photographed price list / rate sheet, one record per service line.
A store/supplier receipt is almost always ONE expense record: vendor = store name, amount = the receipt TOTAL (after tax), category = best fit (materials, fuel, tools, supplies, etc.). Do not create one expense per line item.
If the receipt clearly lists stockable materials the contractor would track (e.g. filters, paint, parts with quantities), you may ALSO add inventory records for those items.
Include propertyName only if a property/job-site name is written on the receipt.
Return {"detectedTarget": "...", "summary": "one sentence describing what was scanned", "records": [{ "target", "label" (human readable), "confidence" (0-1), "fields" {...} }]}.`,
      `Filename: ${body.filename ?? "receipt photo"}. Extract the records from this image.`,
      body.image,
      body.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
      8192,
    );
  } catch (err) {
    req.log.error({ err }, "ingest scan failed");
    res.status(502).json({ error: "Could not read the photo. Please try again." });
    return;
  }

  res.json(
    ParseIngestResponse.parse({
      detectedTarget: parsed.detectedTarget ?? "unknown",
      summary: parsed.summary ?? null,
      records: (parsed.records ?? []).map((r) => ({
        target: r.target,
        label: r.label,
        confidence: r.confidence ?? 0.6,
        fields: r.fields ?? {},
      })),
    }),
  );
});

type BankTxnMatch = {
  txnId: string;
  label: string;
  amount: number;
  date: string;
};

/**
 * Look for a bank transaction matching the receipt: same amount (to the cent,
 * or within $0.02) within ±4 days of the receipt date. Returns null when no
 * bank is connected, Plaid fails, or nothing matches confidently.
 */
async function findBankMatch(
  amount: number | null,
  dateStr: string | null,
): Promise<BankTxnMatch | null> {
  if (!amount || amount <= 0) return null;
  const item = await getPlaidItem();
  if (!item) return null;

  const center = /^\d{4}-\d{2}-\d{2}$/.test(dateStr ?? "")
    ? new Date(`${dateStr}T12:00:00`)
    : new Date();
  if (isNaN(center.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const start = new Date(center);
  start.setDate(start.getDate() - 4);
  const end = new Date(center);
  end.setDate(end.getDate() + 4);
  const today = new Date();
  const endCapped = end > today ? today : end;
  if (start > endCapped) return null;

  const result = await plaidPost("/transactions/get", {
    access_token: item.accessToken,
    start_date: fmt(start),
    end_date: fmt(endCapped),
    options: { count: 100, offset: 0 },
  });
  if (!result.ok) return null;
  const txns: any[] = result.data.transactions ?? [];
  const accounts: any[] = result.data.accounts ?? [];
  const accountLabel = (accountId: string): string => {
    const acct = accounts.find((a) => a.account_id === accountId);
    if (!acct) return "bank account";
    return `${acct.name ?? "Account"}${acct.mask ? ` ••${acct.mask}` : ""}`;
  };

  // Plaid: positive amount = money leaving the account (a purchase).
  const candidates = txns.filter(
    (t) => Number(t.amount) > 0 && Math.abs(Number(t.amount) - amount) <= 0.02,
  );
  if (candidates.length === 0) return null;
  // Closest to the receipt date wins.
  candidates.sort(
    (a, b) =>
      Math.abs(new Date(`${a.date}T12:00:00`).getTime() - center.getTime()) -
      Math.abs(new Date(`${b.date}T12:00:00`).getTime() - center.getTime()),
  );
  const best = candidates[0];
  return {
    txnId: String(best.transaction_id),
    label: `${best.merchant_name || best.name || "Card charge"} · ${accountLabel(String(best.account_id))}`,
    amount: Number(best.amount),
    date: String(best.date),
  };
}

router.post("/ingest/receipt", async (req, res): Promise<void> => {
  const body = ExtractReceiptBody.parse(req.body);

  if (body.image.length > SCAN_MAX_BASE64_CHARS) {
    res.status(413).json({ error: "Image too large. Please retake the photo." });
    return;
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(body.image.slice(0, 1000))) {
    res.status(400).json({ error: "Invalid image data." });
    return;
  }

  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const hits = (scanHits.get(ip) ?? []).filter((t) => now - t < SCAN_WINDOW_MS);
  if (hits.length >= SCAN_MAX_PER_WINDOW) {
    res.status(429).json({ error: "Too many scans. Wait a minute and try again." });
    return;
  }
  hits.push(now);
  scanHits.set(ip, hits);

  const isBillHint = body.kind === "bill";
  let parsed: {
    found: boolean;
    vendor?: string | null;
    amount?: number | null;
    category?: string | null;
    spentOn?: string | null;
    dueDate?: string | null;
    isBill?: boolean | null;
    summary?: string | null;
    confidence?: number | null;
  };
  try {
    parsed = await completeJsonWithImage<typeof parsed>(
      `You are HALO's receipt and bill reader — an expert OCR reader for a property-maintenance contractor.
Read the photographed document and extract ONE expense.
Reading rules: read carefully even if the photo is rotated, skewed, dim, blurry, or crumpled — mentally deskew it first. Transcribe the vendor name and amounts EXACTLY as printed; cross-check the total against subtotal + tax when both are visible. Never invent values — use null for anything unreadable.
Rules:
- vendor: the store/supplier/company name.
- amount: the document TOTAL (after tax), as a number.
- category: best fit — Materials, Fuel, Tools, Supplies, Equipment, Subcontractor, Utilities, Insurance, Office, Other.
- spentOn: the receipt/invoice date as YYYY-MM-DD if printed, else null.
- dueDate: the payment due date as YYYY-MM-DD if this is a bill/invoice to pay, else null.
- isBill: true if this is an unpaid vendor bill or invoice TO the contractor (has a due date, "amount due", "net 30", etc.), false for a paid store receipt.${isBillHint ? "\n- The user says this is an unpaid vendor bill; lean toward isBill: true." : ""}
- summary: one short human sentence, e.g. "Home Depot receipt for $214.85 on June 3".
- confidence: 0-1 how sure you are about the amount.
If the image is not a receipt/bill or is unreadable, return {"found": false}.
Return {"found": true, "vendor", "amount", "category", "spentOn", "dueDate", "isBill", "summary", "confidence"}.`,
      `Filename: ${body.filename ?? "receipt photo"}. Extract the expense from this image.`,
      body.image,
      body.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
      2048,
    );
  } catch (err) {
    req.log.error({ err }, "receipt extract failed");
    res.status(502).json({ error: "Could not read the photo. Please try again." });
    return;
  }

  if (!parsed?.found) {
    res.json(ExtractReceiptResponse.parse({ found: false }));
    return;
  }

  const amount = typeof parsed.amount === "number" && parsed.amount > 0 ? parsed.amount : null;
  let bankMatch: BankTxnMatch | null = null;
  try {
    // Only paid receipts get matched to card/bank charges — unpaid bills
    // haven't hit the bank yet.
    if (!parsed.isBill) {
      bankMatch = await findBankMatch(amount, parsed.spentOn ?? null);
    }
  } catch (err) {
    req.log.warn({ err }, "bank match lookup failed");
  }

  res.json(
    ExtractReceiptResponse.parse({
      found: true,
      vendor: parsed.vendor ?? null,
      amount,
      category: parsed.category ?? null,
      spentOn: isValidDateOnly(parsed.spentOn) ? parsed.spentOn : null,
      dueDate: isValidDateOnly(parsed.dueDate) ? parsed.dueDate : null,
      isBill: parsed.isBill ?? isBillHint,
      summary: parsed.summary ?? null,
      confidence: parsed.confidence ?? null,
      bankMatch,
    }),
  );
});

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidDateOnly(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function findProperty(props: Property[], rawName: string): Property | null {
  const norm = normalizeName(rawName);
  if (!norm) return null;
  // 1. Exact normalized match
  for (const p of props) {
    if (normalizeName(p.name) === norm) return p;
  }
  // 2. Substring containment either way (e.g. "Willow Creek" vs "Willow Creek Apartments")
  //    — only if exactly ONE property matches; ambiguity means no match.
  const substringMatches = props.filter((p) => {
    const pn = normalizeName(p.name);
    return pn.length >= 4 && norm.length >= 4 && (pn.includes(norm) || norm.includes(pn));
  });
  if (substringMatches.length === 1) return substringMatches[0];
  if (substringMatches.length > 1) return null;
  // 3. Token overlap — require a unique clear winner sharing most name words
  const tokens = new Set(norm.split(" ").filter((t) => t.length > 2));
  let best: Property | null = null;
  let bestScore = 0;
  let tied = false;
  for (const p of props) {
    const pTokens = normalizeName(p.name).split(" ").filter((t) => t.length > 2);
    if (pTokens.length === 0) continue;
    const overlap = pTokens.filter((t) => tokens.has(t)).length;
    if (overlap < 2) continue;
    const score = overlap / Math.max(pTokens.length, tokens.size || 1);
    if (score > bestScore) {
      best = p;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return !tied && bestScore >= 0.6 ? best : null;
}

router.post("/ingest/commit", async (req, res): Promise<void> => {
  const body = CommitIngestBody.parse(req.body);
  const messages: string[] = [];
  let committed = 0;
  let skipped = 0;

  // Commit properties first so jobs/invoices in the same file can link to them
  const ordered = [...body.records].sort(
    (a, b) => (a.target === "properties" ? 0 : 1) - (b.target === "properties" ? 0 : 1),
  );

  try {
    // All-or-nothing: if anything fails mid-import, nothing is saved.
    await db.transaction(async (tx) => {
      const props = await tx.select().from(propertiesTable);

      const ensureProperty = async (name: unknown): Promise<string> => {
        const rawName = name ? String(name).trim() : "";
        if (rawName) {
          const existing = findProperty(props, rawName);
          if (existing) return existing.id;
          const [created] = await tx
            .insert(propertiesTable)
            .values({ name: rawName })
            .returning();
          props.push(created);
          messages.push(`Added new property "${rawName}" from the document`);
          return created.id;
        }
        // No property named at all — file under a holding property so nothing is lost
        const fallback = findProperty(props, "Unassigned Imports");
        if (fallback) return fallback.id;
        const [created] = await tx
          .insert(propertiesTable)
          .values({ name: "Unassigned Imports" })
          .returning();
        props.push(created);
        messages.push(`Filed under "Unassigned Imports" — no property named in the document`);
        return created.id;
      };

      for (const r of ordered) {
        const f = r.fields as Record<string, unknown>;
        if (r.target === "properties") {
          if (!f.name) {
            messages.push("Skipped property with no name");
            skipped++;
            continue;
          }
          const existing = findProperty(props, String(f.name));
          if (existing) {
            messages.push(`Property "${String(f.name)}" already exists — skipped duplicate`);
            skipped++;
            continue;
          }
          const [created] = await tx
            .insert(propertiesTable)
            .values({
              name: String(f.name),
              pmcName: f.pmcName ? String(f.pmcName) : null,
              city: f.city ? String(f.city) : null,
              units: f.units != null ? Number(f.units) : null,
            })
            .returning();
          props.push(created);
          committed++;
        } else if (r.target === "jobs") {
          const pid = await ensureProperty(f.propertyName);
          const count = (await tx.select().from(jobsTable)).length;
          await tx.insert(jobsTable).values({
            jobNo: `J-${2000 + count + 1}`,
            propertyId: pid,
            description: String(f.description ?? "Imported job"),
            unitNo: f.unitNo ? String(f.unitNo) : null,
            category: f.category ? String(f.category) : null,
          });
          committed++;
        } else if (r.target === "invoices") {
          const pid = await ensureProperty(f.propertyName);
          const count = (await tx.select().from(invoicesTable)).length;
          await tx.insert(invoicesTable).values({
            invoiceNo: f.invoiceNo ? String(f.invoiceNo) : `INV-${5000 + count + 1}`,
            propertyId: pid,
            amount: Number(f.amount ?? 0),
            status: "draft",
            issuedOn: isValidDateOnly(f.issuedOn) ? f.issuedOn : null,
            poNumber: f.poNumber ? String(f.poNumber) : null,
            billToName: f.billToName ? String(f.billToName) : null,
            notes: f.notes ? String(f.notes) : null,
          });
          committed++;
        } else if (r.target === "expenses") {
          const rawName = f.propertyName ? String(f.propertyName).trim() : "";
          await tx.insert(expensesTable).values({
            vendor: f.vendor ? String(f.vendor) : null,
            category: f.category ? String(f.category) : null,
            amount: Number(f.amount ?? 0),
            propertyId: rawName ? await ensureProperty(rawName) : null,
            source: "import",
          });
          committed++;
        } else if (r.target === "price_items") {
          const serviceName = f.service ? String(f.service).trim() : "";
          const rate = Number(f.rate);
          if (!serviceName || !Number.isFinite(rate) || rate < 0) {
            messages.push(`Skipped price line "${serviceName || "?"}" — missing service or rate`);
            skipped++;
            continue;
          }
          const detail = f.detail ? String(f.detail) : null;
          const unit = f.unit ? String(f.unit) : null;
          const rawPropName = f.propertyName ? String(f.propertyName).trim() : "";
          if (rawPropName) {
            const pid = await ensureProperty(rawPropName);
            const existing = (
              await tx.select().from(priceItemsTable)
            ).find(
              (p) =>
                p.propertyId === pid &&
                normalizeName(p.service) === normalizeName(serviceName),
            );
            if (existing) {
              await tx
                .update(priceItemsTable)
                .set({
                  rate,
                  detail: detail ?? existing.detail,
                  unit: unit ?? existing.unit,
                })
                .where(eq(priceItemsTable.id, existing.id));
              messages.push(
                `Updated ${existing.service} to $${rate.toLocaleString()} on that property's price list`,
              );
            } else {
              await tx.insert(priceItemsTable).values({
                propertyId: pid,
                service: serviceName,
                detail,
                unit,
                rate,
              });
            }
          } else {
            const existing = (
              await tx.select().from(catalogItemsTable)
            ).find((c) => normalizeName(c.service) === normalizeName(serviceName));
            if (existing) {
              await tx
                .update(catalogItemsTable)
                .set({
                  rate,
                  detail: detail ?? existing.detail,
                  unit: unit ?? existing.unit,
                })
                .where(eq(catalogItemsTable.id, existing.id));
              messages.push(
                `Updated ${existing.service} to $${rate.toLocaleString()} on the master price list`,
              );
            } else {
              await tx.insert(catalogItemsTable).values({
                service: serviceName,
                detail,
                unit,
                rate,
              });
            }
          }
          committed++;
        } else if (r.target === "inventory") {
          if (!f.name) {
            messages.push("Skipped inventory item with no name");
            skipped++;
            continue;
          }
          await tx.insert(inventoryItemsTable).values({
            name: String(f.name),
            qty: Number(f.qty ?? 0),
            reorderAt: Number(f.reorderAt ?? 0),
            unitCost: f.unitCost != null ? Number(f.unitCost) : null,
            preferredVendor: f.preferredVendor ? String(f.preferredVendor) : null,
          });
          committed++;
        } else {
          messages.push(`Unknown target "${r.target}"`);
          skipped++;
        }
      }

      // Record this upload in the import history (with the original document if provided)
      if (body.filename) {
        await tx.insert(importUploadsTable).values({
          filename: body.filename,
          mimeType: body.mimeType ?? null,
          objectPath: body.objectPath ?? null,
          summary: body.summary ?? null,
          committed,
          skipped,
          messages: messages.length ? messages : null,
        });
      }
    });
  } catch (err) {
    req.log.error({ err }, "ingest commit failed — rolled back");
    res.json(
      CommitIngestResponse.parse({
        committed: 0,
        messages: ["Import failed — nothing was saved. Please try again."],
      }),
    );
    return;
  }

  res.json(CommitIngestResponse.parse({ committed, messages }));
});

router.get("/ingest/history", async (_req, res): Promise<void> => {
  const uploads = await db
    .select()
    .from(importUploadsTable)
    .orderBy(desc(importUploadsTable.createdAt))
    .limit(50);
  res.json(
    ListImportHistoryResponse.parse({
      uploads: uploads.map((u) => ({
        id: u.id,
        filename: u.filename,
        mimeType: u.mimeType,
        objectPath: u.objectPath,
        summary: u.summary,
        committed: u.committed,
        skipped: u.skipped,
        messages: u.messages,
        createdAt: u.createdAt.toISOString(),
      })),
    }),
  );
});

export default router;
