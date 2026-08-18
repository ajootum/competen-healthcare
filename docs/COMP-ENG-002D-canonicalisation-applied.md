# COMP-ENG-002D — Migration 334 applied and verified

**Applied by the owner, 2026-08-19. Verified read-only immediately afterwards.**
A migration that reports "Success" is not the same as a migration that achieved its intent; this is the
second half.

## Verification: every stated change confirmed

| Class | Expected | Result |
|---|---|---|
| **RETIRED** (8) | absent | ✅ all 8 absent |
| **RESTORED** (1) | present | ✅ `departments :: Group admin reads org departments` |
| **ADOPTED live names** (11) | present | ✅ all 11 present |
| Live policy count | 317 → 318 | ✅ 318 (+1, the restore) |

Retired and confirmed absent: `access_reviews_read`, `access_review_items_read`, `sod_rules_read`,
`adm_profile_read`, `op_observations_read`, `Educator validates assessments`,
`Educator views hospital scores`, `Super admin reads all profiles`.

### Storage, before and after

| Bucket | Before | After |
|---|---|---|
| `avatars` | public, 2 MB, png/jpeg/webp | public, **5 MB**, jpeg/png/webp |
| `practice-attachments` | private, ⚠ **no limit**, ⚠ **any MIME** | private, **25 MB**, **5-type allowlist** |
| `evidence` | private, 50 MB, av+docs | unchanged (002D sets no new decision) |

**The unconstrained upload surface is closed.** `practice-attachments` went from accepting any file of
any size to a 25 MB ceiling and an explicit document/image allowlist.

## Drift, before and after

| Measure | Before 334 | After 334 |
|---|---|---|
| MISSING POLICY | 10 | **2** |
| REWORKED | 19 | **13** |
| Live policies | 317 | 318 |
| Tables with RLS on | 663/663 | 663/663 |

### The 2 remaining MISSING are not a gap

```
profiles :: Users see own profile        (supabase/schema.sql)
profiles :: Admins view hospital nurses  (supabase/rls-updates.sql)
```

Both are declared **only in unnumbered loose files**, never in a numbered migration. So a clean build
from `supabase/migrations/` does not create them either — **absent in production, absent in a clean
build, therefore aligned.** They are part of the `profiles` recursion lineage the loose fix scripts
removed deliberately.

⚠ The 13 REWORKED remain: tables whose live policy names differ from repo declarations beyond the 11
adopted here. They were measured as **semantically equivalent or renamed-only** in the body audit
(280/317 confirmed), so they are a naming divergence rather than an access divergence — but they are
**not yet canonicalised**, and a clean build would produce the repo names rather than the live ones.
That is the largest remaining fidelity item.

## Conformance: nothing broke

- **27/27 harnesses green**, 7 excluded by record, coverage control accounts for all 34.
- **Triggers: ALL GREEN**, 0 problem classes — 45/45 still exact.

Canonicalising RLS and storage changed no application behaviour that any conformance control detects.

## Where §11 stands

| Step | Status |
|---|---|
| 1-5 Dispositions, capture, comparison, approval, manifest | ✅ |
| 6 Forward-only canonicalisation migration | ✅ **applied and verified** |
| 7 Clean disposable environment from repository-controlled infrastructure | ❌ **owner action — no second Supabase project exists** |
| 8 Fidelity manifest incl. Storage | ❌ blocked on 7 |
| 9 Resolve unexplained differences | ❌ blocked on 7 |
| 10 Provision staging | ❌ blocked on 7 |

**The repository is now the canonical definition of the security posture.** Every remaining step needs a
second Supabase project, which is a dashboard and billing action outside what an agent performs.
`docs/COMP-ENG-002-staging-runbook.md` holds the sequence.

⚠ **One honest caveat about step 7.** The clean-build test has never been run, so "a clean build now
reproduces production" is a *reasoned expectation*, not a measurement. The 13 REWORKED are a known
divergence it would surface, and there may be others no audit has looked for — the fidelity manifest
exists precisely because reasoning is not evidence.
