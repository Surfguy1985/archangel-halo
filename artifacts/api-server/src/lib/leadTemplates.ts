export interface LeadTemplateContext {
  contactName: string | null;
  propertyName: string | null;
  summary: string | null;
  companyName: string;
  tagline: string;
  phone: string;
  email: string;
  attn: string;
}

export interface RenderedTemplate {
  key: string;
  name: string;
  description: string;
  subject: string;
  body: string;
}

function greet(ctx: LeadTemplateContext): string {
  return ctx.contactName ? `Hi ${ctx.contactName.split(" ")[0]},` : "Hi there,";
}

function prop(ctx: LeadTemplateContext): string {
  return ctx.propertyName || "your property";
}

function signature(ctx: LeadTemplateContext): string {
  const signer = ctx.attn.replace(/^ATTN:\s*/i, "");
  const lines = [`Best regards,`, signer, ctx.companyName, ctx.tagline];
  if (ctx.phone) lines.push(ctx.phone);
  lines.push(ctx.email);
  return lines.join("\n");
}

interface TemplateDef {
  key: string;
  name: string;
  description: string;
  subject: (ctx: LeadTemplateContext) => string;
  body: (ctx: LeadTemplateContext) => string;
}

const TEMPLATES: TemplateDef[] = [
  {
    key: "intro",
    name: "Introduction",
    description: "First touch — introduce the company and offer a walk-through.",
    subject: (ctx) => `${ctx.companyName} — make-ready & restoration for ${prop(ctx)}`,
    body: (ctx) =>
      `${greet(ctx)}\n\nThanks for the opportunity to connect about ${prop(ctx)}. ${ctx.companyName} specializes in ${ctx.tagline.toLowerCase()} for multifamily communities — full unit turns, paint, drywall, flooring coordination, and punch-out, delivered on schedule with clean, documented invoicing.\n\n${ctx.summary ? `From what you shared — "${ctx.summary}" — that's squarely in our wheelhouse.\n\n` : ""}I'd love to walk the property with you and put together a no-obligation proposal. Would this week or next work for a quick visit?\n\n${signature(ctx)}`,
  },
  {
    key: "follow-up",
    name: "Quick follow-up",
    description: "Gentle nudge a few days after the first touch.",
    subject: (ctx) => `Following up — ${prop(ctx)}`,
    body: (ctx) =>
      `${greet(ctx)}\n\nJust circling back on my earlier note about ${prop(ctx)}. I know turn season gets hectic — if it's easier, I can put together preliminary pricing from a unit walk-through in under 30 minutes on site.\n\nIs there a good time this week to stop by?\n\n${signature(ctx)}`,
  },
  {
    key: "check-in",
    name: "Value check-in",
    description: "Share what working with us looks like; keep the door open.",
    subject: (ctx) => `How we keep turns on schedule at ${prop(ctx)}`,
    body: (ctx) =>
      `${greet(ctx)}\n\nWanted to share how we typically support communities like ${prop(ctx)}:\n\n- Fixed per-unit pricing with a published rate sheet — no surprises\n- Crews scheduled around your move-out calendar\n- Photo documentation on every completed unit\n- Net-30 invoicing with PO support\n\nIf turns, paint, or make-ready work are on your radar this quarter, I'd welcome the chance to earn the first unit.\n\n${signature(ctx)}`,
  },
  {
    key: "reengage",
    name: "Re-engage",
    description: "Restart the conversation after it has gone quiet.",
    subject: (ctx) => `Still here when you need us — ${prop(ctx)}`,
    body: (ctx) =>
      `${greet(ctx)}\n\nIt's been a little while since we last spoke about ${prop(ctx)}, so I wanted to check in. If priorities shifted, no problem at all — but if make-ready or restoration needs have come back up, we currently have crew capacity and can typically start within a week.\n\nHappy to refresh pricing or walk a unit whenever it's useful.\n\n${signature(ctx)}`,
  },
  {
    key: "final-touch",
    name: "Final touch",
    description: "Respectful last note that leaves the door open.",
    subject: (ctx) => `Closing the loop — ${prop(ctx)}`,
    body: (ctx) =>
      `${greet(ctx)}\n\nI'll close the loop on my end so I'm not cluttering your inbox. If unit turns or restoration work come up down the road at ${prop(ctx)}, we'd love to help — my direct contact is below and we can usually mobilize quickly.\n\nWishing you a smooth season either way.\n\n${signature(ctx)}`,
  },
];

export function renderTemplates(ctx: LeadTemplateContext): RenderedTemplate[] {
  return TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    subject: t.subject(ctx),
    body: t.body(ctx),
  }));
}

export function renderTemplate(
  key: string,
  ctx: LeadTemplateContext,
): RenderedTemplate | null {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) return null;
  return {
    key: t.key,
    name: t.name,
    description: t.description,
    subject: t.subject(ctx),
    body: t.body(ctx),
  };
}

export function templateBodyToHtml(body: string): string {
  const esc = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paras = esc.split(/\n\n+/).map((p) => {
    if (p.split("\n").every((l) => l.trim().startsWith("- "))) {
      const lis = p
        .split("\n")
        .map((l) => `<li>${l.trim().replace(/^- /, "")}</li>`)
        .join("");
      return `<ul style="margin:0 0 14px;padding-left:20px;color:#2c2d31;font-size:14px;line-height:1.6">${lis}</ul>`;
    }
    return `<p style="margin:0 0 14px;color:#2c2d31;font-size:14px;line-height:1.6">${p.replace(/\n/g, "<br/>")}</p>`;
  });
  return paras.join("");
}

export interface CampaignStepDef {
  dayOffset: number;
  templateKey: string;
}

export interface CampaignDef {
  kind: string;
  name: string;
  description: string;
  steps: CampaignStepDef[];
}

export const CAMPAIGNS: CampaignDef[] = [
  {
    kind: "new-lead",
    name: "New lead nurture",
    description:
      "Introduction today, quick follow-up on day 3, value check-in on day 7.",
    steps: [
      { dayOffset: 0, templateKey: "intro" },
      { dayOffset: 3, templateKey: "follow-up" },
      { dayOffset: 7, templateKey: "check-in" },
    ],
  },
  {
    kind: "reengage",
    name: "Re-engage quiet lead",
    description: "Re-engage today, respectful final touch on day 5.",
    steps: [
      { dayOffset: 0, templateKey: "reengage" },
      { dayOffset: 5, templateKey: "final-touch" },
    ],
  },
];

export function campaignByKind(kind: string): CampaignDef | null {
  return CAMPAIGNS.find((c) => c.kind === kind) ?? null;
}

export function templateName(key: string): string {
  return TEMPLATES.find((t) => t.key === key)?.name ?? key;
}
