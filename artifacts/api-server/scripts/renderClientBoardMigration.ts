/**
 * Writes lib/db/migrations/0015_client_board_v1.sql from clientBoardDdl.ts
 * so the SQL folder and the boot-time ensure path cannot drift.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderClientBoardMigrationSql } from "@workspace/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../../lib/db/migrations/0015_client_board_v1.sql");
writeFileSync(out, renderClientBoardMigrationSql());
console.log(`wrote ${out}`);
