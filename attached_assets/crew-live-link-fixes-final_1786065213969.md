# Crew Live Link — final patches: GPS fallback, table scans, earnings, duplicate punch

Corrects the three defects I found grading v2: the `computeUnseen` fan-out regression, the unwired `gpsBlocked` state, and the duplicate-punch lockout. Earnings is rewritten so it no longer depends on reading `emergencySettlement.ts`. Duplicate punch now has two paths because the right one depends on your Drizzle driver.

Line numbers are against the files as sent.

---

# 1. GPS fallback

Complete this time — state, handler, and the JSX that consumes it.

## 1a. Copy keys

`COPY.en`, near line 250:

```ts
noGpsTitle:  "Can't get a location fix",
noGpsBody:   "You can still start. We'll tell the office the location is missing.",
noGpsStart:  "Start without location",
noGpsRetry:  "Try location again",
noGpsLabel:  "Checked in without a GPS fix",
noGpsActive: "Started without location — no travel trail today.",
```

`COPY.es`, near line 321:

```ts
noGpsTitle:  "No se puede fijar la ubicación",
noGpsBody:   "Puedes empezar igual. Le avisamos a la oficina que falta la ubicación.",
noGpsStart:  "Empezar sin ubicación",
noGpsRetry:  "Intentar ubicación otra vez",
noGpsLabel:  "Registrado sin señal de GPS",
noGpsActive: "Empezaste sin ubicación — hoy no hay ruta registrada.",
```

`t` is cast `COPY[lang] as typeof COPY.en`, so a key missing from `es` is a runtime `undefined` the compiler won't catch. Add both sides together.

## 1b. State and handler

Near the other `useState` calls, around line 594:

```ts
// Job id whose check-in is waiting on a location decision. Null = no prompt.
const [gpsBlocked, setGpsBlocked] = useState<string | null>(null);
```

Replace `doCheckIn` (lines 784–795):

```ts
const doCheckIn = async (jobId: string, allowNoGps = false) => {
  setErr(null); setNotice(null); setBusy(`ci:${jobId}`);
  const pos = await getPosition();

  if (!pos && !allowNoGps) {
    setBusy(null);
    setGpsBlocked(jobId);   // a fork, not a dead end
    return;
  }
  setGpsBlocked(null);

  checkinMut.mutate(
    {
      token,
      data: {
        jobId,
        kind: "checkin",
        lat: pos?.coords.latitude ?? null,
        lng: pos?.coords.longitude ?? null,
        accuracy: pos?.coords.accuracy ?? null,
        // Goes straight into the office notification body — must read as a
        // sentence, not a slug. See §4b.
        label: pos ? null : t.noGpsLabel,
      },
    },
    {
      onSuccess: () => {
        setBusy(null);
        // No fix means no trail. Starting one from a device that just failed
        // to produce a position writes null points for the rest of the shift.
        if (pos) startTrail(jobId);
        setNotice(pos ? t.checkinOk : t.noGpsActive);
        refresh();
      },
      onError: (e) => {
        setBusy(null);
        const data = (e as { data?: { code?: string; error?: string } | null })?.data;
        if (data?.code === "duplicate_punch") { setNotice(t.alreadyIn); refresh(); return; }
        setErr(data?.error ?? t.saveErr);
      },
    },
  );
};
```

## 1c. The JSX — this is what v2 was missing

In the `scheduled` card (line 1247), replace the action block at lines 1280–1289:

```tsx
<div className="px-[22px] pb-[22px]">
  {gpsBlocked === job.id ? (
    <div className="flex flex-col gap-[10px]">
      <div className="rounded-[14px] bg-amber-500/10 border border-amber-500/25 px-[13px] py-[12px]">
        <div className="flex items-center gap-[7px]">
          <AlertCircle className="w-[15px] h-[15px] text-amber-400 shrink-0" />
          <span className="text-[13.5px] font-bold text-amber-300">{t.noGpsTitle}</span>
        </div>
        <p className="text-[12.5px] text-white/55 mt-[7px] leading-[1.45]">{t.noGpsBody}</p>
      </div>
      <PrimaryBtn
        onClick={() => doCheckIn(job.id, true)}
        busy={isBusy}
        disabled={isBusy}
        icon={LogIn}
        label={t.noGpsStart}
      />
      <button
        type="button"
        onClick={() => { setGpsBlocked(null); doCheckIn(job.id); }}
        disabled={isBusy}
        className="w-full py-[12px] text-[14px] font-bold text-white/55 disabled:opacity-40"
      >
        {t.noGpsRetry}
      </button>
    </div>
  ) : (
    <PrimaryBtn
      onClick={() => doCheckIn(job.id)}
      busy={isBusy}
      disabled={isBusy || !windowOpen}
      icon={LogIn}
      label={windowOpen ? t.checkInBtn : t.checkInLocked(minsToWindow)}
    />
  )}
</div>
```

