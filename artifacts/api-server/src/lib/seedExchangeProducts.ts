/**
 * Falkon Exchange — canonical workflow product seeder.
 *
 * Upserts the 5 canonical HALO workflow products on server boot (idempotent).
 * All products start in "draft" status — they are not commercially available
 * until Exchange activation prerequisites are met and activation is complete.
 *
 * Safe to call multiple times: uses ON CONFLICT DO UPDATE on productKey.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { falkonExchangeProductsTable } from "@workspace/db/schema";
import { logger } from "./logger";

interface SeedProduct {
  productKey: string;
  name: string;
  category: string;
  pricingModel: string;
  pricePerUnit: number | null;
  slaHours: number;
  availability: string;
  description: string;
  capabilities: string[];
}

const CANONICAL_PRODUCTS: SeedProduct[] = [
  {
    productKey: "make-ready-pipeline",
    name: "Make-Ready Pipeline",
    category: "workflow",
    pricingModel: "per_unit",
    pricePerUnit: 45000, // $450 per unit in cents
    slaHours: 72,
    availability: "available",
    description:
      "End-to-end 12-phase make-ready workflow: scope → vendor selection → scheduling → arrival → photos → QC → invoice approval → resident-ready. Includes GPS arrival verification, photo evidence capture, and Falkon AI photo review.",
    capabilities: [
      "12-phase make-ready pipeline",
      "GPS arrival verification",
      "Before/during/after photo capture",
      "Automated QC gate",
      "Walk approval workflow",
      "Resident-ready certification",
    ],
  },
  {
    productKey: "property-inspection",
    name: "Property Inspection",
    category: "workflow",
    pricingModel: "per_job",
    pricePerUnit: 15000, // $150 per inspection in cents
    slaHours: 24,
    availability: "available",
    description:
      "Structured property inspection workflow with photo evidence, checklist verification, and digital sign-off. Supports trade-specific checklists (carpet, painting, make-ready, cleaning). Outputs inspection report with timestamped photos.",
    capabilities: [
      "Trade-specific inspection checklists",
      "Photo evidence with timestamps",
      "Digital inspector sign-off",
      "Automated inspection report",
      "Pass/fail QC gate",
    ],
  },
  {
    productKey: "crew-dispatch",
    name: "Crew Dispatch",
    category: "workflow",
    pricingModel: "per_job",
    pricePerUnit: 2500, // $25 per dispatch in cents
    slaHours: 4,
    availability: "available",
    description:
      "Managed crew dispatch: job posting, crew matching, offer acceptance, GPS check-in/check-out, real-time location tracking, and checkout verification with photo gate. Supports both direct dispatch and competitive job board posting.",
    capabilities: [
      "Job offer broadcast and acceptance",
      "GPS-gated check-in and check-out",
      "Real-time crew location tracking",
      "After-photo checkout gate",
      "Crew performance history",
    ],
  },
  {
    productKey: "billing-orchestration",
    name: "Billing Orchestration",
    category: "platform",
    pricingModel: "per_job",
    pricePerUnit: 5000, // $50 per invoice workflow in cents
    slaHours: 48,
    availability: "available",
    description:
      "Full invoice-to-payment workflow: AI-assisted invoice generation from price book, SOP-compliant billing rules, client delivery, payment tracking, and double-entry ledger sync. Includes change order management and A/P processing.",
    capabilities: [
      "AI invoice generation from price book",
      "SOP-compliant billing rules",
      "Client invoice delivery",
      "Payment tracking and reminders",
      "Double-entry ledger sync",
      "Change order management",
    ],
  },
  {
    productKey: "property-operations",
    name: "Property Operations Platform",
    category: "platform",
    pricingModel: "monthly",
    pricePerUnit: 299900, // $2999/month in cents
    slaHours: 8,
    availability: "available",
    description:
      "Full-stack property operations: work order lifecycle, vendor management, tenant communication, client board, financial reporting, and Falkon Network integration. Includes all HALO capabilities under a single monthly license.",
    capabilities: [
      "Full work order lifecycle management",
      "Vendor and crew management",
      "Client board and communications",
      "Financial reporting and analytics",
      "Falkon Network integration",
      "All workflow products included",
    ],
  },
];

/**
 * Seed canonical Exchange workflow products (idempotent).
 * Called on server boot — safe to call multiple times.
 */
export async function seedExchangeProducts(): Promise<void> {
  try {
    for (const p of CANONICAL_PRODUCTS) {
      await db
        .insert(falkonExchangeProductsTable)
        .values({
          ...p,
          status: "draft",
        })
        .onConflictDoUpdate({
          target: falkonExchangeProductsTable.productKey,
          set: {
            name: sql`excluded.name`,
            category: sql`excluded.category`,
            pricingModel: sql`excluded.pricing_model`,
            pricePerUnit: sql`excluded.price_per_unit`,
            slaHours: sql`excluded.sla_hours`,
            availability: sql`excluded.availability`,
            description: sql`excluded.description`,
            capabilities: sql`excluded.capabilities`,
            updatedAt: new Date(),
          },
        });
    }
    logger.info(
      { count: CANONICAL_PRODUCTS.length },
      "exchange: canonical workflow products seeded",
    );
  } catch (err) {
    // Non-fatal — Exchange seeding failure must not block server startup
    logger.warn({ err }, "exchange: product seeding failed (non-fatal)");
  }
}
