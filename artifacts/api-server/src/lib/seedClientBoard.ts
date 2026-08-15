/**
 * CAF Client Board demo seed (`pnpm seed:demo`).
 *
 * Double-marker properties (name prefix + brief) so a real community that
 * happens to share a name is never wiped. Idempotent: teardown then rebuild.
 *
 * 12 properties × 40 units × 120 days of turn history, including:
 *   - Paloma Creek: client-approval bottleneck + marble off-schedule + live 14-line bid
 *   - Desert Sage: a turn with two rework loops
 *   - Redbud Flats: in-house (CTB) work source
 *   - Paloma first open: blocked variance (paint over schedule) + MARBLE-UP off-schedule
 */

import { sql, eq, and, like, inArray } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientOrgMembersTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  clientUnitsTable,
  clientTurnsTable,
  clientTurnStageEventsTable,
  clientPriceListsTable,
  clientPriceListItemsTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientTurnInvoicesTable,
  clientTurnInvoiceLinesTable,
  clientVendorScorecardsTable,
  clientCapacityDeclarationsTable,
  clientAuditLogTable,
  clientEvidenceItemsTable,
  clientGpsEventsTable,
  clientVarianceRequestsTable,
  clientAccountsTable,
  STAGE_OWNERSHIP_SEED,
  mulCents,
  yymmddInZone,
  formatInvoiceNumber,
  startOfWeekMondayInZone,
  addCivilDaysInZone,
  sha256Hex,
  type TurnStage,
  type WorkSource,
} from "@workspace/db";
import { ensureClientBoardSchema } from "./ensureClientBoardSchema";
import { logger } from "./logger";
import { createBidRequest, inviteVendors, submitVendorBid } from "./bidBoard";

export const CAF_REGIONAL_TOKEN = "caf-regional";
export const CAF_PALOMA_TOKEN = "caf-paloma";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const CAF_DEMO_HISTORY_DAYS = 120;

const PRICE_BOOK: {
  code: string;
  description: string;
  category: string;
  unitPriceCents: bigint;
  tier: string | null;
}[] = [
  { code: "PAINT-WALLS", description: "Interior walls paint", category: "Paint", unitPriceCents: 18500n, tier: "1br" },
  { code: "PAINT-WALLS", description: "Interior walls paint", category: "Paint", unitPriceCents: 24500n, tier: "2br" },
  { code: "PAINT-WALLS", description: "Interior walls paint", category: "Paint", unitPriceCents: 30500n, tier: "3br" },
  { code: "CLEAN-FULL", description: "Full make-ready clean", category: "Clean", unitPriceCents: 16500n, tier: null },
  { code: "FLOOR-LVP", description: "LVP plank replace (room)", category: "Flooring", unitPriceCents: 42000n, tier: null },
  { code: "DRYWALL-PATCH", description: "Drywall patch and texture", category: "Drywall", unitPriceCents: 8500n, tier: null },
  { code: "PUNCH-MISC", description: "Punch list miscellaneous", category: "Punch", unitPriceCents: 4500n, tier: null },
  { code: "HVAC-FILTER", description: "HVAC filter replace", category: "HVAC", unitPriceCents: 2500n, tier: null },
  { code: "BLINDS-STD", description: "Standard blinds replace", category: "Punch", unitPriceCents: 6500n, tier: null },
  { code: "APPL-WIPE", description: "Appliance wipe-down", category: "Clean", unitPriceCents: 3500n, tier: null },
  { code: "CARPET-STEAM", description: "Carpet steam clean", category: "Clean", unitPriceCents: 12000n, tier: null },
  { code: "TUB-REGROUT", description: "Tub / surround regrout", category: "Punch", unitPriceCents: 14500n, tier: null },
  { code: "TOILET-SEAT", description: "Toilet seat replace", category: "Punch", unitPriceCents: 4200n, tier: null },
  { code: "OUTLET-COVER", description: "Outlet cover replace", category: "Punch", unitPriceCents: 1500n, tier: null },
  { code: "CAULK-KITCHEN", description: "Kitchen backsplash recaulk", category: "Punch", unitPriceCents: 3800n, tier: null },
  { code: "SCREEN-REPAIR", description: "Window screen repair", category: "Punch", unitPriceCents: 2800n, tier: null },
];

function uniquePriceBook(tier: string) {
  const seen = new Set<string>();
  const out: typeof PRICE_BOOK = [];
  for (const item of PRICE_BOOK) {
    if (item.code === "PAINT-WALLS" && item.tier !== tier) continue;
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    out.push(item);
  }
  return out;
}

function bumpCents(cents: bigint, pct: number): bigint {
  return cents + (cents * BigInt(pct)) / 100n;
}

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hours(n: number): number {
  return Math.round(n * HOUR_MS);
}

function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

type StageSpan = { stage: TurnStage; ms: number };

