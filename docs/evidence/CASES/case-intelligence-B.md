# Case Intelligence B: C1 to C4 and analytics, build record

**Authority:**
- Owner GO COMPETEN-HOLDINGS-AI-CONSUMPTION-01 (s7 to s14), for development and staging.
- The Stage 5 case interface approval.
- IND-004's C-a to C-e and D-a to D-e.
- case-blueprint/1, AGREED at ab79af52.

**Built on:** migrations 422 (staging-verified, frozen) and 423 (the candidates and delivery package: staged by the main session, record below).

**Not done:**
- No production migration, activation or case publication.
- No student UI. Stage 5's student surfaces are IND-004's, and are not GO'd.

## What is where

| Piece | Code | What it does |
|---|---|---|
| C1 capture, platform side | `src/lib/cases/candidates.ts`, `screen.ts`, `policy.ts` | The permission, the per-case offer, the deterministic gate, withdrawal and retention |
| C2 educator studio | `src/lib/cases/studio.ts`; `/super-admin/cases`, `/super-admin/cases/[caseId]`; `POST /api/hq/cases` | The queue, take/release/decline/promote, create, the no-code editor, submit, AI drafting on the platform budget, versions and audit |
| C3 library on HQ | `/super-admin/cases/publication`; the clinical review page (395) now shows case versions in full | Publication as a separate act, retirement, the case policy |
| C4 delivery | `src/lib/cases/library.ts` | Search (deliverable only), server-side load, sessions with deterministic progression, in-bounds variation |
| s11 analytics | `src/lib/cases/analytics.ts`; `/super-admin/cases/intelligence` | Counts and spend from stored records, with measured spend apart from estimated savings |

**HQ authority:** each action's capability is fixed in the route.
- `hq.quality.case.author` (Clinical Case Educator): the studio.
- `hq.quality.case.publish` (Quality Council Member): publication, retirement, the policy and intelligence.
- `hq.quality.clinical.approve` (Clinical Content Reviewer): the existing review page and route.

## The student-side interface (for IND-004's Scholar code; server-side calls only)

### Capture (C1)

No AI, and nothing is charged to anyone.
- `candidacyStatus(admin, userId)` returns `{ granted, attestation, attestationVersion, current }`.
- `grantCaseCandidacy(admin, { userId, attestation: "own_notes" | "licensed_to_share", attestationVersion })`.
  - The version must be the current policy's (`ATTESTATION_TEXT[version]` in `policy.ts` holds the text to render).
- `revokeCaseCandidacy(admin, { userId })` returns `{ withdrawn }`. The database withdraws and purges every unpromoted candidate.
- `offerPrivateCase(admin, { userId, sourceKey, snapshot, verbatim: { passed, version } | null })` returns `{ candidateId, status: "eligible" | "ineligible", reasons, duplicate }`.
  - Call it only from an explicit per-case student action (C-c).
  - `snapshot` is Scholar's `privateCaseSnapshot`: a valid private case-blueprint/1, with `source_quote` and `sourceRefs` stripped (C-b, B8).
  - `verbatim` is Scholar's verbatim-overlap check. No check means `verbatim_unchecked`, which is ineligible.
  - `sourceKey` is Scholar's own opaque, stable key for the source (`/^[a-z][a-z0-9:_-]{7,199}$/i`). Holdings never reads Scholar's tables (C-a).
- `withdrawCaseCandidate(admin, { userId, sourceKey, reason: "student" | "source_deleted" })`: call this when the student withdraws or deletes the source (C-e).
- `myCaseOffers(admin, userId)`: the student's own offers, each with its status and reasons.

### Delivery (C4)

No AI, no AI-standing check, no charge (D-e).
- `findLibraryCases(admin, { competencyIds?, topic?, level?, context?: { professionTermId?, specialtyTermIds? }, excludeVersionIds?, limit? })` returns `LibraryOffer[]`.
  - It returns only versions that are published AND approved for the exact version (D-d).
  - It returns no content beyond the title and the spoiler-free intro.
- `startCaseSession(admin, userId, versionId, { hints? })` returns a `SessionView` (`{ sessionId, status, current, view: LearnerView, answered: token[] }`).
- `caseSessionView(admin, userId, sessionId, { hints? })`.
- `revealInSession(admin, userId, sessionId, factToken)`: only a fact a current, unanswered decision permits.
- `answerInSession(admin, userId, sessionId, { decisionToken, optionTokens?, text? })` returns `{ answered: answeredView, session }`.
  - The key, the safety criteria and the progression are the blueprint's.
  - The session completes at a terminal stage (R1).
