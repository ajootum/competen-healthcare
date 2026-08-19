# COMP-ENG-002G — Migration 001 was applied to production, and what it reverted

**2026-08-19. Caused by me, found by measurement, repaired by migration 335.**

## What happened

`001-canonical-baseline.sql` is written for a **fresh** database, where migration 249 runs after it and
re-hardens what 001 creates in bootstrap form. It was applied to the **production** project, where
nothing runs after it. Two objects 249 had hardened were silently reverted.

I asked for it to be run through `scripts/apply-migrations.ts`, which refuses to target production. But
the file's own first line said **"paste the entire file into the Supabase SQL editor and Run once"** —
the house-rule banner required for any file containing `$$`. **The banner and the instruction
contradicted each other, and the banner was the one inside the file.** That is my error, not a
misreading.

## How it was established, not assumed

The first read returned an empty function body and I nearly called that the finding — the column is
`src`, not `body`. Re-measured correctly:

| Probe | Result | What it rules out |
|---|---|---|
| `profile_authority_unchanged` present | **yes** | 249 never ran here |
| `handle_new_user` body | **bootstrap form**, no role clamp, no exception handler | drift from some other source |
| `Users update own profile` `with_check` | **null** | 249 §3 still in force |
| Live body vs 001's text | **identical** | coincidence |

249 §2 and §4 are both present in production, and §3 sits between them — so 249 applied in full, and
something later removed §3. **001 is the only file in the repository that drops that policy name.**

## Severity: a lost backstop, not an open door

**No privilege escalation was reachable at any point.** 249 §4 revokes table-level `UPDATE` on
`profiles` and grants back five personal columns. 001 contains no `grant` or `revoke`, and the layer was
re-measured live:

```
UPDATE  authenticated  avatar_url, country, full_name, phone, specialization
UPDATE  service_role   *** table-level ***
authenticated table-level UPDATE: false      anon table-level UPDATE: false
```

A write to `role` is refused with `42501` by the privilege system **before any policy is evaluated**.
Defence in depth went from two layers to one — and 249 §3 exists precisely as the layer that holds if
the grant assumption is ever wrong.

**The larger risk was operational.** 249's `handle_new_user` ends with `exception when others then
return new`, so a failure writing `profiles` cannot abort the `auth.users` insert. The bootstrap body
has no handler, and both `inviteUserByEmail` and `admin.createUser` run through this trigger.

## Blast radius: bounded, and checked rather than asserted

Everything else in 001 was a no-op on a built database. The nine tables are `create table if not
exists`. The RLS enables were already true. The other six policies it recreated are **declared in no
later migration** — grepped, all six — so they were rewritten to the form they already had.

**One policy and one function. Both restored by 335.**

## The guard, and the defect the break-test found in it

001 now refuses to run on a database that is not fresh. The first version was **broken in the more
dangerous direction**: it aborted on *every* database, including an empty one.

```sql
-- WRONG: the planner constant-folds cast('literal' as integer) before execution,
-- so CASE laziness never protects it.
select case when exists (...) then cast('REFUSING...' as integer) else 0 end;

-- RIGHT: the cast operand is non-constant, so it is only evaluated on the real branch.
select cast(case when exists (...) then 'REFUSING...' else '0' end as integer);
```

Both branches are now proven against staging — the true branch forced inside a transaction and rolled
back, leaving zero public functions behind.

## What I would keep from this

1. **A file whose safety depends on what runs *after* it is a hazard on any database where nothing
   does.** Order-safety in a clean build is not safety in general.
2. **A required banner can carry an instruction that contradicts the sentence beside it.** The house
   rule says how to apply; it does not say *where*, and I let the *how* imply the *where*.
3. **The break-test earned its place again.** A guard I had reasoned about carefully was wrong, and only
   running it revealed that.

## Verification after 335 was applied

Read-only, against production, immediately after. A migration reporting "Success" is not the same as a
migration that achieved its intent.

| Check | Result |
|---|---|
| `handle_new_user` role clamp | ✅ restored |
| `handle_new_user` `exception when others` | ✅ restored |
| writes `public.profiles`, `on conflict do update` | ✅ both |
| SECURITY DEFINER, `search_path=public, pg_catalog` | ✅ |
| `Users update own profile` `with check` | ✅ present, calls `profile_authority_unchanged` |
| All **12** authority columns pinned | ✅ |
| `authenticated` table-level UPDATE on `profiles` | ✅ still false |
| Estate policy total | ✅ 318, unchanged |

⚠ One measurement artifact worth recording: the column-count probe first reported **0 of 12 pinned**.
Postgres strips the table qualifier when it stores a policy expression, so a regex looking for
`profiles.role` matches nothing while `role` is right there. **The pin was intact and the instrument was
wrong** — the same class as reading `body` instead of `src` earlier in this incident.

### Fidelity manifest against production: PASS

```
663 tables, all RLS enabled          25 legacy aliases, all matched
67 functions, 10 SECURITY DEFINER, all pinned
45 triggers, none disabled           2 buckets match approved posture
0 storage policies (approved server-mediated posture)
PASS -- target reproduces the approved security semantics
```

This is now the **production side of the comparison** the staging clean build has to reproduce.
