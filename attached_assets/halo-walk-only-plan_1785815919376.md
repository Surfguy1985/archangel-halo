# Halo — Walk-Only Build Plan

Scope: the walk features. No boards, no wizards, no rails, no client portal. The walk is the product; a card is just what a walk leaves behind.

Everything a walk produces can land in the CRM you already have. That's the point — **this plan adds no surface you have to maintain in parallel.**

---

## One shell, four products

All four walks are the same three screens. Build the shell once; `kind` gives you four features.

```
Start          →   Capture          →   Review
which property     unit + evidence      what it produced, confirm
```

That's the entire app. The `kind` parameter changes what Review produces and nothing else:

| Kind | User | Review produces |
|---|---|---|
| **baseline** | You | Scope catalog + unit conditions for a property |
| **qa** | You | Verified or rework verdicts on a crew's claims |
| **completion** | Crew | Refined line items → the invoice |
| **discovery** | Property manager | Priced, PO'd work requests |

One data model, one UI, one capture pipeline. Four things you can sell.

---

## Sequence by adoption risk, not by dependency

The usual instinct is to build the client-facing walk first because it's the demo. It's the riskiest one — it needs a property manager to change how they work. Build the walks where **you** are the user first. They need nobody's permission, and they generate the data the later walks require.

---

# PHASE 1 — Baseline walk (week 1–2)

**User: you. Adoption risk: zero.**

Walk a property you already service. At each unit: tag it, photograph condition, pick scopes from a list. At the end you have that property's scope catalog, unit roster, price mapping, and photo baselines.

**Why first:**
- It's the *input* to every other walk. Without a scope catalog, completion and discovery walks have nothing to resolve against.
- It answers Test 1 from the risk doc by doing rather than asking. If the SOP is too vague to price from, you find out on the first walk and the catalog gets built by hand — which is fine, because you're the one building it.
- It becomes a **billable onboarding visit** and the reason a new property feels finished on day one.

**Build:** walk shell, unit tagging, photo capture, scope picker, end-of-walk review that writes a catalog.

**Gate:** can you walk a 40-unit property in under two hours and come out with a usable catalog?

---

# PHASE 2 — QA walk (week 3–4)

**User: you. Adoption risk: zero.**

Run it on jobs you're already completing today, whether or not the crew is in any app. Open the card, see the claimed line items, verify each in the room. Two buttons per claim.

**Why second:**
- Still nobody's permission required.
- It's the only walk that produces something you can **sell immediately**: *checked by Halo before you see it.* One line on an invoice, and it's true the day you start.
- It generates crew quality data before crews are in the system, which is what makes the completion walk worth their time later.
- Same-angle recapture works from the baseline photos you now have.

**Build:** claim list from the card, verified/rework verdicts, capture on rework, same-angle prompt from prior photos.

**Rule that matters more than any screen:** rework goes back to the crew and the client is never notified. Get that suppression right once.

**Gate:** does QA catch something real in the first ten walks? If it catches nothing, either your crews are excellent — good news, lower the sampling rate — or the checks aren't specific enough.

---

# PHASE 3 — Completion walk (week 5–7)

**User: crew. Adoption risk: real.**

Crew opens one card, one button. Working the job produces the walk: tag the unit, photograph what was done, confirm scopes from the catalog Phase 1 built. Done.

**Why it's worth the risk:** this is the walk that writes the invoice. Line items resolve through the same catalog the baseline built, so the invoice exists the moment the crew finishes.

**What actually gets crews to do it — and it isn't the UI:** pay them faster. Complete the walk, get paid in 48 hours. You have the rails. Make the crew app's only number *paid this week.*

**Constraints:**
- Photos only. **No audio yet** — consent law varies by state and audio buys you little before drafting exists.
- Must work offline. Stairwells and basements have no signal, and that's where the walk happens. Queue captures, flush on reconnect.
- One card, one button, no list, no nav. If a crew member has to choose something, it's wrong.

**Gate:** does one crew complete every job this way for two straight weeks without being chased?

---

# PHASE 4 — Discovery walk (week 8+)

**User: property manager. Adoption risk: highest.**

Only after the other three work. By now the catalog exists, the property has history, and you can demonstrate on their own property that the loop closes.

Manager walks, tags units, captures, picks scopes. Review produces priced, PO'd requests — four jobs from twelve observations.

**Why last:** it's the only walk requiring someone outside your company to change their behavior, and it's the one whose value depends most on everything built before it. A discovery walk against an empty catalog is just a slower form.

**The thing that sells it isn't the walk.** It's opening the app on their third turn and seeing the job already drafted from the last two — `Same again`. That requires history that Phases 1–3 produce.

---

# THE SPINE

Minimal, and shared by all four.

```
walks
  id, property_id, actor_id, kind, started_at, ended_at, status

captures
  id, walk_id, unit_id, media_url, geo, orientation, captured_at
  scope_id, qty, confidence

scope_catalog                -- per property: scope, unit of measure, price, cap, required photos
walk_outputs                 -- what review produced: catalog rows, verdicts, or cards
```

- **Captures resolve to `scope_catalog` rows.** That resolution is the whole engine. Everything else is UI.
- **Offline-first from day one.** Local queue, idempotency keys, flush on reconnect. Retrofitting this is painful; building it in is cheap.
- **Orientation stored on every capture**, whether or not you use it yet. It's what makes same-angle QA possible and it's free at capture time.
- **Walk output lands in your existing CRM.** No new board. A completed walk creates or updates records you already have.

---

## Manual first, everywhere

No model in any phase. Every walk works with: tag a unit, take a photo, pick a scope from a list.

That version already beats what these people do today — which is remember things and type them at a desk hours later. Photo→line-item drafting is an accelerator on a workflow that must be better *without* it. Build it in Phase 5, once four walks' worth of confirmed captures gives you training data you didn't have to buy.

---

## Deferred

| | Why | Revisit |
|---|---|---|
| Audio capture | Consent law by state; low value pre-drafting | Per-property opt-in, contract language |
| Photo → line item drafting | Needs the catalog and confirmed capture history | After Phase 4 |
| No-nav predictive open | One bad prediction strands the user | When usage shows the prediction is right |
| `Same again` | Needs closed-card history | End of Phase 4 |
| Boards, rails, tiles | Not walk features | Separate decision |

---

## What this gets you at week 7

Before any customer has changed a single habit:

- Every property you service has a priced scope catalog
- Every job gets checked, and *checked by Halo* is true and sellable
- Your crews complete work in-app because it pays them faster
- Invoices write themselves from the work
- You have the history that makes Phase 4 feel like magic instead of a form

Three of the four walks are live and **none of them required a customer to say yes.**
