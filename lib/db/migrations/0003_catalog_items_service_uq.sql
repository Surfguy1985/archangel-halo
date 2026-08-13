-- Deduplicate catalog_items by normalized service name before adding the
-- unique index. For each group of rows that share the same lower(trim(service)),
-- keep the oldest (min createdAt) and delete the rest.
DELETE FROM catalog_items
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY lower(trim(service))
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM catalog_items
  ) ranked
  WHERE rn > 1
);

-- Case/whitespace-insensitive unique index — mirrors price_items_property_service_uq.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_items_service_uq
  ON catalog_items (lower(trim(service)));
