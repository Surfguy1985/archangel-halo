import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const FROM = "HALO <onboarding@resend.dev>";

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
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
      }),
    });
    return true;
  } catch (err) {
    logger.warn({ err }, "Email send failed (Resend not connected?)");
    return false;
  }
}
