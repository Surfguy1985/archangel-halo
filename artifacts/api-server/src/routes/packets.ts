import { Router, type IRouter } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { findCrewByPortalBearer } from "../lib/portalToken";
import {
  db,
  crewsTable,
  crewMessagesTable,
  crewPacketsTable,
  notificationsTable,
} from "@workspace/db";
import {
  ListPacketTemplatesResponse,
  ListCrewPacketsParams,
  ListCrewPacketsResponse,
  SendCrewPacketParams,
  SendCrewPacketBody,
  SendCrewPacketResponse,
  ListPortalPacketsParams,
  ListPortalPacketsResponse,
  GetPortalPacketParams,
  GetPortalPacketResponse,
  SavePortalPacketParams,
  SavePortalPacketBody,
  SavePortalPacketResponse,
  SubmitPortalPacketParams,
  SubmitPortalPacketBody,
  SubmitPortalPacketResponse,
} from "@workspace/api-zod";
import {
  listTemplates,
  getTemplate,
  type SignatureValue,
  type PacketAttachmentValue,
} from "@workspace/onboarding-packet";
import { ser } from "../lib/serialize";
import { ADMIN_EMAIL } from "../lib/notifications";
import { sendEmail } from "../lib/email";
import { readSourcePdf } from "../lib/packetAssets";
import { compilePacket } from "../lib/packetPdf";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();

type CrewRow = typeof crewsTable.$inferSelect;
type PacketRow = typeof crewPacketsTable.$inferSelect;

async function crewByToken(token: string): Promise<CrewRow | null> {
  return findCrewByPortalBearer(token);
}

