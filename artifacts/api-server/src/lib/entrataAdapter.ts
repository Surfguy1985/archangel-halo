/**
 * Entrata adapters. v1 ships CSV only. The API adapter is a stub with the
 * same interface so nothing in the product can hard-depend on API access.
 */

export type EntrataAdapterKind = "csv" | "api";

export type EntrataImportKind = "units" | "leases" | "notices" | "purchase_orders";

export type EntrataImportRequest = {
  orgId: string;
  kind: EntrataImportKind;
  filename: string;
  csv: string;
  actorId: string;
  allowedPropertyIds?: string[] | null;
};

export type EntrataImportResult = {
  id: string;
  orgId: string;
  kind: EntrataImportKind;
  filename: string;
  sha256: string;
  adapter: EntrataAdapterKind;
  status: "applied" | "replayed" | "failed";
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{ row: number; message: string }>;
};

export type EntrataSubmitResult = {
  invoiceId: string;
  adapter: EntrataAdapterKind;
  pdfPath: string;
  sidecarPath: string;
};

export class EntrataApiDisabledError extends Error {
  constructor() {
    super("Entrata API access is not configured. Import a CSV export instead.");
    this.name = "EntrataApiDisabledError";
  }
}

export interface EntrataAdapter {
  readonly kind: EntrataAdapterKind;
  importFile(req: EntrataImportRequest): Promise<EntrataImportResult>;
  submitInvoice(args: { orgId: string; invoiceId: string }): Promise<EntrataSubmitResult>;
}