`AlertCircle` and `LogIn` are both already imported (lines 46, 42).

Retry is the quieter of the two — a crew who can step outside should, but the one standing in a basement stairwell isn't blocked while they figure that out.

## 1d. Server — flag it without leaking a slug

In `POST /checkins`, before the notification insert around line 1163:

```ts
const noFix = kind === "checkin" && body.lat == null;
```

Then in the `notificationsTable` insert (line 1166):

```ts
title:
  kind === "checkout"
    ? `${crew.name} checked out${jobLabel ? ` — ${jobLabel}` : ""}`
    : `${crew.name} checked in${jobLabel ? ` — ${jobLabel}` : ""}${noFix ? " · no GPS" : ""}`,
```

The body line stays as-is: `body.note ?? body.label ?? …` now resolves to the human sentence from `t.noGpsLabel`.

Dispatch can find these after the fact with no schema change:

```sql
SELECT * FROM crew_checkins WHERE kind = 'checkin' AND lat IS NULL ORDER BY created_at DESC;
```

---

# 2. Table scans

Same shape as v2 with the fan-out regression removed and exact deletion boundaries.

## 2a. What changed from v2

`computeUnseen` fires eight queries of its own. Folding it into the Phase A `Promise.all` made Phase A a fourteen-query burst per portal load, per crew, every sixty seconds — worse on a small pool than the sequential version it replaced. It stays where it is.

## 2b. Replace lines 312–338

Everything from `const [schedRows, eventRows, jobs, props, contacts] = await Promise.all([` through the closing `]);`.

