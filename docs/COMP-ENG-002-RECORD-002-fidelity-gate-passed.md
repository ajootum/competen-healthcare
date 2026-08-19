# COMP-ENG-002H — The staging fidelity gate is passed

**2026-08-19.** A clean Supabase project was built from `supabase/migrations/` alone and measured
against production with the same instrument. **PASS.**

## The result

| Check | Staging | |
|---|---|---|
| Instrumentation | 4/4 registries readable | ok |
| RLS enablement | 663 tables, all enabled | ok |
| Policy names | 25 approved aliases checked | ok |
| Functions | 67, 10 SECURITY DEFINER, **all pinned** | ok |
| Triggers | 45, none disabled | ok |
| Storage buckets | avatars, practice-attachments both match | ok |
| Storage policies | none — the approved server-mediated posture | ok |

## The alias line is the interesting one

Production run: `25 approved legacy aliases checked, **25** matched by production name`
Staging run:  `25 approved legacy aliases checked, **0** matched by production name`

**That contrast is the point, not a discrepancy.** Production carries 25 historical policy names; a
clean build produces the 25 canonical repository names. Both are accepted because the pairs are
recorded in `security/legacy-name-divergence.json` with reasons. The two runs together are the first
empirical proof that the allowlist describes a real, bounded divergence rather than an assumption —
each side matched the half of the file it was supposed to, and neither matched anything it shouldn't.

## What it took: four classes of hidden bootstrap

`supabase/migrations/` had never been self-contained, and no amount of reading would have shown it.

| | What was missing | Found by |
|---|---|---|
| 1 | 9 foundational tables | 002 failing |
| 2 | 1 function + 7 policies, in loose files | 006 failing |
| 3 | 11 tables + 2 columns, in **no repository file** | 189 and 280 failing |
| 4 | **3 storage buckets** | **nothing failing** — only the manifest |

⚠ **Class 4 is the one to remember.** The build finished matching production on seven separate counts —
663 tables, 318 policies, 67 functions, 10 secdef, 0 unpinned, 45 triggers, 0 RLS-off — **with zero
storage buckets**. 334 only `update`s buckets, and an UPDATE matching no row is not an error. Seven
matching totals proved nothing about a dimension nothing was counting.

## Two instrument defects fixed along the way

- **The manifest diagnosed a bad key as a missing schema**, advising a re-run of five migrations
  against a database that was already correct. An auth-shaped error is now named as a credential
  rejection, with the shape of what was received so a placeholder paste is obvious.
- **The `001` guard aborted on every database**, including an empty one, because
  `cast('literal' as integer)` is constant-folded before `CASE` laziness applies. See COMP-ENG-002G.

## §11 status

| Step | |
|---|---|
| 1-6 dispositions, capture, comparison, approval, manifest, canonicalisation | done |
| 7 clean disposable environment from repository-controlled infrastructure | **done** |
| 8 fidelity manifest including Storage | **PASS** |
| 9 resolve unexplained differences | **none — the gate fails unknown drift by design** |
| 10 provision staging | next |

## What this unblocks

Staging is real, and everything that was waiting on it can start: the synthetic smoke practitioner and
Playwright journeys 3-6 (COMP-ENG-001A), the DR rehearsal against staging rather than production,
the email-verification flow, CSP enforcement testing, and COMP-SEC-002 steps 3-10.

⚠ **One dimension the gate does not cover: columns.** §4's fidelity hierarchy does not list them, yet
this arc found two absent columns on `audit_log` by accident. A production-vs-staging column diff is
cheap to build now that both sides exist and is not yet written.
