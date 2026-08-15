/**
 * CLI: ingest a real Entrata CSV export into the Client Board shape.
 * Usage: pnpm seed:live -- --source=./caf-export/
 */
import { pool } from "@workspace/db";
import { parseSourceArg, seedClientBoardLive } from "../src/lib/seedClientBoardLive";

const source = parseSourceArg(process.argv.slice(2));
if (!source) {
  console.error("Usage: pnpm seed:live -- --source=./caf-export/");
  process.exit(1);
}

const summary = await seedClientBoardLive(source);
console.log(JSON.stringify(summary, null, 2));
await pool.end();