```ts
// ── Phase A: crew-scoped only. Six queries, no job dependency. ──
const [schedRows, eventRows, offerRows, emergencyTargetRows, planRows, leaderRows] =
  await Promise.all([
    db.select().from(schedulesTable)
      .where(and(
        eq(schedulesTable.crewLeaderId, crew.id),
        gte(schedulesTable.scheduledOn, schedStart),
        lte(schedulesTable.scheduledOn, schedEnd),
      ))
      .orderBy(schedulesTable.scheduledOn),

    db.select().from(calendarEventsTable)
      .where(and(
        eq(calendarEventsTable.crewId, crew.id),
        gte(calendarEventsTable.eventDate, schedStart),
        lte(calendarEventsTable.eventDate, schedEnd),
      ))
      .orderBy(calendarEventsTable.eventDate),

    db.select().from(jobBroadcastsTable)
      .where(and(
        eq(jobBroadcastsTable.crewId, crew.id),
        inArray(jobBroadcastsTable.status, ["pending", "approved", "declined"]),
      ))
      .orderBy(desc(jobBroadcastsTable.sentAt)),

    db.select().from(emergencyPingTargetsTable)
      .where(and(
        eq(emergencyPingTargetsTable.crewId, crew.id),
        inArray(emergencyPingTargetsTable.status, ["pending", "committed", "missed", "expired"]),
      ))
      .orderBy(desc(emergencyPingTargetsTable.sentAt)),

    // Moved up from line 421 — one less sequential round trip.
    db.select().from(crewRoutePlansTable)
      .where(and(
        eq(crewRoutePlansTable.crewId, crew.id),
        gte(crewRoutePlansTable.day, weekStart),
        lte(crewRoutePlansTable.day, weekEnd),
      )),

    // Hoisted out of the response literal at line 597, where it was an
    // await inside an object being passed to .parse().
    crew.leaderId
      ? db.select({ name: crewsTable.name }).from(crewsTable)
          .where(eq(crewsTable.id, crew.leaderId))
      : Promise.resolve([] as { name: string }[]),
  ]);

// ── Phase B: resolve pings, then the complete job-ID union. ──
// Order matters. Offers and emergency pings reference jobs that are NOT in
// the schedule window, and both silently drop rows when the job is missing
// (`jobsById.has` at line 486, `if (!job) return false` at line 558) — so a
// scoped query built from schedule alone empties both arrays with no error.
const emergencyPingIds = [...new Set(emergencyTargetRows.map((t) => t.pingId))];
const emergencyPings = emergencyPingIds.length
  ? await db.select().from(emergencyPingsTable)
      .where(inArray(emergencyPingsTable.id, emergencyPingIds))
  : [];
const pingById = new Map(emergencyPings.map((p) => [p.id, p]));

const jobIds = [...new Set([
  ...schedRows.map((s) => s.jobId),
  ...eventRows.map((e) => e.jobId),
  ...offerRows.map((o) => o.jobId),
  ...emergencyPings.map((p) => p.jobId),
].filter((id): id is string => Boolean(id)))];

const jobs = jobIds.length
  ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
  : [];
const jobsById = new Map(jobs.map((j) => [j.id, j]));

// ── Phase C: properties, contacts, offer photos. ──
const propIds = [...new Set(
  jobs.map((j) => j.propertyId).filter((p): p is string => Boolean(p)),
)];
const offerJobIds = [...new Set(offerRows.map((o) => o.jobId))];

const [props, contacts, offerPhotos] = await Promise.all([
  propIds.length
    ? db.select().from(propertiesTable).where(inArray(propertiesTable.id, propIds))
    : Promise.resolve([] as (typeof propertiesTable.$inferSelect)[]),
  propIds.length
    ? db.select().from(contactsTable).where(inArray(contactsTable.propertyId, propIds))
    : Promise.resolve([] as (typeof contactsTable.$inferSelect)[]),
  offerJobIds.length
    ? db.select().from(activitiesTable).where(and(
        eq(activitiesTable.entityType, "job"),
        inArray(activitiesTable.entityId, offerJobIds),
      ))
    : Promise.resolve([] as (typeof activitiesTable.$inferSelect)[]),
]);
const propsById = new Map(props.map((p) => [p.id, p]));

// Unchanged from the original — kept here because the sort at line 439 needs it.
const orderByDay = new Map<string, Map<string, number>>();
for (const p of planRows) {
  const keys = Array.isArray(p.stopKeys) ? (p.stopKeys as string[]) : [];
  orderByDay.set(p.day, new Map(keys.map((k, i) => [k, i])));
}
```

The explicit `Promise.resolve([] as …)` branches matter: a bare `[]` in a ternary inside `Promise.all` widens the tuple type and you lose the row types downstream.

## 2c. Index the contacts — replace lines 344–353

`contactForProp` currently runs `contacts.filter(...)` once per schedule row, per offer, and per ping.

```ts
const contactsByProp = new Map<string, typeof contacts>();
for (const c of contacts) {
  if (!c.propertyId) continue;
  const list = contactsByProp.get(c.propertyId);
  if (list) list.push(c);
  else contactsByProp.set(c.propertyId, [c]);
}

const contactForProp = (propertyId: string | null | undefined) => {
  if (!propertyId) return null;
  const forProp = contactsByProp.get(propertyId);
  if (!forProp?.length) return null;
  const withPhone = forProp.filter((c) => c.phone);
  const onSite = withPhone.find((c) => /on.?site|maint/i.test(c.role ?? ""));
  return onSite ?? withPhone[0] ?? forProp[0]!;
};
```

## 2d. Exact deletions

Work bottom-up so earlier deletions don't shift later line numbers.

