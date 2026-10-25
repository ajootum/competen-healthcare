# COMPETEN-LEARNING-01 — Phase 1: capability discovery and implementation plan

**Status:** DISCOVERY ONLY. No implementation, no migrations, no ADR change, no PR, no deploy (owner: "Proceed with discovery first before development"; "Discovery direction", 25 Oct).
**Contract:** *Competen Learning — Consolidated Product Definition & Architecture* (owner, 25 Oct), cited as **PD §n**. Its §21 17-point acceptance list is the acceptance basis (it supersedes the two-journey summary).
**Base:** `origin/main` 4a983c4d. Paths are repo-relative and migrations are in `supabase/migrations/`. Refs marked ✓ were re-read for this report; the rest come from four read-only discovery passes that opened each cited file.

Classes: **R** built and reusable · **I** built, needs integration · **P** partial · **M** missing.
Priority: **P0** pilot-critical (PD §21) · **P1** soon after the pilot · **P2** deferred.

---

## 1. What the discovery changes about the plan

1. **The estate LMS is thin.** Little of it is worth sharing.
   - `learning_courses` (089 ✓) is a compliance tracker: one `competency_id`, `version_no`, draft/active/retired, `hospital_id` (null means shared). It has no lessons, price, provider or structure.
   - Legacy `courses` (001 ✓) is a flat row. `lessons` (188a ✓) has no FK and **0 code readers**. Lesson content is hard-coded in `src/lib/lessonContent.ts`.
   - `src/app/educator/courses/page.tsx` itself says "Course authoring has no builder yet".
2. **The Holdings pattern to copy already exists: the governed case library.**
   - Global, service-role-only tables. RLS is on, with no policy.
   - Versions are append-only and hashed, with states draft→submitted→published→superseded→retired.
   - Approval comes only from 395. The delivery rule is "published AND approved for this exact version" (`case_library_deliverable()`, 422).
   - Competencies are linked through `case_library_version_competency`. The studio's AI draft is never self-saved (`src/lib/cases/studio.ts` `draftCaseWithAi`).
   - Learning content should be a sibling of this pattern, not an extension of the estate tables.
3. **Course access does not fit the experience ledger.**
   - `individual_entitlement.experience_code` is CHECK-limited to `scholar` and `professional` (370:151-153 ✓), and so is `individual_plan.experience_code` (399:86-88 ✓). Gate 3 reads that ledger.
   - A member with no live experience lands on `no_experience` (`src/lib/individual/access.ts:44-123` ✓). So today a course-only buyer has nowhere to go.
4. **The commercial engine is reusable.**
   - Flutterwave hosted checkout includes UGX mobile money (`src/lib/commerce/gateway.ts` `paymentOptionsFor`).
   - Confirmation has three checks: signature, `verifyTransaction`, and an amount/currency match (`src/lib/commerce/settlement.ts`).
   - Idempotency comes from `unique(provider, provider_event_id)` and a unique `tx_ref` (399).
   - The price is snapshotted onto the checkout (`src/lib/individual/commerce.ts:100-104`).
   - What is missing is an item dimension other than an experience, plus discounts, refunds, price versions and price approval.
5. **No Individual course, enrolment, completion or certificate concept exists.** Nothing anywhere generates a certificate.
   - `individual_professional_cpd` already records unlisted external learning: `activity_type` includes course and workshop, it has a provider, and the attached document gives `evidence_class` = `source_linked` (373:215-250 ✓). It has no verified column by design.

---

## 2. Owner decisions on the two flagged points (options · trade-offs · recommendation)

### 2.1 Sharing Learning capability without breaking ADR-016 D1

ADR-016 D1 says Individual data must never sit in tables that hospital analytics read. Harness 3a enforces this on `cpd_logs`, `course_enrollments`, `learning_enrolments` and four others (`scripts/individual-foundation-harness.ts:155-157` ✓). The owner direction keeps the isolation boundary as the default.

