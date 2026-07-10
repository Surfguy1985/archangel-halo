# HALO — Archangel Operations Layer
### Build Spec v1 · July 2026 · Ship threshold 9+

**Verdict: build it. 9/10.** The spreadsheet's data model is right — that's why it survives as the schema. The medium is wrong: 13 tabs, ~30 columns per job, every cell typed by hand, and alerts that sit in a cell instead of finding you. HALO keeps 100% of the model and deletes 95% of the labor. Three surfaces plus a microphone replace the whole workbook.

**The thesis in one line:** you talk, HALO types. Every queue is computed, never maintained. Every alert travels to you with one tap attached.

---

## 1 · 13 tabs → 3 surfaces + a mic

| Spreadsheet tab | Where it lives in HALO |
|---|---|
| Dashboard | **Today** — AI-triaged feed (Now / Today / This Week / Handled) with the 6:45a morning brief on top |
| Properties | **Properties** — one page per property: brief, agreed price list, jobs, expenses, paper, contact |
| Pipeline | Today feed (bid/lead cards) + property pages; a lead is just a card until it becomes a bid |
| Bids | Cards on Today ("bid quiet for 6 days") + the property page's jobs & bids panel |
| Jobs | Job records everywhere they matter — never a grid you scroll |
| Dispatch | The dispatch card on Today + the **Crews** surface |
| Invoices | **Money** (aging, at-risk) + "ready to invoice" cards that send themselves in one tap |
| Ledger | **Money** — computed from invoices, payments, expenses; nobody keys a ledger row again |
| Inventory | Silent until a reorder point trips, then it's a Today card with a pre-filled PO |
| POs | Attached to jobs; late POs surface as blocker cards ("PO-118 blocks tomorrow's job") |
| Lists | Seed data in Settings (service categories, vendors, crews) — set once |
| Settings | Settings sheet: org, price floors, quiet hours, notification rules |
| Data | Gone. HALO *is* the data layer (Supabase), with export to CSV any time |

Bottom nav: **Today · Properties · [gold ring mic] · Money · Crews.** That's the entire app.

## 2 · Every field, mapped — nothing lost

Fill methods: **V** = voice, **A** = automatic, **C** = computed, **P** = photo/OCR, **T** = one tap.

| Spreadsheet column | HALO home | Fill |
|---|---|---|
| Job ID | `jobs.job_no` — auto-sequenced JOB-### | A |
| Work Order # | `jobs.wo_no` — spoken, or parsed from a forwarded PMC email | V/A |
| Status | `jobs.status` enum — moves itself on schedule/complete/invoice events | A |
| Priority | Computed by triage (blockers, money, age) — never hand-set | C |
| Property Management Company | `properties.pmc_name` — set once per property, inherited by every job | A |
| Unit # | `jobs.unit_no` | V |
| Service Category | `jobs.category` — parser matches your category list | V |
| Service Description | `jobs.description` — your words, cleaned up | V |
| Customer Contact / Phone | `contacts` — set once per property, inherited; overridable by voice | A/V |
| Assigned PM | `jobs.pm_user_id` — defaults to you; voice to reassign | A/V |
| Assigned Crew Leader | `jobs.crew_leader_id` — "put Miguel on it" | V |
| Crew Members | `job_assignments` — day-sheet check-ins fill this from the field | V/A |
| Bid ID | `jobs.bid_id` — linked automatically when a bid converts | A |
| Invoice # | `invoices.invoice_no` — auto-sequenced on send | A |
| Purchase Order | `purchase_orders.job_id` link — created by voice or reorder autopilot | V/A |
| Gross Profit | invoice total − expenses − labor; live, per job | C |
| Profit Margin | GP ÷ revenue; Margin Guardian flags below your 25% floor | C |
| Materials Ordered / Received | `purchase_orders.status` — received via one tap or vendor-email parse | T/A |
| Inspection Required | `jobs.inspection_required` — from the property's turn template or voice | A/V |
| Bid Approval | `bids.status` → approved; instant notification, one tap to schedule | A |
| Invoice Ready | Computed: completed + checklist clear + no invoice yet → orange card | C |
| Job Completed | "Mark it done" — voice or crew day-sheet | V |
| Warranty | `jobs.warranty_until` — auto 90 days on completion (per-property override) | A |
| Photos Uploaded / Before / After | `activities` photo records — crew texts them in, auto-tagged to the job | P |
| Work Recap Emailed | `jobs.recap_sent_at` — HALO writes it, you approve, timestamp lands | A/T |
| Notes | `activities` — every voice note transcribed and pinned to the record | V |