| Lines | What | Note |
|---|---|---|
| 525–546 | `emergencyTargetRows` query, `emergencyPingIds`, `emergencyPings`, `pingById` | Now in Phase B. Stop before line 547 (`const emergencyOffers =`) — keep that. |
| 465–484 | `offerPropIds` and the `const [offerPhotos] = await Promise.all([…])` wrapper | `offerPropIds` is declared and never read anywhere in the file — confirmed dead. `offerJobIds` moves to Phase C. |
| 448–462 | `const offerRows = await db…orderBy(desc(jobBroadcastsTable.sentAt));` | Now in Phase A. |
| **421–430** | The `planRows` query **only** | Starts at `const planRows = await db`, ends at the `);` on line 430. **Keep lines 431–435** — `orderByDay` and the `for` loop that fills it are still needed and now live at the end of Phase C. My v2 said "delete 420–431," which would have taken the `orderByDay` declaration with it. |

Then update the response literal at line 597:

```ts
leaderName: leader Rows[0]?.name ?? null,
```

(no space — `leaderRows[0]?.name ?? null`)

Result: seven sequential awaits become three phases, and `computeUnseen` stays where it was on its own.

## 2e. The same scan in `/earnings`

Line 2351 sits inside a `Promise.all` alongside `holds`, so it can't be scoped in place. Split it — and select only the two columns actually read at line 2383:

```ts
const [holds, payouts, payments] = await Promise.all([ /* … first three unchanged … */ ]);

const holdJobIds = [...new Set(
  holds.map((h) => h.jobId).filter((id): id is string => Boolean(id)),
)];
const jobs = holdJobIds.length
  ? await db.select({
      id: jobsTable.id,
      jobNo: jobsTable.jobNo,
      category: jobsTable.category,
    }).from(jobsTable).where(inArray(jobsTable.id, holdJobIds))
  : [];
```

## 2f. Verify

The regression that matters is silent, so test for presence, not speed:

```ts
it("still returns offers for jobs outside the schedule window", async () => {
  const job = await seedJob({ scheduledOn: null });        // never scheduled
  await seedBroadcast({ crewId, jobId: job.id, status: "pending" });
  const res = await get(`/portal/${token}`);
  expect(res.offers).toHaveLength(1);                       // fails on the naive scoping
});

it("does not scale with total job count", async () => {
  await seedJobs(50_000);
  const t0 = Date.now();
  await get(`/portal/${token}`);
  expect(Date.now() - t0).toBeLessThan(400);
});
```

---

# 3. Earnings

Rewritten so it's correct **without** reading `emergencySettlement.ts`.

## 3a. Why this version is different

v1 and v2 both patched the arithmetic while guessing at `outstandingHoldAmount`'s contract. This version makes the reconciliation invariant hold *by construction*: derive two clamped quantities per hold, and let every total be a sum of those. Whatever `outstandingHoldAmount` returns, the three totals still add up to the face value of the non-cancelled holds.

## 3b. Replace lines 2361–2380

```ts
let heldTotal = 0;
let payableTotal = 0;
let paidTotal = 0;

const rows = holds.map((h) => {
  const job = jobsById2.get(h.jobId);
  const face = h.amount;

  // A settled payout means nothing is outstanding, whatever the payments
  // ledger says. Otherwise clamp into [0, face] so an unexpected return
  // value degrades instead of producing a negative total.
  const settledByPayout = h.status === "RELEASED" && settled.has(`${h.crewId}|${h.jobId}`);
  const outstanding = settledByPayout
    ? 0
    : Math.min(Math.max(outstandingHoldAmount(h.amount, h.crewId, h.jobId, payments), 0), face);
  const alreadyPaid = face - outstanding;

  let state: "held" | "payable" | "paid" | "cancelled";
  if (h.status === "HELD") {
    state = "held";
    heldTotal += face;
  } else if (h.status === "CANCELLED") {
    state = "cancelled";
    // Contributes to nothing, by design.
  } else if (outstanding <= 0) {
    state = "paid";
    paidTotal += face;
  } else {
    state = "payable";
    // A partially settled hold splits across both buckets. The old code put
    // the remainder in payable and dropped `alreadyPaid` on the floor, so
    // money the crew had already received vanished from their totals.
    payableTotal += outstanding;
    paidTotal += alreadyPaid;
  }

  return {
    id: h.id,
    jobId: h.jobId,
    jobLabel: job ? [job.jobNo, job.category].filter(Boolean).join(" · ") : null,
    amount: face,
    bonusAmount: h.bonusAmount,
    state,
    sameDayPay: true,
    heldAt: h.heldAt.toISOString(),
    releasedAt: h.releasedAt ? h.releasedAt.toISOString() : null,
  };
});
```

