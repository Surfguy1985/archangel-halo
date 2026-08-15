/**
 * Ingest a real Entrata CSV export into the Client Board shape.
 * Generated demo seed exists only so the app is developable before the export arrives.
 *
 * Usage: pnpm seed:live -- --source=./caf-export/
 *
 * Walks `units|leases|notices|purchase_orders` directories and root-level
 * `{kind}.csv` files. Creates the CAF live org + properties from unit codes
 * so this does not depend on the generated 12-property set.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientOrgMembersTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  parseUnitRows,
  type EntrataImportKind,
} from "@workspace/db";
import { ensureClientBoardSchema } from "./ensureClientBoardSchema";
import { getEntrataAdapter } from "./entrataCsvAdapter";
import { logger } from "./logger";

export const CAF_LIVE_BRIEF = "CAF_CLIENT_BOARD_LIVE_v1";
export const CAF_LIVE_NAME_PREFIX = "CAF Live — ";
export const CAF_LIVE_SLUG = "caf-live";

const KINDS: EntrataImportKind[] = ["units", "leases", "notices", "purchase_orders"];

export type DiscoveredCsv = { kind: EntrataImportKind; filename: string; path: string };

export function parseSourceArg(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith("--source=")) return arg.slice("--source=".length);
    if (arg === "--source") continue;
  }
  const idx = argv.indexOf("--source");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!;
  return process.env.CAF_EXPORT_DIR ?? null;
}

export function discoverEntrataCsvs(sourceDir: string): DiscoveredCsv[] {
  const root = resolve(sourceDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Entrata export directory not found: ${sourceDir}`);
  }
  const found: DiscoveredCsv[] = [];
  const seen = new Set<string>();
  const push = (kind: EntrataImportKind, path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    found.push({ kind, filename: basename(path), path });
  };
  for (const kind of KINDS) {
    const rootFile = join(root, `${kind}.csv`);
    if (existsSync(rootFile) && statSync(rootFile).isFile()) push(kind, rootFile);
    const dir = join(root, kind);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith(".csv")) continue;
      push(kind, join(dir, name));
    }
  }
  const rank = (k: EntrataImportKind) => KINDS.indexOf(k);
  found.sort((a, b) => rank(a.kind) - rank(b.kind) || a.filename.localeCompare(b.filename));
  return found;
}

async function upsertLiveOrg() {
  const [row] = await db
    .insert(clientOrgsTable)
    .values({
      name: "CAF Management (live)",
      type: "pm_company",
      timezone: "America/Chicago",
      slug: CAF_LIVE_SLUG,
    })
    .onConflictDoUpdate({
      target: clientOrgsTable.slug,
      set: { name: "CAF Management (live)", timezone: "America/Chicago" },
    })
    .returning();
  return row!;
}

async function ensureProperty(args: {
  orgId: string;
  portfolioId: string;
  code: string;
}) {
  const [existing] = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.entrataPropertyId, args.code))
    .limit(1);
  if (existing) {
    await db
      .update(propertiesTable)
      .set({ clientOrgId: args.orgId, brief: CAF_LIVE_BRIEF })
      .where(eq(propertiesTable.id, existing.id));
    const linked = await db
      .select({ propertyId: clientPortfolioPropertiesTable.propertyId })
      .from(clientPortfolioPropertiesTable)
      .where(eq(clientPortfolioPropertiesTable.propertyId, existing.id))
      .limit(1);
    if (!linked[0]) {
      await db.insert(clientPortfolioPropertiesTable).values({
        portfolioId: args.portfolioId,
        propertyId: existing.id,
      });
    }
    return existing.id;
  }
  const [property] = await db
    .insert(propertiesTable)
    .values({
      name: `${CAF_LIVE_NAME_PREFIX}${args.code}`,
      pmcName: "CAF Management",
      city: "—",
      units: 0,
      brief: CAF_LIVE_BRIEF,
      timezone: "America/Chicago",
      avgDailyRentCents: 4000n,
      targetTurnDays: 7,
      occupiedAddonApplies: false,
      entrataPropertyId: args.code,
      clientOrgId: args.orgId,
      status: "active",
    })
    .returning();
  await db.insert(clientPortfolioPropertiesTable).values({
    portfolioId: args.portfolioId,
    propertyId: property!.id,
  });
  return property!.id;
}

export type LiveSeedSummary = {
  orgId: string;
  portfolioId: string;
  source: string;
  files: number;
  properties: number;
  imports: Array<{ kind: EntrataImportKind; filename: string; status: string; created: number; updated: number; errors: number }>;
};

export async function seedClientBoardLive(sourceDir: string): Promise<LiveSeedSummary> {
  await ensureClientBoardSchema();
  const files = discoverEntrataCsvs(sourceDir);
  if (files.length === 0) {
    throw new Error(
      `No Entrata CSVs found under ${sourceDir}. Expected units.csv / leases.csv / notices.csv / purchase_orders.csv, or those names as directories of CSV files.`,
    );
  }

  const org = await upsertLiveOrg();
  await db.delete(clientOrgMembersTable).where(eq(clientOrgMembersTable.orgId, org.id));
  await db.insert(clientOrgMembersTable).values([
    { orgId: org.id, userId: "seed:regional.north", role: "regional_manager", scope: null },
    { orgId: org.id, userId: "seed:asset.manager", role: "asset_manager", scope: null },
  ]);

  const existingPortfolios = await db
    .select()
    .from(clientPortfoliosTable)
    .where(eq(clientPortfoliosTable.orgId, org.id));
  let portfolio = existingPortfolios[0];
  if (!portfolio) {
    const [created] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId: org.id, name: "Live export" })
      .returning();
    portfolio = created!;
  }

  const unitFiles = files.filter((f) => f.kind === "units");
  const codes = new Set<string>();
  for (const file of unitFiles) {
    for (const row of parseUnitRows(readFileSync(file.path, "utf8"))) {
      if (row.propertyCode) codes.add(row.propertyCode);
    }
  }
  for (const code of codes) {
    await ensureProperty({ orgId: org.id, portfolioId: portfolio.id, code });
  }

  const adapter = getEntrataAdapter();
  const imports: LiveSeedSummary["imports"] = [];
  for (const file of files) {
    const csv = readFileSync(file.path, "utf8");
    const result = await adapter.importFile({
      orgId: org.id,
      kind: file.kind,
      filename: file.filename,
      csv,
      actorId: "seed:live",
    });
    imports.push({
      kind: file.kind,
      filename: file.filename,
      status: result.status,
      created: result.createdCount,
      updated: result.updatedCount,
      errors: result.errorCount,
    });
  }

  logger.info({ source: sourceDir, files: files.length, properties: codes.size }, "client-board: live seed complete");
  return {
    orgId: org.id,
    portfolioId: portfolio.id,
    source: resolve(sourceDir),
    files: files.length,
    properties: codes.size,
    imports,
  };
}
