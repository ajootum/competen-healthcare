# ADR-016 — Competen Individual is a third product gate; Scholar and Professional are entitlements inside it

**Status:** Accepted · 2026-10-22. The owner ruled on D1–D10 in the COMPETEN-IND-003 owner rulings and staging commissioning GO.
**Satisfies:** COMPETEN-IND-001 D1–D6, COMPETEN-IND-002 §5, COMPETEN-IND-003 §2 and the owner rulings
**Supersedes:** nothing.
**Enforced by:**
- `supabase/migrations/370-individual-membership-and-entitlement.sql`
- `src/lib/individual/{access,guard,terms,legal,grants}.ts` and their tests
- `src/lib/identity/product-resolution.ts`
- `scripts/individual-foundation-harness.ts` (source invariants, in CI)
- `scripts/individual-acceptance-harness.ts` (database, staging)

---

## The question

Competen Individual is one product presented as two experiences, Competen Scholar and Competen Professional.
Each must be independently entitled and simultaneously usable. Both sit on one identity, one personal AI,
one learning history and one Competen Passport (COMPETEN-IND-001 D2–D5). The audit (COMPETEN-IND-002 §1)
found three facts that shape the answer:

- No per-person entitlement store exists.
- The personal workspace at `/dashboard` is gate 1 (`platform_membership`).
- COMP-ARCH-PSA-001 §40 forbids granting gate 1 as a side effect of joining another product.

## Decision