| Option | What it means | Trade-off |
|---|---|---|
| **A.** Individual reads the estate tables directly | Read `learning_courses`/`courses` rows where `hospital_id is null` | **Excluded** by the owner direction. It also reuses almost nothing (see 1.1). |
| **B.** A Holdings service over the published estate rows | A server service serves shared estate courses to Individual. Personal progress goes to new `individual_*` rows. | No organisation row is read by Individual code, but the estate tables would need large schema additions (structure, provider, price, versions). That widens hospital-domain tables that hospital analytics already read, and couples the Learning roadmap to estate code. Little reuse for the cost. |
| **C. (recommended)** Holdings-owned shared content, plus a Holdings personal learning record | New `learning_*` content tables, global and service-role-only like `case_library_*`. They hold no personal data and no `hospital_id`. Individual reads only published, approved versions through a Learning service. The personal record goes in new Holdings record tables keyed by `user_id` that **no estate analytics file reads**. | Leaves D1 and harness 3a unchanged, and follows the proven case-library and 395 pattern. It means new tables, not reuse of estate rows. Enterprise reaches a person's record only through an explicit assignment or funding link (P1). |

**Recommended minimum: option C.** ADR implications, for the owner to rule on (not done here):
- **No ADR-016 edit is needed.** A new ADR (proposed ADR-017, "Holdings shared services") would record three things.
  - Holdings-owned published content may be read by any product through its service.
  - The Holdings learning record is personal data under D1. No estate analytics reads it. Enterprise sees only records created under its own assignment or funding.
  - A gate-3 addition (2.2.4).
- **Harness changes (new checks only):**
  - The estate side never reads `learning_record*`.
  - The Individual side reads `learning_*` content only through the service.

### 2.2 Course entitlement on the existing infrastructure

| Option | Change | Trade-off |
|---|---|---|
| **E1.** Widen the experience ledger | Add `'learning'` to the `experience_code` CHECKs in 370 and 399, plus `offering_id` | Smallest diff, but `experience_code` is load-bearing: gate 3, the view's column order, terms per experience, the D8 adult check (370:185 ✓), the experience registry and the AI product CHECKs. Every reader would have to exclude course rows, or a course buyer could be admitted to an experience. **High blast radius.** |
| **E2. (recommended)** A sibling course-entitlement ledger on the same commercial engine | A new `individual_course_entitlement` (`user_id`, `offering_id`, `offering_version_id` at grant, `price_id`, `source`, `status`, `starts_at`, `ends_at` null = lifetime under terms, `checkout_id`), a DB-clock view `individual_live_course_entitlement`, and a widened `individual_checkout` (below) | Gate 3 and the experience ledger stay untouched. The ledger keeps the same conventions: rows never move, cancel instead of delete, liveness from the DB clock. One small settlement branch. |
| **E3.** A separate Learning checkout | New checkout and event tables | **Excluded.** PD §9 says no separate Learning payment engine. |

How E2 ties to the server-verified, idempotent confirmation:
1. **Checkout.** `individual_checkout` gains `item_kind` (`experience` | `course`) and a nullable `offering_price_id`. `experience_code` and `plan_code` become nullable, with a CHECK requiring exactly one subject. The price, currency, access days and terms version are snapshotted at creation, as `commerce.ts:100-104` already does. The `cin-` tx_ref and the webhook route are unchanged.
2. **Settlement.** `settlement.ts` is unchanged: signature, `verifyTransaction`, amount/currency match, then the claim on `unique(provider, provider_event_id)`. `INDIVIDUAL_SETTLEMENT.onPaid` (`commerce.ts:155-200`) gains one branch: for `item_kind='course'` it appends `individual_course_entitlement` with `source='payment'`.
   - Paid-without-access logging is reused.
   - Access is never granted from the return page. `src/app/individual/billing/return/page.tsx` already decides nothing.
3. **Free access** needs no entitlement row: `access_model='free'` on the offering version admits enrolment. Sponsored, institution-funded and cohort access later become `source` values with a `funding_ref`, the same shape as the AI institution budget (421).
4. **Gate 3** (owner and ADR ruling): a member with a live course entitlement or free enrolment, but no experience, may reach a new member-only `/individual/learning` area. The `[experience]` routes stay experience-gated. Becoming a member stays an HQ invitation while self-registration and "purchase as a way in" are OFF (P1 decision list, `docs/COMPETEN-P1-COMMERCIAL-holdings-foundation.md` §5).

