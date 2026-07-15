import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import {
  db,
  propertiesTable,
  jobsTable,
  invoicesTable,
  expensesTable,
  inventoryItemsTable,
  importUploadsTable,
  type Property,
} from "@workspace/db";
import {
  ParseIngestBody,
  ParseIngestResponse,
  CommitIngestBody,
  CommitIngestResponse,
  ScanIngestBody,
  ListImportHistoryResponse,
} from "@workspace/api-zod";
import { completeJson, completeJsonWithImage } from "../lib/ai";

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
Valid targets: properties, jobs, invoices, expenses, inventory.
Fields by target:
- properties { name, pmcName?, city?, units? (number) }
- jobs { description, propertyName?, unitNo?, category? }
- invoices { invoiceNo?, propertyName?, amount (number), issuedOn? (YYYY-MM-DD), poNumber?, billToName?, notes? }
- expenses { vendor?, category?, amount (number), propertyName? }
- inventory { name, qty (number), reorderAt? (number), unitCost? (number), preferredVendor? }
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
const SCAN_MAX_PER_WINDOW = 8;
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
      `You are HALO's receipt scanner. Read the photographed receipt, invoice, or document and extract structured records for a property-maintenance contractor.
Valid targets: properties, jobs, invoices, expenses, inventory.
Fields by target:
- properties { name, pmcName?, city?, units? (number) }
- jobs { description, propertyName?, unitNo?, category? }
- invoices { invoiceNo?, propertyName?, amount (number), issuedOn? (YYYY-MM-DD), poNumber?, billToName?, notes? }
- expenses { vendor?, category?, amount (number), propertyName? }
- inventory { name, qty (number), reorderAt? (number), unitCost? (number), preferredVendor? }
A store/supplier receipt is almost always ONE expense record: vendor = store name, amount = the receipt TOTAL (after tax), category = best fit (materials, fuel, tools, supplies, etc.). Do not create one expense per line item.
If the receipt clearly lists stockable materials the contractor would track (e.g. filters, paint, parts with quantities), you may ALSO add inventory records for those items.
Include propertyName only if a property/job-site name is written on the receipt.
Return {"detectedTarget": "...", "summary": "one sentence describing what was scanned", "records": [{ "target", "label" (human readable), "confidence" (0-1), "fields" {...} }]}.`,
      `Filename: ${body.filename ?? "receipt photo"}. Extract the records from this image.`,
      body.image,
      body.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
      4096,
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
