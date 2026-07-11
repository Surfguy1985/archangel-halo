import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, businessSettingsTable } from "@workspace/db";
import {
  GetBusinessSettingsResponse,
  UpdateBusinessSettingsBody,
  UpdateBusinessSettingsResponse,
} from "@workspace/api-zod";
import { getBusinessSettings } from "../lib/businessSettings";

const router: IRouter = Router();

function serialize(row: {
  companyName: string;
  tagline: string;
  street: string;
  city: string;
  attn: string;
  phone: string;
  email: string;
  paymentInstructions: string;
}) {
  return {
    companyName: row.companyName,
    tagline: row.tagline,
    street: row.street,
    city: row.city,
    attn: row.attn,
    phone: row.phone,
    email: row.email,
    paymentInstructions: row.paymentInstructions,
  };
}

router.get("/settings/business", async (_req, res): Promise<void> => {
  const settings = await getBusinessSettings();
  res.json(GetBusinessSettingsResponse.parse(serialize(settings)));
});

router.put("/settings/business", async (req, res): Promise<void> => {
  const body = UpdateBusinessSettingsBody.parse(req.body);
  const existing = await getBusinessSettings();
  const [updated] = await db
    .update(businessSettingsTable)
    .set({
      ...(body.companyName != null ? { companyName: body.companyName } : {}),
      ...(body.tagline != null ? { tagline: body.tagline } : {}),
      ...(body.street != null ? { street: body.street } : {}),
      ...(body.city != null ? { city: body.city } : {}),
      ...(body.attn != null ? { attn: body.attn } : {}),
      ...(body.phone != null ? { phone: body.phone } : {}),
      ...(body.email != null ? { email: body.email } : {}),
      ...(body.paymentInstructions != null
        ? { paymentInstructions: body.paymentInstructions }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(businessSettingsTable.id, existing.id))
    .returning();
  res.json(UpdateBusinessSettingsResponse.parse(serialize(updated)));
});

export default router;
