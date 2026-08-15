/** v2 stub. Same interface as CSV. Must not be called unless ENTRATA_ADAPTER=api. */

import {
  EntrataApiDisabledError,
  type EntrataAdapter,
  type EntrataImportRequest,
  type EntrataImportResult,
  type EntrataSubmitResult,
} from "./entrataAdapter";

export class EntrataApiAdapter implements EntrataAdapter {
  readonly kind = "api" as const;

  async importFile(_req: EntrataImportRequest): Promise<EntrataImportResult> {
    throw new EntrataApiDisabledError();
  }

  async submitInvoice(_args: { orgId: string; invoiceId: string }): Promise<EntrataSubmitResult> {
    throw new EntrataApiDisabledError();
  }
}
