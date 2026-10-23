# COMPETEN-IND-ACCESS-001: Individual invitations, build record

| | |
|---|---|
| **Owner GO** | "Individual invitations: extend ACCESS-001 to support people without existing Competen accounts", relayed by the main session. Plan approved within the GO. |
| **Branch** | `ind-access-001/individual-invitations`, cut from `main` at `89b39f25` (#25 merged). |
| **Migration** | **378**, `supabase/migrations/378-individual-invitation.sql`. **Staging only. Not authorised for production.** |
| **Classification** | **Low** under amended COMPETEN-OPS-001 §8: one new Individual-owned table with its own RLS, plus a view and a trigger on that table. It alters nothing that already exists. |
| **Production** | Nothing applied, deployed or activated. `individual_app` was not written anywhere. |

## 1. What it does
An HQ administrator holding `hq.individual.pilot.grant` can invite an email address that has **no Competen account** into Competen Scholar, Competen Professional or both.

**What the invitation creates:**
- **One identity,** through shared IAM: Supabase auth's own `inviteUserByEmail`, the same call `/super-admin/users` uses.
- **Nothing else:**
  - no platform, enterprise or practice membership;
  - no estate role (the new-user trigger's default `nurse` is cleared to `null`, the rule Competen Practice registration already keeps);
  - no Individual membership or entitlement yet.

**The invitee's path:**
1. Opens the email link and sets a password on the shared `/reset-password` page.
2. Signs in once through the shared `/login`.
3. Arrives at `/individual/access`, which shows the waiting invitation.
4. Presses Accept. Acceptance grants through the existing engine (`grants.ts`), with:
   - the inviter as grantor;
   - the inviter's 18+ confirmation (D8);
   - the operating entity of each experience;
   - the offered validity date.
5. Goes through the welcome, then the D2 terms gate, before any experience opens.

## 2. Invariants and where each is enforced
| Invariant | App | Schema | Proven by |
|---|---|---|---|
| No platform, enterprise or practice membership | `invitations.ts` never writes them | — | Foundation harness 1c and 12n. Staging I2. Planting a write turned 1c and 12n red. |
| No estate role | `profiles.role` is cleared to `null` on the identity this call created, via `individualIdentityProfile()` | — | Foundation harness 1d and 12n. Staging I2 and I12. Planting the skip on staging turned I2 and I12 red with `role=nurse`. |
| One live invitation per email | Refused first (`INVITATION_PENDING` / `INVITATION_EXPIRED_PENDING`) | Full unique index on the generated `pending_email` column | Staging I3, I19 and I20 (`23505`) |
| An existing account goes to the existing grant path | `ACCOUNT_EXISTS`, carrying the person's id | Supabase refuses a duplicate address | Staging I4 and I17 |
| Scholar is 18+ | `AGE_ELIGIBILITY_REQUIRED` | `individual_invitation_scholar_adult`, then `individual_entitlement_scholar_adult` (370) | Staging I5 and I11 |
| Terms before access | Unchanged D2 gate | — | Staging I13 (welcome, then terms) |
| Expiry | Accept reads `individual_live_invitation` (database clock) | `expires_at` within 30 days of `created_at` | Staging I18 |
| Revocation | A reason of at least 8 characters, `PENDING`→`REVOKED` only. The identity is **not** deleted. | Trigger plus `revoked_whole` CHECK | Staging I15 and I16 |
| Audit | `individual_invitation_created`, `_revoked` and `_accepted` written to `audit_log`; the row itself is the record | Append-only trigger with the cascade allowance | Staging I14 and I20 |
| Only the invited identity can accept | Read by session user id; email must be confirmed and match; nothing is taken from the body | Own-row RLS | Foundation harness 12l. Unit tests. Staging I9–I10. |
| Test link mode can't ship enabled | `inviteDeliveryMode`: requires `INDIVIDUAL_INVITE_TEST_DELIVERY=link`, `NODE_ENV !== "production"`, **and** `judgeTarget` (non-production) | — | Foundation harness 12m. Planting removal of the `NODE_ENV` condition turned it red. |

## 3. Migration 378: the four states
| State | Status | Evidence |
|---|---|---|
| 1. Authored | Done, 2026-10-23 | House rules: ALL CLEAR (3 expected warnings: `$$`, plpgsql, function; the `APPLY THIS FILE WHOLE` banner is present) |
| 2. Applied and verified on staging | **Done.** The owner applied it **twice** from `competen-ind-002` with `npx.cmd tsx scripts/apply-migrations.ts --only 378` and reported "Done" (relayed by the main session, which also checked that the file on disk was the corrected version: CRLF `c26dd5ab…`, LF `f2d535b7…`). | See the evidence below this table. |
| 3. Merged into `main` | Not yet (PR) | The code that reads it fails closed while the table is absent: HQ shows "Invitations are not set up in this environment yet", and the access page shows no invitation. The whole flow also sits behind `individual_app` (default OFF). |
| 4. Applied to production | **Not authorised.** Needs a separate owner GO plus the OPS-001 safeguards. | — |

**Staging evidence for state 2:**
- **Pre-application** (11:04Z, read-only REST, with controls):
  - `individual_invitation` and `individual_live_invitation` absent (PGRST205);
  - absent-table control: PGRST205;
  - absent-column control: 42703;
  - `individual_membership` present.
- **Post-application catalog, first check** (read-only transaction on `STAGING_DB_URL`, guarded by `judgeDbTarget`):
  - all 8 CHECKs, including `scholar_adult` on `adult_confirmed_at` only, which is the corrected form;
  - the full unique index on the generated `pending_email`;
  - trigger `trg_individual_invitation_guard` enabled;
  - RLS on, with policy `individual_invitation_read_own` (SELECT);
  - view `security_invoker=true`;
  - 0 rows.
- **Post-application catalog, second check** (11:35Z, after both runs):
  - the D8 CHECK is still `NOT invite_scholar OR adult_confirmed_at IS NOT NULL`, the corrected form;
  - the public objects named like `invitation` are only this migration's (table, view, three indexes, pkey) plus the pre-existing `practice_invitation` and its two indexes;
  - the only new function is `individual_invitation_guard`, and the only trigger on the table is `trg_individual_invitation_guard`;
  - the 370 tables still carry 9 and 11 constraints and their own-row SELECT policies;
  - 0 rows.
- **What the pre-state covers:** it was an existence probe of the objects 378 creates, not a full catalog snapshot. "The rest of public unchanged" therefore rests on three facts:
  - the file contains no statement against any other object;
  - the post-check enumerates what exists by name, and finds only 378's objects;
  - the 370 constraints and policies are intact.

**Checksums:** these must match the file the owner applies.
- LF, as git stores it: `f2d535b7015f824c842db160220c76968359c3d51c482ee647ef064576e18d58`. Verified on the committed blob.
- CRLF Windows working copy: `c26dd5ab4c41fae55355fa4c9f05b0d3fcfd3c1aca68c03006065aec5022e155`

An earlier draft had a defect: its D8 CHECK also required `adult_confirmed_by`, which would have made a confirmer's profile undeletable. It was corrected and re-hashed **before** application, and the hashes for the defective draft were withdrawn.

**Dependencies:**
- **Depends on:** 370 (`individual_membership` and `individual_entitlement`, used at acceptance) and `profiles`.
- **Independent of:** 372–377.
- **Application order:** any time after 370.

**Rollback SQL** (staging, or production if ever applied). Run whole; the trigger must go before its function.
```sql
drop trigger if exists trg_individual_invitation_guard on individual_invitation;
drop function if exists individual_invitation_guard();
drop view if exists individual_live_invitation;
drop table if exists individual_invitation;
notify pgrst, 'reload schema';
```
- **What rollback keeps:** identities created by invitations stay (auth user and profile, with `role` null), along with any Individual membership or entitlement they accepted. The audit rows stay.
- **What rollback removes:** only the invitation records.

## 4. Verification
- **Foundation harness: 58/58.**
  - Updated by decision: 1d (the one role-clearing profiles write), 2a (`individual_invitation` writes), 5a (named exception for the accept route), 5b (invitation routes) and 5c (grant-engine callers, including the relative import).
  - New: 12l, 12m and 12n, each proven red by a planted violation.
- **Auth-boundary harness:** green. The accept route enters `requireIndividualSession`, a new pre-membership boundary in `guard.ts`: the release gate, then the session, and it grants nothing. It is registered in `scripts/auth-boundary-harness.ts` with its plane stated. Before it existed, the route entered no boundary and the harness went red, which is how this was caught.
- **Vitest:** 551/551 across `src/lib` after merging main `bf549efc`, including `invitations.test.ts`.
- **Typecheck and lint:** clean.
- **Staging HTTP:** `individual-access-harness` 66/66. Groups H, S1–S9 and I1–I20, with the dev server started with the test delivery mode.
  - The real invite link is followed to `/reset-password`, and the Individual destination is preserved.
  - Fixtures were deleted afterwards (0 invitation rows remain).
- **Screenshots:** `docs/evidence/COMPETEN-IND-ACCESS-001/invitations/`
  - the HQ invite form (desktop and mobile);
  - the HQ view of a waiting invitation;
  - the invitee's access page with Accept (desktop and mobile);
  - the welcome after acceptance (mobile).
- **Staging flag:** `individual_app` was read, never written. The owner's 3030 viewing session was not touched.

## 5. Decisions recorded (defaults until the owner says otherwise)
1. **Revocation never deletes the account the invitation created.** The revocation record is kept. Deleting unused accounts is a separate owner decision.
2. **The test "return the link" mode** runs only under a local dev server against a non-production project (`judgeTarget`). It is pinned by harness check 12m with a planted red, and it never ships enabled.
3. **An identity created by an invitation and never signed into may be re-invited**, reusing that identity; Supabase sends a recovery link. Once the person has signed in, it is an existing account, and a re-invite goes to the existing grant path.

## 6. Known limits
- **Email delivery on staging and production:** the real path is Supabase's own mailer for the project, unchanged by this work. ADR-010 records that custom SMTP is not yet proven, so confirm delivery before the first real invitation.
- **Supabase's redirect allowlist must allow `/reset-password` with a query string.** It does on staging (I8). Check production's allowlist before activation.
