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

**Rollback SQL:** `docs/evidence/COMPETEN-IND-ACCESS-001/ROLLBACK-378.sql`, following the ROLLBACK-380/381 conventions. It is for staging, or for production if 378 is ever applied there.
- **Checksums:** LF `d07e5fb91ebda2a0191dbf829798cd6149933144af8de05b9b443721b4f1154f`, CRLF working copy `add8d051b3fb6152fb3ea136488f0c436927a132e0def7617edbb6a48a1758b8`.
- **House rules:** ALL CLEAR.
- **It drops, in dependency order, each `IF EXISTS`:** the guard trigger, its function, the view, then the table. Re-running it is a no-op, and it touches nothing 378 did not create.
- **Not rehearsed:** not required for the Low tier.
- **What rollback removes:** **every invitation row** (pending, accepted and revoked), as the file's header states.
- **What rollback keeps:** identities created by invitations (auth user and profile, `role` null), any Individual membership or entitlement they accepted, and the audit rows.

## 4. Verification
- **Foundation harness: 58/58.**
  - Updated by decision: 1d (the one role-clearing profiles write), 2a (`individual_invitation` writes), 5a (named exception for the accept route), 5b (invitation routes) and 5c (grant-engine callers, including the relative import).
  - New: 12l, 12m and 12n, each proven red by a planted violation.
- **Auth-boundary harness:** green. The accept route enters `requireIndividualSession`, a new pre-membership boundary in `guard.ts`: the release gate, then the session, and it grants nothing. It is registered in `scripts/auth-boundary-harness.ts` with its plane stated. Before it existed, the route entered no boundary and the harness went red, which is how this was caught.
- **Vitest:** 551/551 across `src/lib` after merging main `bf549efc`, including `invitations.test.ts`.
- **Typecheck and lint:** clean.
- **Staging HTTP:** `individual-access-harness` 68/68 after merging main `d6234288`. Groups H, S1–S9 and I1–I22, with the dev server started with the test delivery mode.
- **`individual-config-harness` (IND-007):** its G5 "no third HQ door" control now knows the `invitations/` routes, which the foundation harness pins. A planted unknown route still turns G5 red.
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
3. **An identity created by an invitation and never signed into may be re-invited**, reusing that identity; Supabase sends a recovery link.
   - **It must still hold nothing** (owner review item 5, `src/lib/identity/standing.ts`): no platform, enterprise, practice or Individual membership, no HQ appointment, and no role. Otherwise the re-invite is refused as `ACCOUNT_EXISTS`, and the administrator grants Individual to it explicitly.
   - **A failed read counts as standing,** so it refuses.
   - **Once the person has signed in,** it is an existing account in all cases.
   - **Proven on staging:**
     - I21: a clean identity is reused;
     - I22: the same identity, given a platform membership, is refused;
     - planting removal of the check turned I22 red.

## 6. Production prerequisites (owner review item 7)
Nothing here could be verified against production from a development worktree: the production key is in the owner's vault and needs a named GO. These are requirements for the owner to confirm.

1. **Redirect allowlist** (Supabase, production project, Authentication → URL Configuration).
   - **What must be allowed:** the invite `redirectTo` is `<origin>/reset-password?next=%2Findividual%2Fhome`, where `<origin>` is the host the administrator used for HQ (taken from the request).
   - **How to allow it:** list every production host HQ is reached on, as `https://<host>/reset-password**` (the `**` wildcard covers the query string).
   - **If it isn't allowed:** Supabase falls back to the Site URL. The person then lands somewhere that is not the password page, and can still recover through "Forgot password", but the flow breaks.
   - **On staging:** I8 proves the allowlist keeps the path and the `next` query.
2. **Email delivery.**
   - **What sends it:** `inviteUserByEmail` sends through the project's own Auth mailer, unchanged by this work.
   - **What is unproven:** ADR-010 records that custom SMTP is not proven. Supabase's built-in mailer is rate-limited and restricted, and is not for production.
   - **Why staging proves nothing about it:** staging runs used the development-only link mode, so **no real invitation email was sent anywhere**.
   - **Before the first real invitation:** configure and prove production SMTP (ADR-010 steps 1–3), send one invitation to a mailbox the owner controls, and confirm the link opens `/reset-password` on the production host.
