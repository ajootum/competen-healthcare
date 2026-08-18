# COMP-ENG-002A §12.1-4 — Production RLS measurement and reconciliation matrix

**Baseline (§12.1):** commit `de5d2447`, 2026-08-19T01:45:49+03:00.
**Measurement (§12.3):** `npx tsx scripts/rls-drift-audit.ts` — a version-controlled tool reading live
state through the `plat_rls_registry()` function (migration 172), **not model recall** (§9).
**Read-only. Nothing was changed.**

## Measured production posture

| | Repository declares | Production actual |
|---|---|---|
| Tables with an RLS statement | 632 | **663 tables in `public`, 663 with RLS on** |
| Policies | 328 declared | **317 deployed** |

| Classification | Count |
|---|---|
| **RLS OFF** — repo enables, database disabled | **0** |
| **UNDECLARED** — in the database, declared nowhere in the repo | **0** |
| NO POLICIES — RLS on, nothing granted | 419 |
| MISSING POLICY — declared in repo, absent in database | 10 |
| REWORKED — deployed under different names than declared | 19 |
| TABLE NOT FOUND — repo declares RLS for a non-existent table | 2 |
| Loose-script policy drops (reported, not obeyed) | 9 |

⚠ **Policy bodies are not compared.** Postgres rewrites stored expressions, so a text diff would report
all ~317 as drifted. Existence and naming only — stated because §7 asks for "normalised USING and
WITH CHECK expressions or equivalent semantic assertion", **and this measurement does not provide that.**
That is a gap in the evidence, not a clean result.

## ⚠ The finding that justifies the gate

§3 argues a staging database built only from `supabase/migrations/` may not be trustworthy. **That is now
demonstrated, with a mechanism:**

- `supabase/migrations/005-fix-super-admin-rls.sql:18` **creates** policy `"Super admin reads all
  profiles"` on `profiles`.
- `supabase/fix-super-admin-rls-recursion.sql:11` **drops** it — because, in its own words, that policy
  and `"Admins view hospital nurses"` *call* into `profiles` and cause RLS recursion.
- Production **does not have it** (it appears in MISSING POLICY, measured).

So the numbered migration chain **creates a policy that a later unnumbered fix deliberately removed**.

**A clean staging build from `supabase/migrations/` alone would re-create the RLS recursion bug that
production has already had fixed** — and every test run against it would be exercising a security posture
production does not have. This is precisely the false assurance §3 describes, and it is not hypothetical.

Three of the ten MISSING policies are this same `profiles` recursion lineage:

| Missing policy | Declared in | Reading |
|---|---|---|
| `profiles :: Super admin reads all profiles` | `migrations/005-fix-super-admin-rls.sql` | **Deliberately dropped** by the loose recursion fix |
| `profiles :: Admins view hospital nurses` | `supabase/rls-updates.sql` | **Deliberately dropped**, same reason |
| `profiles :: Users see own profile` | `supabase/schema.sql` | Dropped by `fix-super-admin-rls-recursion.sql` |

**The repository's declaration is stale here; the database is correct.** Canonicalisation must encode the
*post-fix* state, not replay the pre-fix one.

## §5 reconciliation matrix

| Repo | Production | Classification | Count | Disposition |
|---|---|---|---|---|
| Present | Present/equivalent | **Aligned** | ~288 | Retain. ⚠ Semantics unverified — bodies not diffed |
| Present | Absent | **Repository-only drift** | **10** | 3 are the recursion lineage → canonical state is *absent*; **7 need individual owner determination** |
| Absent | Present | **Production-only drift** | **0** | Nothing to trace — no dashboard-authored policy exists |
| Different | Different | **Semantic divergence** | **19 REWORKED** | Names differ, counts mostly match. Renamed in-database and never written back. **Do not guess** — needs body-level comparison the current tool cannot do |
| Unnumbered artifact | Present in production | **Non-canonical source** | 4 files, 9 drops | Convert the *end state* into forward numbered migrations |

**The seven MISSING policies that are not the recursion lineage** — and each is a separate question of
"never applied" versus "deliberately removed":

