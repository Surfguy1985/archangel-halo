import { eq } from "drizzle-orm";
import { db, catalogItemsTable, priceItemsTable } from "@workspace/db";
import type { CatalogCandidate } from "./catalogMatchCore";

export async function loadCatalogCandidates(propertyId?: string | null): Promise<CatalogCandidate[]> {
  const [catalog, prices] = await Promise.all([
    db
      .select({
        id: catalogItemsTable.id,
        service: catalogItemsTable.service,
        detail: catalogItemsTable.detail,
        unit: catalogItemsTable.unit,
        rate: catalogItemsTable.rate,
      })
      .from(catalogItemsTable),
    propertyId
      ? db
          .select({
            id: priceItemsTable.id,
            service: priceItemsTable.service,
            detail: priceItemsTable.detail,
            unit: priceItemsTable.unit,
            rate: priceItemsTable.rate,
          })
          .from(priceItemsTable)
          .where(eq(priceItemsTable.propertyId, propertyId))
      : db
          .select({
            id: priceItemsTable.id,
            service: priceItemsTable.service,
            detail: priceItemsTable.detail,
            unit: priceItemsTable.unit,
            rate: priceItemsTable.rate,
          })
          .from(priceItemsTable),
  ]);
  const out: CatalogCandidate[] = [];
  for (const p of prices) {
    out.push({
      id: p.id,
      name: [p.service, p.detail].filter(Boolean).join(" "),
      unit: p.unit,
      rate: p.rate,
      source: "price_item",
    });
  }
  for (const c of catalog) {
    out.push({
      id: c.id,
      name: [c.service, c.detail].filter(Boolean).join(" "),
      unit: c.unit,
      rate: c.rate,
      source: "catalog_item",
    });
  }
  return out;
}
