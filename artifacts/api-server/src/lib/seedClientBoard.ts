/**
 * CAF Client Board Segment 1 seed.
 *
 * Double-marker properties (name prefix + brief) so a real community that
 * happens to share a name is never wiped. Idempotent: teardown then rebuild.
 *
 * 3 properties × 40 units × 90 days of turn history, including:
 *   - Paloma Creek: client-approval bottleneck
 *   - Desert Sage: a turn with two rework loops
 *   - Redbud Flats: in-house (CTB) work source
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
  STAGE_OWNERSHIP_SEED,
  mulCents,
  yymmddInZone,
  startOfWeekMondayInZone,
  addCivilDaysInZone,
  type TurnStage,
  type WorkSource,
} from "@workspace/db";
import { ensureClientBoardSchema } from "./ensureClientBoardSchema";
import { logger } from "./logger";

export const CAF_SEED_BRIEF = "CAF_CLIENT_BOARD_SEED_v1";
export const CAF_SEED_NAME_PREFIX = "CAF Demo — ";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

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
];

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
    await tx.execute(sql`DELETE FROM client_turn_forecasts WHERE property_id IN (${inProps})`);
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
}) {
  const [row] = await db
    .insert(clientOrgsTable)
    .values(input)
    .onConflictDoUpdate({
      target: clientOrgsTable.slug,
      set: { name: input.name, type: input.type, timezone: input.timezone },
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
];

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

  await db.delete(clientOrgMembersTable).where(eq(clientOrgMembersTable.orgId, caf.id));
  await db.insert(clientOrgMembersTable).values([
    { orgId: caf.id, userId: "seed:regional.north", role: "regional_manager", scope: null },
    { orgId: caf.id, userId: "seed:asset.manager", role: "asset_manager", scope: null },
  ]);

  await db.delete(clientPortfoliosTable).where(eq(clientPortfoliosTable.orgId, caf.id));
  const [portfolio] = await db
    .insert(clientPortfoliosTable)
    .values({ orgId: caf.id, name: "North Region" })
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
  const horizonStart = addMs(now, -90 * DAY_MS);

  let unitCount = 0;
  let turnCount = 0;
  let eventCount = 0;
  let openTurns = 0;
  let reworkTurns = 0;
  let bottleneckTurns = 0;

  const eventsBatch: (typeof clientTurnStageEventsTable.$inferInsert)[] = [];

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
        units.push({ id: row!.id, bedrooms, unitNumber });
        unitCount++;
      }

      const windowStart = addMs(now, -90 * DAY_MS);
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
        const cutAt = bottleneck
          ? 5
          : isOpen
            ? 2 + Math.floor(rng() * 7)
            : spans.length;

        const vacateOffsetDays = bottleneck
          ? 6 + Math.floor(rng() * 6)
          : isOpen
            ? Math.floor(rng() * 12)
            : Math.floor(rng() * 80);
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

        const [turn] = await db
          .insert(clientTurnsTable)
          .values({
            unitId: unit.id,
            propertyId: property.id,
            orgId: caf.id,
            status: lastStage,
            noticeGivenAt,
            scheduledVacateAt: actualVacate,
            actualVacateAt: actualVacate,
            readyAt,
            nextMoveInAt: readyAt ? addMs(readyAt, 2 * DAY_MS) : addMs(targetReadyAt, 2 * DAY_MS),
            targetReadyAt,
            predictedReadyAt: readyAt ?? addMs(now, (3 + Math.floor(rng() * 6)) * DAY_MS),
            predictionConfidence: "medium",
            workSource: spec.workSource,
            assignedVendorOrgId: vendorOrgId,
          })
          .returning();
        if (!turn) throw new Error("failed to insert turn");
        turnCount++;
        if (isOpen) openTurns++;

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
            qty: 1,
            uom: "ea",
            unitPriceCents: item.unitPriceCents,
            extendedCents: mulCents(item.unitPriceCents, 1),
            compliance: "matched",
          }));
          await db.insert(clientScopeLinesTable).values(scopeLines);
          const subtotal = scopeLines.reduce((s, l) => s + l.extendedCents, 0n);
          const ymd = yymmddInZone(actualVacate, spec.timezone);
          const [invoice] = await db
            .insert(clientTurnInvoicesTable)
            .values({
              turnId: turn.id,
              scopeId: scope!.id,
              invoiceNumber: `CAF${pIdx + 1}-${unit.unitNumber}-${ymd}-${String(t + 1).padStart(3, "0")}`,
              poNumber: `PO-${unit.unitNumber}-${ymd}`,
              status: "submitted",
              subtotalCents: subtotal,
              taxCents: 0n,
              totalCents: subtotal,
              complianceScore: "3/3",
              submittedAt: readyAt,
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
        }
      }
    }

    for (let i = 0; i < eventsBatch.length; i += 200) {
      const chunk = eventsBatch.slice(i, i + 200);
      await db.insert(clientTurnStageEventsTable).values(chunk);
      eventCount += chunk.length;
    }

    const trades = ["paint", "flooring", "clean", "drywall", "hvac", "punch"];
    const monday = startOfWeekMondayInZone(now, "America/Chicago");
    const capRows = [];
    for (const vendor of [archangel, ctb, vendorB]) {
      for (let w = 0; w < 8; w++) {
        for (const trade of trades) {
          capRows.push({
            vendorOrgId: vendor.id,
            trade,
            weekStart: addCivilDaysInZone(monday, w * 7, "America/Chicago"),
            unitsCapacity: 4 + Math.floor(rng() * 6),
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
      after: { properties: PROPERTY_SPECS.length, units: unitCount, turns: turnCount },
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

  logger.info(
    {
      properties: PROPERTY_SPECS.length,
      units: unitCount,
      turns: turnCount,
      events: eventCount,
      openTurns,
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
  };
}
