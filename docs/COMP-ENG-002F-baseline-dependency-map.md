# COMP-ENG-002F §9.2-4 — 151 collision review and baseline dependency map

**Read-only analysis, 2026-08-19. No SQL authored.** §13 puts baseline authoring at DRAFT-ONLY until
these reviews complete; this is them.

## §9.2 — The 151 collision review: NO COLLISION

`supabase/migrations/151-service-profiles.sql` creates **`service_profiles`** and
**`service_required_competencies`** — two distinct tables. It never creates, alters or redefines
`profiles`.

Its only contact is a foreign key: `created_by uuid references profiles(id) on delete set null`.

**That is a dependency, not a collision.** 151 requires `profiles` to exist, exactly as 002 does. It
strengthens the case for a baseline rather than complicating it.

## §9.4 — Dependency map for the 9 foundational tables

| Table | Created by a numbered migration? | Altered by | FK-referenced by | App references |
|---|---|---|---|---|
| `profiles` | **No** | 9 migrations | **144 migrations** | **1030** |
| `hospitals` | **No** | 5 | **116** | 90 |
| `questions` | **No** | 1 | 0 | 27 |
| `cpd_logs` | **No** | 0 | 0 | 20 |
| `course_enrollments` | **No** | 0 | 0 | 19 |
| `courses` | **No** | 0 | 0 | 13 |
| `quiz_attempts` | **No** | 0 | 0 | 11 |
| `nurse_competencies` | **No** | 0 | 0 | 1 |
| `competencies` | **No** | 0 | 0 | **0** |

### Three conclusions

**1. Not one of the nine is created by any numbered migration.** The hidden bootstrap is exactly this
set — no more, no less. The chain has never been self-contained.

**2. There is no collision risk anywhere.** Zero duplicate `create table` statements across all 332
migrations for any of the nine. A baseline creating them cannot conflict with a later migration,
because no later migration creates them.

**3. `profiles` is the most load-bearing object in the schema.** 144 migrations carry a foreign key to
it and the application references it 1030 times. Its absence is why the clean build died on file one,
and why nothing after 002 could have run either.

### On `competencies` — zero references, but keep it

`competencies` has no FK from any migration, no alteration, and **no application reference at all**. On
usage alone it is dead.

⚠ **It stays in the baseline regardless**, because `nurse_competencies` carries a foreign key to it
inside `schema.sql` itself. Dropping it would break referential integrity in the very file being
promoted. Whether the pair should be retired is a separate product question, and **retiring tables is
not what a reproducibility fix is for.**

## Baseline content, per §3 and §4

| Include | Reason |
|---|---|
| All 9 tables | Required by 002 and later; no collisions; 8 of 9 in active application use |
| The function and trigger from `schema.sql` | Part of the approved current architecture — subject to confirming neither is superseded by a later migration |

| Omit | Retirement rationale |
|---|---|
| `profiles :: Users see own profile` | Recursion lineage — dropped by `fix-super-admin-rls-recursion.sql`, measurably absent in production, one of the 2 remaining MISSING |
| `profiles :: Admins view hospital nurses` | Same lineage, same evidence (`rls-updates.sql` origin) |
| Any other `schema.sql` policy matching a retired category | §4: recursion, cross-tenant, obsolete write path, or ADR-008 role-name authorization |

`schema.sql` contains **11 policies**. Each needs individual classification against §4 before the draft
is written — that work is not done yet and is not claimed.

## §9.5 — Remote migration ledger: NOT YET INSPECTED, and I cannot do it

§7's caution is the real open risk: introducing a `001` earlier than migrations already recorded
remotely can diverge local and remote history.

**Reading production's ledger needs a production database connection**, which this environment does not
have and should not acquire for a read this narrow. **One query, run by the owner in the production SQL
editor, settles it:**

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

Three possible answers, three different strategies:

| Result | Meaning | Baseline strategy |
|---|---|---|
| **Table does not exist** | The CLI ledger was never created — every migration applied by hand in the SQL editor | A `001` file is **safe**: there is no remote history to diverge from |
| **Exists but empty** | Same conclusion | Safe |
| **Contains rows** | `supabase db push` has been used at some point | ⚠ **Stop.** A `001` inserted below recorded versions needs a reconciliation strategy, per §7 |

⚠ **Prediction, not evidence:** this repo's migrations are applied by hand in the SQL editor
(`CLAUDE.md` § Database), so I expect the table to be absent or empty. **That expectation is exactly
what §7 warns against acting on.** An earlier probe in this arc *appeared* to find four ledger tables
and was a PostgREST artifact — the head+count missing-table trap — so the guess is not merely unproven,
it has already been wrong once in this same investigation.

## Status against §11

| Gate | State |
|---|---|
| 151 collision review | ✅ no collision |
| Migration graph | ✅ every prerequisite for 002+ is explicit — the 9 tables |
| Security state | ⏳ omission list drafted; 11 policies need individual §4 classification |
| Remote-history safety | ❌ **blocked on the ledger query above** |
| Fresh database / fidelity / conformance / staging | ❌ downstream of the baseline |

**No baseline SQL written**, per §13.

---

## Addendum, 2026-08-19 — the second hidden bootstrap, found by the clean build

With the nine tables in place the chain reached **006-org-hierarchy.sql** and died on
`current_user_is_hospital_admin_for(uuid)`. Rather than patch the one symptom, the repository was
scanned for every object declared **only** in an unnumbered `supabase/*.sql` file:

| | Declared by numbered migrations | Declared **only** in loose files |
|---|---|---|
| Functions | 67 | **1** |
| Policies | 195 | **13** |
| Tables | 655 | 0 |

