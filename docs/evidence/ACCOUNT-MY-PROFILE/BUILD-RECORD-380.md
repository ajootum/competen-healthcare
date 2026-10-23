# Migration 380 build record: optional given/family names on `profiles` (PR D, My profile)

Owner GO 2026-10-23, "PR D — Shared My Profile": *"Support optional given/family names only through a reviewed, backward-compatible schema change. Never infer them from full_name."* Classified **Medium** (a column-level UPDATE grant on shared `profiles` is an access-boundary change under amended §8).

| | |
|---|---|
| File | `supabase/migrations/380-profiles-given-family-name.sql` |
| sha256 (LF, the committed and applied file) | `7371321b08205f6880b2c08c4eec5830e9c1e5168705d30c9852db8470e17739` |
| House rules | ALL CLEAR (63 lines, 10 statements) |
| What it does | Adds nullable `given_name` and `family_name` (no default, no backfill), a CHECK on each (null, or trimmed, 1–100 characters), and `grant update (given_name, family_name) on profiles to authenticated`. No policy, function or index. `full_name` stays authoritative. |
| Dependencies | `profiles` (001) only. Independent of 374–379 and 381. |
| Production | **NOT applied, NOT authorised.** `main` may hold this file before production does. The code reads the two columns separately and fails closed where they are absent: the card says "not available on this environment yet", and the route refuses the two fields with a 409. |
| Rollback | `docs/evidence/ACCOUNT-MY-PROFILE/ROLLBACK-380.sql`, sha256 `816e7ecebd02325688ea57824ce741499293ca216d6b766e7e7a293326279230`. It drops both CHECKs and both columns, all IF EXISTS, so a re-run is a no-op. Dropping a column removes its column privilege, so it has no separate revoke. A project-check header names the staging ref. |

## Pre-application state (STAGING `ezhvpgtcqcdsgylrxgdb`, read-only)
- **`authenticated` grants:**
  - column-level UPDATE on exactly `avatar_url`, `country`, `full_name`, `phone`, `specialization`;
  - no table-level UPDATE or INSERT;
  - nothing on email or any authority column.
- **Policies:** `Country admin reads country profiles` (SELECT), `Group admin reads org profiles` (SELECT), `Users update own profile` (UPDATE, WITH CHECK `profile_authority_unchanged(...)`), and `users_read_own_profile` (SELECT).
- **Auth email sync:** nothing synced the Auth email to `profiles.email`. `handle_new_user` is insert-only.

## Staging application and the Medium gate (fingerprints: `scratchpad/fp380.mts`, read-only)

| Step | By | Result | profilesSchema | profilesPrivileges | profilesPolicies | restOfPublic |
|---|---|---|---|---|---|---|
| Apply ×2 | owner, `apply-migrations.ts --only 380` from `.passport-view` | both "ok", guard passed | | | | |
| **F1**, verify | read-only | columns nullable with no default; both CHECKs; authenticated UPDATE = the five + `given_name`, `family_name`; no table-level UPDATE; policies and `profile_authority_unchanged` (md5 40cb41aa…) unchanged; 0 names filled | 57bd1ae6 | 064f59ab | ca659264 | 4852d374 |
| Compatibility | harnesses | auth-boundary green, plane-boundary 35/35, account-profile-harness 19/19, hq-appointment 26/26 (staging), account-profile-acceptance 13/13 (staging) | | | | |
| Rollback | owner, terminal runner `run-staging-sql.mjs` ("Done on ezhvpgtcqcdsgylrxgdb. Committed.") | | | | | |
| **F2**, pre-state restored | read-only | no name columns or CHECKs; authenticated UPDATE = exactly the five; policies and function unchanged | 26eca7fe | b874d603 | ca659264 | 4852d374 |
| Re-apply ×2 | owner, `apply-migrations.ts --only 380` | "all run" | | | | |
| **F3** = F1 | read-only | identical to F1 | 57bd1ae6 | 064f59ab | ca659264 | 4852d374 |

**Two mistaken rollback runs** went to the dashboard SQL editor on another project before the terminal runner was used. Production was confirmed read-only afterwards: no name columns or CHECKs, authenticated column UPDATE = the five, 4 policies, 26 columns. Both runs were no-ops: the first errored on its first statement, the second was all IF EXISTS. The first one exposed a real defect: the original rollback's `revoke` failed when the columns were absent. Fixed in the committed rollback (`816e7ece…`).

## Verification of the feature
See the PR body.
- **Static (CI):** `account-profile-harness` 19/19, with 9 planted controls.
- **Unit tests:** `vitest` 671/671 on an LF clone.
- **Staging:** `account-profile-acceptance-harness` 13/13. A real session updates its own fields; all 9 authority columns and the email are refused and unchanged; another row is refused; the 380 names work. The email-change step is PEND, because staging Auth rejects synthetic addresses.