Every branch adds exactly `face` across the three totals, except `cancelled` which adds nothing. That's the invariant, and it doesn't depend on the helper's semantics.

## 3c. Verify

```ts
it("reconciles the three totals against hold face value", async () => {
  const { heldTotal, payableTotal, paidTotal, holds } = await get(`/portal/${token}/earnings`);
  const face = holds
    .filter((h) => h.state !== "cancelled")
    .reduce((s, h) => s + h.amount, 0);
  expect(heldTotal + payableTotal + paidTotal).toBeCloseTo(face, 2);
});

it("splits a partially settled hold across payable and paid", async () => {
  const hold = await seedHold({ amount: 200, status: "RELEASED" });
  await seedPayment({ crewId, jobId: hold.jobId, amount: 120 });
  const { payableTotal, paidTotal } = await get(`/portal/${token}/earnings`);
  expect(payableTotal).toBeCloseTo(80, 2);
  expect(paidTotal).toBeCloseTo(120, 2);   // the old code returned 0 here
});
```

The second test is the one that documents the actual bug. If it fails at `paidTotal`, `outstandingHoldAmount` isn't returning what its name implies and you should read it before shipping — the clamps keep the totals sane either way, but the split would be wrong.

---

# 4. Duplicate punch

Two paths. Pick by driver.

## 4a. Check your driver first

```bash
grep -rn "drizzle-orm/neon-http\|drizzle-orm/neon-serverless\|drizzle-orm/postgres-js\|drizzle-orm/node-postgres" packages/db/
```

| Import | Interactive transactions | Use |
|---|---|---|
| `neon-http` | **No** — `db.transaction()` throws | Path B |
| `neon-serverless` (WebSocket `Pool`) | Yes | Path A |
| `postgres-js` / `node-postgres` | Yes | Path A |

Replit's default Postgres is Neon, and `neon-http` is the common wiring. If that's you, Path A won't run at all — that's the flaw I graded my v2 patch down for.

## 4b. The lockout my v2 patch created

Crew clocks in at 8am, forgets to clock out, comes back next morning. Last punch is a `checkin`, older than the dedupe window → my v2 code returned 409. They can't clock in. They also can't clock out, because that path requires after photos they never took (portal.ts:1119). Dispatch has to fix it by hand.

Both paths below include the stale-punch escape. This is the part that matters more than the concurrency mechanism.

```ts
// A punch older than this was a shift that never got closed, not a double-tap.
const STALE_PUNCH_MS = 14 * 60 * 60 * 1000;
// Inside this window a repeat of the same kind is a double-tap.
const DEDUPE_MS = 90_000;

class DuplicatePunchError extends Error {
  constructor(public kind: "checkin" | "checkout") { super("duplicate_punch"); }
}
```

## 4c. Path A — interactive transaction

Replace the insert at lines 1129–1142:

```ts
const jobFilter = body.jobId
  ? eq(crewCheckinsTable.jobId, body.jobId)
  : isNull(crewCheckinsTable.jobId);

let row: typeof crewCheckinsTable.$inferSelect;
let deduped = false;

try {
  const result = await db.transaction(async (tx) => {
    // Serializes this crew's punch writes. Nothing else locks this row on the
    // write path, so contention is one crew against their own taps.
    await tx.select({ id: crewsTable.id })
      .from(crewsTable).where(eq(crewsTable.id, crew.id)).for("update");

    const [last] = await tx.select()
      .from(crewCheckinsTable)
      .where(and(eq(crewCheckinsTable.crewId, crew.id), jobFilter))
      .orderBy(desc(crewCheckinsTable.createdAt))
      .limit(1);

    if (last?.kind === kind && last.createdAt) {
      const ageMs = Date.now() - new Date(last.createdAt).getTime();

      if (ageMs < DEDUPE_MS) {
        // Return the row they already made so the response shape is unchanged
        // and the client's success path runs normally.
        return { row: last, deduped: true };
      }

      if (kind === "checkin" && ageMs > STALE_PUNCH_MS) {
        // Yesterday's shift was left open. Close it rather than blocking today.
        await tx.insert(crewCheckinsTable).values({
          crewId: crew.id,
          jobId: body.jobId ?? null,
          kind: "checkout",
          label: "Auto-closed — previous shift left open",
        });
      } else {
        throw new DuplicatePunchError(kind);
      }
    }

    const [inserted] = await tx.insert(crewCheckinsTable).values({
      crewId: crew.id,
      jobId: body.jobId ?? null,
      kind,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      accuracy: body.accuracy ?? null,
      label: body.label ?? null,
      note: body.note ?? null,
    }).returning();

    return { row: inserted!, deduped: false };
  });
  row = result.row;
  deduped = result.deduped;
} catch (e) {
  if (e instanceof DuplicatePunchError) {
    res.status(409).json({
      error: e.kind === "checkin"
        ? "You're already clocked in on this job"
        : "You're already clocked out of this job",
      code: "duplicate_punch",
    });
    return;
  }
  throw e;
}
```