---

## 3. Capability matrix (L1–L7)

§21 = the acceptance point the row serves.

| Pkg | Capability | Existing (ref) | Class | Genuine gap | Proposed action | Pri |
|---|---|---|---|---|---|---|
| L1 | Offering record and types (course, module, workshop, blended, simulation, programme, pathway, external) | `learning_courses.course_type` (089 ✓); `learning_resources.resource_type`, `url` (014); `curricula.programme_type` (016); `simulation_scenarios` (131) | P | All estate, `hospital_id`-scoped, no shared offering model | New `learning_offering` + `learning_offering_version` (case-library pattern); type and format as WCE-configured vocabularies | P0 §21.1, .4, .11 |
| L1 | Hierarchy Programme→Course→Module/Session→Activity→Outcome; a short activity stands alone | `curricula`/`curriculum_modules`/`module_resources` (016) | P | No generic structure; estate lessons unused | Structure as validated jsonb in the version, `learning-blueprint/1` (like `src/lib/cases/blueprint.ts`); programme→course and prerequisites as `learning_offering_relation` | P0 §21.1 |
| L1 | Content owner / delivery provider / certificate issuer / commercial responsibility kept distinct | `individual_professional_cpd.provider` (373); `cmo_certifications.issuer` (114) | M | No provider entity | `learning_provider` + four role FKs on the version (owner, delivery, issuer, commercial); external listings name provider, location, payment and issuer (PD §3C) | P0 §21.11 |
| L1 | Search and filter (profession, specialty, CFCA, topic, level, format, provider, cost, duration, certificate, CPD, location, availability) | `findLibraryCases` by competency/topic/level/profession (`src/lib/cases/library.ts`); `taxonomies`/`taxonomy_terms` (013); `frameworks.profession_term_id`, `competency_layer` (384) | P | No offering search | Service query over published versions using taxonomy terms + CFCA links; the filter set is WCE config | P0 §21.4 (core filters); rest P1 |
| L1 | External listing (secure URL, outcomes, fee, certificate/CPD info, review date, listing status) | `learning_resources.url` (014) | P | No listing governance or review date | The offering version with `delivery='external'`, `external_url` (https-only), `review_due_on`; curator publish (L2 row) | P0 §21.11 |
| L2 | No-code Studio (course, modules, objectives, materials, media, completion rules, delivery modes) | Case studio `src/lib/cases/studio.ts`; HQ studio pages behind `hq.learning.studio.view` (`src/lib/hq/spaces.ts:130` ✓); `src/app/educator/studio/sections.ts` (most "soon") | P | No course builder | HQ Learning Studio pages on the case-studio pattern, writing the version blueprint; media in a new private bucket | P0 §21.1 |
| L2 | Reuse governed questions and cases | `case_library_version` + deliverable rule (422); Scholar questions are personal (372) | I | No content→case reference | The blueprint references `case_library_version.id`, checked deliverable at publish and at delivery | P1 |
| L2 | CFCA mapping per outcome, with relation (introduces / develops / practises / assesses / supports verification) | `case_library_version_competency` (422); `framework_competencies.learning_outcomes` (384); `competency_catalogue_entry` (394); stateless engine `src/lib/competency/mapping.ts` (confidence only) | P | No relation vocabulary anywhere | `learning_offering_version_outcome` (version, competency, outcome key, `relation` CHECK); AI proposals through the mapping engine, decided by the educator | P0 §21.2 |
| L2 | Versions, publication, retirement; history kept | `case_library_version` states + hash (422) | R (pattern) | Not for learning | Copy the state machine on `learning_offering_version`; enrolments pin a version | P0 §21.3, .15 |
| L2 | Review → clinical approval per version, separate from authoring and publication | 395 engine: independence, scope, staleness, 1–5 approvals; `content_kind` competency or case (422:210-216 ✓) | I | No `learning` kind | Add `content_kind='learning'` + `learning_version_id`; replace the guard functions as 422 did | P0 §21.3 |
| L2 | Listing governance for external entries (not clinical endorsement) | — | M | — | Curator publish + periodic review (`review_due_on`); the label never says "endorsed" or "accredited" | P0 §21.11, .13 |
| L2 | Pricing approval separate from content | `hq.individual.commercial.manage` (400; no position holds it); audit only, no maker-checker (`src/lib/individual/plans.ts`) | P | No approval step | `learning_offering_price` with proposer ≠ approver (DB-enforced) | P0 §21.5 |
| L2 | AI-assisted drafting with provenance; never auto-published | `draftCaseWithAi` stamps provenance and never saves itself; provenance/rights on cases (`src/lib/cases/blueprint.ts`) | R (pattern) | No learning workflow | `learning.author_draft` in `ATTRIBUTION` (`src/lib/ai/consumption.ts:28` ✓) as `platform_or_institution`; provenance in the blueprint | P1 (P0 if the owner wants §21.16 shown on authoring) |
| L2 | Copyright / rights on materials | Rights only on cases (423); Scholar material has sha256 and PII attestation only (372) | M | — | Rights + source fields on uploaded learning media, mirroring the case `rights` set | P0 §21.3 |
| L3 | Discover → access/purchase → enrol | Estate enrolment: `learning_enrolments` (089), assignment route `src/app/api/operations/learning-assign/route.ts` (hospital-bound) | M for Individual | D1 bars reuse | `learning_enrolment` (user, offering, pinned version, entitlement ref) via the Learning service | P0 §21.5 |
| L3 | Lessons, progress, resume, completion | Estate: client-set progress %, no lesson position (`src/app/api/learning/my-enrolments/route.ts`) | M for Individual | — | `learning_activity_progress` rows; resume = last incomplete activity; completion computed from the version's rule | P0 §21.7 |
| L3 | External: safe link, provider shown, payment/delivery responsibility, return path, manual completion, certificate upload | Document quartet + private bucket + generated `evidence_class` (373 ✓) | I (pattern) | — | Outbound interstitial (provider, who takes payment); return to the record form; completion = self_declared, or source_linked with an upload | P0 §21.11, .12, .13 |
| L3 | Unlisted external learning still recordable | `individual_professional_cpd` (373:215 ✓) | R | — | Keep as is; Professional remains the home for non-catalogue CPD (PD §13) | done |
| L4 | Configurable completion (lessons, checks, assessments, attendance, practicals, reflection, sign-off) | `pathway_items.completion_method` + `verified_by` (183); estate assessment engine (009, `src/lib/engines/*`), hospital-scoped; no training attendance (`src/app/educator/progress/page.tsx`) | P | No rule engine for learning | Completion rule in the blueprint, evaluated by a pure function. Pilot: required lessons + knowledge check. Attendance, practicals and sign-off later | P0 (lessons + check) §21.7; rest P1 |
| L4 | Assessment / knowledge checks | Scholar Evaluate (426) is **not on main** (IND-004, in development); `question_banks` (022) is estate | P | Holdings evaluation engine not yet landed | Pilot: deterministic questions inside the approved version, scored by a pure function, attempts in the record. Adopt the Scholar evaluation engine once it is merged | P0 §21.7 |
| L4 | Distinct outcomes (attendance, participation, completion, assessed knowledge, verified competence) | `evidence_class` (373); Passport `EvidenceClass` (`src/lib/individual/passport.ts`) | P | No completion-kind vocabulary | `learning_completion.kind` CHECK; "verified competence" is never set by course completion (PD §6) | P0 §21.8, .13 |
| L4 | One authoritative learning record | None. Learning is split across 373 / 372–417; `src/lib/individual/history.ts` stores nothing | M | — | `learning_record` = enrolment + completion + certificate + evidence, Holdings-owned and personal (2.1 C) | P0 §21.8 |
| L4 | Certificates (issuer explicit, approval authority) | `professional_credentials` (016), `cmo_certifications` (114) are estate; no generator; `passport_share_tokens` + `/verify` (122) | M | — | `learning_certificate` (type, issuer provider, number, issued_at, revoked_at); issuance requires an approved certificate rule on the version (`hq.learning.credential.issue`); HTML view + verify. PDF later | P0 §21.10 |
| L4 | No duplicate CPD or evidence; Professional by reference | 373 CPD/evidence have no reference column; `src/lib/individual/professional/progress.ts` computes on read | I | — | **No 373 change.** Professional CPD, evidence and progress also *read* `learning_record` through a Learning loader; one row, two views | P0 §21.9 (IND-007 dependency) |
| L4 | Passport achievement | Passport is a composed view; `own` comes from `loadOwnRecords`; Scholar items opt-in (375) | I | No learning section | `loadLearningRecords` feeds a "Learning" Passport section labelled by completion kind and issuer | P0 §21.10 |
| L5 | Need → Plan → Learning link; recommend from needs | `individual_professional_need`/`goal` (373:109/162 ✓); `individual_professional_competency_map` (393) | I | No goal→offering link | Pilot: "find learning" from a need/goal = catalogue filtered by its competencies (read only). Later: a goal→enrolment reference | P1 (browse and buy need no plan: PD §4) |
| L5 | Completion updates CPD/plan/evidence by reference | see L4 | I | — | see L4; the plan item shows the record when linked | P0 §21.9 |
| L5 | Scholar reinforcement (Teach Me / Revise / Apply on course material) | Scholar flows are keyed to the student's own material via composite FKs (372, 414–417) | P | Course content is not "own material" | Deferred; needs an IND-004 decision on non-owned sources | P2 |
| L5 | Scholar / Enterprise access per entitlement | Scholar = member (370); Enterprise assignment is hospital-scoped (089) | P | No cross-product access to Holdings content | Scholar: same `/individual/learning` area (2.2.4). Enterprise: assignment to staff and cohorts creates a funded entitlement + record visible to that organisation only (PD §15) | P0 Scholar §21.14; Enterprise P1 (owner decision 4.3) |
| L6 | Per-course price, multiple currencies, access days or lifetime | `individual_plan`: one price, `interval_days` 1–366, experience-only (399:68-100 ✓); currency table in `gateway.ts:42-45` | P | No item price; no lifetime term | `learning_offering_price` (offering, currency, amount_minor, access_days null = lifetime under terms, terms_version, status, approval) | P0 §21.5 |
| L6 | Checkout → verified, idempotent confirmation → course entitlement | `startIndividualCheckout`, three-check settlement, unique event + tx_ref (399; `settlement.ts`) | R | Experience-only item | E2 (2.2): widen the checkout; one `onPaid` branch | P0 §21.6 |
| L6 | Mobile Money via the authorised integration | Flutterwave; UGX options include `mobilemoneyuganda` (`gateway.ts`); test mode = `_TEST` keys (`scripts/flutterwave-sandbox.ts:52-53`) | R | The sandbox script drives Practice, not Individual | Staging test purchase with test keys; extend the sandbox script to `cin-` refs | P0 §21.6 |
| L6 | Original price and terms kept | Amount, currency and interval snapshotted (`commerce.ts:100-104`); plans edited in place | P | Plan name and terms not snapshotted; no price versions | Snapshot `price_id` + `terms_version` onto the checkout; prices are append-only rows | P0 |
| L6 | No subscription needed to buy; separate entitlement, one identity | Membership ≠ entitlement (370) | P | Gate 3 has no route for a course-only member | E2 + `/individual/learning` (2.2.4) | P0 §21.15 |
| L6 | Discounts, promotions, refunds, subscription-included, sponsored, institution-funded, cohort | Only Practice patient-billing adjustments (303); promotions page is a placeholder | M | — | Refund = checkout + entitlement status; discount = a price row with a validity window; funded sources with `funding_ref` | P2 (no real charging in the pilot) |
| L6 | Partner / reseller / referral revenue | — | M | — | Separately governed (PD §9); out of pilot | P2 |
| L6 | Real charging stays OFF | `individual_commerce` + `individual_app` flags, absent row = OFF (`commerce.ts:36-46`); no FLW env = 503 | R | — | A new `learning_commerce` flag under both; staging test keys only | P0 |
| L7 | Enrolment, completion, results, revenue, coverage | Scholar intelligence pattern measured / insufficient / not_measured (`src/lib/individual/scholar/intelligence.ts`); case analytics (`src/lib/cases/analytics.ts`); estate loaders are hospital-scoped | P | Nothing reads learning or checkout data | One HQ Learning report loader on the case-analytics pattern (counts from record + checkout) | P1 |
| L7 | Demand, effectiveness, feedback, gaps, CKRI link | No feedback store; CKRI has no code on main (CKRI session, migrations 440–449) | M | — | Deferred; the CKRI link is a contract with that session | P2 |
| X | AI gateway: multi-provider, eligibility, payer attribution | `src/lib/ai/client.ts` (anthropic / openai / gemini); `ai_model_eligibility` (411); owner types individual / platform / institution (421:113 ✓); `runOwnedAi` | I | `AiProduct` and CHECKs are scholar / professional only (411:114 ✓) | Widen the product CHECKs to include `learning`; add workflows to `ATTRIBUTION`; activities are fair-use policy data | P1 (P0 only if §21.16 is shown via authoring) |
| X | Stored content needs no AI calls | The case replay workflow is `none` (`consumption.ts`) | R (pattern) | — | Lessons and questions are stored in the version; delivery makes no AI call | P0 §21.17 |
| X | Separate roles per version (author, review, clinical approval, publish, price approval, credential issue) | Case roles `hq.quality.case.author` / `.publish`, `hq.quality.clinical.approve` (422, 395) | P | No learning capabilities | New capabilities `hq.learning.author`, `.publish`, `.listing.curate`, `.price.approve`, `.credential.issue`, granted to no position (grants = owner GO, as with 400) | P0 §21.1, .3 |
| X | No-code configuration, no hard-coded nursing, Uganda or prices | WCE (076; `src/lib/config/workspace-config.ts`) with `scope_ref` partitions; Individual policy pattern (`src/lib/individual/policy.ts`) | R | Hard-codes exist elsewhere (013 seeds; UGX AI default) | `learning.policy.*` at platform/`learning`: offering types, formats, filters, completion kinds. Prices stay data | P0 |

