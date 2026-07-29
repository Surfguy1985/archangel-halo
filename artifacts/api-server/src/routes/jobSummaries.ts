import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  jobsTable,
  jobSummariesTable,
  propertiesTable,
  contactsTable,
  crewsTable,
  crewPhotosTable,
  type JobSummary,
  type SummaryChecklistSection,
  type SummaryFlag,
  type SummaryPhoto,
} from "@workspace/db";
import {
  GetJobSummaryResponse,
  SaveJobSummaryBody,
  SaveJobSummaryResponse,
  SendJobSummaryBody,
  SendJobSummaryResponse,
  GetPublicJobSummaryResponse,
} from "@workspace/api-zod";
import { crewPhotosForJobs } from "../lib/jobPhotos";
import { sendEmail } from "../lib/email";
import { getBusinessSettings } from "../lib/businessSettings";
import { raiseClientCard } from "../lib/clientBoard";

const router: IRouter = Router();

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publicBaseUrl(): string {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}` : "";
}

function shareUrl(token: string): string {
  const base = publicBaseUrl();
  return base ? `${base}/summary/${token}` : `/summary/${token}`;
}

// Flag options mirrored from the Archangel recap sheet ("While we were there, we noticed…").
const FLAG_OPTIONS = [
  "Leak / drip (sink, fixture)",
  "Toilet running or loose",
  "Mold or mildew",
  "Damaged floor or wall",
  "Burnt-out light bulb(s)",
  "Cracked tile / open grout",
  "Slow or clogged drain",
  "Failing caulk / seal",
  "Damaged blinds / screens",
  "Pest / insect activity",
];

const TOUCH_UP_CHECKLIST: SummaryChecklistSection[] = [
  {
    section: "Kitchen",
    items: [
      "Oven interior, racks & hood degreased",
      "Range pulled; behind, under & floor",
      "Fridge pulled; interior, coils & behind",
      "Cabinets & drawers in/out; tops degreased",
      "Countertops & sink cleaned; sink polished",
      "Dishwasher cleaned; parts run & reset",
      "Floor, baseboards & appliance panels",
    ].map((label) => ({ label, checked: true })),
  },
  {
    section: "Bathrooms",
    items: [
      "Tile & grout cleaned",
      "Tub, shower & fixtures cleaned",
      "Toilet in/out, base & supply line",
      "Vanity, sink & counter wiped spot-free",
      "Mirror, light fixture & bulbs cleaned",
      "Rods, bars, holders & cabinet cleaned",
      "Checked & reported mold / mildew",
    ].map((label) => ({ label, checked: true })),
  },
  {
    section: "Rest of unit",
    items: [
      "Windows, sills, frames & blinds",
      "Doors, closets, shelves & racks",
      "Ceiling fans, chandeliers & vents",
      "Washer & dryer incl. lint traps",
      "Baseboards wiped throughout",
      "Full-unit vacuum (corners & fans)",
      "Patio, storage & breezeway cleared",
    ].map((label) => ({ label, checked: true })),
  },
];

function defaultChecklist(category: string | null, description: string | null): SummaryChecklistSection[] {
  if (category && /clean/i.test(category)) return TOUCH_UP_CHECKLIST;
  const items = (description ?? "")
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((label) => ({ label, checked: true }));
  return [
    {
      section: "Scope of work",
      items: items.length > 0 ? items : [{ label: category || "Work completed as scoped", checked: true }],
    },
  ];
}

function defaultFlags(): SummaryFlag[] {
  return FLAG_OPTIONS.map((label) => ({ label, checked: false, note: "" }));
}

async function loadContext(jobId: string) {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return null;
  const [property] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, job.propertyId));
  return { job, property: property ?? null };
}

async function serDoc(summary: JobSummary | null, jobId: string) {
  const ctx = await loadContext(jobId);
  if (!ctx) return null;
  const { job, property } = ctx;
  const settings = await getBusinessSettings();
  const business = {
    companyName: settings.companyName || "ArchAngel Contractors",
    phone: settings.phone || null,
    email: settings.email || null,
  };
  const propertyName = property?.name ?? null;
  const propertyAddress = property
    ? [property.address, property.city].filter(Boolean).join(", ") || null
    : null;

  if (summary) {
    return {
      jobId,
      propertyId: job.propertyId,
      exists: true,
      token: summary.token,
      shareUrl: shareUrl(summary.token),
      title: summary.title,
      unitNumber: summary.unitNumber,
      serviceDate: summary.serviceDate,
      crewLead: summary.crewLead,
      timeIn: summary.timeIn,
      timeOut: summary.timeOut,
      checklist: summary.checklist,
      flags: summary.flags,
      observations: summary.observations,
      touchUpNotes: summary.touchUpNotes,
      overallResult: summary.overallResult,
      photos: summary.photos.map((p) => ({ ...p, url: `/api/storage${p.path}` })),
      status: summary.status,
      sentTo: summary.sentTo,
      sentAt: summary.sentAt ? summary.sentAt.toISOString() : null,
      propertyName,
      propertyAddress,
      business,
    };
  }

  // Prefilled draft — nothing saved yet.
  let crewLead: string | null = null;
  if (job.crewLeaderId) {
    const [crew] = await db
      .select({ name: crewsTable.name })
      .from(crewsTable)
      .where(eq(crewsTable.id, job.crewLeaderId));
    crewLead = crew?.name ?? null;
  }
  const category = job.category ?? "Service";
  return {
    jobId,
    propertyId: job.propertyId,
    exists: false,
    token: null,
    shareUrl: null,
    title: `${category} — Service Recap`,
    unitNumber: job.unitNo,
    serviceDate: job.scheduledOn ?? null,
    crewLead,
    timeIn: job.scheduledTime ?? null,
    timeOut: null,
    checklist: defaultChecklist(job.category, job.description),
    flags: defaultFlags(),
    observations: null,
    touchUpNotes: null,
    overallResult: "met",
    photos: [] as (SummaryPhoto & { url: string })[],
    status: "draft",
    sentTo: null,
    sentAt: null,
    propertyName,
    propertyAddress,
    business,
  };
}

/** Crew photos matched to this job, with phase info, for the attach picker. */
async function jobPhotosWithPhase(jobId: string) {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return [];
  const matched = await crewPhotosForJobs([
    {
      id: job.id,
      jobNo: job.jobNo,
      unitNo: job.unitNo,
      crewLeaderId: job.crewLeaderId,
      scheduledOn: job.scheduledOn,
    },
  ]);
  const ids = matched.map((m) => m.id);
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(crewPhotosTable)
    .where(inArray(crewPhotosTable.id, ids));
  return rows.map((r) => ({
    phase: r.phase ?? "progress",
    path: r.storagePath,
    url: `/api/storage${r.storagePath}`,
  }));
}

router.get("/jobs/:id/summary", async (req, res): Promise<void> => {
  const jobId = req.params.id;
  const [summary] = await db
    .select()
    .from(jobSummariesTable)
    .where(eq(jobSummariesTable.jobId, jobId));
  const doc = await serDoc(summary ?? null, jobId);
  if (!doc) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const [availablePhotos, contacts] = await Promise.all([
    jobPhotosWithPhase(jobId),
    db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.propertyId, doc.propertyId)),
  ]);
  const suggested =
    contacts.find((c) => (c.role ?? "").toLowerCase().includes("bill"))?.email ??
    contacts.find((c) => c.email)?.email ??
    null;
  res.json(
    GetJobSummaryResponse.parse({
      doc,
      availablePhotos,
      suggestedRecipient: suggested,
    }),
  );
});

router.put("/jobs/:id/summary", async (req, res): Promise<void> => {
  const jobId = req.params.id;
  const body = SaveJobSummaryBody.parse(req.body);
  const ctx = await loadContext(jobId);
  if (!ctx) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(jobSummariesTable)
    .where(eq(jobSummariesTable.jobId, jobId));
  const values = {
    ...(body.title != null ? { title: body.title } : {}),
    ...(body.unitNumber !== undefined ? { unitNumber: body.unitNumber } : {}),
    ...(body.serviceDate !== undefined ? { serviceDate: body.serviceDate } : {}),
    ...(body.crewLead !== undefined ? { crewLead: body.crewLead } : {}),
    ...(body.timeIn !== undefined ? { timeIn: body.timeIn } : {}),
    ...(body.timeOut !== undefined ? { timeOut: body.timeOut } : {}),
    ...(body.checklist != null ? { checklist: body.checklist } : {}),
    ...(body.flags != null ? { flags: body.flags } : {}),
    ...(body.observations !== undefined ? { observations: body.observations } : {}),
    ...(body.touchUpNotes !== undefined ? { touchUpNotes: body.touchUpNotes } : {}),
    ...(body.overallResult != null ? { overallResult: body.overallResult } : {}),
    ...(body.photos != null ? { photos: body.photos } : {}),
    updatedAt: new Date(),
  };
  let saved: JobSummary;
  if (existing) {
    [saved] = await db
      .update(jobSummariesTable)
      .set(values)
      .where(eq(jobSummariesTable.id, existing.id))
      .returning();
  } else {
    [saved] = await db
      .insert(jobSummariesTable)
      .values({
        jobId,
        propertyId: ctx.job.propertyId,
        token: randomBytes(18).toString("base64url"),
        title: body.title ?? "Service Recap",
        unitNumber: body.unitNumber ?? ctx.job.unitNo,
        serviceDate: body.serviceDate ?? ctx.job.scheduledOn ?? null,
        crewLead: body.crewLead ?? null,
        timeIn: body.timeIn ?? null,
        timeOut: body.timeOut ?? null,
        checklist: body.checklist ?? defaultChecklist(ctx.job.category, ctx.job.description),
        flags: body.flags ?? defaultFlags(),
        observations: body.observations ?? null,
        touchUpNotes: body.touchUpNotes ?? null,
        overallResult: body.overallResult ?? "met",
        photos: body.photos ?? [],
      })
      .returning();
  }
  const doc = await serDoc(saved, jobId);
  res.json(SaveJobSummaryResponse.parse(doc));
});

router.post("/jobs/:id/summary/send", async (req, res): Promise<void> => {
  const jobId = req.params.id;
  const body = SendJobSummaryBody.parse(req.body);
  const to = body.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }
  const [summary] = await db
    .select()
    .from(jobSummariesTable)
    .where(eq(jobSummariesTable.jobId, jobId));
  if (!summary) {
    res.status(404).json({ error: "Save the summary before sending it" });
    return;
  }
  const ctx = await loadContext(jobId);
  if (!ctx) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const settings = await getBusinessSettings();
  const company = settings.companyName || "ArchAngel Contractors";
  const link = shareUrl(summary.token);
  const flagged = summary.flags.filter((f) => f.checked);
  const unit = summary.unitNumber ? ` — Unit ${summary.unitNumber}` : "";
  const flaggedHtml =
    flagged.length > 0
      ? `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:14px 16px;margin:14px 0">
          <b style="color:#B91C1C">⚑ Flagged for your attention${summary.unitNumber ? ` (Unit ${escHtml(summary.unitNumber)})` : ""}:</b>
          <ul style="margin:8px 0 0;padding-left:18px">
            ${flagged
              .map(
                (f) =>
                  `<li>${escHtml(f.label)}${f.note ? ` — ${escHtml(f.note)}` : ""}</li>`,
              )
              .join("")}
          </ul>
        </div>`
      : "";
  const note = body.message
    ? `<p style="background:#f4f5f7;border-radius:8px;padding:12px 14px">${escHtml(body.message)}</p>`
    : "";
  const result = await sendEmail({
    to,
    subject: `${ctx.property?.name ?? "Your property"}${unit} — ${summary.title} from ${company}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#101318">
        <h2 style="margin-bottom:4px">${escHtml(summary.title)}</h2>
        <p>${escHtml(company)} completed service at <b>${escHtml(ctx.property?.name ?? "")}</b>${escHtml(unit)}. The full recap — checklist, notes, and before &amp; after photos — is one click away.</p>
        ${flaggedHtml}
        ${note}
        <p><a href="${link}" style="background:#B4FF44;color:#000;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px;display:inline-block">View the job summary</a></p>
        <p style="color:#667085;font-size:13px">Or copy this link: ${link}</p>
      </div>`,
  });
  if (!result.ok) {
    res.status(400).json({ error: result.error ?? "Email delivery failed" });
    return;
  }
  const [updated] = await db
    .update(jobSummariesTable)
    .set({ status: "sent", sentTo: to, sentAt: new Date(), updatedAt: new Date() })
    .where(eq(jobSummariesTable.id, summary.id))
    .returning();
  // Mirror onto the client board. Flagged areas get their own card so they
  // can be worked independently of just reading the recap.
  if (ctx.job?.propertyId) {
    await raiseClientCard({
      propertyId: ctx.job.propertyId,
      kind: "summary",
      title: `${summary.title}${unit}`,
      body: `Job recap from Archangel Contractors — checklist, notes, and before & after photos.`,
      actionLabel: "View recap",
      links: [{ label: "Open job summary", url: link, kind: "summary" }],
      sourceType: "job_summary",
      sourceId: summary.id,
      jobId,
    });
    if (flagged.length > 0) {
      await raiseClientCard({
        propertyId: ctx.job.propertyId,
        kind: "flag",
        title: `⚑ ${flagged.length} area${flagged.length === 1 ? "" : "s"} flagged${unit}`,
        body: flagged.map((f) => `• ${f.label}${f.note ? ` — ${f.note}` : ""}`).join("\n"),
        actionLabel: "Review flagged areas",
        links: [{ label: "See details in the summary", url: link, kind: "summary" }],
        sourceType: "job_summary_flags",
        sourceId: summary.id,
        jobId,
      });
    }
  }
  const doc = await serDoc(updated, jobId);
  res.json(SendJobSummaryResponse.parse(doc));
});

router.get("/job-summaries/:token", async (req, res): Promise<void> => {
  const [summary] = await db
    .select()
    .from(jobSummariesTable)
    .where(eq(jobSummariesTable.token, req.params.token));
  if (!summary) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const full = await serDoc(summary, summary.jobId);
  if (!full) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  // Strict public DTO: no internal IDs, token, or delivery metadata.
  const doc = {
    title: full.title,
    unitNumber: full.unitNumber,
    serviceDate: full.serviceDate,
    crewLead: full.crewLead,
    timeIn: full.timeIn,
    timeOut: full.timeOut,
    checklist: full.checklist,
    observations: full.observations,
    touchUpNotes: full.touchUpNotes,
    overallResult: full.overallResult,
    photos: full.photos,
    propertyName: full.propertyName,
    propertyAddress: full.propertyAddress,
    business: full.business,
  };
  res.json(
    GetPublicJobSummaryResponse.parse({
      doc,
      flaggedItems: summary.flags
        .filter((f) => f.checked)
        .map((f) => (f.note ? `${f.label} — ${f.note}` : f.label)),
      // The PM-managed community box view (client CMS) ships in a later build;
      // until then every property uses the generic box template.
      hasBoard: false,
    }),
  );
});

export default router;