## 4d. Path B — partial unique index, no interactive transaction

The database enforces the invariant; you catch the violation. `isUniqueViolation` is **already imported** at line 57 from `./dispatchBoard`.

Migration:

```sql
ALTER TABLE crew_checkins ADD COLUMN open_punch boolean;

-- One open check-in per crew per job. NULL job_id gets its own slot.
CREATE UNIQUE INDEX crew_checkins_one_open_punch
  ON crew_checkins (crew_id, COALESCE(job_id, '00000000-0000-0000-0000-000000000000'))
  WHERE open_punch;
```

Add `openPunch: boolean("open_punch")` to `crewCheckinsTable` in `@workspace/db`.

Handler:

```ts
const jobFilter = body.jobId
  ? eq(crewCheckinsTable.jobId, body.jobId)
  : isNull(crewCheckinsTable.jobId);

let row: typeof crewCheckinsTable.$inferSelect;
let deduped = false;

if (kind === "checkin") {
  try {
    const [inserted] = await db.insert(crewCheckinsTable).values({
      crewId: crew.id, jobId: body.jobId ?? null, kind: "checkin",
      lat: body.lat ?? null, lng: body.lng ?? null, accuracy: body.accuracy ?? null,
      label: body.label ?? null, note: body.note ?? null,
      openPunch: true,           // the index enforces uniqueness on this
    }).returning();
    row = inserted!;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;

    // An open punch already exists. Decide what it is.
    const [open] = await db.select().from(crewCheckinsTable)
      .where(and(
        eq(crewCheckinsTable.crewId, crew.id),
        jobFilter,
        eq(crewCheckinsTable.openPunch, true),
      ))
      .limit(1);

    const ageMs = open?.createdAt
      ? Date.now() - new Date(open.createdAt).getTime()
      : Number.MAX_SAFE_INTEGER;

    if (ageMs < DEDUPE_MS) {
      row = open!;                  // double-tap
      deduped = true;
    } else if (ageMs > STALE_PUNCH_MS) {
      // Close the abandoned shift, then retry today's punch.
      await db.update(crewCheckinsTable)
        .set({ openPunch: null })
        .where(eq(crewCheckinsTable.id, open!.id));
      await db.insert(crewCheckinsTable).values({
        crewId: crew.id, jobId: body.jobId ?? null, kind: "checkout",
        label: "Auto-closed — previous shift left open",
      });
      const [retry] = await db.insert(crewCheckinsTable).values({
        crewId: crew.id, jobId: body.jobId ?? null, kind: "checkin",
        lat: body.lat ?? null, lng: body.lng ?? null, accuracy: body.accuracy ?? null,
        label: body.label ?? null, note: body.note ?? null,
        openPunch: true,
      }).returning();
      row = retry!;
    } else {
      res.status(409).json({
        error: "You're already clocked in on this job",
        code: "duplicate_punch",
      });
      return;
    }
  }
} else {
  // Checkout: clear the open flag first. If nothing was open, this is a
  // repeat checkout — return the last one instead of writing another.
  const cleared = await db.update(crewCheckinsTable)
    .set({ openPunch: null })
    .where(and(
      eq(crewCheckinsTable.crewId, crew.id),
      jobFilter,
      eq(crewCheckinsTable.openPunch, true),
    ))
    .returning({ id: crewCheckinsTable.id });

  if (cleared.length === 0) {
    const [lastOut] = await db.select().from(crewCheckinsTable)
      .where(and(
        eq(crewCheckinsTable.crewId, crew.id), jobFilter,
        eq(crewCheckinsTable.kind, "checkout"),
      ))
      .orderBy(desc(crewCheckinsTable.createdAt)).limit(1);

    if (lastOut?.createdAt &&
        Date.now() - new Date(lastOut.createdAt).getTime() < DEDUPE_MS) {
      row = lastOut; deduped = true;
    } else {
      res.status(409).json({
        error: "You're already clocked out of this job",
        code: "duplicate_punch",
      });
      return;
    }
  }

  if (!deduped) {
    const [inserted] = await db.insert(crewCheckinsTable).values({
      crewId: crew.id, jobId: body.jobId ?? null, kind: "checkout",
      lat: body.lat ?? null, lng: body.lng ?? null, accuracy: body.accuracy ?? null,
      label: body.label ?? null, note: body.note ?? null,
    }).returning();
    row = inserted!;
  }
}
```