1. **Individual is gate 3, built the way gates 1 and 2 were.**
   - `individual_membership` holds one row per person. It is the only fact that admits a person to the Individual shell.
   - Absence of the row means no access.
   - An unreadable store is reported as unavailable and admits nobody (ADR-015's "unreadable is not permission").
   - Creating the row never creates another product's membership and never writes `profiles.role`.
2. **Scholar and Professional are rows in an entitlement ledger,** `individual_entitlement`, keyed `(user_id, experience_code)`.
   - Each row has a period, a status, a `source` (NOT NULL, no default) and an `operating_entity`.
   - Any number of rows may be live together.
   - Liveness is the database clock, read through the view `individual_live_entitlement`.
3. **Graduation activates; it never migrates.** It inserts a Professional row (`source = 'graduation'`). Returning to study inserts a Scholar row. Identity, history and Passport never move.
4. **The primary experience is a preference,** honoured only while that experience is live.
5. **The shell is Individual's own.**
   - `/individual/(app)/**` is guarded by gate 3, never by `admitToEstate`.
   - Person-facing APIs use `requireIndividualContext`. That guard is registered as the Individual plane in `scripts/auth-boundary-harness.ts`.
6. **Shared modules are rendered inside each experience, not owned by either.** The Passport, profile and history, personal AI and settings are mounted at `/individual/<experience>/…`.

## Owner rulings (2026-10-22)

| # | Ruling | Where it is enforced |
|---|---|---|
| D1 | Separate `individual_*` tables. Personal data must not become employer-visible through shared Enterprise datasets. | 370 creates only `individual_*` objects. The foundation harness (3a) fails any Individual use of the estate learning tables. The acceptance harness (M1) proves that no fixture row reaches them. |
| D2 | Holdings manages the shared foundation, and the Scholar subsidiary operates its service. Controller/processor relationships stay configurable pending formal legal confirmation. Terms acceptance is captured before pilot use. | `legal.ts` holds `DATA_ROLES` (`confirmed: false`); terms and privacy versions come from the environment, with no legal text or name invented. `terms.ts` gate: shared-foundation acceptance on the membership row, operator acceptance on the entitlement row, both all-or-nothing in the schema. Checked in the experience layout, every page and every experience API. Acceptance via `POST /api/individual/terms`, of the versions displayed. The publication structure and the consent-record requirements are in COMPETEN-LEGAL-001 (DRAFT, not legally approved). |
| D3 | Employer-issued Passport evidence is read-only to the individual, with provenance and verification status. External sharing is governed by the individual's consent. Organisations' lawful rights over their original records are preserved. | `passport.ts` reads by the subject's id only, writes nothing and copies nothing. Every item is labelled *Issued by an organisation*, *Verified by an organisation* or *Self-declared*. Sharing stays on the existing consented share surface. |
| D4 | Graduation does not revoke Scholar. Entitlements remain independent, and learning history persists. | The ledger allows concurrent rows. The grant end route cancels one experience only. History reads every period. Acceptance check D1. |
| D5 | Individual maintains its own professional identity record. Future Practice linkage requires governed consent. | No Individual code reads or writes `practice_practitioner_identity`. The record itself arrives with the Professional MVP. |
| D6 | RLS and server-side authorisation on Individual personal data, including cross-user isolation. | 370: RLS on, own-row `select` policies, no write policies, `security_invoker` view. App guards on every route. Acceptance checks G1–G4. |
| D7 | Authenticated routes `/individual/scholar/**` and `/individual/professional/**`. Public marketing routes stay distinct. | `src/app/individual/(app)/[experience]`. |
| D8 | The Scholar pilot is 18+, enforced during access granting. | The grant refuses Scholar without `adultConfirmed: true`. The schema CHECK `individual_entitlement_scholar_adult` refuses any Scholar row without `adult_confirmed_at`. The grant records `adult_confirmed_by`. |
| D9 | `hq.individual.pilot.grant` goes through existing HQ governance, assigned to an Individual Product Administrator appointment. No new landlord authority and no parallel grant engine. | 370 seeds the capability, the position `individual_product_administrator` (platform space, product line `individual`) and its grant. `spaces.ts` catalogue. `POST /api/hq/individual/grants` and `/grants/end` behind `hqApiGate(["hq.individual.pilot.grant"])`, refusing self-grant. |
| D10 | Personal AI persistent memory stays OFF until opt-in, visibility, correction and deletion controls exist. | The assistant stores no conversation (foundation harness 9g), and the page says so. One narrow exception: see "D10 exception (owner ruling 2 Nov 2026, CE-04)" below. |

The Scholar operating company's registered name is pending. `INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_REGISTERED_NAME` stays unset, and surfaces show a descriptive label.

## D10 exception (owner ruling 2 Nov 2026, CE-04)

D10 stands in full for Personal AI conversation memory. One narrow exception was approved for SCHOLAR-CE-2026 workstream CE-04, "Talk to the patient" in a clinical case: the turns of a **simulated-patient conversation** are stored as part of the learner's own case attempt. They are assessment evidence for that attempt, not persistent Personal AI memory.

**Scope.** One table, `individual_scholar_case_conversation` (migration 880, unapplied at the time of writing), and its operations: insert (the server, through the Scholar store), read-own, and delete only by cascade from the attempt or by the owner erasure function. UPDATE is refused. The assistant, Personal AI ask, Learn, study-session context and every other activity never read it. Foundation harness 9g still fails for any other conversation, message or session table. 9h and 9i hold the exception to its table and its three files, and `case-conversation-scope.test.ts` proves it from the source.

**The nine conditions.**
1. Turns are stored only against the specific learner's case attempt (session, same learner) and the stage the session had reached (`stage_id`, checked by the guard).
2. The saved conversation is shown in that learner's debrief.
3. Deleting the attempt deletes its conversation: both session foreign keys are `on delete cascade`, and the append-only guard allows the cascade path (`pg_trigger_depth() > 1`).
4. The Scholar erase-all workflow covers it: private plays by cascade, library plays by `individual_scholar_case_conversation_erase(user)` (server role only), called from `eraseAllMaterial`, subject to applicable retention obligations.
5. The turns are not reused as Personal AI memory or as context for unrelated activities (harness 9g/9h/9i and the scope test).
6. Within the same attempt they may be used for feedback and assessment: the end-of-case communication note and the debrief read only that session's turns.
7. The learner is told before the first turn, in the panel: "This conversation is recorded with your case attempt so you can review it and get feedback. It is not used as Personal AI memory." No separate consent system.
8. A completed transcript is never silently rewritten: append-only, no UPDATE, and a screened reply is kept flagged, not altered. No correction mechanism exists for it and none was built.
9. Real patient information is discouraged: a line at the input ("This is a simulated patient. Do not enter real patient names or identifiers.") and the existing patient-identifier screen runs on every question before any AI call.

The feature stays off by default (`scholar_case_conversation`, Individual policy).

## Consequences and limits

- **Ships dark.** A release gate (`practice_platform_flags.individual_app`, default OFF; `src/lib/individual/gate.ts`) is checked first at every Individual entry point and in the neutral resolver. While it is off, Individual answers 404 everywhere and `/login` is unchanged. It does not depend on migration 370.
- **No public signup.** People enter by HQ grant. The `/individual/sign-in` door stays `being_built`, and pilot users sign in at `/login`.
- **No experience is usable until its terms are published.** The four `INDIVIDUAL_LEGAL_*_VERSION` variables per environment must be set before the pilot.
- **The grant right has an API, not an HQ page.** An HQ console page would add route intent, navigation and plane-boundary entries. It is the next package's work.
- **Passport sharing from Individual is not built.** A person who also holds gate 1 is pointed to the existing share surface.
- **No migration of `profiles.role`.** New accounts still receive `role = 'nurse'` from the new-user trigger (migration 335). Individual neither relies on that value nor changes it. Whether an Individual-only account should keep it is outside this ADR.