⚠ The first search found **no declaration at all** for the function, because the pattern omitted the
`public.` qualifier — **the same mistake made twice earlier in this arc**, on `handle_new_user` and on
the policy column pin. Qualifier-agnostic search found it in `fix-rls-recursion.sql`.

### Of the thirteen, seven are live in production and are now in the baseline

`profiles::users_read_own_profile`, `nurse_competencies::Users insert own competencies`,
`nurse_competencies::Users update own competencies`,
`nurse_competencies::Admins view hospital nurse competencies`,
`cpd_logs::Admins view hospital CPD logs`, `course_enrollments::Admins view hospital enrollments`,
`hospitals::Authenticated users view hospitals` — plus the helper function, pinned as production carries
it (`pg_catalog, public`).

### Six are measurably absent and stay omitted

The four already recorded above, plus two the scan added:

- `profiles::Users insert own profile` — **deliberately closed by migration 250.** Recreating it would
  reopen in a clean build the exact door 250 was written to shut.
- `profiles::Admins view hospital nurses` — retired recursion lineage, the second remaining MISSING.

### Verification

001 was applied to staging inside a transaction and rolled back: it executes cleanly against the
already-partly-built state, creates the function and all seven policies, and leaves staging untouched.
`--only` was added to the runner so a baseline that gains objects after the chain has passed it can be
re-applied without tearing down the environment and destroying the evidence.

---

## Addendum 2, 2026-08-19 — the third class: objects in NO repository file

With the baseline complete the chain ran **006 to 188** unbroken (183 migrations) and stopped at
189 on `relation "skills" does not exist`.

`skills` is created by **no file in the repository at all** — not a numbered migration, not a loose
script. Diffing production against every `create table` in the repo:

| | |
|---|---|
| production public tables | 663 |
| tables created somewhere in the repo | 666 |
| **in production, created nowhere** | **11** |

`certifications, content_approvals, cycle_assessors, department_frameworks, enrolments,
framework_rules, framework_versions, lesson_progress, lessons, skills, subscriptions`

All eleven hold **zero rows**. Seven have no application reference; four do — `content_approvals` (9
files), `framework_versions` (4), `framework_rules` (2), `cycle_assessors` (1). **All eleven are
created anyway**, on the same ruling already made for `competencies`: retiring tables is not what a
reproducibility fix is for. The five policies they carry are already declared by 189 and 190, so 188a
creates tables only.

### Placed at 188a, not in the baseline

Six carry foreign keys to `frameworks`, `departments` and `competency_cycles` — created by 003, 006 and
009. At 001 those targets do not exist. 188a sits at the **last point before first use**, which also
leaves the already-proven 006→188 sequence untouched.

⚠ **Known, deliberate fidelity gap:** `ON DELETE`/`ON UPDATE` actions are not reproduced. The OpenAPI
schema does not expose them and this estate has no foreign-key registry. Recorded rather than guessed.

### And the same class at column level

A dry run then found `280-mullen-corrective-migration.sql` writing `audit_log.notes`, a column no
migration adds. Checking the whole table found **two** absent columns, `notes` and `organisation_id`.

⚠ A first careless instrument said **four** — it compared against a hardcoded list of 040's columns.
`tenant_id` is added by 040 and `trace_id` by 178. **Same failure mode as the `public.` qualifier: the
list I measured against was wrong, not the estate.**

### Result: the whole remaining chain now applies

All **147** remaining migrations apply in order with no failures, verified inside a transaction and
rolled back.

| | staging (dry run) | production |
|---|---|---|
| tables | **663** | **663** |
| policies | **318** | **318** |

⚠ Function counts are **not** comparable across those two instruments — production's 67 comes from
`plat_function_registry()`, which migration 170 made exclude extension functions, while the dry-run
count was raw `pg_proc`. Not drift, a units mismatch.

---

## Clean build COMPLETE, 2026-08-19 — and the fourth class

**All 335 migrations applied to an empty Supabase project.** COMP-ENG-002E §11 step 7 is done.

### Pre-flight against production, same instruments both sides

The registry functions were called on staging over SQL and on production over PostgREST, so the units
are identical rather than merely similar.

| | staging | production | |
|---|---|---|---|
| tables | 663 | 663 | match |
| policies | 318 | 318 | match |
| functions | 67 | 67 | match |
| SECURITY DEFINER | 10 | 10 | match |
| secdef without pinned search_path | 0 | 0 | match |
| triggers | 45 | 45 | match |
| tables with RLS disabled | 0 | 0 | match |

25 policy names differ in each direction. **Checked, not assumed: all 25 are exactly the approved
aliases** in `security/legacy-name-divergence.json`, so the manifest's name check passes.

### ⚠ The fourth class: storage buckets, created by no migration

Staging finished the build with **zero buckets**. Production has three. **No migration has ever created
one** — they were made by hand in the dashboard, and 334 only `update`s them, which on a fresh project
matches zero rows and is silently a no-op.

**Every count any instrument was watching matched production, and the entire storage estate was
absent.** That is the sharpest lesson of this arc: seven matching totals proved nothing about a
dimension nothing was counting.

Migration 336 creates all three with the measured posture, `on conflict (id) do nothing` so it is a
no-op on production. It creates **no** storage policies — the approved posture is server-mediated with
none (002D §5). Verified on staging in a transaction and rolled back, including a second run to prove
idempotency.

### The four classes of hidden bootstrap, in the order they were found

1. **Nine foundational tables** — in `schema.sql` only. Found by 002 failing.
2. **One function and seven policies** — in loose `supabase/*.sql` only. Found by 006 failing.
3. **Eleven tables and two columns** — in **no repository file at all**. Found by 189 and 280 failing.
4. **Three storage buckets** — in no repository file, and **no migration would ever have failed**.
   Found only because the manifest checks a dimension the chain does not exercise.