---

## 4. Genuine owner decisions

1. **ADR route (2.1):** approve option C and a new ADR-017 "Holdings shared services", leaving ADR-016 untouched.
2. **Course entitlement (2.2):** approve E2, a sibling ledger, over E1, and the gate-3 addition: a member-only `/individual/learning` area with no experience required.
3. **§21.14 Enterprise in the pilot:** show it in the pilot (organisation assignment + funded entitlement), or show Scholar only and do Enterprise in P1.
4. **Membership for course buyers:** HQ invitation only while self-registration and "purchase as a way in" are OFF (the P1 commercial decisions stay open).
5. **Certificate issuer and wording:** Competen Holdings as issuer of Competen-course certificates; which outcome kinds the pilot certificate may state (recommended: "course completion" and "assessed knowledge" only).
6. **Pilot price row:** the ECG price stays a staging data row (UGX 20,000–30,000 illustrative, not approved), entered through price approval, never in code.
7. **Capability holders:** which positions get the new learning capabilities on staging (author, clinical reviewer, publisher, price approver, issuer must be distinct people).
8. **Operating entity:** course entitlements carry `operating_entity = competen_holdings` (370 CHECK), since Learning is a Holdings service.

---

## 5. Migrations needed (named, not written)

Proposed number claim: **460–469**. CKRI holds 440–449 and Professional Stage 1 holds 450–459 (shared-notes claims); 437–439 are left for IND-004/IND-007.