**The 8 status queues** (🔴🟠🟡🟢🔵🟣⚫⚪) become eight computed queries — Past Due, Ready to Invoice, Materials Pending, Dispatch Today, Active Bids, Low Inventory, Late POs, Vendor Compliance. They feed the triage engine, which sorts them into Now / Today / This Week. Nobody colors a cell again.

**The 11 quick actions** (New Property / Lead / Bid / Job, Schedule, Invoice, Payment, Expense, Inventory, PO, Vendor) collapse into the one gold ring. Say it, confirm the preview, done. A manual "+" fallback exists for the rare silent moment.

---
## 3 · Supabase schema (RLS non-negotiable)

Stack: **Next.js App Router + Supabase (Postgres, Auth, Storage, Edge Functions) + Tailwind**, deployed to Vercel. Everything below is org-scoped; RLS on every table, no exceptions.

```sql
-- ============ core ============
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null, created_at timestamptz default now()
);
create table org_members (
  org_id uuid references orgs on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('owner','manager','crew_leader')),
  primary key (org_id, user_id)
);

-- RLS helper — one function, reused by every policy
create or replace function is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members
    where org_id = p_org and user_id = auth.uid());
$$;

-- ============ properties & pricing ============
create table properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  name text not null, pmc_name text, city text, units int,
  access_notes text,                 -- gate codes, shutoffs, quirks
  brief text, brief_updated_at timestamptz,   -- Claude-written
  avg_days_to_pay numeric, status text default 'active',
  created_at timestamptz default now()
);
create table contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  property_id uuid references properties on delete set null,
  name text not null, role text, phone text, email text,
  prefers text                        -- 'text before 3pm'
);
create table price_list_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  property_id uuid not null references properties on delete cascade,
  service text not null, detail text, unit text default 'each',
  rate numeric not null, margin_floor numeric default 0.25,
  effective_from date, unique (property_id, service)
);
create table agreements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  property_id uuid references properties on delete cascade,
  title text, storage_path text, effective_from date, renews_on date
);

-- ============ pipeline ============
create table leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  property_id uuid references properties, source text, summary text,
  status text default 'new' check (status in ('new','qualified','bid','dead')),
  created_at timestamptz default now()
);
create table bids (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  bid_no text not null, property_id uuid references properties,
  unit_no text, scope text, amount numeric not null, est_cost numeric,
  status text default 'draft' check (status in ('draft','sent','approved','declined','expired')),
  sent_at timestamptz, decided_at timestamptz, last_nudge_at timestamptz
);

-- ============ jobs ============
create table crew_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  name text not null, trade text, phone text,
  is_leader boolean default false, active boolean default true
);
create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  job_no text not null, wo_no text,
  property_id uuid not null references properties,
  unit_no text, category text, description text,
  status text default 'pending' check (status in
    ('pending','scheduled','in_progress','blocked','completed','invoiced','paid','warranty','cancelled')),
  pm_user_id uuid references auth.users,
  crew_leader_id uuid references crew_members,
  bid_id uuid references bids, contact_id uuid references contacts,
  inspection_required boolean default false, inspection_passed_at timestamptz,
  completed_at timestamptz, recap_sent_at timestamptz,
  warranty_until date, created_at timestamptz default now()
);
create table job_assignments (
  job_id uuid references jobs on delete cascade,
  crew_member_id uuid references crew_members on delete cascade,
  primary key (job_id, crew_member_id)
);
create table schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  job_id uuid not null references jobs on delete cascade,
  scheduled_on date not null, window_start time, 
  crew_leader_id uuid references crew_members,
  status text default 'scheduled' check (status in ('scheduled','dispatched','on_site','done','pushed'))
);

-- ============ money ============
create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  invoice_no text not null, job_id uuid references jobs,
  property_id uuid not null references properties,
  amount numeric not null, sent_at timestamptz, due_at date, paid_at timestamptz
);
-- status is computed at query time (current_date isn't immutable,
-- so no generated column): draft / sent / past_due / paid
create view v_invoice_status as
  select i.*, case when i.paid_at is not null then 'paid'
                   when i.sent_at is null then 'draft'
                   when i.due_at < current_date then 'past_due'
                   else 'sent' end as status
  from invoices i;
create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  invoice_id uuid references invoices, amount numeric not null,
  method text, received_at timestamptz default now()
);
create table expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  job_id uuid references jobs, property_id uuid references properties,
  vendor text, category text, amount numeric not null,
  receipt_path text, source text default 'voice',   -- voice | receipt_ocr | manual
  spent_on date default current_date
);

-- ============ inventory, POs, vendors ============
create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  name text not null, qty numeric default 0, reorder_at numeric default 0,
  unit_cost numeric, preferred_vendor text
);
create table inventory_moves (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  item_id uuid references inventory_items on delete cascade,
  delta numeric not null, job_id uuid references jobs, reason text,
  created_at timestamptz default now()
);
create table vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  name text not null, trade text, email text, phone text,
  w9_path text, coi_path text, coi_expires_on date
);
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  po_no text not null, vendor_id uuid references vendors,
  job_id uuid references jobs, expected_on date, received_at timestamptz,
  status text default 'draft' check (status in ('draft','sent','ordered','received','cancelled'))
);
create table po_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid references purchase_orders on delete cascade,
  description text, qty numeric, unit_price numeric
);

-- ============ nervous system ============
create table activities (            -- polymorphic timeline: notes, photos, calls, emails
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  entity_type text not null, entity_id uuid not null,
  kind text not null check (kind in ('note','photo_before','photo_after','call','email','sms','system')),
  body text, storage_path text, created_by uuid, created_at timestamptz default now()
);
create table voice_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  audio_path text, transcript text not null,
  parsed_actions jsonb not null, status text default 'pending'
    check (status in ('pending','confirmed','edited','discarded')),
  confirmed_by uuid, created_at timestamptz default now()
);
create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  user_id uuid not null, kind text not null, priority text not null
    check (priority in ('instant','brief','close','weekly')),
  entity_type text, entity_id uuid, title text, body text,
  channel text[] default '{inapp}', sent_at timestamptz, read_at timestamptz,
  resolved_at timestamptz, dedupe_key text
);
create unique index notif_dedupe on notifications (org_id, dedupe_key)
  where resolved_at is null;
create table stage_transitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, entity_type text, entity_id uuid,
  from_status text, to_status text, by_user uuid, at timestamptz default now()
);
create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null, actor uuid, action text, entity_type text,
  entity_id uuid, diff jsonb, at timestamptz default now()
);

-- ============ RLS: same pattern, every table ============
alter table properties enable row level security;
create policy p_sel on properties for select using (is_member(org_id));
create policy p_ins on properties for insert with check (is_member(org_id));
create policy p_upd on properties for update using (is_member(org_id));
create policy p_del on properties for delete
  using (exists (select 1 from org_members m where m.org_id = properties.org_id
                 and m.user_id = auth.uid() and m.role in ('owner','manager')));
-- Repeat the four-policy pattern for every org_id table above.
-- Crew leaders get select + insert on activities/expenses/schedules only;
-- money tables (invoices, payments) are owner/manager for writes.

-- ============ the 8 queues, computed ============
create view v_queues as
  select 'past_due' as queue, i.org_id, i.id as entity_id, i.invoice_no as label
    from v_invoice_status i where i.status = 'past_due'
  union all
  select 'ready_to_invoice', j.org_id, j.id, j.job_no from jobs j
    where j.status = 'completed' and j.recap_sent_at is not null
      and not exists (select 1 from invoices v where v.job_id = j.id)
  union all
  select 'late_po', p.org_id, p.id, p.po_no from purchase_orders p
    where p.status in ('sent','ordered') and p.expected_on < current_date
  union all
  select 'low_inventory', it.org_id, it.id, it.name from inventory_items it
    where it.qty <= it.reorder_at
  union all
  select 'vendor_compliance', v.org_id, v.id, v.name from vendors v
    where v.coi_expires_on < current_date + 30;
-- dispatch_today, active_bids, materials_pending follow the same shape.
```

