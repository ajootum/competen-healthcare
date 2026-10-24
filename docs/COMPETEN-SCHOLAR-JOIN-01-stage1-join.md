# COMPETEN-SCHOLAR-JOIN-01: Stage 1 Join, J1–J3 (build record)

**Status:** development authorised; **production activation not authorised.**

- Every join surface sits behind `individual_self_registration` (no row is written by any migration, so it is OFF) *and* the Individual release gate `individual_app`.
- **Owner ruling:** public self-registration stays disabled pending legal confirmation and separate production approval.

**Migrations:** 402 and 403 are this build's. Number 404 was allocated and is released unused.

**Stacking:** the branch `scholar/join-01` is stacked on `holdings/commercial-foundation`, because J3 uses the 399 interfaces (`plan_code`, the `signup` source).

## 1. The journey

Get Started (`/individual/join`) → Create Account → Verify Email → Educational Context and Activate Scholar (`/individual/join/start`, two short steps) → Welcome (**Upload my notes**) → terms (D2, as today) → Scholar upload.

- **J1, an existing account.**
  - A signed-in person with no Individual membership sees "Add Competen Scholar" on `/individual/access`.
  - A Professional member reaching `/individual/scholar` sees the same offer.
  - In both cases Scholar is activated on the account and membership the person already has: no new identity, no second membership.
  - The invitation flow (378) is untouched and does not read the join flag (foundation harness 14f).
- **J2, a new account.**
  - `POST /api/individual/join/register` creates the identity with Supabase auth sign-up and email confirmation.
  - It refuses a signed-in caller, and offers sign-in for an email that already has an account; GoTrue's no-identities answer is treated the same way. A second account is never created.
  - The new identity's `profiles.role` is cleared to null (no estate role), as Practice signup and Individual invitations already do.
  - Nothing Individual is created until the person returns verified.
- **J3, subscription-ready entitlement.**
  - Activation writes through `grants.ts`, which is still the one writer of gate-3 rows.
  - The membership gets source `signup` when none exists. The Scholar period gets source `signup`, with an optional `plan_code` from 399.
  - No payment provider is involved, and identity is independent of payment. A later paid period appends (P1 Commercial).
  - Scholar and Professional stay independent.

## 2. Owner rulings, and how each is met

| Ruling | Implementation | Pinned by |
|---|---|---|
| **AGE**: 18+, an explicit declaration with timestamp and eligibility-policy version; self-declaration, not verified age; no documents, no external service | Migration 403 adds `individual_age_declaration`: `declared_at` from the database clock, the exact statement, `policy_version` and `source`. It is append-only. A self-activated Scholar period names its declaration (`adult_declaration_id`), and `adult_confirmed_by` stays null. A new CHECK makes HQ-confirmed and self-declared exclusive. The 370 D8 CHECK is unchanged. The API refuses a missing declaration or a stale policy version. | unit tests; foundation 14d; staging A2, A5, A6, H3 |
| **Self-registration DISABLED** pending legal and production approval | `individual_self_registration`, with no row. The join pages and routes return 404 while it is off. | foundation 14a, 14b; staging F0, F1 |
| **EDUCATIONAL CONTEXT**: current *and* historical; a change must not overwrite the context of earlier learning | Migration 402 keeps `individual_scholar_learner` as the current pointer, adding level and institution (code plus the label shown). Its trigger copies every change into the append-only `individual_scholar_learner_context` as a period on the database clock. A record's context is the period containing its `created_at` (`contextAt`), so learning tables need no new column. | foundation 14e; unit tests; staging A7, H1, H2 |
| **CONFIGURATION**: reuse CONFIG-002/WCE, with no-code admin for programmes, levels, institutions and fields; no parallel engine | Four policies in the existing Individual catalogue, each with a control on `/super-admin/individual/configuration` behind `hq.individual.config.manage`, versioned, audited and rolled back by WCE: `scholar_onboarding_programmes` (which 387 programme rows are offered), `scholar_programme_levels` (per programme), `scholar_institutions`, `scholar_onboarding_fields`. Programme and level names are checked against active programme rows on write and on every read. | unit tests; config harness 36/36 |
| **IMPLEMENTATION**: existing Holdings identity, entitlement, governance and commercial infrastructure | Supabase auth with one identity; gate-3 rows through `grants.ts`; WCE for configuration; 399 plan and source interfaces; the D2 terms gate as today. | — |

## 3. Migrations

