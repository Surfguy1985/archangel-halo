---
name: HALO Command structured answers
description: Command answers are a headline plus capped bullets with a separate speech field; caps are server-enforced, predictions only become chips when an executor exists, and quoted baselines must aggregate the full cohort.
---

# The prompt asks; the server enforces

The command answer is a structured shape — headline, bounded list of short
bullet fragments, and a separate conversational field for anything spoken.

**Why:** the model was already told to answer in one or two sentences and
ignored it. A free-form string with a large token ceiling has nothing
structurally stopping a wall of text, so prompt rules alone reliably fail.

**How to apply:** run every new answer surface through the same server-side
capping pass; adding format instructions to a prompt will regress. Bullets are
screen-only — voice paths read the conversational field. Strip inline markdown
at the render layer even on the structured path, since a legacy plain-text
answer can arrive at any time. Never invent an entity to fill a bullet.

# Predictions are only offered when they can be acted on

An insight gets an approvable chip only when it carries an entity an existing
executor can act on; otherwise it renders as an observation.

**Why:** a chip for something with no underlying record is a button that cannot
do anything. Silence beats a dead control.

**How to apply:** add the executor before the proposal, never the reverse.
Client turns are reconciled to jobs heuristically, so client-only or demo
properties often have no match — absent proposals there are correct.

# Operator-facing averages must aggregate the whole cohort in SQL

A number quoted to the operator, or used to decide which records get flagged,
has to be aggregated over the entire intended population in the database.

**Why:** two separate defects shipped here and were caught in review.
1. A `LIMIT` with no `ORDER BY` returns an arbitrary physical subset, so past
   the limit the average drifts with table layout rather than the business.
2. `GREATEST` **ignores NULL arguments** in Postgres, so a "clamp to zero"
   fallback over a missing date yields 0 instead of NULL — silently scoring
   unknown durations as zero and dragging the average down. Guard an optional
   fallback with `CASE WHEN <input> IS NOT NULL THEN ... END` so unknowns stay
   NULL and the aggregate skips them.

**How to apply:** push aggregation into SQL over the full population. Make
"unknown" NULL, never a sentinel zero. Prove the test would catch each fault:
the fixture needs a tail that shifts the mean AND rows whose value is
underivable — a uniform fixture detects neither.

# Baselines need a minimum sample

Use a measured average only once the sample is large enough; below that, keep
the previous fixed thresholds.

**Why:** a sparse operation would otherwise derive thresholds from a couple of
data points, and quoted numbers have to match what the operator sees.