function packetPayload(row: PacketRow) {
  return {
    id: row.id,
    crewId: row.crewId,
    templateKey: row.templateKey,
    status: row.status,
    applicability: (row.applicability as Record<string, unknown> | null) ?? null,
    formsData: (row.formsData as Record<string, unknown> | null) ?? null,
    signatures: (row.signatures as Record<string, unknown> | null) ?? null,
    attachments: (row.attachments as Record<string, unknown> | null) ?? null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

// ---- Admin ----

router.get("/packet-templates", async (_req, res): Promise<void> => {
  res.json(ListPacketTemplatesResponse.parse(listTemplates()));
});

router.get("/crews/:id/packets", async (req, res): Promise<void> => {
  const { id } = ListCrewPacketsParams.parse(req.params);
  const rows = await db
    .select()
    .from(crewPacketsTable)
    .where(eq(crewPacketsTable.crewId, id))
    .orderBy(desc(crewPacketsTable.createdAt));
  res.json(ListCrewPacketsResponse.parse(rows.map(packetPayload)));
});

router.post("/crews/:id/packets", async (req, res): Promise<void> => {
  const { id } = SendCrewPacketParams.parse(req.params);
  const body = SendCrewPacketBody.parse(req.body);
  const tpl = getTemplate(body.templateKey);
  if (!tpl) {
    res.status(400).json({ error: "Unknown packet template" });
    return;
  }
  const [crew] = await db.select().from(crewsTable).where(eq(crewsTable.id, id));
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const [row] = await db
    .insert(crewPacketsTable)
    .values({ crewId: id, templateKey: tpl.key, status: "sent" })
    .returning();
  await db.insert(crewMessagesTable).values({
    crewId: id,
    sender: "admin",
    body: `We've sent you an onboarding packet to complete: ${tpl.label}. Open your portal to fill it out and sign.`,
  });
  await db.insert(notificationsTable).values({
    kind: "packet_sent",
    priority: "normal",
    entityType: "crew",
    entityId: id,
    title: `Onboarding packet sent to ${crew.name}`,
    body: tpl.label,
  });
  res.status(201).json(SendCrewPacketResponse.parse(packetPayload(row)));
});

// ---- Portal ----

router.get("/portal/:token/packets", async (req, res): Promise<void> => {
  const { token } = ListPortalPacketsParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const rows = await db
    .select()
    .from(crewPacketsTable)
    .where(eq(crewPacketsTable.crewId, crew.id))
    .orderBy(desc(crewPacketsTable.createdAt));
  res.json(ListPortalPacketsResponse.parse(rows.map(packetPayload)));
});

async function portalPacket(
  token: string,
  packetId: string,
): Promise<{ crew: CrewRow; row: PacketRow } | null> {
  const crew = await crewByToken(token);
  if (!crew) return null;
  const [row] = await db
    .select()
    .from(crewPacketsTable)
    .where(
      and(
        eq(crewPacketsTable.id, packetId),
        eq(crewPacketsTable.crewId, crew.id),
      ),
    );
  if (!row) return null;
  return { crew, row };
}

router.get("/portal/:token/packets/:packetId", async (req, res): Promise<void> => {
  const { token, packetId } = GetPortalPacketParams.parse(req.params);
  const found = await portalPacket(token, packetId);
  if (!found) {
    res.status(404).json({ error: "Packet not found" });
    return;
  }
  res.json(GetPortalPacketResponse.parse(packetPayload(found.row)));
});

router.put("/portal/:token/packets/:packetId", async (req, res): Promise<void> => {
  const { token, packetId } = SavePortalPacketParams.parse(req.params);
  const body = SavePortalPacketBody.parse(req.body);
  const found = await portalPacket(token, packetId);
  if (!found) {
    res.status(404).json({ error: "Packet not found" });
    return;
  }
  if (found.row.status === "submitted") {
    res.status(409).json({ error: "Packet already submitted" });
    return;
  }
  const patch: Partial<typeof crewPacketsTable.$inferInsert> = {};
  if (body.applicability !== undefined) patch.applicability = body.applicability;
  if (body.formsData !== undefined) patch.formsData = body.formsData;
  if (body.signatures !== undefined) patch.signatures = body.signatures;
  if (body.attachments !== undefined) patch.attachments = body.attachments;
  patch.status = "in_progress";
  const [transitioned] = await db
    .update(crewPacketsTable)
    .set({ status: "in_progress" })
    .where(
      and(
        eq(crewPacketsTable.id, packetId),
        eq(crewPacketsTable.status, "sent"),
      ),
    )
    .returning({ id: crewPacketsTable.id });
  const [row] = await db
    .update(crewPacketsTable)
    .set(patch)
    .where(
      and(
        eq(crewPacketsTable.id, packetId),
        ne(crewPacketsTable.status, "submitted"),
      ),
    )
    .returning();
  if (!row) {
    res.status(409).json({ error: "Packet already submitted" });
    return;
  }
  if (transitioned) {
    const tpl = getTemplate(found.row.templateKey);
    await db.insert(notificationsTable).values({
      kind: "packet_started",
      priority: "normal",
      entityType: "crew",
      entityId: found.crew.id,
      title: `${found.crew.name} started their onboarding packet`,
      body: tpl?.label ?? found.row.templateKey,
    });
  }
  res.json(SavePortalPacketResponse.parse(packetPayload(row)));
});

router.post(
  "/portal/:token/packets/:packetId/submit",
  async (req, res): Promise<void> => {
    const { token, packetId } = SubmitPortalPacketParams.parse(req.params);
    const body = SubmitPortalPacketBody.parse(req.body);
    const found = await portalPacket(token, packetId);
    if (!found) {
      res.status(404).json({ error: "Packet not found" });
      return;
    }
    const tpl = getTemplate(found.row.templateKey);
    const now = new Date();
    const patch: Partial<typeof crewPacketsTable.$inferInsert> = {
      status: "submitted",
      submittedAt: now,
    };
    if (body.applicability !== undefined) patch.applicability = body.applicability;
    if (body.formsData !== undefined) patch.formsData = body.formsData;
    if (body.signatures !== undefined) patch.signatures = body.signatures;
    if (body.attachments !== undefined) patch.attachments = body.attachments;
    const [row] = await db
      .update(crewPacketsTable)
      .set(patch)
      .where(eq(crewPacketsTable.id, packetId))
      .returning();

    await db.insert(crewMessagesTable).values({
      crewId: found.crew.id,
      sender: "crew",
      body: `I've completed and submitted the onboarding packet: ${tpl?.label ?? found.row.templateKey}.`,
    });
    await db.insert(notificationsTable).values({
      kind: "packet_submitted",
      priority: "now",
      entityType: "crew",
      entityId: found.crew.id,
      title: `${found.crew.name} submitted their onboarding packet`,
      body: tpl?.label ?? found.row.templateKey,
    });
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Onboarding packet completed — ${found.crew.name}`,
      html: submittedEmail(found.crew.name, tpl?.label ?? found.row.templateKey),
    });

    res.json(SubmitPortalPacketResponse.parse(packetPayload(row)));
  },
);

function submittedEmail(crewName: string, label: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f3f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(23,24,28,0.08);">
    <tr><td>
      <div style="font-size:12px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#8f6a1f;">ArchAngel · HALO</div>
      <div style="font-size:20px;font-weight:800;color:#17181c;margin-top:6px;">Onboarding packet completed</div>
      <div style="font-size:14px;color:#3a3c42;line-height:1.55;margin-top:12px;">
        <strong>${esc(crewName)}</strong> has finished, signed, and submitted their onboarding packet.
      </div>
      <div style="font-size:13px;color:#6b6e76;margin-top:10px;">Packet: ${esc(label)}</div>
      <div style="font-size:13px;color:#6b6e76;margin-top:14px;line-height:1.55;">Open the crew's profile in HALO to download the compiled PDF with every form, response, and signature.</div>
    </td></tr>
  </table>
  </td></tr></table>
  </body></html>`;
}

// ---- Binary PDF routes (not part of the JSON API) ----

/** Public source legal PDF for a form, rendered for the crew to read. */
router.get(
  "/packets/templates/:templateKey/forms/:code/pdf",
  async (req, res): Promise<void> => {
    const { templateKey, code } = req.params;
    const bytes = await readSourcePdf(templateKey, code);
    if (!bytes) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${code}.pdf"`);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(Buffer.from(bytes));
  },
);

/** Admin: compiled packet PDF with all forms, responses, and signatures. */
router.get("/packets/:packetId/pdf", async (req, res): Promise<void> => {
  const { packetId } = req.params;
  const [row] = await db
    .select()
    .from(crewPacketsTable)
    .where(eq(crewPacketsTable.id, packetId));
  if (!row) {
    res.status(404).json({ error: "Packet not found" });
    return;
  }
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, row.crewId));

  const applicability = (row.applicability as { insured?: boolean; ach?: boolean } | null) ?? {};
  const storage = new ObjectStorageService();

  try {
    const bytes = await compilePacket({
      templateKey: row.templateKey,
      crewName: crew?.name ?? "Subcontractor",
      applicability: {
        insured: Boolean(applicability.insured),
        ach: Boolean(applicability.ach),
      },
      formsData: (row.formsData as Record<string, Record<string, unknown>>) ?? {},
      signatures: (row.signatures as Record<string, SignatureValue>) ?? {},
      attachments: (row.attachments as Record<string, PacketAttachmentValue[]>) ?? {},
      submittedAt: row.submittedAt ? row.submittedAt.toISOString().slice(0, 10) : null,
      loadAttachment: async (att) => {
        try {
          const file = await storage.getObjectEntityFile(att.storagePath);
          const [buf] = await file.download();
          return { bytes: new Uint8Array(buf), contentType: att.contentType ?? null };
        } catch {
          return null;
        }
      },
    });
    const safeName = (crew?.name ?? "packet").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="welcome-packet-${safeName}.pdf"`,
    );
    res.end(Buffer.from(bytes));
  } catch (err) {
    req.log.error({ err }, "Failed to compile packet PDF");
    res.status(500).json({ error: "Failed to compile packet PDF" });
  }
});

export default router;
