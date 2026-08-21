/**
 * Vapi AI field verification agent.
 *
 * Flow:
 *  1. After field app / work review inputs → outbound VERIFY call to crew
 *  2. Crew can dictate corrections → tools apply to job + review + dispatch board
 *  3. Outbound CONFIRM call reads back final state
 *
 * Env:
 *   VAPI_API_KEY
 *   VAPI_PHONE_NUMBER_ID
 *   VAPI_ASSISTANT_ID (optional — uses transient assistant if unset)
 *   VAPI_WEBHOOK_BASE (public HTTPS base for tool webhooks, e.g. https://archangel-halo.replit.app)
 *   VAPI_MOCK=true → no real calls; simulate tool apply
 */
import { eq } from "drizzle-orm";
import { db, jobsTable, crewsTable, workReviewsTable } from "@workspace/db";
import { logger } from "./logger";
import { buildWorkVerification } from "./workVerification";

const VAPI_BASE = "https://api.vapi.ai";

export type FieldCallKind = "verify" | "confirm";

export type FieldCallRecord = {
  id: string;
  kind: FieldCallKind;
  jobId: string;
  reviewId: string | null;
  crewId: string | null;
  phone: string;
  vapiCallId: string | null;
  status: "queued" | "ringing" | "in_progress" | "completed" | "failed" | "mock";
  corrections: Array<Record<string, unknown>>;
  transcriptSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

const calls: FieldCallRecord[] = [];
const byVapiId = new Map<string, string>();

function pushCall(c: FieldCallRecord) {
  calls.unshift(c);
  if (calls.length > 100) calls.length = 100;
  if (c.vapiCallId) byVapiId.set(c.vapiCallId, c.id);
}

export function listFieldCalls(limit = 25) {
  return calls.slice(0, limit);
}

export function getFieldCall(id: string) {
  return calls.find((c) => c.id === id) || null;
}

function webhookBase() {
  return (process.env.VAPI_WEBHOOK_BASE || process.env.HALO_PUBLIC_URL || "").replace(/\/$/, "");
}

function mockMode() {
  return process.env.VAPI_MOCK === "true" || !process.env.VAPI_API_KEY;
}

async function vapiFetch(path: string, body: unknown) {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error("VAPI_API_KEY not set");
  const res = await fetch(`${VAPI_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(json?.message || json?.error || text.slice(0, 300) || `Vapi ${res.status}`);
  }
  return json;
}

function buildVerifySystemPrompt(ctx: {
  jobNo: string | null;
  unitNo: string | null;
  propertyName: string | null;
  services: string[];
  crewName: string | null;
  issues: string[];
}) {
  return `You are Halo Field Verify, an AI ops agent for Archangel turn crews.
You are calling ${ctx.crewName || "the crew lead"} about job ${ctx.jobNo || "unknown"}, unit ${ctx.unitNo || "—"}${ctx.propertyName ? ` at ${ctx.propertyName}` : ""}.

Your goals:
1) Confirm the services logged from the field app are correct: ${ctx.services.join(", ") || "none listed"}.
2) Confirm the right crew members are assigned to each service.
3) Confirm pricing inputs are intentional (no surprise $0 / missing lines).
4) If anything is wrong, collect corrections clearly and call the tool apply_field_correction.
5) If everything is accurate, call confirm_field_accurate.

Known issues to resolve if still open: ${ctx.issues.join("; ") || "none flagged"}.

Rules:
- Keep turns short (under 25 words when possible).
- One question at a time.
- Never invent prices; only apply what the crew states.
- After corrections are applied, summarize what changed and say a confirmation call may follow.
- Be professional, calm, field-friendly.`;
}

function buildConfirmSystemPrompt(ctx: {
  jobNo: string | null;
  unitNo: string | null;
  summary: string;
  crewName: string | null;
}) {
  return `You are Halo Field Confirm. You are calling ${ctx.crewName || "the crew"} to confirm final dispatch details for job ${ctx.jobNo || "unknown"}, unit ${ctx.unitNo || "—"}.

Read this summary of the verified / corrected work:
${ctx.summary}

