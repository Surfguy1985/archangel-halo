/**
 * Push a property-entered PO into Base44 so dispatch and the field app
 * fill in without a second typing. Best-effort: HALO keeps the stamp even
 * if Work is down.
 */

import { logger } from "./logger";

export const DEFAULT_BASE44_WRITE_URL =
  "https://wakeful-ready-track-flow.base44.app/functions/haloWrite";

export async function pushPoToBase44(input: {
  poNumber: string;
  jobNo: string;
  unitNo: string | null;
  propertyName: string;
  unitId: string | null;
  crewJobIds: string[];
}): Promise<{ ok: boolean; error: string | null }> {
  const token = process.env.HALO_WRITE_TOKEN || process.env.HALO_READ_TOKEN || "";
  const url = process.env.BASE44_WRITE_URL || DEFAULT_BASE44_WRITE_URL;
  if (!token) {
    return { ok: false, error: "Base44 write token is not configured" };
  }
  if (!input.unitId && input.crewJobIds.length === 0) {
    return { ok: false, error: "This unit is not mapped to a Work app record yet." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-halo-token": token,
        accept: "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        action: "set_po",
        po_number: input.poNumber,
        job_no: input.jobNo,
        unit_number: input.unitNo,
        property: input.propertyName,
        unit_id: input.unitId,
        crew_job_ids: input.crewJobIds,
      }),
    });
    if (!resp.ok) {
      const err = `Work app returned ${resp.status}`;
      logger.warn({ status: resp.status, url }, "base44 write: PO push failed");
      return { ok: false, error: err };
    }
    return { ok: true, error: null };
  } catch (err) {
    const error = err instanceof Error && err.name === "AbortError" ? "Work app timed out" : "Work app is unreachable";
    logger.warn({ err }, "base44 write: PO push failed");
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}