| File | sha256 (CRLF, applied) | sha256 (LF, git blob) | Depends on |
|---|---|---|---|
| `402-individual-scholar-educational-context-history.sql` (APPLY WHOLE) | `f233ca1ee7dba9272da68ca19c948bf65225b70ad31c8e60fba606a1cea62d0d` | `ea94c2774148dda4ebed343fd3dd5e67e7f9071eb39aa42b7592a1a619374953` | 387 |
| `403-individual-adult-age-declaration.sql` (APPLY WHOLE) | `2d80cbf8eb245aaade93f72e772444d975b82339d405b3fee7b52d225dc16814` | `92c356409a24535fbff1165ef27d2e1043c21172b84b0bb2266125917c79e82b` | 370 |

**Application order:** 402, then 403. They are independent of each other. Both pass `migration-house-rules` with ALL CLEAR; the only warnings are the acknowledgements of the APPLY WHOLE banner.

**Staging state before application** (read-only probe, 2026-10-24):
- the new columns and tables are absent;
- 0 learners;
- one active programme, `nursing-ug-diploma`;
- `individual_app` is ON;
- `individual_self_registration` and `individual_commerce` are absent.

**Staging application** (main session, 2026-10-24, under the owner authorisation for staging 396–401 extended to 402–404):
- Each file was applied twice; all runs reported ok, and the checksums are the CRLF values above.
- **Medium-risk rehearsal.** These files add plpgsql triggers, one of them on an existing table, and 403 alters `individual_entitlement`. Fingerprint over the `individual_%` tables:

| State | Tables | Fingerprint |
|---|---|---|
| PRE | 28 | `809352989ccc` |
| F1, after applying | 30 | `f9243b89796d` |

- **Rollback rehearsal.**
  - `docs/evidence/COMPETEN-SCHOLAR-JOIN-01/ROLLBACK-403.sql` (CRLF sha256 `036d7bd415168b95af81ba75abea80af4efe429e5a9556bdcd1a13a4578252a4`) ran first. Its self-declared-periods guard read 0.
  - `ROLLBACK-402.sql` (`d116e8eb233e8aa00bfd962352b0aa282b5d41b294360c3bc2e7b5296f03ff49`) ran second.
  - After both: **F2 = 28 tables, `809352989ccc`, equal to PRE.**
- **Re-application:** each file applied twice again, all ok. **F3 = 30 tables, `f9243b89796d`, equal to F1.**

**Production:** not applied. With the flag off, code on `main` behaves as follows:
- **Join routes:** they read nothing from 402 or 403.
- **Programme route:**
  - it writes level and institution only when one is chosen;
  - when a programme alone is chosen, it falls back to the 387 write, so it works without 402.
- **Commerce:** its Scholar carry-forward reads `adult_declaration_id`. Commerce is dark, and it needs 399 and 403 before activation.

### Rollback

The rollback files are `docs/evidence/COMPETEN-SCHOLAR-JOIN-01/ROLLBACK-403.sql`, then `ROLLBACK-402.sql`. Both are idempotent and use `IF EXISTS` throughout, and both were rehearsed on staging (see above).

The 403 rollback should be refused, and that refusal is correct, if a self-declared Scholar period still exists: it is evidence behind live access. End the period first.

## 4. Verification

- **Unit tests:** `join.test.ts` covers:
  - the gate;
  - registration and one identity;
  - the declaration;
  - `selfActivateScholar`;
  - the order of `activateScholar`;
  - the policy kinds;
  - the join options;
  - `contextAt`.

  The Individual and Practice suites pass 466/466.
- **Foundation harness: 73/73.** Group 14 is new:
  - 14a dark by default;
  - 14b every entry point checks the flag first;
  - 14c one identity;
  - 14d the declared basis;
  - 14e history is the database's;
  - 14f invitations are independent.

  These checks were updated with stated reasons: 1d (the join's role clear), 2a (the join's writes), 5a (the join routes serve people with no membership yet), 5c (`join.ts` may reach only `selfActivateScholar`), and 6a (`auth.signUp` only in the gated join).
- **Controls proven red, then restored:** an ungated register route (14b), an HQ confirmer on a self-declared period (14d), and the application writing the history (14e).
- **Config harness:** 36/36.
- **`next build`:** *(see section 5)*.
- **Staging journey** (`scripts/scholar-join-harness.ts`, registered as privileged): *pending 402 and 403.*

## 5. Readiness

*Filled in after the staging run.*
