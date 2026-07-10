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
} from "@workspace/db";
import {
  ParseVoiceBody,
  ParseVoiceResponse,
  ConfirmVoiceBody,
  ConfirmVoiceResponse,
} from "@workspace/api-zod";
import { completeJson } from "../lib/ai";

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
- log_expense { vendor, category, amount (number), propertyName?, jobNo? }
- create_lead { summary, source?, propertyName? }
- create_job { description, propertyName, unitNo?, category? }
- add_note { entityType (property|job), entityRef (name or job number), body }
- complete_job { jobNo }`;

router.post("/voice/parse", async (req, res): Promise<void> => {
  const { transcript } = ParseVoiceBody.parse(req.body);
  const props = await db.select().from(propertiesTable);
  const jobs = await db.select().from(jobsTable);

  let actions: Action[] = [];
  try {
    const result = await completeJson<{ actions: Action[] }>(
      `You are HALO's voice intake. Convert a contractor's spoken note into structured actions. ${TOOLS}
Known properties: ${props.map((p) => p.name).join(", ") || "none"}.
Known jobs: ${jobs.map((j) => j.jobNo).join(", ") || "none"}.
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
        await db.insert(expensesTable).values({
          vendor: f.vendor ? String(f.vendor) : null,
          category: f.category ? String(f.category) : null,
          amount: Number(f.amount ?? 0),
          propertyId: prop?.id ?? null,
          jobId: job?.id ?? null,
          source: "voice",
        });
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
        applied++;
        messages.push(`Completed ${job.jobNo}`);
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
