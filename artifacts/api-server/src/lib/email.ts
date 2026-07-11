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
 * Send an email via Resend. Prefers the RESEND_API_KEY secret (direct
 * api.resend.com call); falls back to the Resend connector proxy when the
 * secret is not set.
 *
 * Sender: emails go out from the verified standingstill.org domain (the
 * archangelcontractors.com domain is not verified in Resend yet), displaying
 * the company name from business settings. Replies are directed to
 * admin@archangelcontractors.com via Reply-To. Once archangelcontractors.com
 * is verified in Resend, switch FROM_ADDRESS back to the business email.
 */
const FROM_ADDRESS = "no-reply@standingstill.org";
const REPLY_TO = "admin@archangelcontractors.com";
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<SendEmailResult> {
  try {
    const settings = await getBusinessSettings();
    const from = `${settings.companyName} <${FROM_ADDRESS}>`;
    const payload = JSON.stringify({
      from,
      to: [opts.to],
      reply_to: REPLY_TO,
      subject: opts.subject,
      html: opts.html,
      ...(opts.attachments && opts.attachments.length
        ? { attachments: opts.attachments }
        : {}),
    });
    const apiKey = process.env.RESEND_API_KEY;
    let res: Response;
    if (apiKey) {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: payload,
      });
    } else {
      const connectors = new ReplitConnectors();
      res = await connectors.proxy("resend", "/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
    }
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