3. **The invite email template.** Supabase's "Invite user" template is the one used. Its wording and branding are owner configuration in the Supabase dashboard; nothing in this PR changes it.
4. **Migration 378 production GO**, with the OPS-001 safeguards: a recovery reference, the rollback SQL in §3, and a post-application catalog check matching §3.
5. **The release gate stays OFF.** Without `individual_app`, invitations refuse with 404, as they do today.

## 7. Invitation links while `individual_app` is OFF (owner release review item 6)
**No invitation can be created while the gate is off.** `POST /api/hq/individual/invitations` checks the release gate after the HQ capability and answers 404 before reading the body: no identity, no email, no row. The same is true while migration 378 is absent: the route answers 503 `NOT_SET_UP`, and the HQ screen says invitations are not set up.

**An invitation made while the gate was ON, with the gate later switched OFF:**

| Step | Behaviour |
|---|---|
| The person opens the email link | Supabase verifies it and redirects to `/reset-password?next=%2Findividual%2Fhome` (shared IAM, not gated). |
| They set a password | It succeeds. It is their one Competen identity, and nothing is granted by it. |
| They choose "Sign in" | `/login?next=/individual/home`, presented as signing in to Competen Individual. |
| After signing in | `/individual/home` answers **404**, the same as an absent route (the gate is checked before anything else). |
| Accept | `POST /api/individual/invitation/accept` answers **404** before reading the session or any table. |
| The neutral sign-in | Offers no destination: Individual is not queried while the gate is off. The person sees "No Competen product access is currently assigned". |
| The invitation row | Stays `PENDING` and expires on schedule by the database clock. If the gate returns before expiry, it can then be accepted. After expiry it cannot, and the administrator revokes it and re-invites. |
| What the identity holds throughout | Nothing: `role` null, no membership of any product. |

The link therefore never opens Individual while the gate is off. At most it lets the person set a password on an identity that holds nothing.

## 8. Production build and the development-only test link (owner release review item 3)
`inviteDeliveryMode()` returns `"link"` only when all three conditions hold:
1. `INDIVIDUAL_INVITE_TEST_DELIVERY=link` was set deliberately.
2. `process.env.NODE_ENV !== "production"`.
3. `judgeTarget(NEXT_PUBLIC_SUPABASE_URL)` identifies a non-production project.

On a production build, Next.js sets `NODE_ENV=production` for `next build` and for the deployed runtime, and Vercel runs that build. Condition 2 cannot hold there, whatever environment variables are set in Vercel. Condition 3 independently refuses the production project, so the mode would still be `"email"` even if a development server were pointed at production.

The link is attached to the API response only on the `"link"` branch. In `"email"` mode it is never generated, because `generateLink` is called only on that branch.

**Proven by:**
- foundation harness 12m, which runs the function over five environments and checks the code shape; dropping the `NODE_ENV` condition turned it red;
- unit tests in `invitations.test.ts`;
- the unit test asserting that `testLink` is absent in `"email"` mode.

## 9. Safe production email and redirect test (owner release review item 7)
**Status: not run.** It sends a real email from production, so it needs its own owner authorisation and a mailbox the owner controls. It does not need Individual, an invitation, an entitlement, a new identity or the service key. It uses GoTrue's public recovery endpoint, with the production anon key that every browser already receives.

The goal is to exercise the same Auth mailer and the same redirect allowlist that invitations use, without touching Individual:
```bash
curl -sS -X POST "https://<production-ref>.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2F<hq-host>%2Freset-password%3Fnext%3D%252Findividual%252Fhome" \
  -H "apikey: <production anon key>" -H "Content-Type: application/json" \
  -d '{"email":"<an existing owner-controlled Competen account>"}'
```

**Pass criteria:**
1. **SMTP:** the email arrives promptly, from the configured sender. That proves production SMTP, as ADR-010 requires.
2. **Redirect allowlist:** opening the link, or reading its `redirect_to`, lands on `https://<hq-host>/reset-password?next=%2Findividual%2Fhome`, not the Site URL. That proves the allowlist entry. Repeat for each host HQ is reached on.
3. **Nothing else changes:** completing the reset only changes that owner account's password, and it can be skipped. No invitation row, membership or entitlement is created anywhere.

**Failure modes and fixes:**
- **The email doesn't arrive:** configure production SMTP (ADR-010 steps 1–3).
- **The link goes to the Site URL:** add `https://<hq-host>/reset-password**` under Authentication → URL Configuration.