- **Live AI with a stored case** (`case.live_with_stored`, the student's own) is Scholar's call. Use `resolveOwner` and `runOwnedAi` with `record: caseSessionRecord(sessionId)`, so the session's spend is counted.
- **D-a:** a superseded or retired version keeps working only for a session already on that exact version.
- **D-b:** `loadLibraryCase` returns the full blueprint and is server-only. The static harness K7 refuses any use of it outside HQ and `src/lib/cases`.

## The red lines and what enforces each

| Red line (GO, coordinator) | Database (423, 422, 395) | Application | Proven by |
|---|---|---|---|
| Candidacy needs the student's separate, revocable permission | Offer insert refused without a granted `case_candidacy`. The attestation is copied from the grant | `grantCaseCandidacy` on the current text only | t423 X2, X7; acceptance J1, J2b, J8; harness K8 |
| Only privacy-screened, rights-cleared material enters | `case_identifier_kinds` backstop on an eligible offer and at submission. Ineligible, declined and withdrawn rows hold no content (CHECK) | `screen.ts` is stricter: titled names, addresses, facilities, ages over 89, unbanded ages, source references. No AI verdict is read | t423 X1, X3, X9; screen tests; parity 12/12; K4, K8; J2 |
| Educators never see the student, uploads, histories or transcripts | The queue view has no user and no source key, is security_invoker, and is revoked from anon and authenticated | HQ reads `case_candidate` for id and status only | t423 X10; K1, K2; J3 |
| Budget owner resolved server-side, never from the browser | ownership on the ledger (421) | AI drafting resolves `case.educator_develop` itself. The route reads no owner, budget or cost | K5, K9; A's harnesses |
| Promotion never re-charges the student, and offering costs nothing | no ledger write in 423 | no AI or ledger import in C1 or C4 | K3; J3b, J7c |
| Independent approval, separate publication, exact version | 422 and 395 triggers. Revision drafts keep their parents' authors | `saveDraft` makes every editor an author | t422 W1 to W8; J5, J6 |
| Delivery only of the deliverable | Sessions start only on `case_library_deliverable` | Search and load check it too | t423 X10; K6; J7 |
| Measured is not estimated | | `measuredSpend` reads "not measured" with metering off, and the estimate sits in its own field with its basis | studio tests; J9 |

## Tests and harnesses

- **Vitest:** 978/978 across the repository. In `src/lib/cases`: blueprint 24, screen 4, library and candidates 8, studio and analytics 7.
- **Static:** `case-intelligence-harness.ts` 28/28, which is K1 to K10 plus 18 plants, each going red. It is registered in `ci-harnesses.ts`.
  - Also re-run green: access-doors 39, access-scanner 22, plane-boundary 35, clinical-review 25, ai-fair-use 51, individual-professional 92.
- **Local Postgres 17:**
  - t423 X1 to X11.
  - 6 SQL plants, each red.
  - Rehearsal PRE = F2, F1 = F3. The rollback refuses with data present.
  - Database and application screens agree on the corpus (12/12).
- **Staging, after 422:** clinical-review-acceptance 16/16 and hq-guard 70/70.
- **Staging journey:** `case-intelligence-acceptance-harness.ts`, J1 to J9 and Z1. It is registered in `privileged-harnesses.ts` (UNTRIAGED 0) and runs once 423 has its staging record (below).
- **Build:** `next build` exit 0. All five new routes compile.
- **CI note:** `ci-harnesses` reports 54/56. The two red ones, `pd-screen-doctrine` and `pui-tokens`, fail identically on `main` at 3ed266c5. They predate this work and are not touched by it.

## The gate

CLAUDE.md lifecycle state 3: production may lack 422 and 423 while this is on main.
- Everything that starts case work runs only while the platform flag `case_library` is ON: grant, offer, the studio route and pages, search, load and start. Unwritten is OFF.
- Revoke, withdraw and a student's own offers are never gated.
- Checked by K10.

## The calendar-date question (for the owner)

- The backstop refuses calendar dates, and the application screen also refuses written and two-digit-year dates.
- Relative clinical times pass both layers: day 2 post-op, 3/7, 1/52, at 14:00, Q4H.
- One known false refusal, alike in both layers: space-separated 24-hour times ("0800 1200 1600") read as a telephone number. With commas, they pass.
- See the 423 record.

## Fixed in passing

`reviewQueue` (`src/lib/competency/clinical-review-hq.ts`) read every clinical_content_version as a competency. With 422, a case version has no `competency_id`, so the first submitted case would have made every reviewer's queue unreadable. It now takes competency rows for the competency path and lists cases by 422's own rule: one appointment covering every competency the case teaches.

## Proposed, not published

`case_author` in `scripts/ai-provisional-policy.ts`, for educator AI drafting:
- tier `reasoning`, at least `clinical_educational`, 3000 tokens;
- platform-funded through a platform budget's policy.

Until a platform budget funds it and routing names it, AI drafting is refused with the budget's own message. Nothing was seeded.

## Production dependencies (not authorised)

- Migrations 422 and 423 in production, each under its own GO.
- The legal review of publishing student-derived cases. The attestation text (`case-attest/1`) is a staging draft.
- An appointed, scoped clinical reviewer, a Clinical Case Educator, and a Quality Council Member to publish.
- A platform budget and routing for `case.educator_develop`, if AI drafting is wanted.
- IND-004's Scholar capture and delivery entry points, which are not part of this PR.