`departments :: Group admin reads org departments` (mig 008) · `assessments :: Educator validates
assessments` (mig 009) · `op_observations :: op_observations_read` (mig 039) · `adm_unit_profile ::
adm_profile_read` (mig 109) · `access_reviews :: access_reviews_read`, `access_review_items ::
access_review_items_read`, `sod_rules :: sod_rules_read` (all mig 166)

⚠ Migration 166 contributes **three** of them, which suggests that migration may not have fully applied
— a different problem from a deliberate drop, and worth checking before anything is written forward.

## §8 fidelity acceptance — **DOES NOT PASS**

| Criterion | Status |
|---|---|
| No unknown production-only security state | ✅ **PASS** — 0 UNDECLARED, 0 RLS OFF |
| Clean build reproduces production security semantics | ❌ **FAIL** — it would re-create at least one deliberately-removed recursion policy |
| Divergence reconciled or explicitly approved | ❌ 10 MISSING + 19 REWORKED undispositioned |
| Policy semantics compared | ❌ Bodies not diffed; tool cannot currently do it |

**Staging remains gated**, on evidence rather than caution.

## What is needed next, and who owns it

**Owner decisions (§5 says do not guess):**
1. Confirm the three `profiles` recursion policies are **intended to stay absent**. If so, canonicalisation
   supersedes migrations 005 and `rls-updates.sql`/`schema.sql` forward.
2. Determine the seven other MISSING — never applied, or deliberately removed? **Check migration 166
   first**, given it accounts for three.
3. Approve the canonical end-state for the 19 REWORKED, which needs a body-level comparison first.

**Buildable without a decision:**
4. Extend measurement to policy *bodies* (§7 asks for it; the current tool explicitly declines it). A
   normalised comparison — or a semantic assertion per policy — is the missing evidence.
5. ~~Functions unmeasured~~ — **now measured, see below.** Triggers and storage policies remain
   unmeasured; §4 requires both.

## Functions (§4) — measured, and they change the canonicalisation plan

`npx tsx scripts/function-drift-audit.ts`, reading deployed bodies via `plat_function_registry()`
(migration 168):

> 65 signature(s) intended, 4 intentionally dropped · 65 deployed in `public` ·
> **65 of 65 intended signatures match the database**

Bodies are clean. But three loose-script drops target functions that are **still deployed**:

| Function | Dropped by | State |
|---|---|---|
| `current_user_is_super_admin()` | `fix-super-admin-rls-recursion.sql:16` | **still deployed** |
| `current_user_is_hospital_admin_for(uuid)` | `fix-super-admin-rls-recursion.sql:18` | **still deployed** |
| `handle_new_user()` | `reset.sql:6` | still deployed |

⚠ **This is a partial application, and the mechanism matters.** The same loose script's *policy* drops
**did** take effect (its three `profiles` policies are measurably MISSING); its *function* drops did
**not**. The reason is visible in the repo: migration `005` creates both functions, and migrations `006`,
`007` and others define policies whose `USING` clause **calls `current_user_is_super_admin()`**. A bare
`DROP FUNCTION` against a function live policies depend on is refused by Postgres. So the script ran, its
policy drops succeeded, and its function drops were rejected by dependency.

**Consequence for §6, and it is a dangerous one:** a canonicalisation migration that faithfully replayed
this script would try to drop two functions that many policies depend on. It would either fail — or, if
someone reached for `CASCADE` to make it apply cleanly, **silently destroy every policy calling them.**

**Those two functions are load-bearing; the script's intent to drop them was never achieved and must not
be encoded forward.** Precisely the case §6 means when it forbids concealing unexpected state behind
indiscriminate `IF EXISTS`, and §5 when it says do not guess.

⚠ **Method note, since §9 is about provenance.** A first pass concluded the audit had *misattributed*
these drops, because a grep for `drop function` found nothing in that file — the file uses uppercase
`DROP FUNCTION`. The reproducible tool was right; the ad-hoc search was wrong. That is §9's rule in
miniature.

**Not started, and correctly so:** §12 steps 5-12. No canonicalisation migration should be written until
items 1-3 are answered — writing one now would encode a guess as schema.