Ask them to say YES if correct, or explain any last change.
If they request a change, call apply_field_correction.
If they confirm, call confirm_field_accurate.
Keep it under 2 minutes. Short sentences.`;
}

const toolDefs = [
  {
    type: "function",
    function: {
      name: "apply_field_correction",
      description: "Apply a correction spoken by the crew to the job / dispatch record",
      parameters: {
        type: "object",
        properties: {
          correctionType: {
            type: "string",
            enum: [
              "service_add",
              "service_remove",
              "service_rename",
              "crew_reassign",
              "price_note",
              "unit_fix",
              "other",
            ],
          },
          detail: { type: "string", description: "What the crew said to change" },
          serviceCode: { type: "string" },
          crewName: { type: "string" },
          unitNo: { type: "string" },
          amountDollars: { type: "number" },
        },
        required: ["correctionType", "detail"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_field_accurate",
      description: "Crew confirmed field app inputs are accurate",
      parameters: {
        type: "object",
        properties: {
          notes: { type: "string" },
        },
      },
    },
  },
];

function transientAssistant(opts: {
  kind: FieldCallKind;
  system: string;
  firstMessage: string;
  metadata: Record<string, string>;
}) {
  const base = webhookBase();
  const serverUrl = base ? `${base}/api/vapi/webhook` : undefined;
  return {
    name: opts.kind === "verify" ? "Halo Field Verify" : "Halo Field Confirm",
    firstMessage: opts.firstMessage,
    model: {
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "system", content: opts.system }],
      tools: toolDefs,
    },
    voice: { provider: "11labs", voiceId: "rachel" },
    metadata: opts.metadata,
    ...(serverUrl
      ? {
          server: { url: serverUrl },
          serverMessages: ["tool-calls", "end-of-call-report", "status-update"],
        }
      : {}),
  };
}

export async function startFieldVerifyCall(opts: {
  jobId: string;
  reviewId?: string | null;
  phone?: string | null;
  crewId?: string | null;
}): Promise<{ ok: boolean; call: FieldCallRecord; mock?: boolean; error?: string }> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, opts.jobId)).limit(1);
  if (!job) return { ok: false, call: null as any, error: "Job not found" };

  let crewId = opts.crewId || job.crewLeaderId;
  let phone = opts.phone || null;
  let crewName: string | null = null;
  if (crewId) {
    const [crew] = await db.select().from(crewsTable).where(eq(crewsTable.id, crewId)).limit(1);
    if (crew) {
      crewName = crew.name;
      if (!phone) phone = crew.phone;
    }
  }
  if (!phone) {
    return {
      ok: false,
      call: null as any,
      error: "No crew phone — pass phone or set crews.phone",
    };
  }

  let services: string[] = [];
  let issues: string[] = [];
  try {
    const v = await buildWorkVerification(opts.jobId);
    services = (v.lines || []).map((l: any) => l.serviceCode || l.label || l.name).filter(Boolean);
    issues = (v.suggestions || [])
      .filter((s: any) => s.action !== "confirm_clean")
      .map((s: any) => s.title || s.body)
      .filter(Boolean);
  } catch {
    /* optional */
  }

  const localId = `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata = {
    haloCallId: localId,
    kind: "verify",
    jobId: opts.jobId,
    reviewId: opts.reviewId || "",
    crewId: crewId || "",
  };

  const system = buildVerifySystemPrompt({
    jobNo: job.jobNo,
    unitNo: job.unitNo,
    propertyName: null,
    services,
    crewName,
    issues,
  });
  const firstMessage = `Hi${crewName ? ` ${crewName.split(" ")[0]}` : ""}, this is Halo verifying job ${job.jobNo || "today"} unit ${job.unitNo || ""}. Do the services on your field app look correct?`;

  const record: FieldCallRecord = {
    id: localId,
    kind: "verify",
    jobId: opts.jobId,
    reviewId: opts.reviewId || null,
    crewId: crewId || null,
    phone,
    vapiCallId: null,
    status: "queued",
    corrections: [],
    transcriptSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (mockMode()) {
    record.status = "mock";
    record.vapiCallId = `mock_${localId}`;
    record.transcriptSummary = "MOCK: verification call not dialed (set VAPI_API_KEY + VAPI_PHONE_NUMBER_ID)";
    pushCall(record);
    byVapiId.set(record.vapiCallId, record.id);
    logger.info({ jobId: opts.jobId, phone }, "vapi field verify MOCK call");
    return { ok: true, call: record, mock: true };
  }

  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    return { ok: false, call: null as any, error: "VAPI_PHONE_NUMBER_ID not set" };
  }

  const body: any = {
    phoneNumberId,
    customer: { number: phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}` },
    metadata,
  };
  if (process.env.VAPI_ASSISTANT_ID) {
    body.assistantId = process.env.VAPI_ASSISTANT_ID;
    body.assistantOverrides = {
      firstMessage,
      variableValues: metadata,
    };
  } else {
    body.assistant = transientAssistant({
      kind: "verify",
      system,
      firstMessage,
      metadata,
    });
  }

  try {
    const created = await vapiFetch("/call", body);
    record.vapiCallId = created.id || created.call?.id || null;
    record.status = "ringing";
    pushCall(record);
    if (record.vapiCallId) byVapiId.set(record.vapiCallId, record.id);
    logger.info({ jobId: opts.jobId, vapiCallId: record.vapiCallId }, "vapi verify call started");
    return { ok: true, call: record };
  } catch (err: any) {
    record.status = "failed";
    record.transcriptSummary = err.message;
    pushCall(record);
    return { ok: false, call: record, error: err.message };
  }
}

export async function startFieldConfirmCall(opts: {
  jobId: string;
  reviewId?: string | null;
  phone?: string | null;
  summary?: string;
}): Promise<{ ok: boolean; call: FieldCallRecord; mock?: boolean; error?: string }> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, opts.jobId)).limit(1);
  if (!job) return { ok: false, call: null as any, error: "Job not found" };

  let phone = opts.phone || null;
  let crewName: string | null = null;
  if (job.crewLeaderId) {
    const [crew] = await db.select().from(crewsTable).where(eq(crewsTable.id, job.crewLeaderId)).limit(1);
    if (crew) {
      crewName = crew.name;
      if (!phone) phone = crew.phone;
    }
  }
  if (!phone) return { ok: false, call: null as any, error: "No crew phone" };

  const related = calls.filter((c) => c.jobId === opts.jobId && c.kind === "verify");
  const corrText =
    related.flatMap((c) => c.corrections).map((c) => JSON.stringify(c)).join("; ") ||
    "No changes — original field inputs confirmed.";

  const summary =
    opts.summary ||
    `Job ${job.jobNo}, unit ${job.unitNo}. Corrections: ${corrText}`;

  const localId = `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata = {
    haloCallId: localId,
    kind: "confirm",
    jobId: opts.jobId,
    reviewId: opts.reviewId || "",
  };

  const record: FieldCallRecord = {
    id: localId,
    kind: "confirm",
    jobId: opts.jobId,
    reviewId: opts.reviewId || null,
    crewId: job.crewLeaderId,
    phone,
    vapiCallId: null,
    status: "queued",
    corrections: [],
    transcriptSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (mockMode()) {
    record.status = "mock";
    record.vapiCallId = `mock_${localId}`;
    record.transcriptSummary = "MOCK confirm call";
    pushCall(record);
    return { ok: true, call: record, mock: true };
  }

  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!phoneNumberId) return { ok: false, call: null as any, error: "VAPI_PHONE_NUMBER_ID not set" };

  const system = buildConfirmSystemPrompt({
    jobNo: job.jobNo,
    unitNo: job.unitNo,
    summary,
    crewName,
  });
  const firstMessage = `Hi${crewName ? ` ${crewName.split(" ")[0]}` : ""}, Halo again — quick confirm on job ${job.jobNo}. ${summary.slice(0, 120)}. Does that sound right?`;

  const body: any = {
    phoneNumberId,
    customer: { number: phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}` },
    metadata,
    assistant: transientAssistant({
      kind: "confirm",
      system,
      firstMessage,
      metadata,
    }),
  };

  try {
    const created = await vapiFetch("/call", body);
    record.vapiCallId = created.id || null;
    record.status = "ringing";
    pushCall(record);
    if (record.vapiCallId) byVapiId.set(record.vapiCallId, record.id);
    return { ok: true, call: record };
  } catch (err: any) {
    record.status = "failed";
    record.transcriptSummary = err.message;
    pushCall(record);
    return { ok: false, call: record, error: err.message };
  }
}

/** Apply correction from Vapi tool → job notes + review field edits + board touch. */
export async function applyFieldCorrection(opts: {
  jobId: string;
  reviewId?: string | null;
  correction: Record<string, unknown>;
  haloCallId?: string | null;
}) {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, opts.jobId)).limit(1);
  if (!job) return { ok: false, error: "Job not found" };

  const line = `[Vapi ${new Date().toISOString()}] ${opts.correction.correctionType}: ${opts.correction.detail}`;
  const prevNotes = (job as any).notes || (job as any).internalNotes || "";
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  // Best-effort note fields
  if ("notes" in job || true) {
    (patch as any).notes = prevNotes ? `${prevNotes}\n${line}` : line;
  }
  if (opts.correction.unitNo) {
    (patch as any).unitNo = String(opts.correction.unitNo);
  }
  // Touch board so dispatch refreshes
  const board = job.boardStatus || job.status;
  if (board) {
    (patch as any).boardStatus = board;
  }

  try {
    await db.update(jobsTable).set(patch as any).where(eq(jobsTable.id, opts.jobId));
  } catch (err) {
    logger.warn({ err }, "applyFieldCorrection job update partial");
  }

  if (opts.reviewId) {
    try {
      const [rev] = await db
        .select()
        .from(workReviewsTable)
        .where(eq(workReviewsTable.id, opts.reviewId))
        .limit(1);
      if (rev) {
        const edits = {
          ...((rev.fieldEdits as object) || {}),
          vapiCorrections: [
            ...(((rev.fieldEdits as any)?.vapiCorrections as any[]) || []),
            { ...opts.correction, at: new Date().toISOString() },
          ],
          lastVapiDetail: opts.correction.detail,
        };
        await db
          .update(workReviewsTable)
          .set({ fieldEdits: edits, updatedAt: new Date() } as any)
          .where(eq(workReviewsTable.id, opts.reviewId));
      }
    } catch (err) {
      logger.warn({ err }, "applyFieldCorrection review update failed");
    }
  }

  if (opts.haloCallId) {
    const c = calls.find((x) => x.id === opts.haloCallId);
    if (c) {
      c.corrections.push(opts.correction);
      c.updatedAt = new Date().toISOString();
    }
  }

  logger.info({ jobId: opts.jobId, correction: opts.correction }, "vapi field correction applied");
  return {
    ok: true,
    jobId: opts.jobId,
    dispatchUpdated: true,
    correction: opts.correction,
    message: "Correction saved to job notes and review; dispatch record touched",
  };
}

export async function markFieldAccurate(opts: {
  jobId: string;
  reviewId?: string | null;
  notes?: string;
  haloCallId?: string | null;
}) {
  if (opts.reviewId) {
    try {
      const [rev] = await db
        .select()
        .from(workReviewsTable)
        .where(eq(workReviewsTable.id, opts.reviewId))
        .limit(1);
      if (rev) {
        const edits = {
          ...((rev.fieldEdits as object) || {}),
          vapiConfirmedAccurate: true,
          vapiConfirmNotes: opts.notes || null,
          vapiConfirmedAt: new Date().toISOString(),
        };
        await db
          .update(workReviewsTable)
          .set({ fieldEdits: edits, updatedAt: new Date() } as any)
          .where(eq(workReviewsTable.id, opts.reviewId));
      }
    } catch {
      /* */
    }
  }
  if (opts.haloCallId) {
    const c = calls.find((x) => x.id === opts.haloCallId);
    if (c) {
      c.status = "completed";
      c.transcriptSummary = opts.notes || "Crew confirmed accurate";
      c.updatedAt = new Date().toISOString();
    }
  }
  return { ok: true, jobId: opts.jobId, confirmed: true };
}

/** Handle Vapi server webhook (tool-calls + end-of-call). */
export async function handleVapiWebhook(body: any) {
  const message = body.message || body;
  const type = message.type || body.type;

  if (type === "tool-calls" || type === "function-call") {
    const call = message.call || body.call || {};
    const meta = call.metadata || message.metadata || {};
    const jobId = meta.jobId || meta.job_id;
    const reviewId = meta.reviewId || meta.review_id || null;
    const haloCallId = meta.haloCallId || null;

    const toolWithToolCallList = message.toolCallList || message.toolCalls || [];
    const results = [];

    // Vapi tool-calls format variants
    const callsList =
      toolWithToolCallList.length > 0
        ? toolWithToolCallList
        : message.functionCall
          ? [{ function: message.functionCall }]
          : [];

    for (const tc of callsList) {
      const name = tc.function?.name || tc.name || tc.toolCall?.function?.name;
      let params: any = tc.function?.arguments || tc.arguments || tc.params || {};
      if (typeof params === "string") {
        try {
          params = JSON.parse(params);
        } catch {
          params = { detail: params };
        }
      }

      if (name === "apply_field_correction" && jobId) {
        const r = await applyFieldCorrection({
          jobId,
          reviewId,
          correction: params,
          haloCallId,
        });
        results.push({ toolCallId: tc.id || tc.toolCallId, result: r });
      } else if (name === "confirm_field_accurate" && jobId) {
        const r = await markFieldAccurate({
          jobId,
          reviewId,
          notes: params.notes,
          haloCallId,
        });
        results.push({ toolCallId: tc.id || tc.toolCallId, result: r });
      } else {
        results.push({
          toolCallId: tc.id || tc.toolCallId,
          result: { ok: false, error: `Unhandled tool ${name}` },
        });
      }
    }

    // Vapi expects results array for tool-calls
    return { results };
  }

  if (type === "end-of-call-report" || type === "hang") {
    const call = message.call || {};
    const vapiId = call.id;
    const localId = (call.metadata || {}).haloCallId || (vapiId && byVapiId.get(vapiId));
    const rec = localId ? calls.find((c) => c.id === localId) : null;
    if (rec) {
      rec.status = "completed";
      rec.transcriptSummary =
        message.summary || message.analysis?.summary || message.transcript?.slice?.(0, 500) || null;
      rec.updatedAt = new Date().toISOString();

      // After VERIFY with corrections → auto CONFIRM call
      if (rec.kind === "verify" && rec.corrections.length > 0) {
        try {
          await startFieldConfirmCall({
            jobId: rec.jobId,
            reviewId: rec.reviewId,
            phone: rec.phone,
          });
          logger.info({ jobId: rec.jobId }, "auto confirm call after verify corrections");
        } catch (err) {
          logger.warn({ err }, "auto confirm call failed");
        }
      }
    }
    return { ok: true };
  }

  if (type === "status-update") {
    const call = message.call || {};
    const vapiId = call.id;
    const localId = (call.metadata || {}).haloCallId || (vapiId && byVapiId.get(vapiId));
    const rec = localId ? calls.find((c) => c.id === localId) : null;
    if (rec && message.status) {
      const s = String(message.status);
      if (s.includes("progress") || s === "in-progress") rec.status = "in_progress";
      if (s === "ringing") rec.status = "ringing";
      if (s === "ended" || s === "completed") rec.status = "completed";
      rec.updatedAt = new Date().toISOString();
    }
    return { ok: true };
  }

  return { ok: true, ignored: type };
}

export function getVapiConfigStatus() {
  return {
    ok: true,
    service: "vapi-field-verify",
    mock: mockMode(),
    hasApiKey: !!process.env.VAPI_API_KEY,
    hasPhoneNumberId: !!process.env.VAPI_PHONE_NUMBER_ID,
    hasAssistantId: !!process.env.VAPI_ASSISTANT_ID,
    webhookBase: webhookBase() || null,
    webhookPath: "/api/vapi/webhook",
    recentCalls: calls.slice(0, 10),
  };
}