| # | Name | Content |
|---|---|---|
| 460 | `learning-offering-catalogue` | `learning_provider`, `learning_offering`, `learning_offering_version` (blueprint jsonb, state, hash, delivery, `external_url`, `review_due_on`, four responsibility FKs), `learning_offering_relation`, `learning_offering_version_outcome` (relation CHECK) |
| 461 | `learning-on-clinical-approval` | 395 `content_kind` + `'learning'`, `learning_version_id`, guard replacement; `learning_offering_deliverable()` |
| 462 | `learning-record` | `learning_enrolment`, `learning_activity_progress`, `learning_completion` (kind, evidence_class), `learning_certificate`, `learning_evidence` (document quartet) + private bucket |
| 463 | `learning-course-commerce` | `learning_offering_price` (proposer ≠ approver), `individual_checkout` widened (item_kind, `offering_price_id`, exactly-one CHECK, terms snapshot), `individual_course_entitlement` + `individual_live_course_entitlement` view |
| 464 | `learning-capabilities` | The five `hq.learning.*` capabilities, no grants |
| 465 | `ai-learning-product` | Widen the product CHECKs in 411 and 421 to include `learning` (P1 unless AI authoring is in the pilot) |

Flags are rows, not migrations: `learning_app` and `learning_commerce`, absent = OFF. WCE `learning.policy.*` is data.