Storage buckets: `receipts/`, `photos/`, `agreements/`, `voice/` — all private, signed URLs only.

---
## 4 · The voice pipeline

```
Hold ring → MediaRecorder captures audio
  → Deepgram Nova (streaming STT; Whisper API as fallback)   [~300ms]
  → Claude (tool use, strict schema) parses transcript        [~1.5s]
  → Preview cards render — nothing has written yet
  → One tap "Confirm & file" → Supabase writes + audit row
  → audio + transcript + parsed JSON land in voice_logs (clean audit trail)
```

Deepgram over Whisper as primary: streaming partials for the live transcript, and it holds up better against jobsite noise and trade jargon. Keep Whisper as the retry path.

**Claude parser — system prompt (drop-in):**

```
You are HALO's intake parser for Archangel Contractors. Convert one spoken
update into structured actions using ONLY the provided tools. Rules:

1. Resolve names fuzzily against the provided context lists (properties,
   crews, vendors, categories, open jobs/bids/POs/invoices). "Lakeside" →
   Lakeside Commons. "Miguel's job" → the open job where crew_leader=Miguel.
2. "The agreed price / usual rate" → look up price_list_items for that
   property+service and attach rate + item id. If no match, set
   needs_review=true with a note; never invent a number.
3. Relative dates resolve in America/Chicago. "Thursday morning" →
   next Thursday, window_start 08:00.
4. Money: "four eighty-two sixteen" → 482.16. Never round.
5. One utterance often means several actions (create job + schedule +
   attach rate). Emit them all, in dependency order.
6. If a required field is missing or ambiguous, emit request_info with a
   single, specific question. Never guess a property or an amount.
7. Emit strictly valid tool calls. No prose.
```

