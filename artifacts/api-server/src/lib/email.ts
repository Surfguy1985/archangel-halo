import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const FROM = "HALO <onboarding@resend.dev>";

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
