import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

// Sender must be an address on a Resend-verified domain (megprimepay.com is
// verified on the connected account). Client replies are routed to the
// ArchAngel admin inbox via reply-to.
const FROM = "ArchAngel Contractors <bryce@megprimepay.com>";
const REPLY_TO = "admin@archangelcontractors.com";

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file contents. */
  content: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<boolean> {
  try {
    const connectors = new ReplitConnectors();
    await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [opts.to],
        reply_to: REPLY_TO,
        subject: opts.subject,
        html: opts.html,
        ...(opts.attachments && opts.attachments.length
          ? { attachments: opts.attachments }
          : {}),
      }),
    });
    return true;
  } catch (err) {
    logger.warn({ err }, "Email send failed (Resend not connected?)");
    return false;
  }
}