**Action tools (JSON schema names):** `create_job`, `schedule_job`, `update_job_status`, `complete_job`, `create_bid`, `create_lead`, `create_invoice`, `record_payment`, `log_expense`, `adjust_inventory`, `create_po`, `add_vendor`, `add_note`, `request_info`. Each carries `org_id`-scoped references, a `confidence` float, and `needs_review` — anything under 0.8 confidence renders with a yellow edge in the preview so the eye goes there first.

## 5 · Notifications — the 10/10 system

Two channels (in-app + email; SMS in Phase 2), four rhythms, and laws that keep it quiet.

| Event | Trigger | Channel | When | Auto-resolves when |
|---|---|---|---|---|
| Invoice paid | payment insert | email + in-app | instant | — |
| Bid approved | bids.status→approved | email + in-app | instant | scheduled |
| Blocker: PO late vs. scheduled job | expected_on past + schedule ≤48h | email + in-app | instant | PO received or job pushed |
| Vendor COI lapse on dispatched work | expiry ≤30d + upcoming assignment | in-app, email at 7d | daily check | new COI uploaded |
| Invoice past due | due_at passed | in-app card + drafted reminder | 6:45a brief | paid |
| Ready to invoice | completion checklist clears | in-app | within 15 min | invoice sent |
| Bid quiet | sent + no reply 5 days | in-app | 6:45a brief | reply or nudge |
| Low inventory | qty ≤ reorder_at | in-app + pre-filled PO | 6:45a brief | PO sent |
| Morning brief | cron | email | 6:45a | — |
| Evening close | cron | email | 6:30p | — |
| Weekly scorecard | cron | email | Mon 7:00a | — |

