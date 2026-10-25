# COMPETEN-LEARNING-01, Phase 2: build record (S1–S4)

**Contract:**
- the owner GO "Phase 2 — Implementation & Staging" (25 Oct 2026), decisions D1–D8;
- the *Competen Learning Consolidated Product Definition & Architecture* (cited as **PD §n**);
- discovery: `docs/COMPETEN-LEARNING-01-phase1-discovery.md`;
- architecture: `docs/adr/ADR-017-holdings-shared-learning-service.md`.

**Authorised:** development, staging migrations, integration and staging acceptance. **Not authorised:** production deployment, real charging and activation. `learning_app` and `learning_commerce` stay absent in production.

---

## 1. What was built

| Step | What | Where |
|---|---|---|
| S1 | Holdings providers and offerings (Competen, partner, external); versioned `learning-blueprint/1` content (Programme → Course → Module/Session → Activity → Outcome); CFCA mapping per objective with five distinct relations; the no-code Studio editor (lessons with text, images, PDFs and video links; deterministic checks; reflections; library cases; completion rules; certificate; CPD info; access; provenance and rights); external listings; review through the one 395 process (461); independent publication; the listing route that is not clinical endorsement; price proposal and maker-checker approval | `src/lib/learning/{blueprint,policy,studio}.ts`, `src/app/super-admin/learning/**`, `src/app/api/hq/learning/**` |
| S2 | The unified catalogue (search and filter by delivery, level, format, cost, certificate, profession, competency, topic); enrolment (free, entitlement or external); the hosted lesson player with progress and resume; deterministic knowledge checks scored on the server; configurable completion (course completion or assessed knowledge); the one authoritative personal record; certificate records under a separate issuer authorisation, plus public verification; external launch and return; manual external completion with an optional document | `src/lib/learning/{catalogue,record}.ts`, `src/app/individual/(app)/learning/**`, `src/app/api/individual/learning/**`, `src/app/learning/verify/[code]` |
| S3 | Course prices as governed data; free and paid access; the sibling course-entitlement ledger; course checkout on the existing `individual_checkout`, settled by the Holdings engine through its own `lrn-` adapter, idempotent at two levels; the price and terms snapshot; course-only members; HQ course grants (pilot access) | `src/lib/learning/commerce.ts`, `src/app/api/individual/learning/checkout`, `/individual/learning/return`, one dispatch branch in `src/app/api/v1/practice/billing/webhook/flutterwave/route.ts`, `/super-admin/learning/access` |
| S4 | Learning records exposed by reference: CPD lines, competency evidence, need and goal relevance (computed from shared CFCA competencies, nothing stored), Passport items, with platform-recorded, self-declared and source-linked kept distinct | `src/lib/learning/products.ts`. The renderers belong to their owners (§6). |

**Authority (D8, migration 464):**
- New positions:
  - `learning_course_author` (`hq.learning.course.author`);
  - `learning_publisher` (`hq.learning.course.publish`);
  - `learning_price_approver` (`hq.learning.price.approve`);
  - `learning_certificate_issuer` (`hq.learning.certificate.issue`).
- Clinical approval is the existing `hq.quality.clinical.approve`.
- Course grants use the existing `hq.individual.pilot.grant`.
- Nothing is granted to an existing position, and nobody is appointed.

## 2. Migrations 460–464 (state 2: staging-verified, committed byte-identical)

The package is in the shared notes folder `LEARNING-01-460-464/`: the five files, ROLLBACK-460..464, VERIFY-460-464, LOCAL-TEST-460-464, SHA256SUMS and a README.

| # | File | sha256 | Risk |
|---|---|---|---|
| 460 | learning-offering-catalogue | 4a5ba91e…1aec | Low |
| 461 | learning-on-clinical-approval (**after 442**) | 74544e0e…5511 | Medium (shared guards) |
| 462 | learning-record | 83ae6daa…7b62 | Low |
| 463 | learning-course-commerce | 252afd6c…f614 | Medium (widens `individual_checkout`) |
| 464 | learning-capabilities | a0b44736…837e | Low |