---

## 6. Minimum implementation sequence

1. **S0 (decisions).** Section 4, items 1, 2 and 5. Every later step depends on them.
2. **S1 (catalogue and studio).**
   - Migrations 460, 461 and 464.
   - Learning service: a read API for published and approved content.
   - HQ Studio: blueprint editor, outcome mapping, submit → 395 review → publish.
   - External listing form plus curator publish.
   - Covers §21.1–4 and §21.11.
3. **S2 (record and delivery).**
   - Migration 462.
   - `/individual/learning`: catalogue, enrol (free), lessons, progress, resume, knowledge check, completion.
   - External interstitial, return path and record form.
   - Certificate record and view.
   - Covers §21.7, .8, .10, .12, .13 and .17.
4. **S3 (commercial).**
   - Migration 463.
   - Price proposal and approval; checkout widening; the `onPaid` branch.
   - Staging test purchase (UGX, Flutterwave test keys).
   - Covers §21.5, .6 and .15.
5. **S4 (Professional and Passport by reference).**
   - The `loadLearningRecords` loader.
   - IND-007 renders it in CPD, evidence and progress; the Passport gets a Learning section.
   - Covers §21.9, .10 and .14 (Scholar).
6. **S5 (P1).** AI authoring (465), the Enterprise assignment and funding link, the L7 report loader.

