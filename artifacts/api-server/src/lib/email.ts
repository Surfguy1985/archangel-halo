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

/** Escape HTML entities for safe interpolation into email markup. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Branded payment-reminder email for an overdue invoice, sent by Autopilot
 * (or on one-tap approval) to the property's billing contact.
 */
export async function sendInvoiceReminderEmail(opts: {
  to: string;
  billToName: string | null;
  invoiceNo: string;
  amount: number;
  daysOverdue: number;
  propertyName: string | null;
}): Promise<SendEmailResult> {
  const settings = await getBusinessSettings();
  const company = settings.companyName || "ArchAngel Contractors";
  const phone = settings.phone || "";
  const email = settings.email || REPLY_TO;
  const pay = settings.paymentInstructions || "";
  const amountFmt = `$${opts.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const firstName = opts.billToName?.trim().split(/\s+/)[0] ?? null;
  const greeting = firstName ? `Hi ${escHtml(firstName)},` : "Hello,";
  const forLine = opts.propertyName ? ` for ${escHtml(opts.propertyName)}` : "";
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#17181c;border-radius:14px 14px 0 0;padding:22px 26px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#c9a24b;">${escHtml(company)}</div>
          <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:6px;">Friendly payment reminder</div>
        </td></tr>
        <tr><td style="background:#ffffff;padding:24px 26px;border-radius:0 0 14px 14px;box-shadow:0 1px 3px rgba(23,24,28,0.08);">
          <p style="font-size:15px;color:#3a3c42;line-height:1.6;margin:0 0 14px 0;">${greeting}</p>
          <p style="font-size:15px;color:#3a3c42;line-height:1.6;margin:0 0 14px 0;">This is a friendly reminder that invoice <strong>${escHtml(opts.invoiceNo)}</strong>${forLine} is now <strong>${opts.daysOverdue} day${opts.daysOverdue === 1 ? "" : "s"} past due</strong>.</p>
          <div style="background:#f7f5f0;border-left:3px solid #c9a24b;border-radius:8px;padding:12px 16px;margin:0 0 16px 0;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8f6a1f;margin-bottom:4px;">Amount due</div>
            <div style="font-size:20px;font-weight:800;color:#17181c;">${amountFmt}</div>
          </div>
          ${pay ? `<p style="font-size:14px;color:#3a3c42;line-height:1.6;margin:0 0 14px 0;">${escHtml(pay)}</p>` : ""}
          <p style="font-size:14px;color:#3a3c42;line-height:1.6;margin:0 0 6px 0;">Already sent payment? Thank you — please disregard this note.</p>
          <p style="font-size:14px;color:#3a3c42;line-height:1.7;margin:0;">
            Questions? ${phone ? `Call or text: <strong>${escHtml(phone)}</strong><br>` : ""}
            Email: <a href="mailto:${escHtml(email)}" style="color:#8f6a1f;font-weight:600;">${escHtml(email)}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 8px 4px 8px;">
          <div style="font-size:12px;color:#9a9da4;line-height:1.5;text-align:center;">${escHtml(company)}${settings.street ? ` · ${escHtml(settings.street)}, ${escHtml(settings.city)}` : ""}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendEmail({
    to: opts.to,
    subject: `Payment reminder — Invoice ${opts.invoiceNo} (${amountFmt} past due)`,
    html,
  });
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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Branded customer-facing thank-you email sent automatically after the AI
 * receptionist captures a new phone lead with an email address.
 */
export async function sendLeadThankYouEmail(opts: {
  to: string;
  contactName: string | null;
  requestSummary: string;
}): Promise<SendEmailResult> {
  const settings = await getBusinessSettings();
  const company = settings.companyName || "ArchAngel Contractors";
  const phone = settings.phone || "";
  const email = settings.email || REPLY_TO;
  const firstName = opts.contactName?.trim().split(/\s+/)[0] ?? null;
  const greeting = firstName ? `Hi ${esc(firstName)},` : "Hello,";
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#17181c;border-radius:14px 14px 0 0;padding:22px 26px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#c9a24b;">${esc(company)}</div>
          <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:6px;">Thanks for reaching out</div>
        </td></tr>
        <tr><td style="background:#ffffff;padding:24px 26px;border-radius:0 0 14px 14px;box-shadow:0 1px 3px rgba(23,24,28,0.08);">
          <p style="font-size:15px;color:#3a3c42;line-height:1.6;margin:0 0 14px 0;">${greeting}</p>
          <p style="font-size:15px;color:#3a3c42;line-height:1.6;margin:0 0 14px 0;">Thank you for calling ${esc(company)}. We've received your request and one of our team members will be in touch <strong>within the next 48 hours</strong>.</p>
          <div style="background:#f7f5f0;border-left:3px solid #c9a24b;border-radius:8px;padding:12px 16px;margin:0 0 16px 0;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8f6a1f;margin-bottom:4px;">Your request</div>
            <div style="font-size:14px;color:#3a3c42;line-height:1.5;">${esc(opts.requestSummary)}</div>
          </div>
          <p style="font-size:15px;color:#3a3c42;line-height:1.6;margin:0 0 6px 0;">Need to reach us sooner?</p>
          <p style="font-size:14px;color:#3a3c42;line-height:1.7;margin:0;">
            ${phone ? `Call or text: <strong>${esc(phone)}</strong><br>` : ""}
            Email: <a href="mailto:${esc(email)}" style="color:#8f6a1f;font-weight:600;">${esc(email)}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 8px 4px 8px;">
          <div style="font-size:12px;color:#9a9da4;line-height:1.5;text-align:center;">${esc(company)}${settings.street ? ` · ${esc(settings.street)}, ${esc(settings.city)}` : ""}<br>Licensed, insured &amp; bonded · Serving the DFW metroplex</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendEmail({
    to: opts.to,
    subject: `Thanks for contacting ${company} — we'll be in touch within 48 hours`,
    html,
  });
}