- **Staging PASS** (coordinator, 25 Oct): applied ×2, corrected rollback 464→460 to F2 = PRE (buckets excepted), the current files re-applied ×2 to F1 01e0dc07, and VERIFY all as expected. Record: `docs/evidence/LEARNING-01/460-464-staging-record.md`. Never production.
- ⚠ After any rollback, the empty `learning-content` and `learning-evidence` buckets are removed by a person through the Storage API or dashboard. A bucket holding files is never deleted automatically.
- 461 carries 422's and 442's guard branches byte-identical. 442 on main (#108) is identical to the copy used.

## 3. Proof so far

- **Real Postgres 17**, run locally over stubs plus the real 370, 395, 399, 422 and 442 §4:
  - 460–464 applied twice;
  - **63/63** planted-failure assertions pass;
  - rollback returns an **identical schema fingerprint**, re-applying passes, and each rollback refuses once records exist.
- **Bugs caught before staging:**
  - a Postgres regex repetition over 255;
  - a CHECK that passed on NULL;
  - governance actor FKs that would have blocked account deletion;
  - a harness-unparseable seed;
  - sub-unit prices being rounded instead of refused.
- **Repo checks:**
  - `tsc` 0 errors; ESLint clean on every changed file; Vitest `src/lib/learning` **23/23**;
  - `learning-harness` **23/23** (new, in CI); `individual-foundation-harness` **74/74**; `hq-guard-harness` **51/51**;
  - `ci-harnesses` coverage control accounts for all 64 pure/local harnesses.
- **Already red on `origin/main`, unchanged by this work:**
  - `case-intelligence-harness` (P K8/K10);
  - `pd-screen-doctrine-harness` (5);
  - `pui-tokens-harness` (globals.css drift);
  - `professional-profile-harness` (P W3).
- **Staging acceptance:** `learning-acceptance-harness` **ALL GREEN, 22/22** on ezhvpgtcqcdsgylrxgdb, 25 Oct. Afterwards learning_app was back off, no harness account remained, the fixtures were retired and no Learning appointment was active.
- **Not yet run:** the browser walkthrough with the five synthetic identities, and the Flutterwave TEST purchase. Both are owner actions: `docs/evidence/LEARNING-01/staging-acceptance-owner-actions.md`.

## 4. PD §21 acceptance, item by item

| §21 | Where proven | State |
|---|---|---|
| 1 Studio course | acceptance A1, A1b | staging PASS |
| 2 CFCA outcomes | A2; local S1/M1 | local PASS |
| 3 Review and publication | A3a/c; local R0–R2, U1–U2 | local PASS |
| 4 Discovery | A4 | staging PASS |
| 5 Free or paid access enforced | A5b; local E1 | local PASS |
| 6 Verified purchase grants course entitlement | A6a/b; local K1–K4, N1–N3 | local PASS (DB). Real TEST payment pending (§5) |
| 7 Lessons and assessments | A7a/b; unit tests | unit PASS |
| 8 One authoritative record | A8; local E3–E8 | local PASS |
| 9 CPD and evidence in Professional | A9 (by reference) | library PASS on staging pending. **UI hand-off H1** |
| 10 Certificates and Passport | A10; local Z1–Z7 | local PASS. **Passport UI hand-off H2** |
| 11 External listed and opened | B1; local X1–X4 | local PASS |
| 12 External completion and evidence | B2; local E3, E5 | local PASS |
| 13 Not falsely verified | B3; unit "never says verified" | unit PASS |
| 14 Scholar and Enterprise by entitlement | the member-only area serves any member. Enterprise deferred (D4) | Individual and Scholar: built. **Scholar nav link is hand-off H3** |
| 15 History outlives access | A15; local H1–H4 | local PASS |
| 16 AI to the correct budget | X1: Learning makes **no** AI call (465 deferred) | staging PASS |
| 17 No unnecessary AI | stored lessons and deterministic checks only | built |

## 5. Staging steps (coordinator or owner)

1. **Apply 460–464** in order (461 after 442), ×2, run VERIFY-460-464, then the rollback rehearsal. Send the results so the files can be committed.
2. **Library acceptance:**

   ```bash
   npx tsx scripts/privileged-harnesses.ts --staging --only learning-acceptance
   ```

   It turns `learning_app` on for its own run and restores it. It creates and removes seven synthetic accounts and their appointments, and leaves retired `LRN-HARNESS-*` fixtures.
3. **Staging capability assignments (D8).** These are prepared, not made: they need the owner's named staging testers, since no personnel are invented. Five different people, appointed through `/super-admin/users/appointments` (`POST /api/hq/appointments`):
   - Learning Course Author → `learning_course_author`;
   - Clinical Content Reviewer → `clinical_content_reviewer`, with a framework scope covering the ECG competencies (Clinical review governance);
   - Learning Publisher → `learning_publisher`;
   - Learning Price Approver → `learning_price_approver`;
   - Learning Certificate Issuer → `learning_certificate_issuer`.

   For HQ course grants: the existing Individual Product Administrator (`hq.individual.pilot.grant`). The learner is an existing Individual member (HQ invitation, D5).
4. **Switches, staging only:**
   - `learning_app` ON for the walkthrough.
   - `learning_commerce` ON **only** with Flutterwave **TEST** keys set (`FLW_SECRET_KEY` must end `_TEST`), for the purchase step.
   - Both stay absent in production.
5. **Browser walkthrough** (Journey A then B):
   - the author builds "ECG Interpretation" and maps it;
   - the reviewer approves on **Learning Review**;
   - the publisher publishes;
   - the issuer authorises certificates;
   - the author proposes a staging price (illustrative, D7), and the price approver approves it;
   - the learner (course-only member) finds it, pays with a Flutterwave test card or test Mobile Money, and returns (`/individual/learning/return`);
   - access opens only after the webhook settles;
   - the learner completes it, the certificate verifies at `/learning/verify/<code>`, and the record shows in My learning;
   - then the external listing: open, return, record with a document.

## 6. Hand-offs (shared contracts, via the coordinator; not edited here)

**H1. IND-007, Professional.** Read `loadLearningRecords(admin, userId)` from `src/lib/learning/products.ts`. Copy nothing.
- **CPD page:** list `learningCpdLines(refs)` beside the person's own entries, labelled "From Competen Learning", read-only, linking to `/individual/learning/record/<recordId>`.
- **Progress:** count learning hours in CPD hours by year, shown as "of which from Competen Learning".
- **Evidence page:** completed learning with its CFCA competencies and `evidenceLabel`, and certificate links `/individual/learning/certificate/<no>`.
- **Needs and goals:** for a need or goal with mapped competencies (393), show `learningForCompetencies(refs, ids)` ("Learning you completed that serves this"), plus "Find learning" → `/individual/learning?competency=<id>`. Never mark a need met automatically.
- Learning stays optional: Professional keeps every other CPD route (PD §13).

**H2. Passport** (`src/lib/individual/passport.ts`, IND-007 and the foundation owners):
- add a `learning` section from `learningPassportItems(refs)`;
- `EvidenceClass` gains `platform_recorded`, labelled "Recorded by Competen Learning";
- never "verified". Null means unreadable; an empty list means none.

**H3. Foundation, gate-3 surfaces** (ADR-016 owners; no gate change is needed):
- `src/app/individual/(app)/home/page.tsx`: in the no-experience state, when `learningEnabled(admin)`, offer **Competen Learning** (`/individual/learning`) instead of only "no experience is active". A course-only member is a real state (D2).
- `ShellNav`: one foundation link, "Learning" → `/individual/learning`, shown when `learningEnabled`. It is not an experience module.
- Scholar (IND-004): the same link reaches courses. Teach Me, Revise and Apply on course content is a later decision (P2).

**H4. Foundation harness.** No change is required: it stays 74/74. The Learning-specific rules live in the new `scripts/learning-harness.ts`.

**H5. AI files.** None. Learning makes no AI call. 465 (AI authoring) stays deferred.

## 7. Not in this release

- AI-assisted authoring (465).
- Enterprise assignment and funding (D4, P1).
- Discounts, promotions and refunds.
- Partner and referral revenue.
- Attendance, practicals and assessor sign-off as completion rules.
- PDF certificates.
- Scholar reinforcement on course content.
- L7 Learning intelligence and the CKRI link.
- Legal review of the staging terms and certificate wording (`LEARNING_TERMS`, `CERTIFICATE_DISCLAIMER`, both marked staging draft).
