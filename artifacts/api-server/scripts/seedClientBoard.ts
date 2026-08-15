/**
 * CLI: apply Client Board v1 schema (if needed) and seed 12×40×120 demo data.
 * Usage: pnpm seed:demo   (alias: pnpm --filter @workspace/api-server seed:client-board)
 */
import { pool } from "@workspace/db";
import { seedClientBoard } from "../src/lib/seedClientBoard";

const summary = await seedClientBoard();
console.log(JSON.stringify(summary, null, 2));
await pool.end();
