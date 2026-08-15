/**
 * CSV Entrata adapter — scheduled or uploaded unit / lease / notice / PO files.
 * Idempotent on (org, file sha256) and on Entrata external ids.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientUnitsTable,
  clientTurnsTable,
  clientTurnInvoicesTable,
  clientEntrataImportsTable,
  clientEntrataPurchaseOrdersTable,
  clientAuditLogTable,
  sha256Hex,
  parseUnitRows,
  parseLeaseRows,
  parseNoticeRows,
  parsePoRows,
  firstPropertyCode,
  zonedCivilToUtc,
} from "@workspace/db";
import { EntrataApiAdapter } from "./entrataApiAdapter";
import { createTurn, OpenTurnExistsError } from "./turnEngine";
import { buildInvoiceExport, exportInvoicePdf, markInvoiceExported, InvoiceNotFoundError } from "./turnInvoice";
import type {
  EntrataAdapter,
  EntrataImportRequest,
  EntrataImportResult,
  EntrataSubmitResult,
} from "./entrataAdapter";

function outboundDir(): string {
  return process.env.CLIENT_BOARD_IMPORT_DIR ?? join(tmpdir(), "halo-entrata");
}

function toResult(row: typeof clientEntrataImportsTable.$inferSelect): EntrataImportResult {
  return {
    id: row.id,
    orgId: row.orgId,
    kind: row.kind,
    filename: row.filename,
    sha256: row.sha256,
    adapter: row.adapter === "api" ? "api" : "csv",
    status: row.status as EntrataImportResult["status"],
    createdCount: row.createdCount,
    updatedCount: row.updatedCount,
    skippedCount: row.skippedCount,
    errorCount: row.errorCount,
    errors: row.errors ?? [],
  };
}

async function propertyByCode(
  orgId: string,
  code: string,
  allowed: string[] | null | undefined,
): Promise<{ id: string; timezone: string } | null> {
  const [row] = await db
    .select({
      id: propertiesTable.id,
      timezone: propertiesTable.timezone,
      orgId: propertiesTable.clientOrgId,
    })
    .from(propertiesTable)
    .where(eq(propertiesTable.entrataPropertyId, code))
    .limit(1);
  if (!row?.orgId || row.orgId !== orgId) return null;
  if (allowed && allowed.length > 0 && !allowed.includes(row.id)) return null;
  return { id: row.id, timezone: row.timezone };
}

async function unitOnProperty(propertyId: string, unitNumber: string) {
  const [row] = await db
    .select()
    .from(clientUnitsTable)
    .where(and(eq(clientUnitsTable.propertyId, propertyId), eq(clientUnitsTable.unitNumber, unitNumber)))
    .limit(1);
  return row ?? null;
}

export class EntrataCsvAdapter implements EntrataAdapter {
  readonly kind = "csv" as const;

  async importFile(req: EntrataImportRequest): Promise<EntrataImportResult> {
    const digest = sha256Hex(req.csv);
    const [existing] = await db
      .select()
      .from(clientEntrataImportsTable)
      .where(and(eq(clientEntrataImportsTable.orgId, req.orgId), eq(clientEntrataImportsTable.sha256, digest)))
      .limit(1);
    if (existing) return { ...toResult(existing), status: "replayed" };

    const counts = { created: 0, updated: 0, skipped: 0 };
    const errors: Array<{ row: number; message: string }> = [];

    try {
      if (req.kind === "units") {
        for (const line of parseUnitRows(req.csv)) {
          try {
            await this.applyUnit(req.orgId, req.allowedPropertyIds, line, counts);
          } catch (err) {
            errors.push({ row: line.row, message: err instanceof Error ? err.message : String(err) });
          }
        }
      } else if (req.kind === "leases") {
        for (const line of parseLeaseRows(req.csv)) {
          try {
            await this.applyLease(req.orgId, req.allowedPropertyIds, line, counts);
          } catch (err) {
            errors.push({ row: line.row, message: err instanceof Error ? err.message : String(err) });
          }
        }
      } else if (req.kind === "notices") {
        for (const line of parseNoticeRows(req.csv)) {
          try {
            await this.applyNotice(req.orgId, req.actorId, req.allowedPropertyIds, line, counts);
          } catch (err) {
            errors.push({ row: line.row, message: err instanceof Error ? err.message : String(err) });
          }
        }
      } else {
        for (const line of parsePoRows(req.csv)) {
          try {
            await this.applyPo(req.orgId, req.allowedPropertyIds, line, counts);
          } catch (err) {
            errors.push({ row: line.row, message: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    } catch (err) {
      errors.push({ row: 0, message: err instanceof Error ? err.message : String(err) });
    }

    const [saved] = await db
      .insert(clientEntrataImportsTable)
      .values({
        orgId: req.orgId,
        kind: req.kind,
        filename: req.filename,
        sha256: digest,
        adapter: "csv",
        status: errors.length && counts.created + counts.updated === 0 ? "failed" : "applied",
        createdCount: counts.created,
        updatedCount: counts.updated,
        skippedCount: counts.skipped,
        errorCount: errors.length,
        errors,
      })
      .returning();

    await db.insert(clientAuditLogTable).values({
      orgId: req.orgId,
      actorId: req.actorId,
      entityType: "client_entrata_import",
      entityId: saved!.id,
      action: "entrata.csv_imported",
      after: { kind: req.kind, filename: req.filename, sha256: digest },
    });

    return toResult(saved!);
  }

  async submitInvoice(args: { orgId: string; invoiceId: string }): Promise<EntrataSubmitResult> {
    const { payload } = await buildInvoiceExport({ invoiceId: args.invoiceId, orgId: args.orgId });
    const pdf = await exportInvoicePdf({ invoiceId: args.invoiceId, orgId: args.orgId });
    const dir = join(outboundDir(), "outbound");
    mkdirSync(dir, { recursive: true });
    const stem = payload.invoiceNumber.replace(/[^A-Za-z0-9-]/g, "") || args.invoiceId;
    const pdfPath = join(dir, `${stem}.pdf`);
    const sidecarPath = join(dir, `${stem}.json`);
    writeFileSync(pdfPath, Buffer.from(pdf));
    writeFileSync(sidecarPath, JSON.stringify(payload, null, 2));
    await markInvoiceExported(args.invoiceId);
    return { invoiceId: args.invoiceId, adapter: "csv", pdfPath, sidecarPath };
  }

  private async applyUnit(
    orgId: string,
    allowed: string[] | null | undefined,
    line: ReturnType<typeof parseUnitRows>[number],
    counts: { created: number; updated: number; skipped: number },
  ) {
    const property = await propertyByCode(orgId, line.propertyCode, allowed);
    if (!property) throw new Error(`unknown property ${line.propertyCode}`);
    const existing = await unitOnProperty(property.id, line.unitNumber);
    if (existing) {
      await db
        .update(clientUnitsTable)
        .set({
          bedrooms: line.bedrooms,
          bathrooms: line.bathrooms,
          sqft: line.sqft,
          marketRentCents: line.marketRentCents,
          entrataUnitId: line.entrataUnitId ?? existing.entrataUnitId,
        })
        .where(eq(clientUnitsTable.id, existing.id));
      counts.updated += 1;
      return;
    }
    await db.insert(clientUnitsTable).values({
      propertyId: property.id,
      unitNumber: line.unitNumber,
      bedrooms: line.bedrooms,
      bathrooms: line.bathrooms,
      sqft: line.sqft,
      marketRentCents: line.marketRentCents,
      entrataUnitId: line.entrataUnitId,
    });
    counts.created += 1;
  }

  private async applyLease(
    orgId: string,
    allowed: string[] | null | undefined,
    line: ReturnType<typeof parseLeaseRows>[number],
    counts: { created: number; updated: number; skipped: number },
  ) {
    const property = await propertyByCode(orgId, line.propertyCode, allowed);
    if (!property) throw new Error(`unknown property ${line.propertyCode}`);
    const unit = await unitOnProperty(property.id, line.unitNumber);
    if (!unit) throw new Error(`unknown unit ${line.unitNumber}`);
    if (line.rentCents != null) {
      await db.update(clientUnitsTable).set({ marketRentCents: line.rentCents }).where(eq(clientUnitsTable.id, unit.id));
    }
    const [open] = await db
      .select({ id: clientTurnsTable.id })
      .from(clientTurnsTable)
      .where(and(eq(clientTurnsTable.unitId, unit.id), isNull(clientTurnsTable.readyAt)))
      .limit(1);
    if (open) {
      const patch: Partial<typeof clientTurnsTable.$inferInsert> = { entrataLeaseId: line.leaseId };
      if (line.moveOut) {
        patch.nextMoveInAt = zonedCivilToUtc(property.timezone, line.moveOut.year, line.moveOut.month, line.moveOut.day, 10, 0, 0);
      }
      await db.update(clientTurnsTable).set(patch).where(eq(clientTurnsTable.id, open.id));
      counts.updated += 1;
      return;
    }
    counts.skipped += 1;
  }

  private async applyNotice(
    orgId: string,
    actorId: string,
    allowed: string[] | null | undefined,
    line: ReturnType<typeof parseNoticeRows>[number],
    counts: { created: number; updated: number; skipped: number },
  ) {
    const [prior] = await db
      .select({ id: clientTurnsTable.id })
      .from(clientTurnsTable)
      .where(and(eq(clientTurnsTable.orgId, orgId), eq(clientTurnsTable.entrataNoticeId, line.noticeId)))
      .limit(1);
    if (prior) {
      counts.skipped += 1;
      return;
    }
    const property = await propertyByCode(orgId, line.propertyCode, allowed);
    if (!property) throw new Error(`unknown property ${line.propertyCode}`);
    const unit = await unitOnProperty(property.id, line.unitNumber);
    if (!unit) throw new Error(`unknown unit ${line.unitNumber}`);
    const noticeAt = zonedCivilToUtc(
      property.timezone,
      line.noticeDate.year,
      line.noticeDate.month,
      line.noticeDate.day,
      8,
      0,
      0,
    );
    const vacate = line.scheduledVacate
      ? zonedCivilToUtc(
          property.timezone,
          line.scheduledVacate.year,
          line.scheduledVacate.month,
          line.scheduledVacate.day,
          8,
          0,
          0,
        )
      : noticeAt;
    try {
      const created = await createTurn({
        orgId,
        propertyId: property.id,
        unitId: unit.id,
        source: "import",
        occurredAt: noticeAt,
        noticeGivenAt: noticeAt,
        scheduledVacateAt: vacate,
        actorId,
        idempotencyKey: `entrata-notice:${line.noticeId}`,
        meta: { entrataNoticeId: line.noticeId, leaseId: line.leaseId },
      });
      await db
        .update(clientTurnsTable)
        .set({
          entrataNoticeId: line.noticeId,
          entrataLeaseId: line.leaseId,
        })
        .where(eq(clientTurnsTable.id, created.turnId));
      counts.created += 1;
    } catch (err) {
      if (!(err instanceof OpenTurnExistsError)) throw err;
      const [open] = await db
        .select({ id: clientTurnsTable.id })
        .from(clientTurnsTable)
        .where(and(eq(clientTurnsTable.unitId, unit.id), isNull(clientTurnsTable.readyAt)))
        .limit(1);
      if (!open) throw err;
      await db
        .update(clientTurnsTable)
        .set({
          noticeGivenAt: noticeAt,
          scheduledVacateAt: vacate,
          entrataNoticeId: line.noticeId,
          entrataLeaseId: line.leaseId,
        })
        .where(eq(clientTurnsTable.id, open.id));
      counts.updated += 1;
    }
  }

  private async applyPo(
    orgId: string,
    allowed: string[] | null | undefined,
    line: ReturnType<typeof parsePoRows>[number],
    counts: { created: number; updated: number; skipped: number },
  ) {
    const property = await propertyByCode(orgId, line.propertyCode, allowed);
    if (!property) throw new Error(`unknown property ${line.propertyCode}`);
    const unit = line.unitNumber ? await unitOnProperty(property.id, line.unitNumber) : null;
    const [dup] = await db
      .select({ id: clientEntrataPurchaseOrdersTable.id })
      .from(clientEntrataPurchaseOrdersTable)
      .where(
        and(eq(clientEntrataPurchaseOrdersTable.orgId, orgId), eq(clientEntrataPurchaseOrdersTable.poNumber, line.poNumber)),
      )
      .limit(1);
    if (dup) {
      counts.skipped += 1;
      return;
    }
    let invoiceId: string | null = null;
    if (unit) {
      const [inv] = await db
        .select({ id: clientTurnInvoicesTable.id })
        .from(clientTurnInvoicesTable)
        .innerJoin(clientTurnsTable, eq(clientTurnsTable.id, clientTurnInvoicesTable.turnId))
        .where(and(eq(clientTurnsTable.unitId, unit.id), isNull(clientTurnInvoicesTable.poNumber)))
        .limit(1);
      if (inv) {
        invoiceId = inv.id;
        await db.update(clientTurnInvoicesTable).set({ poNumber: line.poNumber }).where(eq(clientTurnInvoicesTable.id, inv.id));
      }
    }
    await db.insert(clientEntrataPurchaseOrdersTable).values({
      orgId,
      propertyId: property.id,
      unitId: unit?.id ?? null,
      poNumber: line.poNumber,
      amountCents: line.amountCents,
      glCode: line.glCode,
      issuedOn: line.issuedOn,
      invoiceId,
    });
    counts.created += 1;
  }
}

export async function listEntrataImports(orgId: string): Promise<EntrataImportResult[]> {
  const rows = await db
    .select()
    .from(clientEntrataImportsTable)
    .where(eq(clientEntrataImportsTable.orgId, orgId));
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 50)
    .map(toResult);
}

export async function getEntrataImport(orgId: string, id: string): Promise<EntrataImportResult | null> {
  const [row] = await db
    .select()
    .from(clientEntrataImportsTable)
    .where(and(eq(clientEntrataImportsTable.id, id), eq(clientEntrataImportsTable.orgId, orgId)))
    .limit(1);
  return row ? toResult(row) : null;
}

export { InvoiceNotFoundError };

export function getEntrataAdapter(): EntrataAdapter {
  if ((process.env.ENTRATA_ADAPTER ?? "csv").toLowerCase() === "api") {
    return new EntrataApiAdapter();
  }
  return new EntrataCsvAdapter();
}

/** Drop-folder: CLIENT_BOARD_IMPORT_DIR/{units|leases|notices|purchase_orders}/*.csv */
export async function sweepEntrataDropFolder(): Promise<number> {
  const root = process.env.CLIENT_BOARD_IMPORT_DIR;
  if (!root) return 0;
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { listPortfoliosForOffice } = await import("./portfolioPulse");
  const fallbackOrg = (await listPortfoliosForOffice())[0]?.orgId;
  const adapter = new EntrataCsvAdapter();
  const kinds: EntrataImportRequest["kind"][] = ["units", "leases", "notices", "purchase_orders"];
  let n = 0;
  for (const kind of kinds) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith(".csv")) continue;
      const csv = readFileSync(join(dir, name), "utf8");
      const code = firstPropertyCode(csv);
      let orgId = fallbackOrg ?? null;
      if (code) {
        const [row] = await db
          .select({ orgId: propertiesTable.clientOrgId })
          .from(propertiesTable)
          .where(eq(propertiesTable.entrataPropertyId, code))
          .limit(1);
        if (row?.orgId) orgId = row.orgId;
      }
      if (!orgId) continue;
      await adapter.importFile({ orgId, kind, filename: name, csv, actorId: "system:drop-folder" });
      n += 1;
    }
  }
  return n;
}
