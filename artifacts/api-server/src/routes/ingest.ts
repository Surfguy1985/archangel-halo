import { Router, type IRouter } from "express";
import {
  db,
  propertiesTable,
  jobsTable,
  invoicesTable,
  expensesTable,
  inventoryItemsTable,
} from "@workspace/db";
import {
  ParseIngestBody,
  ParseIngestResponse,
  CommitIngestBody,
  CommitIngestResponse,
} from "@workspace/api-zod";
import { completeJson } from "../lib/ai";

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
- invoices { invoiceNo?, propertyName?, amount (number) }
- expenses { vendor?, category?, amount (number), propertyName? }
- inventory { name, qty (number), reorderAt? (number), unitCost? (number), preferredVendor? }
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

router.post("/ingest/commit", async (req, res): Promise<void> => {
  const body = CommitIngestBody.parse(req.body);
  const props = await db.select().from(propertiesTable);
  const propByName = new Map(props.map((p) => [p.name.toLowerCase(), p]));
  const messages: string[] = [];
  let committed = 0;

  const propId = (name: unknown): string | null =>
    name ? (propByName.get(String(name).toLowerCase())?.id ?? null) : null;

  for (const r of body.records) {
    const f = r.fields as Record<string, unknown>;
    try {
      if (r.target === "properties") {
        if (!f.name) {
          messages.push("Skipped property with no name");
          continue;
        }
        await db.insert(propertiesTable).values({
          name: String(f.name),
          pmcName: f.pmcName ? String(f.pmcName) : null,
          city: f.city ? String(f.city) : null,
          units: f.units != null ? Number(f.units) : null,
        });
        committed++;
      } else if (r.target === "jobs") {
        const pid = propId(f.propertyName);
        if (!pid) {
          messages.push(`Skipped job — unknown property "${f.propertyName}"`);
          continue;
        }
        const count = (await db.select().from(jobsTable)).length;
        await db.insert(jobsTable).values({
          jobNo: `J-${2000 + count + 1}`,
          propertyId: pid,
          description: String(f.description ?? "Imported job"),
          unitNo: f.unitNo ? String(f.unitNo) : null,
          category: f.category ? String(f.category) : null,
        });
        committed++;
      } else if (r.target === "invoices") {
        const pid = propId(f.propertyName);
        if (!pid) {
          messages.push(`Skipped invoice — unknown property "${f.propertyName}"`);
          continue;
        }
        const count = (await db.select().from(invoicesTable)).length;
        await db.insert(invoicesTable).values({
          invoiceNo: f.invoiceNo ? String(f.invoiceNo) : `INV-${5000 + count + 1}`,
          propertyId: pid,
          amount: Number(f.amount ?? 0),
          status: "draft",
        });
        committed++;
      } else if (r.target === "expenses") {
        await db.insert(expensesTable).values({
          vendor: f.vendor ? String(f.vendor) : null,
          category: f.category ? String(f.category) : null,
          amount: Number(f.amount ?? 0),
          propertyId: propId(f.propertyName),
          source: "import",
        });
        committed++;
      } else if (r.target === "inventory") {
        if (!f.name) {
          messages.push("Skipped inventory item with no name");
          continue;
        }
        await db.insert(inventoryItemsTable).values({
          name: String(f.name),
          qty: Number(f.qty ?? 0),
          reorderAt: Number(f.reorderAt ?? 0),
          unitCost: f.unitCost != null ? Number(f.unitCost) : null,
          preferredVendor: f.preferredVendor ? String(f.preferredVendor) : null,
        });
        committed++;
      } else {
        messages.push(`Unknown target "${r.target}"`);
      }
    } catch {
      messages.push(`Failed to import ${r.label ?? r.target}`);
    }
  }

  res.json(CommitIngestResponse.parse({ committed, messages }));
});

export default router;
