---
name: OpenAPI schema naming vs orval operation names
description: Avoid schema names that collide with orval's generated <OperationId>Response/Body exports
---
Rule: never name an OpenAPI component schema `<OperationId>Response` or `<OperationId>Body` for any operationId in the spec — orval generates zod exports with those exact names, and the duplicate export breaks `typecheck:libs` (TS2308 ambiguous re-export in api-zod).

**Why:** hit this when a schema `ImportPriceItemsResponse` collided with the generated response for operation `importPriceItems`.

**How to apply:** give response/input schemas distinct nouns (e.g. `PriceItemImportResult`) instead of mirroring the operation name.
