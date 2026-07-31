import { z } from 'zod';

/**
 * Runtime validation for board card modules and actions.
 *
 * These schemas mirror the hardened openapi.yaml exactly (ClientCardModule
 * oneOf + ClientCardActionInput oneOf). The generated orval types give you
 * compile-time narrowing; this file gives you the runtime guarantee — a card
 * from a newer server build, or a malformed payload, is caught here instead of
 * exploding inside a render.
 *
 * Every field the renderers actually read (audited from BoardCardModules.tsx)
 * is present; everything is nullish-tolerant because the server snapshots are.
 * `.passthrough()` on each module keeps forward compatibility: a server that
 * adds a field does not break an older client.
 */

// ---------------------------------------------------------------------------
// Lanes / columns
// ---------------------------------------------------------------------------

export const BOARD_COLUMNS = ['inbox', 'todo', 'in_progress', 'done'] as const;
export const boardColumnSchema = z.enum(BOARD_COLUMNS);
export type BoardColumn = z.infer<typeof boardColumnSchema>;

// ---------------------------------------------------------------------------
// Module payloads — one schema per `module.type`
// ---------------------------------------------------------------------------

export const invoiceModuleSchema = z
  .object({
    type: z.literal('invoice'),
    invoiceNo: z.string().nullish(),
    amount: z.number().nullish(),
    status: z.string().nullish(),
    dueDate: z.string().nullish(),
    pdfUrl: z.string().nullish(),
    payUrl: z.string().nullish(),
    canApprove: z.boolean().nullish(),
    approvedAt: z.string().nullish(),
    payMethod: z.enum(['ach', 'check']).nullish(),
  })
  .passthrough();