**Parallel work.** S1 and the S3 price/approval schema can be built side by side once S0 is decided. S2 needs S1's content tables. S3's settlement branch needs S2's enrolment. S4 needs S2. The external-listing slice (S1/S2 subset) is independent of commerce and can ship first.

---

## 7. Dependencies on other workstreams (shared contracts; not edited here)

- **IND-007 (Professional MVP):**
  - S4 needs Professional CPD, evidence, progress and Passport to read `loadLearningRecords`.
  - A new Passport label (for example, "Course completion, issued by Competen Holdings") needs agreement, and must never say "verified".
  - The 373 tables are unchanged.
- **Professional Stage 1 (450–459):** read-only use of the profile's profession for filters.
- **IND-004 (Scholar Stages 7–8):** the Evaluate engine (426), not yet on main, is the intended assessment engine. The pilot uses a minimal pure scorer until then. Scholar reinforcement on course content is a later IND-004 decision.
- **Holdings AI gateway:** the `ATTRIBUTION` additions and the product-CHECK widening (465) touch shared AI files.
- **Foundation harness and ADR-016 owners:** the gate-3 addition and the new harness checks.
- **CKRI (440–449):** a future L7 link only. No dependency for the pilot.

---

## 8. Pilot-critical vs deferred

- **Pilot (P0):**
  - One ECG course authored, mapped, approved and published, then delivered.
  - Free and test-paid access; course entitlement; the record; the certificate record.
  - One external listing with return and self-declared or source-linked completion.
  - Professional and Passport reading by reference; Scholar access.
  - No AI at delivery.
- **Deferred:**
  - P1: AI authoring, Enterprise assignment and funding, the L7 report, course-to-case reuse, need/goal recommendations.
  - P2: discounts, promotions, refunds, partner revenue, attendance, practicals and sign-off, PDF certificates, Scholar reinforcement, demand and feedback analytics, the CKRI link, LTI/xAPI.
