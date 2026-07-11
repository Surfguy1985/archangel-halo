import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";
import { getBusinessSettings } from "./businessSettings";

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file contents. */
  content: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Human-readable failure reason (safe to surface to the admin UI). */
  error?: string;
}

/**
 * Send an email via the Resend connector. The FROM address is built from
 * business settings (company name + email); the sender domain must be
 * verified in the connected Resend account or Resend rejects the send.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<SendEmailResult> {
  try {
    const settings = await getBusinessSettings();
    const from = `${settings.companyName} <${settings.email}>`;
    const connectors = new ReplitConnectors();
    const res = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [opts.to],
        reply_to: settings.email,
        subject: opts.subject,
        html: opts.html,
        ...(opts.attachments && opts.attachments.length
          ? { attachments: opts.attachments }
          : {}),
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { message?: string; name?: string };
        detail = body?.message || body?.name || "";
      } catch {
        // non-JSON error body
      }
      const error = detail
        ? `Resend rejected the email: ${detail}`
        : `Resend rejected the email (HTTP ${res.status})`;
      logger.warn({ status: res.status, detail, from, to: opts.to }, "Email send failed");
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, "Email send failed (Resend not connected?)");
    return { ok: false, error: "Email service is not connected" };
  }
}