export const invoiceBatchModuleSchema = z
  .object({
    type: z.literal('invoice_batch'),
    unpaidAmount: z.number().nullish(),
    count: z.number().nullish(),
    invoices: z
      .array(
        z
          .object({
            invoiceNo: z.string().nullish(),
            amount: z.number().nullish(),
            status: z.string().nullish(),
            payUrl: z.string().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

export const bidModuleSchema = z
  .object({
    type: z.literal('bid'),
    status: z.string().nullish(),
    amount: z.number().nullish(),
    scope: z.string().nullish(),
    pdfUrl: z.string().nullish(),
    lineItems: z
      .array(
        z
          .object({
            service: z.string().nullish(),
            qty: z.number().nullish(),
            amount: z.number().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

export const documentModuleSchema = z
  .object({
    type: z.literal('document'),
    label: z.string().nullish(),
    url: z.string().nullish(),
    isPdf: z.boolean().nullish(),
  })
  .passthrough();

export const trackerModuleSchema = z
  .object({
    type: z.literal('tracker'),
    jobNo: z.string().nullish(),
    unitNo: z.string().nullish(),
    scope: z.string().nullish(),
    trackerUrl: z.string().nullish(),
  })
  .passthrough();

export const crewMapModuleSchema = z
  .object({
    type: z.literal('crewmap'),
    onSiteCount: z.number().nullish(),
    crews: z
      .array(
        z
          .object({
            crewName: z.string().nullish(),
            crewTrade: z.string().nullish(),
            description: z.string().nullish(),
            unitNo: z.string().nullish(),
            onSite: z.boolean().nullish(),
            selfieUrl: z.string().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

// NOTE: module type is `flags` (plural) while the push/card kind is `flag`.
// Legacy mismatch, kept deliberately so stored cards keep rendering — the
// spec documents it; do not "fix" one side without migrating the other.
export const flagsModuleSchema = z
  .object({
    type: z.literal('flags'),
    totalCount: z.number().nullish(),
    requestedAt: z.string().nullish(),
    canSchedule: z.boolean().nullish(),
    items: z
      .array(
        z.object({ label: z.string().nullish(), unit: z.string().nullish() }).passthrough(),
      )
      .nullish(),
  })
  .passthrough();

export const photosModuleSchema = z
  .object({
    type: z.literal('photos'),
    jobId: z.string().nullish(),
    jobNo: z.string().nullish(),
    unitNo: z.string().nullish(),
    totalCount: z.number().nullish(),
    photoUrls: z.array(z.string()).nullish(),
  })
  .passthrough();

export const summaryModuleSchema = z
  .object({
    type: z.literal('summary'),
    summaryId: z.string().nullish(),
    title: z.string().nullish(),
    result: z.string().nullish(),
    unitNo: z.string().nullish(),
    serviceDate: z.string().nullish(),
    summaryUrl: z.string().nullish(),
    checkedCount: z.number().nullish(),
    itemCount: z.number().nullish(),
    flagCount: z.number().nullish(),
    photoCount: z.number().nullish(),
  })
  .passthrough();

export const referralModuleSchema = z
  .object({
    type: z.literal('referral'),
    referredAt: z.string().nullish(),
    canRefer: z.boolean().nullish(),
  })
  .passthrough();

export const linkModuleSchema = z
  .object({
    type: z.literal('link'),
    label: z.string().nullish(),
    url: z.string().nullish(),
  })
  .passthrough();

export const clientCardModuleSchema = z.discriminatedUnion('type', [
  invoiceModuleSchema,
  invoiceBatchModuleSchema,
  bidModuleSchema,
  documentModuleSchema,
  trackerModuleSchema,
  crewMapModuleSchema,
  flagsModuleSchema,
  photosModuleSchema,
  summaryModuleSchema,
  referralModuleSchema,
  linkModuleSchema,
]);
export type ClientCardModule = z.infer<typeof clientCardModuleSchema>;

export const MODULE_TYPES = clientCardModuleSchema.options.map(
  (o) => o.shape.type.value,
) as string[];

// ---------------------------------------------------------------------------
// Actions — the discriminated union replacing the flat nullable bag
// ---------------------------------------------------------------------------

export const cardActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    name: z.string().nullish(),
    note: z.string().nullish(),
  }),
  z.object({
    action: z.literal('pay_method'),
    method: z.enum(['ach', 'check']),
  }),
  z.object({
    action: z.literal('schedule'),
    name: z.string().nullish(),
    note: z.string().nullish(),
    unitNo: z.string().nullish(),
    neededBy: z.string().nullish(),
  }),
  z.object({
    action: z.literal('refer'),
    contact: z.string().min(1, 'Referral contact is required'),
    name: z.string().nullish(),
  }),
  z.object({
    action: z.literal('acknowledge'),
    note: z.string().nullish(),
  }),
]);
export type CardAction = z.infer<typeof cardActionSchema>;

// ---------------------------------------------------------------------------
// Parse helpers — the three outcomes that matter in the field
// ---------------------------------------------------------------------------

export type ParsedModule =
  | { status: 'ok'; module: ClientCardModule }
  | { status: 'none' } // kinds with no module: manual, payment_request
  | { status: 'unknown'; type: string | null } // newer server than this build
  | { status: 'invalid'; type: string | null; error: string }; // server bug — log loudly

export function parseModule(raw: unknown): ParsedModule {
  if (raw == null) return { status: 'none' };
  const type =
    typeof raw === 'object' && raw !== null && 'type' in raw
      ? String((raw as { type: unknown }).type)
      : null;
  if (type === null || !MODULE_TYPES.includes(type)) {
    return { status: 'unknown', type };
  }
  const parsed = clientCardModuleSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'invalid', type, error: parsed.error.message };
  }
  return { status: 'ok', module: parsed.data };
}

/** Validate an outgoing action BEFORE it leaves the client. */
export function parseCardAction(
  raw: unknown,
): { ok: true; action: CardAction } | { ok: false; error: string } {
  const parsed = cardActionSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid action' };
  }
  return { ok: true, action: parsed.data };
}
