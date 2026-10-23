# Migration 381 build record: copy a confirmed Auth email change into `profiles.email`

Owner GO 2026-10-23, item 4, "Email synchronisation": *"Develop a separate focused PR for confirmed Auth-email-to-profile synchronisation. Use a Medium-risk migration with staging rollback rehearsal. Preserve verified-email authority, audit, identity integrity and existing notification behaviour. No production migration without separate GO."*

| | |
|---|---|
| File | `supabase/migrations/381-sync-confirmed-auth-email-to-profile.sql` (APPLY THIS FILE WHOLE: plpgsql) |
| sha256 (LF, the committed and applied file) | `d5e8f2c8a84a3695bfeac53868f28dc22ccfd7e98eaae5fbcfa7c385a28a60b6` |
| House rules | ALL CLEAR (91 lines, 18 statements). The only warnings are the declared `$$`, plpgsql and function constructs. |
| What it does | Function `public.sync_confirmed_auth_email_to_profile()`: SECURITY DEFINER, `search_path = public, pg_catalog`, EXECUTE revoked from public, anon and authenticated. Trigger `on_auth_user_email_confirmed`: AFTER UPDATE OF email ON auth.users FOR EACH ROW. |
| When it copies | Only when `auth.users.email` actually changed, `email_confirmed_at` is not null, and the new value is not null. Only that person's `profiles` row, and only if it differs. |
| Audit | One `audit_log` row per copy: actor_id null, actor_name `auth`, action `sync_profile_email`, old and new value. |
| On failure | Any error inside is caught with a warning, so a person can always confirm their email (the `handle_new_user` posture). |
| Backfill | **None.** The read-only count on staging was 0 mismatched (18 profiles with an Auth user, 0 null, 0 pending). Production needs its own read-only count under its GO. |
| Notifications | No code path changed. Readers of `profiles.email` simply read the confirmed address. |
| Dependencies | `profiles` (001) and `audit_log` (040). Independent of 380. |
| Production | **NOT applied, NOT authorised.** |
| Rollback | `docs/evidence/ACCOUNT-EMAIL-SYNC/ROLLBACK-381.sql`, sha256 `4717e6e4248cbf1cc9ebc7d057d048a90e8b88dab4a0a82e93dccff6eff638d4`. It drops the trigger, then the function, both IF EXISTS. It touches no data, and a project-check header names the staging ref. |

## Staging application and the Medium gate (fingerprints: `scratchpad/fp381.mts`, read-only, STAGING `ezhvpgtcqcdsgylrxgdb`)

| Step | By | Result | function md5 | authUsersTriggers | publicTablesAndPolicies | otherPublicFunctions |
|---|---|---|---|---|---|---|
| Before | read-only | auth.users triggers: `on_auth_user_created` only. Acceptance showed **a confirmed change NOT copied** (the defect, and the proof the check can fail) | none | (pre-381) | | |
| Apply ×2 | owner, `apply-migrations.ts --only 381` from `.consent-view` | both "ok", guard passed | | | | |
| Acceptance | `email-sync-acceptance` | **6/6**: N1 no-op, C1 synced, C2 one audit row, U1 unconfirmed not copied, fixtures gone | | | | |
| **G1** | read-only | SECURITY DEFINER, search_path fixed, owner postgres; EXECUTE held only by postgres and service_role (a Supabase default); trigger as specified; 0 mismatched | 63c926ad | 4bedf57b | 9f7b4a11 | 51c5f538 |
| Rollback | owner, terminal runner ("Done on ezhvpgtcqcdsgylrxgdb. Committed.") | | | | | |
| **G2**, pre-state | read-only | function gone, `on_auth_user_created` only, other functions unchanged | none | 7e45f22c | fc90cb1c * | 51c5f538 |
| Re-apply ×2 | owner | "all run" | | | | |
| **G3** = G1 | read-only | identical to G1 | 63c926ad | 4bedf57b | 9f7b4a11 | 51c5f538 |

\* G1 was taken while 380 was also applied, and G2 after 380's rollback too. The `publicTablesAndPolicies` difference is exactly 380's columns. Proof: at the same moment, fp380 showed everything except `profiles` unchanged (4852d374) and `profiles` in the pre-380 state.

## Verification
- **`email-sync-harness`** (CI): 13/13. Six checks, with seven planted controls:
  - trigger scope;
  - confirmed-only;
  - own row;
  - audit;
  - definer, search_path and banner;
  - no backfill;
  - exact rollback.
- **`email-sync-acceptance-harness`** (staging, registered STAGING in `privileged-harnesses`): 6/6 after apply, and PEND before apply.

## Merge review (owner GO "APPROVED FOR MERGE", 2026-10-23)

**Items 2–4: authority and safety, pinned by `email-sync-harness`:**
- **Auth stays the source of the verified email.** The function copies Auth to `profiles` only, never the other way. A person cannot write `profiles.email` themselves: `authenticated` has no UPDATE on it (column grants, PR D), pinned by `account-profile-harness` E1 and staging acceptance U5.
- **Confirmed-only and own-profile only:** G1, with planted P2 and P3.
- **EXECUTE revoked and `search_path` fixed:** S1, with planted P5. Staging G1/G3 confirms it: EXECUTE is held only by postgres and service_role.
- **Audit row written:** A1, with planted P4. Staging acceptance C2: exactly one row.

**Item 5: who can read the old and new address in the audit row.** Read-only on STAGING:
- `audit_log` has RLS **enabled with no policies**, so `anon` and `authenticated` read zero rows through the API, whatever their table grants. Only the service role and postgres can read it.
- In the app, the service-role readers that select `old_value` / `new_value` are:
  - `/super-admin/audit`, behind HQ capability. **This is the one surface that shows the addresses.**
  - Assessor and educator pages filtered to a fixed action and to the viewer as actor (`ai_report`, `ai_*`, `send_message`). A `sync_profile_email` row has actor null, so it never matches.
- Every other reader selects only `actor_name`, `action`, `entity_name`, `entity_type` and `created_at`, and 381 writes `entity_name` null and `actor_name` `auth`. So those readers show at most "sync profile email" with no address.

So the addresses are readable only by the service role and by HQ audit viewers. That is consistent with the GO ("old to new"), and no change to 381 is needed. Any future reader that selects `new_value` broadly must not be exposed below HQ.

**Item 6: reconciliation (read-only):** `scripts/email-sync-reconcile.ts`.
- **Output:** for confirmed Auth accounts, how many have `profiles.email` different from Auth (ids only, never an address), and how many have no profile row.
- **How to run:**
  - Staging: `npx tsx scripts/email-sync-reconcile.ts`.
  - Production: only with `--production` AND `COMPETEN_PRODUCTION_READ_GO=<named owner GO>` (`productionReadDecision`, R13).
- **Staging, 2026-10-23:** 21 confirmed accounts, **0 mismatched**. One confirmed Auth user has no profile row (77c9bdb5…), which is unrelated to 381 (a profile never created or later removed). Recorded, not changed.
- **Production:** run it under its read GO before deciding any one-time backfill. 381 performs none.

**Item 7: compatibility with 380.**
- **Disjoint objects:** 380 adds `profiles.given_name` / `family_name`, their CHECKs and a column grant. 381 adds a function and a trigger on `auth.users`, and writes only `profiles.email` and `audit_log`.
- **No shared object, no ordering dependency:** either merge or apply order works.
- **The one textual overlap** is the additive registry lists (`scripts/ci-harnesses.ts`, `scripts/privileged-harnesses.ts`). Whichever PR lands second keeps both entries.
