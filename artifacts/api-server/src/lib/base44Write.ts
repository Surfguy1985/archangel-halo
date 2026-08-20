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


/** Push pricing discrepancy cards into Base44 after work logged / job completed. */
export async function pushPricingAlertToBase44(input: {
  jobId: string;
  jobNo?: string | null;
  unitNo?: string | null;
  propertyName?: string | null;
  discrepancies: Array<{
    id: string; type: string; severity: string; status: string; explanation: string;
    serviceCode?: string | null; expectedCents?: number | null; actualCents?: number | null; varianceCents?: number | null;
  }>;
}): Promise<{ ok: boolean; error: string | null }> {
  if (!input.discrepancies.length) return { ok: true, error: null };
  const token = process.env.HALO_WRITE_TOKEN || process.env.HALO_READ_TOKEN || "";
  const url = process.env.BASE44_WRITE_URL || DEFAULT_BASE44_WRITE_URL;
  if (!token) return { ok: false, error: "Base44 write token is not configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-halo-token": token, accept: "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        action: "pricing_alert",
        job_id: input.jobId,
        job_no: input.jobNo ?? null,
        unit_number: input.unitNo ?? null,
        property: input.propertyName ?? null,
        resolve_url: `${process.env.PUBLIC_APP_URL || "https://archangel-halo.replit.app"}/punchlist`,
        api_open_url: `${process.env.PUBLIC_APP_URL || "https://archangel-halo.replit.app"}/api/discrepancies/job/${input.jobId}`,
        cards: input.discrepancies.map((d) => ({
          id: d.id, type: d.type, severity: d.severity, status: d.status,
          title: d.type === "missing_invoice" ? "Missing invoice" : d.type === "zero_or_missing" ? "Price required ($0)" : d.type === "bid_needs_price" ? "Bid needs a price" : "Price variance",
          explanation: d.explanation, service_code: d.serviceCode ?? null,
          expected_cents: d.expectedCents ?? null, actual_cents: d.actualCents ?? null, variance_cents: d.varianceCents ?? null,
          expected_dollars: d.expectedCents != null ? (d.expectedCents / 100).toFixed(2) : null,
          actual_dollars: d.actualCents != null ? (d.actualCents / 100).toFixed(2) : null,
        })),
      }),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status, url, jobId: input.jobId }, "base44 write: pricing_alert failed");
      return { ok: false, error: `Work app returned ${resp.status}` };
    }
    return { ok: true, error: null };
  } catch (err) {
    const error = err instanceof Error && err.name === "AbortError" ? "Work app timed out" : "Work app is unreachable";
    logger.warn({ err, jobId: input.jobId }, "base44 write: pricing_alert failed");
    return { ok: false, error };
  } finally { clearTimeout(timer); }
}