function happyPath(rng: Rng, bottleneck: boolean, reworkLoops: number): StageSpan[] {
  const pendingMs = bottleneck
    ? hours(24 * (4 + rng() * 2.2))
    : hours(6 + rng() * 18);
  const spans: StageSpan[] = [
    { stage: "notice", ms: hours(24 * (10 + rng() * 8)) },
    { stage: "vacated", ms: hours(2 + rng() * 6) },
    { stage: "walk", ms: hours(4 + rng() * 8) },
    { stage: "scoped", ms: hours(3 + rng() * 8) },
    { stage: "pending_approval", ms: pendingMs },
    { stage: "approved", ms: hours(1 + rng() * 4) },
    { stage: "scheduled", ms: hours(12 + rng() * 24) },
    { stage: "in_progress", ms: hours(36 + rng() * 48) },
    { stage: "qc", ms: hours(4 + rng() * 8) },
  ];
  for (let i = 0; i < reworkLoops; i++) {
    spans.push({ stage: "rework", ms: hours(6 + rng() * 12) });
    spans.push({ stage: "in_progress", ms: hours(18 + rng() * 24) });
    spans.push({ stage: "qc", ms: hours(4 + rng() * 6) });
  }
  spans.push({ stage: "ready", ms: 0 });
  return spans;
}

function uuidList(ids: string[]) {
  return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}

