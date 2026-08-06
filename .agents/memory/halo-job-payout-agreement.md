---
name: HALO job payout agreement
description: Per-job contractor payout agreement shown before any work step; backed by job_agreements DB table and portal routes.
---

# HALO Per-Job Payout Agreement

## Rule
Every crew member must tap **"I Agree & Start Work"** on a payout agreement card before any work step begins on any job.
The agreement is recorded in the `job_agreements` table (unique on job_id + crew_id, idempotent on repeat calls).

The card appears in `deriveCard` immediately after check-in (`isIn === true`) and before `before-photos`.

## Agreement content (server-side, snapshot)
1. **Payout schedule** — derived from `crews.payment_terms` at time of agreement (snapshot stored in `job_agreements.payment_terms`)
2. **Condition 1** — Property must verify work was completed correctly
3. **Condition 2** — Archangel must have received full payment from the property
4. Consequence: payout held until both conditions are met

## Payment terms values
`due_on_receipt` | `net15` | `net30` | `net45` (from crews table, same options as crew profile)

## Why
Ensures every contractor has explicit, time-stamped acknowledgement of their payout schedule and the two release conditions on a per-job basis (not just the one-time IC portal agreement).

## How to apply
- New portal work steps that gate on agreement status: check `jobAgreed[job.id]` (derived in `CrewPortalFlow.tsx` from `job.jobAgreedAt || locallyAgreedJobs.has(job.id)`)
- Server agreement endpoint: `POST /portal/:token/jobs/:jobId/agreement` — idempotent, logs activity + notification
- `job_agreements` table has: `job_id`, `crew_id`, `payment_terms` (snapshot), `terms_text` (snapshot), `agreed_at`, `agreed_by`
- `jobAgreedAt` is included in `ListPortalJobsResponse` items (Zod schema updated, server joins job_agreements)
- `paymentTerms` added to `GetPortalResponse.crew` (Zod schema updated, server includes from crews row)

## Do NOT
- Allow skipping the agreement entirely (no skip button on the job-agreement card)
- Use the one-time `crews.agreement_accepted_at` for per-job gate logic — that's the IC portal agreement, separate from payout terms