**Anti-noise laws (hard-coded):** one live notification per `dedupe_key` — a thing never nags twice for the same state. Non-urgent items bundle into the next brief. Quiet hours 9:00p–6:30a; only paid/approved/emergency break through. Every alert carries its one-tap action (the reminder is *drafted*, the PO is *pre-filled*). State change anywhere resolves the alert everywhere.

**Templates.** Morning brief: crews out, cash landing this week, top blockers with actions queued — five sentences, written by Claude from live data, signed with the ring. Instant: one line, one number, one button. Evening close ends the same way every day: *"Desk is clear — the rest can wait until 6:45 tomorrow."*

## 6 · Where Claude lives in HALO

Six touchpoints, one SDK: the **voice parser** (above); the **property brief writer** (nightly + on-change: pay behavior, margin drift, gotchas — the paragraph on every property page); the **recap writer** (before/after photos + your notes → the client-ready work recap email); the **email-to-job parser** (forward any PMC work order to jobs@archangel — a draft job card appears for one-tap accept); the **triage engine** (scores every open item into Now / Today / This Week and writes the briefs); and **Ask HALO** ("what's my margin at Copper Ridge this quarter" — answered from SQL, not vibes).

## 7 · God mode — ten steps ahead

**Phase 1 ships with:** Margin Guardian (live GP per job, flags under the 25% floor before an invoice leaves), Price List Memory ("the agreed rate" just works), auto-invoice on completion, and the drive-home close — 90 seconds of talking files the whole day.

**Phase 2:** receipt cam (snap it, OCR checks the total against what you said), crew day sheets by SMS link — zero download, their voice notes and photos file straight to the job — inventory reorder autopilot, email-to-job inbox, invoice PDFs.

**Phase 3:** PMC scorecard (days-to-pay, margin, volume per management company — who gets a rate increase, who gets fired), Cash Radar forecasting off real pay patterns, warranty vault (callbacks inside the window auto-flag no-charge and score crew quality), Make-Ready turn templates ("turn unit 204" spawns the whole checklist), Ask HALO, and the Falkyn graduation path — HALO is the internal proving ground; what survives Archangel's 500 properties becomes Falkyn's feature list.

## 8 · Build plan

**Phase 1 — the vertical slice (one week in Claude Code).** Schema + RLS, auth, Today feed with computed queues, Properties with price lists, the full voice loop (record → Deepgram → Claude → preview → confirm), morning brief + instant paid/approved emails via Resend, drive-home close. Ship it and run Archangel on it for two weeks before touching Phase 2.

**Kickoff prompt (paste into Claude Code):**

```
Read HALO-build-spec.md in this repo root. Build Phase 1 exactly as specified:
Next.js 15 App Router + TypeScript + Tailwind + Supabase. Apply the full
schema and RLS from §3 as migrations. Build four routes — /today /properties
/money /crews — plus the voice sheet (MediaRecorder → Deepgram →
/api/parse using the Anthropic SDK with the §4 system prompt and tools →
preview cards → confirmed writes + voice_logs row). Cron routes for the
6:45a brief and 6:30p close emailing via Resend, templates per §5, with the
dedupe_key law enforced. Match the visual system in halo-prototype.html:
porcelain paper, ink, gold ring, Bricolage Grotesque display. Zero stubs —
every button writes, every state renders. Definition of done: I can create
a job, schedule it, expense it, complete it, and invoice it entirely by
voice, and the morning brief email describes it correctly.
```

**Needs from you before kickoff:** a Supabase project (URL + service key), Anthropic API key, Deepgram key, Resend key + a send domain (halo@archangel…), and the real property list with agreed rates — even five properties seeds it. Twilio waits for Phase 2.

---

*HALO exists so the desk stops following you home. Everything above serves that.*
