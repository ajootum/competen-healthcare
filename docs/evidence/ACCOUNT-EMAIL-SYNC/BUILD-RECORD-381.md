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