async function teardownSeedProperties(): Promise<void> {
  const seeded = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(
      and(
        like(propertiesTable.name, `${CAF_SEED_NAME_PREFIX}%`),
        eq(propertiesTable.brief, CAF_SEED_BRIEF),
      ),
    );
  const ids = seeded.map((r) => r.id);
  if (ids.length === 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('halo.allow_append_delete', 'on', true)`);
    const inProps = uuidList(ids);

    await tx.execute(sql`DELETE FROM client_turn_invoice_lines WHERE invoice_id IN (
      SELECT id FROM client_turn_invoices WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
    await tx.execute(sql`DELETE FROM client_turn_invoices WHERE turn_id IN (
      SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_entrata_purchase_orders WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_entrata_imports WHERE org_id IN (
      SELECT client_org_id FROM properties WHERE id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_variance_requests WHERE turn_id IN (
      SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_scope_lines WHERE scope_id IN (
      SELECT id FROM client_scopes WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
    await tx.execute(sql`DELETE FROM client_scopes WHERE turn_id IN (
      SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_vendor_bid_lines WHERE bid_id IN (
      SELECT id FROM client_vendor_bids WHERE bid_request_id IN (
        SELECT id FROM client_bid_requests WHERE property_id IN (${inProps})))`);
    await tx.execute(sql`DELETE FROM client_vendor_bids WHERE bid_request_id IN (
      SELECT id FROM client_bid_requests WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_bid_invitations WHERE bid_request_id IN (
      SELECT id FROM client_bid_requests WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_bid_requests WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_signed_url_tickets WHERE resource_id IN (
      SELECT id FROM client_turn_records WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps}))
      UNION
      SELECT id FROM client_evidence_items WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
    await tx.execute(sql`DELETE FROM client_turn_records WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_evidence_items WHERE turn_id IN (
      SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_gps_events WHERE turn_id IN (
      SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_prediction_log WHERE turn_id IN (
      SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_turn_outbox WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_turn_metrics_mv WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_turn_stage_events WHERE turn_id IN (
      SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_turns WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_price_list_items WHERE price_list_id IN (
      SELECT id FROM client_price_lists WHERE property_id IN (${inProps}))`);
    await tx.execute(sql`DELETE FROM client_price_lists WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_vendor_scorecards WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_capacity_holds WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_turn_forecasts WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_capacity_declarations WHERE vendor_org_id IN (
      SELECT id FROM client_orgs WHERE slug IN ('archangel-vendor', 'ctb-multifamily', 'summit-turn', 'prairie-star'))`);
    await tx.execute(sql`DELETE FROM client_accounts WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_units WHERE property_id IN (${inProps})`);
    await tx.execute(sql`DELETE FROM client_portfolio_properties WHERE property_id IN (${inProps})`);
    await tx.delete(propertiesTable).where(
      and(
        like(propertiesTable.name, `${CAF_SEED_NAME_PREFIX}%`),
        eq(propertiesTable.brief, CAF_SEED_BRIEF),
      ),
    );
  });
}

async function upsertOrg(input: {
  name: string;
  type: "pm_company" | "vendor";
  timezone: string;
  slug: string;
  crewPortalComp?: boolean;
}) {
  const crewPortalComp = input.crewPortalComp ?? false;
  const [row] = await db
    .insert(clientOrgsTable)
    .values({ ...input, crewPortalComp })
    .onConflictDoUpdate({
      target: clientOrgsTable.slug,
      set: {
        name: input.name,
        type: input.type,
        timezone: input.timezone,
        crewPortalComp,
      },
    })
    .returning();
  return row!;
}

type PropertySpec = {
  name: string;
  city: string;
  address: string;
  timezone: string;
  avgDailyRentCents: bigint;
  targetTurnDays: number;
  bottleneck: boolean;
  workSource: WorkSource;
  latitude: number;
  longitude: number;
};

const PROPERTY_SPECS: PropertySpec[] = [
  {
    name: `${CAF_SEED_NAME_PREFIX}Paloma Creek`,
    city: "Frisco, TX",
    address: "4801 Paloma Creek Dr, Frisco, TX",
    timezone: "America/Chicago",
    avgDailyRentCents: 4850n,
    targetTurnDays: 7,
    bottleneck: true,
    workSource: "third_party",
    latitude: 33.1507,
    longitude: -96.8236,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Desert Sage`,
    city: "Phoenix, AZ",
    address: "2200 W Sage Ave, Phoenix, AZ",
    timezone: "America/Phoenix",
    avgDailyRentCents: 5200n,
    targetTurnDays: 8,
    bottleneck: false,
    workSource: "third_party",
    latitude: 33.4484,
    longitude: -112.074,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Redbud Flats`,
    city: "Tulsa, OK",
    address: "910 S Redbud St, Tulsa, OK",
    timezone: "America/Chicago",
    avgDailyRentCents: 4100n,
    targetTurnDays: 7,
    bottleneck: false,
    workSource: "in_house",
    latitude: 36.154,
    longitude: -95.9928,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Cedar Ridge`,
    city: "Austin, TX",
    address: "4100 Cedar Ridge Rd, Austin, TX",
    timezone: "America/Chicago",
    avgDailyRentCents: 5400n,
    targetTurnDays: 7,
    bottleneck: false,
    workSource: "third_party",
    latitude: 30.2672,
    longitude: -97.7431,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Lakewood Place`,
    city: "Dallas, TX",
    address: "8800 Lakewood Blvd, Dallas, TX",
    timezone: "America/Chicago",
    avgDailyRentCents: 4600n,
    targetTurnDays: 8,
    bottleneck: false,
    workSource: "third_party",
    latitude: 32.7767,
    longitude: -96.797,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Iron Horse`,
    city: "San Antonio, TX",
    address: "150 Iron Horse Pkwy, San Antonio, TX",
    timezone: "America/Chicago",
    avgDailyRentCents: 3900n,
    targetTurnDays: 7,
    bottleneck: false,
    workSource: "third_party",
    latitude: 29.4241,
    longitude: -98.4936,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Cottonwood`,
    city: "Tucson, AZ",
    address: "6700 E Cottonwood St, Tucson, AZ",
    timezone: "America/Phoenix",
    avgDailyRentCents: 3700n,
    targetTurnDays: 8,
    bottleneck: false,
    workSource: "third_party",
    latitude: 32.2226,
    longitude: -110.9747,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Mesa Verde`,
    city: "Mesa, AZ",
    address: "2400 S Verde Ave, Mesa, AZ",
    timezone: "America/Phoenix",
    avgDailyRentCents: 4300n,
    targetTurnDays: 7,
    bottleneck: false,
    workSource: "third_party",
    latitude: 33.4152,
    longitude: -111.8315,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Riverbend`,
    city: "Oklahoma City, OK",
    address: "1200 Riverbend Dr, Oklahoma City, OK",
    timezone: "America/Chicago",
    avgDailyRentCents: 3500n,
    targetTurnDays: 8,
    bottleneck: false,
    workSource: "third_party",
    latitude: 35.4676,
    longitude: -97.5164,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Willow Park`,
    city: "Plano, TX",
    address: "3300 Willow Park Ln, Plano, TX",
    timezone: "America/Chicago",
    avgDailyRentCents: 5100n,
    targetTurnDays: 7,
    bottleneck: false,
    workSource: "third_party",
    latitude: 33.0198,
    longitude: -96.6989,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Stonebridge`,
    city: "Scottsdale, AZ",
    address: "8800 E Stonebridge Way, Scottsdale, AZ",
    timezone: "America/Phoenix",
    avgDailyRentCents: 6100n,
    targetTurnDays: 8,
    bottleneck: false,
    workSource: "third_party",
    latitude: 33.4942,
    longitude: -111.9261,
  },
  {
    name: `${CAF_SEED_NAME_PREFIX}Pecan Square`,
    city: "Norman, OK",
    address: "500 Pecan Square, Norman, OK",
    timezone: "America/Chicago",
    avgDailyRentCents: 3300n,
    targetTurnDays: 7,
    bottleneck: false,
    workSource: "third_party",
    latitude: 35.2226,
    longitude: -97.4395,
  },
];

export const CAF_DEMO_PROPERTY_SPECS = PROPERTY_SPECS;

export type ClientBoardSeedSummary = {
  orgId: string;
  portfolioId: string;
  properties: number;
  units: number;
  turns: number;
  events: number;
  openTurns: number;
  reworkTurns: number;
  bottleneckTurns: number;
  variancePending: number;
};

export async function seedClientBoard(opts?: {
  applySchema?: boolean;
}): Promise<ClientBoardSeedSummary> {
  if (opts?.applySchema !== false) {
    await ensureClientBoardSchema();
  }

  const rng = mulberry32(20260814);
  await teardownSeedProperties();

  const caf = await upsertOrg({
    name: "CAF Management",
    type: "pm_company",
    timezone: "America/Chicago",
    slug: "caf-demo",
  });
  const archangel = await upsertOrg({
    name: "Archangel Operations",
    type: "vendor",
    timezone: "America/Chicago",
    slug: "archangel-vendor",
  });
  const ctb = await upsertOrg({
    name: "CTB Multifamily",
    type: "vendor",
    timezone: "America/Chicago",
    slug: "ctb-multifamily",
    crewPortalComp: true,
  });
  const vendorB = await upsertOrg({
    name: "Summit Turn Services",
    type: "vendor",
    timezone: "America/Chicago",
    slug: "summit-turn",
  });
  const vendorC = await upsertOrg({
    name: "Prairie Star Make-Ready",
    type: "vendor",
    timezone: "America/Chicago",
    slug: "prairie-star",
  });

  await db.delete(clientOrgMembersTable).where(
    inArray(clientOrgMembersTable.orgId, [caf.id, archangel.id, ctb.id, vendorB.id, vendorC.id]),
  );
  await db.insert(clientOrgMembersTable).values([
    { orgId: caf.id, userId: "seed:regional.north", role: "regional_manager", scope: null },
    { orgId: caf.id, userId: "seed:asset.manager", role: "asset_manager", scope: null },
    { orgId: archangel.id, userId: "seed:vendor.archangel", role: "vendor_admin", scope: null },
    { orgId: vendorB.id, userId: "seed:vendor.summit", role: "vendor_admin", scope: null },
    { orgId: vendorC.id, userId: "seed:vendor.prairie", role: "vendor_admin", scope: null },
  ]);

  await db.delete(clientPortfoliosTable).where(eq(clientPortfoliosTable.orgId, caf.id));
  const [portfolio] = await db
    .insert(clientPortfoliosTable)
    .values({ orgId: caf.id, name: "North Region", dashboardToken: CAF_REGIONAL_TOKEN })
    .returning();

  await db.delete(clientCapacityDeclarationsTable).where(
    inArray(clientCapacityDeclarationsTable.vendorOrgId, [
      archangel.id,
      ctb.id,
      vendorB.id,
      vendorC.id,
    ]),
  );

  const now = new Date();
  const horizonStart = addMs(now, -CAF_DEMO_HISTORY_DAYS * DAY_MS);

  let unitCount = 0;
  let turnCount = 0;
  let eventCount = 0;
  let openTurns = 0;
  let reworkTurns = 0;
  let bottleneckTurns = 0;
  let palomaId = "";
  let redbudId = "";
  let variancePending = 0;

  const eventsBatch: (typeof clientTurnStageEventsTable.$inferInsert)[] = [];
  const evidenceTurns: Array<{
    turnId: string;
    unitId: string;
    lat: number;
    lng: number;
    at: Date;
  }> = [];

  await db.execute(
    sql`ALTER TABLE client_turn_stage_events DISABLE TRIGGER client_turn_stage_events_refresh_metrics`,
  );

  try {
    for (let pIdx = 0; pIdx < PROPERTY_SPECS.length; pIdx++) {
      const spec = PROPERTY_SPECS[pIdx]!;
      const vendorOrgId = spec.workSource === "in_house" ? ctb.id : archangel.id;
      const [property] = await db
        .insert(propertiesTable)
        .values({
          name: spec.name,
          pmcName: "CAF Management",
          address: spec.address,
          city: spec.city,
          units: 40,
          latitude: spec.latitude,
          longitude: spec.longitude,
          brief: CAF_SEED_BRIEF,
          timezone: spec.timezone,
          avgDailyRentCents: spec.avgDailyRentCents,
          targetTurnDays: spec.targetTurnDays,
          occupiedAddonApplies: false,
          entrataPropertyId: `CAF-DEMO-${pIdx + 1}`,
          clientOrgId: caf.id,
          status: "active",
        })
        .returning();
      if (!property) throw new Error("failed to insert seed property");
      if (pIdx === 0) palomaId = property.id;
      if (pIdx === 2) redbudId = property.id;

      await db.insert(clientPortfolioPropertiesTable).values({
        portfolioId: portfolio!.id,
        propertyId: property.id,
      });

      const [priceList] = await db
        .insert(clientPriceListsTable)
        .values({
          propertyId: property.id,
          revision: "Rev 01",
          effectiveFrom: addMs(horizonStart, -30 * DAY_MS),
          effectiveTo: null,
        })
        .returning();

      await db.insert(clientPriceListItemsTable).values(
        PRICE_BOOK.map((item) => ({
          priceListId: priceList!.id,
          code: item.code,
          description: item.description,
          category: item.category,
          uom: "ea",
          unitPriceCents: item.unitPriceCents,
          tier: item.tier,
          isBidOnly: false,
        })),
      );

      const units: {
        id: string;
        bedrooms: number;
        unitNumber: string;
        latitude: number;
        longitude: number;
      }[] = [];
      for (let u = 0; u < 40; u++) {
        const bedrooms = (u % 3) + 1;
        const market = bedrooms === 1 ? 125000n : bedrooms === 2 ? 148000n : 179000n;
        const unitNumber = String(100 + u + 1);
        const [row] = await db
          .insert(clientUnitsTable)
          .values({
            propertyId: property.id,
            unitNumber,
            bedrooms,
            bathrooms: bedrooms === 1 ? "1.0" : bedrooms === 2 ? "2.0" : "2.5",
            sqft: 650 + bedrooms * 220,
            marketRentCents: market,
            latitude: spec.latitude + (u % 8) * 0.00015,
            longitude: spec.longitude + Math.floor(u / 8) * 0.00018,
          })
          .returning();
        units.push({
          id: row!.id,
          bedrooms,
          unitNumber,
          latitude: spec.latitude + (u % 8) * 0.00015,
          longitude: spec.longitude + Math.floor(u / 8) * 0.00018,
        });
        unitCount++;
      }

      const windowStart = addMs(now, -CAF_DEMO_HISTORY_DAYS * DAY_MS);
      await db.insert(clientVendorScorecardsTable).values([
        {
          vendorOrgId: archangel.id,
          propertyId: property.id,
          onTimePct: 92,
          reworkRate: 6,
          avgTurnDays: "6.40",
          disputesCount: 1,
          capacityUnitsPerWeek: 12,
          windowStart,
          windowEnd: now,
        },
        {
          vendorOrgId: ctb.id,
          propertyId: property.id,
          onTimePct: 88,
          reworkRate: 4,
          avgTurnDays: "7.10",
          disputesCount: 0,
          capacityUnitsPerWeek: 8,
          windowStart,
          windowEnd: now,
        },
        {
          vendorOrgId: vendorB.id,
          propertyId: property.id,
          onTimePct: 81,
          reworkRate: 11,
          avgTurnDays: "8.20",
          disputesCount: 3,
          capacityUnitsPerWeek: 6,
          windowStart,
          windowEnd: now,
        },
        {
          vendorOrgId: vendorC.id,
          propertyId: property.id,
          onTimePct: 74,
          reworkRate: 15,
          avgTurnDays: "9.50",
          disputesCount: 4,
          capacityUnitsPerWeek: 5,
          windowStart,
          windowEnd: now,
        },
      ]);

      const completedCount = 28;
      const openCount = 8;
      const usedUnits = new Set<number>();
      const takeUnit = (): number => {
        let idx = Math.floor(rng() * 40);
        let guard = 0;
        while (usedUnits.has(idx) && guard < 40) {
          idx = (idx + 1) % 40;
          guard++;
        }
        usedUnits.add(idx);
        return idx;
      };

      for (let t = 0; t < completedCount + openCount; t++) {
        const isOpen = t >= completedCount;
        const unit = units[takeUnit()]!;
        const reworkLoops = spec.name.includes("Desert Sage") && t === 0 ? 2 : rng() < 0.08 ? 1 : 0;
        if (reworkLoops > 0) reworkTurns++;
        const bottleneck = Boolean(spec.bottleneck && isOpen && t >= completedCount + 3);
        if (bottleneck) bottleneckTurns++;

        const spans = happyPath(
          rng,
          bottleneck || Boolean(spec.bottleneck && !isOpen && rng() < 0.35),
          reworkLoops,
        );
        // pending_approval is index 4; cut there so the client-owned wait is visible.
        // Paloma's second open turn is the 14-line bid board demo — stop at approved.
        const isBidDemo = spec.name.includes("Paloma Creek") && isOpen && t === completedCount + 1;
        const cutAt = isBidDemo
          ? 6
          : bottleneck
            ? 5
            : isOpen
              ? 2 + Math.floor(rng() * 7)
              : spans.length;

        const vacateOffsetDays = bottleneck
          ? 6 + Math.floor(rng() * 6)
          : isOpen
            ? Math.floor(rng() * 12)
            : Math.floor(rng() * (CAF_DEMO_HISTORY_DAYS - 10));
        const actualVacate = addMs(now, -(vacateOffsetDays * DAY_MS + Math.floor(rng() * DAY_MS)));
        const noticeSpan = spans[0]!;
        let cursor = addMs(actualVacate, -noticeSpan.ms);
        const noticeGivenAt = cursor;
        const targetReadyAt = addMs(actualVacate, spec.targetTurnDays * DAY_MS);

        const activeSpans = spans.slice(0, cutAt);
        const lastStage = activeSpans[activeSpans.length - 1]!.stage;
        const readyAt =
          lastStage === "ready"
            ? addMs(actualVacate, activeSpans.slice(1).reduce((s, x) => s + x.ms, 0))
            : null;

        const onSchedule = isOpen || rng() >= 0.2;
        const scheduledVacateAt = onSchedule
          ? actualVacate
          : addMs(actualVacate, (rng() < 0.5 ? -2 : 2) * DAY_MS);

        const [turn] = await db
          .insert(clientTurnsTable)
          .values({
            unitId: unit.id,
            propertyId: property.id,
            orgId: caf.id,
            status: lastStage,
            noticeGivenAt,
            scheduledVacateAt,
            actualVacateAt: actualVacate,
            readyAt,
            nextMoveInAt: readyAt ? addMs(readyAt, 2 * DAY_MS) : addMs(targetReadyAt, 2 * DAY_MS),
            targetReadyAt,
            predictedReadyAt: readyAt ?? addMs(now, (3 + Math.floor(rng() * 6)) * DAY_MS),
            predictionConfidence: "medium",
            workSource: spec.workSource,
            assignedVendorOrgId: isBidDemo ? null : vendorOrgId,
          })
          .returning();
        if (!turn) throw new Error("failed to insert turn");
        turnCount++;
        if (isOpen) openTurns++;
        if (
          (spec.name.includes("Desert Sage") && t === 0) ||
          bottleneck ||
          (spec.name.includes("Redbud") && isOpen && t === completedCount)
        ) {
          evidenceTurns.push({
            turnId: turn.id,
            unitId: unit.id,
            lat: unit.latitude,
            lng: unit.longitude,
            at: addMs(actualVacate, 6 * HOUR_MS),
          });
        }

        for (let s = 0; s < activeSpans.length; s++) {
          const span = activeSpans[s]!;
          const enteredAt = s === 0 ? noticeGivenAt : cursor;
          const ownerOrg = STAGE_OWNERSHIP_SEED[span.stage] === "client" ? caf.id : vendorOrgId;
          const actorId =
            STAGE_OWNERSHIP_SEED[span.stage] === "client" ? "seed:regional.north" : "seed:crew.lead";
          eventsBatch.push({
            turnId: turn.id,
            stage: span.stage,
            event: "entered",
            occurredAt: enteredAt,
            actorId,
            actorOrgId: ownerOrg,
            source: "system",
            meta: { seed: true },
          });
          cursor = addMs(enteredAt, span.ms);
          const isLastOpen = isOpen && s === activeSpans.length - 1;
          if (!isLastOpen && span.stage !== "ready") {
            eventsBatch.push({
              turnId: turn.id,
              stage: span.stage,
              event: "exited",
              occurredAt: cursor,
              actorId,
              actorOrgId: ownerOrg,
              source: "system",
              meta: { seed: true },
            });
          }
        }

        if (lastStage === "ready") {
          const tier = unit.bedrooms === 1 ? "1br" : unit.bedrooms === 2 ? "2br" : "3br";
          const paint = PRICE_BOOK.find((i) => i.code === "PAINT-WALLS" && i.tier === tier)!;
          const clean = PRICE_BOOK.find((i) => i.code === "CLEAN-FULL")!;
          const punch = PRICE_BOOK.find((i) => i.code === "PUNCH-MISC")!;
          const lines = [paint, clean, punch];
          const [scope] = await db
            .insert(clientScopesTable)
            .values({
              turnId: turn.id,
              status: "approved",
              createdBy: "seed:crew.lead",
              submittedAt: actualVacate,
            })
            .returning();
          const scopeLines = lines.map((item) => ({
            scopeId: scope!.id,
            description: item.description,
            code: item.code,
            tier: item.tier,
            qty: 1,
            uom: "ea",
            unitPriceCents: item.unitPriceCents,
            extendedCents: mulCents(item.unitPriceCents, 1),
            compliance: "matched",
          }));
          await db.insert(clientScopeLinesTable).values(scopeLines);
          const subtotal = scopeLines.reduce((s, l) => s + l.extendedCents, 0n);
          const ymd = yymmddInZone(actualVacate, spec.timezone);
          const propertyCode = property.entrataPropertyId || "PROP";
          const [invoice] = await db
            .insert(clientTurnInvoicesTable)
            .values({
              turnId: turn.id,
              scopeId: scope!.id,
              invoiceNumber: formatInvoiceNumber({
                propertyCode,
                unitNumber: unit.unitNumber,
                yymmdd: ymd,
                seq: t + 1,
              }),
              poNumber: `PO-${unit.unitNumber}-${ymd}`,
              status: "submitted",
              subtotalCents: subtotal,
              taxCents: 0n,
              totalCents: subtotal,
              complianceScore: "3/3",
              submittedAt: readyAt,
              firstPassAccepted: true,
            })
            .returning();
          await db.insert(clientTurnInvoiceLinesTable).values(
            scopeLines.map((l, i) => ({
              invoiceId: invoice!.id,
              description: l.description,
              qty: l.qty,
              uom: l.uom,
              unitPriceCents: l.unitPriceCents,
              extendedCents: l.extendedCents,
              compliance: "matched",
              glCode: "6200",
              unitNumber: unit.unitNumber,
              sortOrder: i,
            })),
          );
        } else if (spec.name.includes("Paloma Creek") && isOpen && t === completedCount) {
          const tier = unit.bedrooms === 1 ? "1br" : unit.bedrooms === 2 ? "2br" : "3br";
          const paint = PRICE_BOOK.find((i) => i.code === "PAINT-WALLS" && i.tier === tier)!;
          const [scope] = await db
            .insert(clientScopesTable)
            .values({
              turnId: turn.id,
              status: "draft",
              createdBy: "seed:crew.lead",
            })
            .returning();
          const bumpedPaint = bumpCents(paint.unitPriceCents, 20);
          const insertedLines = await db
            .insert(clientScopeLinesTable)
            .values([
              {
                scopeId: scope!.id,
                description: paint.description,
                code: paint.code,
                tier: paint.tier,
                qty: 1,
                uom: "ea",
                unitPriceCents: bumpedPaint,
                extendedCents: mulCents(bumpedPaint, 1),
                compliance: "variance_pending",
                varianceReason: "Owner asked for premium sheen after walk.",
              },
              {
                scopeId: scope!.id,
                description: "Marble counter upgrade",
                code: "MARBLE-UP",
                tier: null,
                qty: 1,
                uom: "ea",
                unitPriceCents: 89000n,
                extendedCents: 89000n,
                compliance: "off_schedule",
              },
            ])
            .returning();
          const paintLine = insertedLines.find((l) => l.code === "PAINT-WALLS");
          if (paintLine) {
            await db.insert(clientVarianceRequestsTable).values({
              orgId: caf.id,
              scopeId: scope!.id,
              scopeLineId: paintLine.id,
              turnId: turn.id,
              propertyId: property.id,
              reason: "Owner asked for premium sheen after walk.",
              status: "pending",
              requestedQty: 1,
              requestedUnitPriceCents: bumpedPaint,
              scheduleUnitPriceCents: paint.unitPriceCents,
              deltaCents: bumpedPaint - paint.unitPriceCents,
            });
            variancePending++;
          }
        } else if (spec.name.includes("Paloma Creek") && isOpen && t === completedCount + 1) {
          const tier = unit.bedrooms === 1 ? "1br" : unit.bedrooms === 2 ? "2br" : "3br";
          const book = uniquePriceBook(tier);
          const [scope] = await db
            .insert(clientScopesTable)
            .values({
              turnId: turn.id,
              status: "draft",
              createdBy: "seed:crew.lead",
            })
            .returning();
          await db.insert(clientScopeLinesTable).values(
            book.map((item) => ({
              scopeId: scope!.id,
              description: item.description,
              code: item.code,
              tier: item.tier,
              qty: 1,
              uom: "ea",
              unitPriceCents: item.unitPriceCents,
              extendedCents: mulCents(item.unitPriceCents, 1),
              compliance: "matched",
            })),
          );
          const published = await createBidRequest({
            scopeId: scope!.id,
            orgId: caf.id,
            actorId: "seed:regional.north",
            dueAt: addMs(now, 14 * DAY_MS),
          });
          await inviteVendors({
            bidRequestId: published.id,
            orgId: caf.id,
            actorId: "seed:regional.north",
            vendorOrgIds: [archangel.id, vendorB.id, vendorC.id],
          });
          const bidders = [
            { id: archangel.id, pct: 0, days: 5 },
            { id: vendorB.id, pct: 10, days: 7 },
            { id: vendorC.id, pct: 20, days: 10 },
          ];
          for (const bidder of bidders) {
            await submitVendorBid({
              bidRequestId: published.id,
              orgId: caf.id,
              vendorOrgId: bidder.id,
              actorId: `seed:vendor.${bidder.id.slice(0, 8)}`,
              earliestStartAt: addMs(now, bidder.days * DAY_MS),
              promisedDays: bidder.days,
              lines: book.map((item) => ({
                code: item.code,
                tier: item.tier,
                unitPriceCents: bumpCents(item.unitPriceCents, bidder.pct),
              })),
            });
          }
        }
      }

      const leftovers = units.map((_, i) => i).filter((i) => !usedUnits.has(i));
      const pipeMonday = startOfWeekMondayInZone(now, spec.timezone);
      for (let n = 0; n < leftovers.length; n++) {
        const unit = units[leftovers[n]!]!;
        const weekOffset = spec.name.includes("Paloma") ? 2 : n === 0 ? 4 : 7;
        const vacateAt = addCivilDaysInZone(pipeMonday, weekOffset * 7 + 2, spec.timezone);
        const asNoticeOnly = n === leftovers.length - 1 && !spec.name.includes("Paloma");
        const [future] = await db
          .insert(clientTurnsTable)
          .values({
            unitId: unit.id,
            propertyId: property.id,
            orgId: caf.id,
            status: "notice",
            noticeGivenAt: now,
            scheduledVacateAt: asNoticeOnly ? null : vacateAt,
            actualVacateAt: null,
            readyAt: null,
            nextMoveInAt: addCivilDaysInZone(vacateAt, spec.targetTurnDays + 2, spec.timezone),
            targetReadyAt: addCivilDaysInZone(vacateAt, spec.targetTurnDays, spec.timezone),
            predictedReadyAt: addCivilDaysInZone(vacateAt, spec.targetTurnDays, spec.timezone),
            predictionConfidence: asNoticeOnly ? "low" : "high",
            workSource: spec.workSource,
            assignedVendorOrgId: vendorOrgId,
          })
          .returning();
        if (!future) continue;
        turnCount++;
        openTurns++;
        eventsBatch.push({
          turnId: future.id,
          stage: "notice" as TurnStage,
          event: "entered" as const,
          occurredAt: now,
          actorId: "seed:pipeline",
          source: "import",
          meta: { pipeline: true },
        });
      }
    }

    for (let i = 0; i < eventsBatch.length; i += 200) {
      const chunk = eventsBatch.slice(i, i + 200);
      await db.insert(clientTurnStageEventsTable).values(chunk);
      eventCount += chunk.length;
    }

    await seedFeaturedEvidence(evidenceTurns);

    const trades = ["paint", "flooring", "clean", "drywall", "hvac", "punch"];
    const monday = startOfWeekMondayInZone(now, "America/Chicago");
    const capRows = [];
    for (const vendor of [archangel, ctb, vendorB, vendorC]) {
      for (let w = 0; w < 13; w++) {
        for (const trade of trades) {
          capRows.push({
            vendorOrgId: vendor.id,
            trade,
            weekStart: addCivilDaysInZone(monday, w * 7, "America/Chicago"),
            unitsCapacity: w === 2 && trade === "paint" ? 1 : 4 + Math.floor(rng() * 6),
          });
        }
      }
    }
    await db.insert(clientCapacityDeclarationsTable).values(capRows);

    await db.insert(clientAuditLogTable).values({
      orgId: caf.id,
      actorId: "seed",
      entityType: "seed",
      entityId: caf.id,
      action: "client_board.seed",
      after: {
        properties: PROPERTY_SPECS.length,
        units: unitCount,
        turns: turnCount,
        variancePending,
        historyDays: CAF_DEMO_HISTORY_DAYS,
      },
    });
  } finally {
    await db.execute(
      sql`ALTER TABLE client_turn_stage_events ENABLE TRIGGER client_turn_stage_events_refresh_metrics`,
    );
  }

  await db.execute(sql`
    SELECT refresh_client_turn_metrics(id)
      FROM client_turns
     WHERE org_id = ${caf.id}
  `);

  if (palomaId) {
    await db.insert(clientOrgMembersTable).values({
      orgId: caf.id,
      userId: "seed:pm.paloma",
      role: "property_manager",
      scope: { propertyIds: [palomaId] },
    });
    await db
      .insert(clientAccountsTable)
      .values({
        propertyId: palomaId,
        dashboardToken: CAF_PALOMA_TOKEN,
        status: "active",
        notes: "Password-free Paloma property view",
      })
      .onConflictDoUpdate({
        target: clientAccountsTable.propertyId,
        set: { dashboardToken: CAF_PALOMA_TOKEN, status: "active" },
      });
  }
  if (redbudId) {
    await db.insert(clientOrgMembersTable).values({
      orgId: caf.id,
      userId: "seed:ml.redbud",
      role: "maintenance_lead",
      scope: { propertyIds: [redbudId] },
    });
  }

  logger.info(
    {
      properties: PROPERTY_SPECS.length,
      units: unitCount,
      turns: turnCount,
      events: eventCount,
      openTurns,
      variancePending,
    },
    "client-board: seed complete",
  );

  return {
    orgId: caf.id,
    portfolioId: portfolio!.id,
    properties: PROPERTY_SPECS.length,
    units: unitCount,
    turns: turnCount,
    events: eventCount,
    openTurns,
    reworkTurns,
    bottleneckTurns,
    variancePending,
  };
}

const SEED_ROOMS = ["living", "kitchen", "bed 1", "bed 2", "bath 1", "bath 2", "exterior", "other"];

async function seedFeaturedEvidence(
  turns: Array<{ turnId: string; unitId: string; lat: number; lng: number; at: Date }>,
): Promise<void> {
  for (const turn of turns) {
    const photos = [];
    for (const room of SEED_ROOMS) {
      const phases = room === "living" || room === "kitchen" ? ["before", "after", "during", "qc"] : ["before", "after"];
      for (const phase of phases) {
        const offset = room === "living" && phase === "before";
        const key = `${turn.turnId}:${room}:${phase}`;
        photos.push({
          turnId: turn.turnId,
          unitId: turn.unitId,
          kind: "photo",
          phase,
          room,
          storageKey: `seed/${key}.png`,
          sha256: sha256Hex(key),
          mime: "image/png",
          bytes: 70n,
          deviceCapturedAt: turn.at,
          serverReceivedAt: turn.at,
          deviceLat: offset ? turn.lat + 0.0013 : turn.lat,
          deviceLng: turn.lng,
          gpsAccuracyM: 7,
          exif: { Make: "Apple", Model: "iPhone 15 Pro" },
          capturedByUserId: "Maya Chen",
          integrityFlags: offset ? { gps_outside_geofence: true } : null,
        });
      }
    }
    await db.insert(clientEvidenceItemsTable).values(photos);
    await db.insert(clientGpsEventsTable).values([
      {
        turnId: turn.turnId,
        userId: "Maya Chen",
        type: "check_in",
        lat: turn.lat,
        lng: turn.lng,
        occurredAt: turn.at,
        distanceFromUnitM: 3,
      },
      {
        turnId: turn.turnId,
        userId: "Maya Chen",
        type: "trail",
        lat: turn.lat + 0.00018,
        lng: turn.lng + 0.00012,
        occurredAt: addMs(turn.at, 12 * 60_000),
        distanceFromUnitM: 22,
      },
      {
        turnId: turn.turnId,
        userId: "Maya Chen",
        type: "check_out",
        lat: turn.lat + 0.00004,
        lng: turn.lng,
        occurredAt: addMs(turn.at, 50 * 60_000),
        distanceFromUnitM: 5,
      },
    ]);
  }
}