Backfill before the index goes live, or it'll be created against inconsistent data:

```sql
-- Mark the latest check-in as open where no later checkout exists.
UPDATE crew_checkins c SET open_punch = true
WHERE c.kind = 'checkin'
  AND NOT EXISTS (
    SELECT 1 FROM crew_checkins c2
    WHERE c2.crew_id = c.crew_id
      AND c2.job_id IS NOT DISTINCT FROM c.job_id
      AND c2.kind = 'checkout'
      AND c2.created_at > c.created_at
  );
```

Run it, check for duplicates, resolve any by hand, **then** create the unique index. If the index creation fails you have crews with two open punches already — that's the bug, sitting in your data.

## 4e. Skip the side effects on a dedupe

Both paths. A second notification is what the office actually complains about:

```ts
if (!deduped) {
  // existing moving-to clear (lines 1146–1160) and notification insert
}
res.status(201).json(CreatePortalCheckinResponse.parse(ser(row)));
```

## 4f. Verify

```ts
it("collapses concurrent double-taps into one punch", async () => {
  await Promise.all([post(checkin), post(checkin)]);
  const rows = await db.select().from(crewCheckinsTable)
    .where(and(eq(crewCheckinsTable.crewId, crewId), eq(crewCheckinsTable.jobId, jobId)));
  expect(rows).toHaveLength(1);
});

it("lets a crew clock in after leaving yesterday's shift open", async () => {
  await seedCheckin({ crewId, jobId, kind: "checkin", createdAt: hoursAgo(20) });
  const res = await post(checkin);
  expect(res.status).toBe(201);                  // v2 returned 409 here
  const rows = await db.select().from(crewCheckinsTable) /* … */;
  expect(rows.map((r) => r.kind)).toEqual(["checkin", "checkout", "checkin"]);
});

it("sends exactly one notification for a double-tap", async () => {
  await Promise.all([post(checkin), post(checkin)]);
  const notes = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.entityId, crewId));
  expect(notes).toHaveLength(1);
});
```

Run the first one twenty times. On Path A it's deterministic because of the lock; on Path B because of the index. Without either it fails intermittently — that flakiness is the bug.

---

## Order

1. **GPS fallback** — self-contained, no schema or driver dependency, fixes the thing that generates dispatch calls today.
2. **Table scans** — biggest diff, needs a staging pass. Write the offers-survive-scoping test *before* the change.
3. **Earnings** — safe to ship as written; run the reconciliation test to learn whether the split is right.
4. **Duplicate punch** — last, because it's the only one gated on a driver check and a possible migration.

## Still unverified

- `crewCheckinsTable.createdAt` nullability — Path A and B both read it with `!` / a null guard. If it's `notNull` in the schema those guards are dead code, which is fine; if it's nullable, the guards matter.
- `outstandingHoldAmount`'s contract — the §3 construction is safe regardless, but the partial-settlement test tells you whether the split is meaningful or just arithmetically consistent.
- Whether `crew_checkins` currently has rows with two open punches. Run the backfill query as a `SELECT` first and count.
