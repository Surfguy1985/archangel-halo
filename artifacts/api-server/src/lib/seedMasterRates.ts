/**
 * Idempotent seed of Master Price List + Crew Payout Master
 * from Archangel Preferred PM Pricing Guide (Aug 2026) and Crew Payout Rate Sheet.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

type Row = {
  serviceCode: string;
  name: string;
  category: string;
  unitType: string;
  rateCents: number | null;
  notes?: string;
  trade?: string;
};

const MASTER: Row[] = [
  { serviceCode: "PAINT_WALL_FULL", name: "Wall Prep & Paint", category: "paint", unitType: "1br", rateCents: 23000 },
  { serviceCode: "PAINT_WALL_FULL", name: "Wall Prep & Paint", category: "paint", unitType: "2br", rateCents: 32000 },
  { serviceCode: "PAINT_WALL_FULL", name: "Wall Prep & Paint", category: "paint", unitType: "3br", rateCents: 38000 },
  { serviceCode: "PAINT_CEILING", name: "Ceiling Paint", category: "paint", unitType: "1br", rateCents: 12500 },
  { serviceCode: "PAINT_CEILING", name: "Ceiling Paint", category: "paint", unitType: "2br", rateCents: 15000 },
  { serviceCode: "PAINT_CEILING", name: "Ceiling Paint", category: "paint", unitType: "3br", rateCents: 17000 },
  { serviceCode: "PAINT_COLOR_CHANGE", name: "Color Change", category: "paint", unitType: "1br", rateCents: 34900 },
  { serviceCode: "PAINT_COLOR_CHANGE", name: "Color Change", category: "paint", unitType: "2br", rateCents: 43900 },
  { serviceCode: "PAINT_COLOR_CHANGE", name: "Color Change", category: "paint", unitType: "3br", rateCents: 49900 },
  { serviceCode: "PAINT_CABINET", name: "Cabinet Paint", category: "paint", unitType: "flat", rateCents: 35000 },
  { serviceCode: "PAINT_DOORS_TRIM", name: "Doors & Trim", category: "paint", unitType: "flat", rateCents: 19500 },
  { serviceCode: "PAINT_KILZ", name: "Kilz Primer Seal", category: "paint", unitType: "flat", rateCents: 7500 },
  { serviceCode: "DRYWALL_SMALL", name: "Small Patch 1x1", category: "drywall", unitType: "flat", rateCents: 12000 },
  { serviceCode: "DRYWALL_MEDIUM", name: "Medium Patch 2x2", category: "drywall", unitType: "flat", rateCents: 14000 },
  { serviceCode: "DRYWALL_LARGE", name: "Large Patch 3x3", category: "drywall", unitType: "flat", rateCents: 16000 },
  { serviceCode: "DRYWALL_MAJOR", name: "Major Drywall", category: "drywall", unitType: "bid", rateCents: null },
  { serviceCode: "RESURF_STD_TUB", name: "Standard Tub Reglaze", category: "resurfacing", unitType: "flat", rateCents: 17500 },
  { serviceCode: "RESURF_GARDEN_TUB", name: "Garden Tub Reglaze", category: "resurfacing", unitType: "flat", rateCents: 35000 },
  { serviceCode: "RESURF_SHOWER", name: "Standup Shower Reglaze", category: "resurfacing", unitType: "flat", rateCents: 20000 },
  { serviceCode: "MAKE_READY_PACKAGE", name: "Make-Ready Package", category: "make_ready", unitType: "flat", rateCents: 27500 },
  { serviceCode: "TOILET_INSTALL", name: "Toilet Install", category: "plumbing", unitType: "flat", rateCents: 16000 },
  { serviceCode: "CLEAN_VACANT", name: "Vacant Unit Clean", category: "cleaning", unitType: "1br", rateCents: 15000 },
  { serviceCode: "CLEAN_VACANT", name: "Vacant Unit Clean", category: "cleaning", unitType: "2br", rateCents: 21000 },
  { serviceCode: "CLEAN_VACANT", name: "Vacant Unit Clean", category: "cleaning", unitType: "3br", rateCents: 26000 },
  { serviceCode: "CARPET_BASIC", name: "Basic Carpet Clean", category: "carpet", unitType: "1br", rateCents: 10000 },
  { serviceCode: "CARPET_BASIC", name: "Basic Carpet Clean", category: "carpet", unitType: "2br", rateCents: 15000 },
  { serviceCode: "CARPET_BASIC", name: "Basic Carpet Clean", category: "carpet", unitType: "3br", rateCents: 19900 },
  { serviceCode: "CARPET_STRETCH", name: "Carpet Stretching", category: "carpet", unitType: "flat", rateCents: 5000, notes: "per room" },
  { serviceCode: "COUNTER_KITCHEN", name: "Kitchen Countertop", category: "counters", unitType: "flat", rateCents: 30000 },
  { serviceCode: "COUNTER_BATH", name: "Bath Countertop", category: "counters", unitType: "flat", rateCents: 14500 },
];

const CREW: Row[] = [
  { serviceCode: "PAINT_WALL_FULL", name: "Unit Paint Full Interior", category: "paint", unitType: "1br", rateCents: 13000, trade: "paint" },
  { serviceCode: "PAINT_WALL_FULL", name: "Unit Paint Full Interior", category: "paint", unitType: "2br", rateCents: 17000, trade: "paint" },
  { serviceCode: "PAINT_WALL_FULL", name: "Unit Paint Full Interior", category: "paint", unitType: "3br", rateCents: 21000, trade: "paint" },
  { serviceCode: "PAINT_CEILING", name: "Ceiling Paint", category: "paint", unitType: "1br", rateCents: 4500, trade: "paint" },
  { serviceCode: "PAINT_CEILING", name: "Ceiling Paint", category: "paint", unitType: "2br", rateCents: 5500, trade: "paint" },
  { serviceCode: "PAINT_CEILING", name: "Ceiling Paint", category: "paint", unitType: "3br", rateCents: 6500, trade: "paint" },
  { serviceCode: "PAINT_CABINET", name: "Cabinet Paint", category: "paint", unitType: "1br", rateCents: 12000, trade: "paint" },
  { serviceCode: "PAINT_CABINET", name: "Cabinet Paint", category: "paint", unitType: "2br", rateCents: 14000, trade: "paint" },
  { serviceCode: "PAINT_CABINET", name: "Cabinet Paint", category: "paint", unitType: "3br", rateCents: 16000, trade: "paint" },
  { serviceCode: "DRYWALL_SMALL", name: "Drywall 1x1", category: "drywall", unitType: "flat", rateCents: 5000, trade: "drywall" },
  { serviceCode: "DRYWALL_MEDIUM", name: "Drywall 2x2", category: "drywall", unitType: "flat", rateCents: 7000, trade: "drywall" },
  { serviceCode: "DRYWALL_LARGE", name: "Drywall 3x3", category: "drywall", unitType: "flat", rateCents: 9000, trade: "drywall" },
  { serviceCode: "TOILET_INSTALL", name: "Toilet Install", category: "plumbing", unitType: "flat", rateCents: 4000, trade: "plumbing" },
  { serviceCode: "CLEAN_VACANT", name: "Housekeeping", category: "cleaning", unitType: "1br", rateCents: 8000, trade: "cleaning" },
  { serviceCode: "CLEAN_VACANT", name: "Housekeeping", category: "cleaning", unitType: "2br", rateCents: 9000, trade: "cleaning" },
  { serviceCode: "CLEAN_VACANT", name: "Housekeeping", category: "cleaning", unitType: "3br", rateCents: 11000, trade: "cleaning" },
  { serviceCode: "CARPET_BASIC", name: "Carpet Clean", category: "carpet", unitType: "1br", rateCents: 6000, trade: "carpet" },
  { serviceCode: "CARPET_BASIC", name: "Carpet Clean", category: "carpet", unitType: "2br", rateCents: 10000, trade: "carpet" },
  { serviceCode: "CARPET_BASIC", name: "Carpet Clean", category: "carpet", unitType: "3br", rateCents: 13000, trade: "carpet" },
  { serviceCode: "RESURF_STD_TUB", name: "Standard Tub", category: "resurfacing", unitType: "flat", rateCents: 12000, trade: "resurfacing" },
  { serviceCode: "RESURF_SHOWER", name: "Standard Shower", category: "resurfacing", unitType: "flat", rateCents: 12000, trade: "resurfacing" },
  { serviceCode: "RESURF_GARDEN_TUB", name: "Garden Tub", category: "resurfacing", unitType: "flat", rateCents: 21000, trade: "resurfacing" },
];

function esc(s: string) {
  return s.replace(/'/g, "''");
}

async function upsertMaster(row: Row) {
  const rate = row.rateCents == null ? "NULL" : String(row.rateCents);
  const notes = row.notes ? `'${esc(row.notes)}'` : "NULL";
  await db.execute(sql.raw(`
    INSERT INTO master_price_list (service_code, name, category, unit_type, rate_cents, notes, effective_from, is_active)
    VALUES ('${esc(row.serviceCode)}', '${esc(row.name)}', '${esc(row.category)}', '${esc(row.unitType)}', ${rate}, ${notes}, '2026-08-01', true)
    ON CONFLICT (service_code, unit_type, effective_from) DO UPDATE SET
      name = EXCLUDED.name, category = EXCLUDED.category, rate_cents = EXCLUDED.rate_cents, notes = EXCLUDED.notes, is_active = true
  `));
}

async function upsertCrew(row: Row) {
  const rate = row.rateCents == null ? "NULL" : String(row.rateCents);
  const notes = row.notes ? `'${esc(row.notes)}'` : "NULL";
  const trade = row.trade ? `'${esc(row.trade)}'` : "NULL";
  await db.execute(sql.raw(`
    INSERT INTO crew_payout_master (service_code, name, category, unit_type, rate_cents, trade, notes, effective_from, is_active)
    VALUES ('${esc(row.serviceCode)}', '${esc(row.name)}', '${esc(row.category)}', '${esc(row.unitType)}', ${rate}, ${trade}, ${notes}, '2026-08-01', true)
    ON CONFLICT (service_code, unit_type, effective_from) DO UPDATE SET
      name = EXCLUDED.name, category = EXCLUDED.category, rate_cents = EXCLUDED.rate_cents, trade = EXCLUDED.trade, notes = EXCLUDED.notes, is_active = true
  `));
}

export async function seedMasterRates(): Promise<{ master: number; crew: number }> {
  let master = 0;
  let crew = 0;
  for (const row of MASTER) {
    try {
      await upsertMaster(row);
      master++;
    } catch (err) {
      logger.warn({ err, serviceCode: row.serviceCode }, "seedMasterRates master upsert failed");
    }
  }
  for (const row of CREW) {
    try {
      await upsertCrew(row);
      crew++;
    } catch (err) {
      logger.warn({ err, serviceCode: row.serviceCode }, "seedMasterRates crew upsert failed");
    }
  }
  logger.info({ master, crew }, "Master + crew payout rates seeded");
  return { master, crew };
}
