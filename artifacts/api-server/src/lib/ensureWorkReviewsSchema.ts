import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
let ensured = false;
export async function ensureWorkReviewsSchema(): Promise<void> {
  if (ensured) return;
  await db.execute(sql`CREATE TABLE IF NOT EXISTS work_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending_field', trigger text NOT NULL DEFAULT 'dispatch_scan',
    verification_snapshot jsonb, field_edits jsonb, field_submitted_at timestamptz, field_submitted_by text,
    bot_final_snapshot jsonb, margin_report jsonb, bot_decision text, bot_notes text,
    discrepancy_count integer DEFAULT 0, invoice_queued_at timestamptz, field_notified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await db.execute(sql`ALTER TABLE work_reviews ADD COLUMN IF NOT EXISTS margin_report jsonb`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS work_report_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid, job_id uuid NOT NULL,
    job_no text, unit_no text, stage text NOT NULL, title text NOT NULL, summary text,
    card jsonb NOT NULL, margin_report jsonb, actor text, created_at timestamptz NOT NULL DEFAULT now())`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS work_reviews_job_idx ON work_reviews (job_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS work_reviews_status_idx ON work_reviews (status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS work_report_cards_job_idx ON work_report_cards (job_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS work_report_cards_created_idx ON work_report_cards (created_at DESC)`);
  ensured = true;
  logger.info("work_reviews + work_report_cards schema ensured");
}
