# COMP-ENG-002B §9.4-5 — Triggers and storage policies

**Read-only, 2026-08-19.** The last two object classes before §10's gate can be assessed. **Neither is
measured, and both are blocked for a stated reason rather than an oversight.**

## §9.4 Triggers — BLOCKED on measurement infrastructure

**45 triggers are declared** across the numbered migrations. **Zero can be compared against production.**

`pg_trigger` lives in `pg_catalog`, PostgREST does not expose it, and this repository has registries for
policies (`plat_rls_registry`, 172), functions (`plat_function_registry`, 168; `plat_function_attributes`,
250) and indexes (`plat_index_registry`) — **but none for triggers.** The instrument is simply missing.

**Migration `332-trigger-registry.sql` has been written and handed to the owner** (passes house rules,
ALL CLEAR). It creates one read-only function mirroring the existing four: `stable`, `language sql`,
pinned `search_path`, **security INVOKER**, execute granted to `service_role` only, internal
constraint triggers excluded.

⚠ **It is deliberately NOT a canonicalisation migration.** It changes no policy, table, grant or
application behaviour. §10 forbids canonicalisation until measurement is complete; this is the
instrument, not the change. Triggers can be measured the moment it is applied.

**Why it matters:** this codebase uses triggers as security and data-governance controls — the
append-only audit pattern with the `pg_trigger_depth() > 1` cascade allowance is a documented,
repeatedly-relied-upon invariant. A staging database missing an append-only trigger would accept
UPDATEs and DELETEs that production refuses, and every test of that invariant would pass while proving
nothing.

## §9.5 Storage policies — MEASURED IN THE ONLY WAY THAT MATTERS, and the answer is a finding

**No migration in this repository declares a storage bucket or a storage policy.** Searched every
`.sql` under `supabase/` for `storage.buckets` / `storage.objects`: **zero hits.**

The application uses **two buckets**:

| Bucket | Sites | Holds |
|---|---|---|
| `avatars` | 4 | profile images |
| `evidence` | 5 | **assessment evidence** |

Both exist in production. Their access policies exist **only in the Supabase dashboard** — they are
production-only configuration with **zero repository control**.

⚠ **A clean build from `supabase/migrations/` produces no buckets and no storage policies at all.** So
for §8's fidelity criterion, storage is not a partial match or a drift — it is a **total absence** from
the repository-controlled path. Staging would have no `evidence` bucket, and any workflow touching
assessment evidence would fail there while working in production.

⚠ **And `evidence` is the one that matters.** Assessment evidence is the substantiation behind a
competency judgement. Whatever governs who can read it is currently untracked, unreviewed and
unreproducible — and this audit **cannot state what that policy is**, because nothing in the repository
records it.

**Disposition: storage posture must be captured into repository control before staging can claim
fidelity.** That is a genuine piece of work, not a measurement: someone has to read the live bucket
policies from the dashboard and encode them forward.

## Functions security posture (§4) — measured, and clean

Measured via `plat_function_attributes()`:

| | |
|---|---|
| Functions in `public` | 65 |
| **SECURITY DEFINER** (run as owner, bypass RLS) | **10** |
| …of those, **without** a pinned `search_path` | **0** |

All ten pin `search_path`. A SECURITY DEFINER function with a mutable search_path is the classic
privilege-escalation vector — a caller able to create objects in an earlier schema can shadow what the
body resolves. **None here is exposed that way.**

⚠ The check discriminates: it found 10 of 65, not 0 and not all, so the `secdef` flag is being read
correctly and an unpinned function would have been named.

## Effect on the §10 gate

| §10 requirement | Status |
|---|---|
| Policy bodies measured | ✅ 280/317 semantically confirmed |
| Policy roles measured | ✅ 0 divergence, break-tested |
| Migration 166 audited whole | ✅ not a partial application |
| All 20 MISSING dispositioned | ✅ only one should be restored as written |
| **Trigger posture measured** | ❌ **blocked — migration 332 awaiting application** |
| **Storage posture measured** | ❌ **not in repository at all; must be captured first** |
| Canonical end state approved | ❌ owner decision |

**The gate cannot pass yet, and the two remaining blockers are now concrete and actionable** rather than
unknown: apply one read-only migration, and capture two buckets' policies into version control.
