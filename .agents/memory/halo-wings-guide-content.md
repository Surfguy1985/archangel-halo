---
name: HALO Wings guide content
description: Source of truth for Wings guide copy — must mirror the printed "Archangel Wings Program" PDF exactly
---

## Rule
WingsGuide.tsx (mobile) and WingsGuideDialog.tsx (desktop) must reflect the official PDF document word-for-word. Do not revert to the old "override/reserve/sponsor" content — that system still exists in the DB/backend but is not crew-facing.

## Structure (4 sections)
1. **How your slice is measured** — formula + 3 tables (Role base wings, Years multiplier, Score multiplier)
2. **What a real quarter looks like** — 7-person example ($200k profit → $24k pot → 189.4 Wings → $126.73/Wing)
3. **What this can grow into** — Kev's 5-step road from $1,014 to $5,354
4. **The rules, plain and short** — 10 numbered rules from the PDF

## Key numbers (do not drift)
- Role wings: crew 10 / lead 15 / foreman 25 / superintendent 35 / founder bonus +15
- Years multiplier: <1yr not eligible / 1-2 × 1.00 / 2-4 × 1.15 / 4-7 × 1.30 / 7+ × 1.50
- Score multiplier: 95-100 × 1.30 / 90-94 × 1.15 / 80-89 × 1.00 / 70-79 × 0.80 / 60-69 × 0.50 / <60 × 0
- Pot: 12% of quarterly profit
- Payout: 45 days after quarter close
- Dispute window: 14 days after quarter close

## 10 rules (exact wording)
1. One full year before eligible — no exceptions, no partial credit
2. Score under 60 = no share that quarter
3. Willful safety violation = no share that quarter, whatever your score was
4. Paid 45 days after quarter closes, once books are final
5. Must still be employed on payout day; quit/fired for cause = forfeit
6. Laid off or hurt on the job = prorated share for weeks worked
7. Role on last day of the quarter counts; promotions pay immediately
8. 14 days to dispute score; every point traceable to a record
9. Wings totals posted for everyone; checks are private
10. Bonus program, not ownership — not buying equity in Archangel

## WingsProgramPanel (mobile + desktop)
- Rules updated to all 10 (matching above)
- Score tracker sub-text: "safety, on time, closing out your work, photos & logs, and customer feedback"
- `readonly` arrays from `as const` — `SimpleTable` must accept `ReadonlyArray`
- `dim` is optional on exampleRows — use `"dim" in r && r.dim` guard

## Crew portal Wings tab (CrewPortal.tsx)
- Removed: sponsor card, recruits list, held/released reserve grid, override earnings list
- Kept: Halo score header, WingsProgramPanel, founder card

**Why:**
The PDF is the official employee-facing document. The override/reserve/sponsor system is internal/backend-only and does not belong in crew-facing UI until the official program document is updated to include it.
