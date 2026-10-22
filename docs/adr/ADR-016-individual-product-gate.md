# ADR-016 — Competen Individual is a third product gate; Scholar and Professional are entitlements inside it

**Status:** Proposed · 2026-10-22. It becomes Accepted when the owner applies migration 370 and confirms
the provisional rulings below.
**Satisfies:** COMPETEN-IND-001 D1–D6, COMPETEN-IND-002 §5, COMPETEN-IND-003 §2
**Supersedes:** nothing.
**Enforced by:**
- `supabase/migrations/370-individual-membership-and-entitlement.sql` (draft, owner-applied)
- `src/lib/individual/access.ts` and `src/lib/individual/access.test.ts`
- `src/lib/identity/product-resolution.ts` and its test
- `scripts/individual-foundation-harness.ts`

---

## The question

Competen Individual is one product presented as two experiences, Competen Scholar and Competen Professional.
Each must be independently entitled and simultaneously usable. Both sit on one identity, one personal AI,
one learning history and one Competen Passport (COMPETEN-IND-001 D2–D5). The audit (COMPETEN-IND-002 §1)
found three facts that shape the answer:

- No per-person entitlement store exists. Every commercial store is keyed on a workspace or a tenant.
- The personal workspace at `/dashboard` is gate 1 (`platform_membership`).
- COMP-ARCH-PSA-001 §40 forbids granting gate 1 as a side effect of joining another product.

## Decision

1. **Individual is gate 3, built the way gates 1 and 2 were.**
   - `individual_membership` holds one row per person, with `status`, `source` and grant/revoke audit
     columns. It is the only fact that admits a person to the Individual shell.
   - Absence of the row means no access.
   - An unreadable store is reported as unavailable and admits nobody: ADR-015's "unreadable is not
     permission", and the fail-closed half of `product-resolution.ts`.
   - Creating the row never creates `platform_membership`, never writes `profiles.role`, and never touches
     `practice_membership` or `enterprise_membership`.
2. **Scholar and Professional are rows in an entitlement ledger, not products and not roles.**
   - `individual_entitlement` is keyed `(user_id, experience_code)`, with a period
     (`starts_at`/`ends_at`), a `status`, a `source` (NOT NULL, no default, after migration 368's reasoning)
     and an `operating_entity`.
   - Any number of rows may be live together, so both experiences can run at once.
   - Liveness is decided by the database clock, in the view `individual_live_entitlement`. Application
     code never compares its own clock to a stored period.
3. **Graduation activates; it never migrates.** Activating Professional for a Scholar inserts a ledger row
   (`source = 'graduation'`). Returning to Scholar for postgraduate study inserts a Scholar row. The
   identity, history and Passport do not move, because they were never inside an experience.
4. **The primary experience is a preference, not an entitlement.**
   - It is stored as `individual_membership.primary_experience`.
   - It is honoured only while that experience is live.
   - Otherwise the landing falls back to the single live experience, and then to a chooser.
5. **The shell is Individual's own.** `/individual/(app)/**` is guarded by gate 3 and never by
   `admitToEstate`. Individual API routes use `requireIndividualContext`, not `getCaller()`, whose default
   is gate 1 by design (`src/lib/api-auth.ts`).
6. **Shared modules are rendered inside each experience, not owned by either.** The Passport, profile and
   history, personal AI and settings are one module each. They are mounted at `/individual/<experience>/…`
   so the navigation context lives in the URL, and they read the same person-scoped data.

## Provisional rulings

These are working assumptions from COMPETEN-IND-002 §7. The owner has not ruled on them.

| # | Assumption | Where it is implemented |
|---|---|---|
| D1 | Individual-originated records live in `individual_*` tables. Nothing Individual writes goes into estate tables that hospital analytics read. | Migration 370 creates only `individual_*` tables. The harness fails any Individual write to `quiz_attempts`, `cpd_logs`, `course_enrollments`, `knowledge_attempts` or `learning_enrolments`. |
| D3 | Records an institution issued about a person are shown to that person, read-only and labelled by issuer. | `src/lib/individual/passport.ts` reads them with the subject's id only. |
| D6 | RLS is enabled on `individual_*` with own-row `select` policies. Writes go through the service role behind app guards. | Migration 370. |
| D7 | The app routes are `/individual/scholar/**` and `/individual/professional/**`. | `src/app/individual/(app)/[experience]` plus the registry. |
| D8 | The pilot is 18+. | Recorded only. Pilot grants are made by HQ, so there is no age gate in code. |

D2 (operating entity and data controller) is only partly assumed. `operating_entity` is recorded per
entitlement, but the controller arrangement and terms capture are not built.

## Consequences and limits

- **No public signup.** The only way in is a pilot grant. The `/individual/sign-in` door stays
  `being_built`, and pilot users sign in at `/login`, where the neutral resolver offers Individual.
- **The pilot-grant right has no HQ capability yet.** Who in HQ may grant it is an owner decision. Until
  then, grants are made by the owner in SQL from the template in COMPETEN-IND-003 §6.
- **Passport sharing from Individual is not built.** The existing share route is behind gate 1. A person
  who also holds gate 1 is pointed to it; a person who does not is told that sharing is not available yet.
- The personal AI keeps **no memory**. Each question is grounded on the person's own record and
  forgotten. Memory waits for a consent design.
