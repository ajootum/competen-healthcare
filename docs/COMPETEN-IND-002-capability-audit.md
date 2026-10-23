# COMPETEN-IND-002 — Individual capability audit and foundation

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Status** | Discovery and recommendations. **Not a build authorisation.** Nothing here is implemented, migrated or deployed. |
| **Branch** | `ind-002/capability-audit` (cut from `origin/main` @ `07d750ce`) |
| **Adopted direction** | COMPETEN-IND-001 Option B: Competen Individual is one product with two experiences, Scholar and Professional. They share one identity, one personal AI, one learning history and one Competen Passport. |
| **Method** | Code, migrations, routes, harnesses and specs were read or grepped on this branch. No live database was queried. "Operational" means the code path exists and runs; it does not mean the migration has been confirmed as applied in production. |
| **Inputs not in this repo** | COMP-IND-UX-001, COMP-ID-ROUTE-001 and PLAT-ROUTE-001 are cited by code but absent from `docs/`. COMPETEN-IND-001 and COMPETEN-WEB-IND-001 are not yet committed on `web-ind-001/individual-redesign`; its tip equals `main`. Their content is taken from the brief only. |

---

## 1. Capability inventory

Classes: **Operational**, **Partial**, **Specified-only**, **Missing**, **Reusable** (usable by a lone person, or as a pattern, without redesign).

The scope column records the property that decides reuse:
- *person*: keyed on `profiles.id`.
- *global*: no tenant column.
- *hospital*: keyed on `hospital_id`, often `NOT NULL`.
- *workspace*: keyed on a Practice `workspace_id`.
- *tenant*: keyed on `tenant_id`.

### 1.1 Identity, entitlement, routing

| Capability | Class | Scope | Evidence |
|---|---|---|---|
| One central identity (GoTrue + `profiles`) | Operational | person | `on_auth_user_created` trigger. `profiles.role` is nullable (mig 279 §2, ADR-001). |
| Product gate pattern: explicit per-person membership, three-state guard | Operational, **reusable** | person | `platform_membership` (mig 279, unique `user_id`, `source`, read-own RLS) with `admitToEstate` (`src/lib/platform-membership.ts:171`). `enterprise_membership` (mig 286, unique `(user_id, tenant_id)`). |
| Neutral sign-in product resolution and chooser | Operational, **reusable** | person | `src/lib/identity/product-resolution.ts:31-110`. `code` is typed `"platform" \| "practice"` only. The header (l.23-29) defines how a new product joins: one read and one code. |
| **Per-person commercial entitlement** | **Missing** | — | Every entitlement store is workspace- or tenant-keyed: `practice_entitlement` (mig 191 l.138, `workspace_id`), `tenant_product_licenses` (mig 106), `plat_subscriptions` (mig 042). `orchestration/licensing.ts:15-43` is tenant-only and fails open. |
| Individual product identity | Specified-only | — | Gateway `GATEWAYS.individual` (`src/lib/identity/domains.ts`), door `INDIVIDUAL` `being_built` (`src/lib/access-doors.ts`), governance line `plat_product_line.individual` (mig 281 l.39, frozen). None of them is an entitlement. |
| Individual sign-in / app shell | Missing | — | `/individual/sign-in` is a coming-soon page with no credential field. `/individual` is a marketing page (`GATEWAY_CTA_MODE="talk_to_us"`). `/login` sends `?next=/individual` to My Competen (`src/app/login/page.tsx` `BUILDING` map). |
| Experience concept (Scholar / Professional), primary experience, switching, graduation | Missing | — | No `scholar`, `primary_experience` or graduation concept in `src/`, `scripts/` or migrations. The only switcher is the estate-role cookie (`src/app/api/auth/switch-role/route.ts`). PW-014 `resolveExperience` is reserved and unbuilt. |
| Self-serve provisioning pattern (flag ladder, idempotency, legal versions, `role:null`) | Operational, **reusable** | workspace | `src/app/api/v1/practice/signup/route.ts`, `.../provisioning/individual/route.ts` (CPR-IAM-001 s8, CPR-PROV-001). In Practice, "individual" means a *solo practitioner*, which is a naming collision. |
| My Competen (`/my` → `/dashboard`) | Operational, **estate-gated** | person + hospital | `src/app/dashboard/layout.tsx:55` redirects anyone `admitToEstate` refuses. An Individual-only person cannot enter. |

### 1.2 Passport, evidence, credentials

| Capability | Class | Scope | Evidence |
|---|---|---|---|
| Passport 2.0 view and print | Operational, **reusable** (composition) | person, reads hospital-issued rows | `src/app/dashboard/passport/page.tsx` (814 lines). It reads `competency_decisions`, `cpd_logs`, `professional_credentials`, `professional_recognitions`, `clinical_authorizations` and `employment_records`. |
| Public verification link | Operational, **reusable** | person | `passport_share_tokens` (mig 122: expiry, scope, revoke, view count), `src/app/api/passport/share/route.ts` (owner-only, audited) and `src/app/verify/[token]/page.tsx` (with framework-currency caveat, mig 126/129). It is HTML only, unsigned, link-bearer access, and has no per-recipient grant. |
| Employer provenance on decisions; employment history kept after exit | Operational | person | Mig 027 (`employment_records`, decision `hospital_id`/`organisation_id` stamp). Decision history and immutability: mig 182, `scripts/decision-immutability-harness.ts`. |
| Credentials and registration | Partial | person, hospital-verified | `professional_credentials` (mig 016). Self-submit is open. Verification needs hospital staff in scope (`inScope`, `src/lib/api-auth.ts:136-139`, which requires both hospitals non-null and equal). No regulator lookup. |
| Person-owned professional record with a provenance vocabulary | Operational, **reusable as pattern** | person (Practice namespace) | Mig 217/218/270/273, `src/lib/practice/portfolio.ts` (`buildProfessionalRecord`, `exportProfessionalRecord`). It labels each fact `source_linked` / `self_declared` / `operator_checked` and never says "verified". |
| Tamper-evident / W3C VC / Open Badges / custodian | Missing | — | Called for by STRATEGY-001 §4.4; nothing in code. |

### 1.3 Learning, assessment, clinical reasoning

| Capability | Class | Scope | Evidence |
|---|---|---|---|
| Courses | Operational (thin) | global / hospital | Legacy `courses` + `course_enrollments` (mig 001; content hard-coded in `src/lib/lessonContent.ts`). `learning_courses`/`learning_enrolments` (mig 089, enrolment `hospital_id NOT NULL`). |
| Question banks, practice quizzes, graded tests | Operational, **reusable** | global banks, person attempts | `questions`/`quiz_attempts` (mig 001), `question_banks`/`knowledge_attempts` (mig 022), `src/app/dashboard/questions`, `src/app/dashboard/tests/[bankId]`. Authoring is staff-only. |
| Adaptive test | Partial | person | `cst_adaptive_exams` (mig 136), `cdp_adaptive_sessions` (mig 146), `src/lib/delivery/adaptive.ts` (lightweight CAT). |
| Spaced repetition (SM-2) | Operational, **reusable engine** | person, cards hospital-seeded | `cdp_reinforcement_cards` (mig 143, nullable `hospital_id`), `src/lib/delivery/reinforcement.ts`. Cards are generated from competency decisions only. |
| **AI-generated questions** | **Missing** | — | No caller of `generate()` authors questions. |
| **Learner upload → understand** (ingest, extract, chunk, explain) | **Missing** | — | No learner upload-for-study flow. The only text extractor is DOCX (`src/lib/import/docx-text.ts`, mammoth) for the staff CPU importer. There is no PDF library in `package.json`. |
| Clinical cases | Operational (read-only) | global | `clinical_cases` (mig 026): `status` draft/active/retired and `source_ref`, **no clinical-reviewer sign-off field**. Static reading in `src/app/dashboard/knowledge/case/[caseId]`. |
| OSCE (institutional) | Operational | hospital (nullable) | `osce_*` (mig 033), `/api/osce/*`, `src/app/assessor/osce`. |
| OSCE prep (learner) | Partial | none | `src/app/dashboard/osce/page.tsx` is a client component with hard-coded stations. It persists nothing. |
| AI simulation | Partial | person | `src/lib/simulation-briefs.ts` (7 static briefs), `cdp_sim_sessions` (mig 147). |
| Competency frameworks | Operational, **reusable** | global when `hospital_id` null | Mig 003/004/011/123-130. |
| Competency assessment and sign-off | Operational, **hospital-bound** | hospital | `competency_cycles` (mig 009 `hospital_id NOT NULL`), `src/lib/engines/decisions.ts`, assessor/educator consoles. There is no sign-off path for a person without a hospital. Roster capture is still missing (ROADMAP-001 §3). |
| Audio (TTS, transcription) | Missing | — | Only browser dictation (`src/components/practice/Dictation.tsx`) and audio evidence upload. |

### 1.4 Personal AI and knowledge

| Capability | Class | Scope | Evidence |
|---|---|---|---|
| Provider-neutral generation gateway with usage and cost log | Operational, **reusable** | person (`actor_id`) | `src/lib/ai/client.ts:179` `generate()`, `src/lib/ai/config.ts`, `src/lib/ai/gateway.ts` → `plat_ai_requests` (mig 055). |
| Rate limit | Partial | person | `src/lib/ai/quota.ts`: 30 calls/hour, counted from `audit_log`, fails open. No cost cap. |
| Own-record-grounded advisory AI | Operational, **reusable pattern** | person | `src/app/api/me/copilot/route.ts`, `src/app/api/ai/coach/route.ts`. |
| Grounding and provenance guardrails | Operational, **reusable pattern** | workspace | `src/lib/practice/ai-assistant.ts:14-27` (record-only, opt-in switch, mig 215), `verifyGrounded` (`src/lib/practice/document-phrasing.ts:129`), phrasing provenance (mig 356). |
| Conversation memory | Partial | workspace | `practice_ai_session`/`practice_ai_message` (mig 215). Stored but not replayed. |
| **Longitudinal learner context / personal AI memory** | **Missing** | — | Nothing assembles a person's history for an LLM across sessions. |
| Retrieval (FTS + vectors) | Partial, dormant | hospital / global | `knowledge_embeddings vector(1536)` (mig 017), `src/lib/ai/embed.ts` (dormant without an embedding key), `src/lib/search/hybrid.ts` (`match_assets` needs `p_hospital`, mig 186). No per-person corpus. |

### 1.5 Commercial, comms, governance

| Capability | Class | Scope | Evidence |
|---|---|---|---|
| Payments (Flutterwave, mobile money channel, three-check settlement) | Operational, **reusable logic** | workspace | `src/lib/practice/subscription-gateway.ts`, the checkout/webhook routes, mig 349/367-369, ADR-015 ledger precedence. Production `FLW_*` keys were unset per mig 369. |
| Consumer (person) billing | Missing | — | `src/app/dashboard/billing/page.tsx` states that no store backs it. |
| In-app notifications, email (Resend) | Operational, **reusable** | person | `src/lib/notify.ts`, `src/lib/notifications/framework.ts` (mig 161), `src/lib/notifications/dispatch.ts`. |
| SMS / WhatsApp | Operational | workspace, patient-facing | `src/lib/practice/messaging.ts`, mig 350. |
| Push | Missing | — | `public/sw.js` is an offline cache only. |
| Activation and funnel telemetry pattern | Operational, **reusable pattern** | workspace | Mig 283 `practice_activation_event`, mig 366. |
| Audit trails; append-only with cascade allowance | Operational, **reusable** | — | `audit_log` (mig 040), `src/lib/practice/audit.ts`, ADR-006 pattern. |
| Consent register / person data export and erasure | Missing | — | Only per-feature consents exist (mig 215, 224/350/361, 122). `src/app/api/account/*` covers avatar, password and profile only. |
| Landlord-plane boundary | Operational | — | `src/lib/access/plane-boundary.ts` + `scripts/plane-boundary-harness.ts` (AST allowlist of table and column pairs readable from `super-admin/**` and `api/platform/**`). It currently names only `practice_*`. Any `individual_*` read from HQ must be added there with a reason. |
| Recruitment | Missing | — | Door is `being_built`; no tables. |

---

## 2. Architecture assessment

**2.1 The frozen architecture already has the slot Individual needs.**
- PSA-001 §7, §21-22, §39-40 require an explicit, product-specific membership and provisioning event. Identity grants nothing.
- `product-resolution.ts` names the join point.
- `access-doors.ts`, `domains.ts` and `plat_product_line` already carry `individual`.

Individual therefore needs no change to identity, routing doctrine, `profiles.role`, `platform_membership` or governance lines. It needs a third gate built the way gates 1 and 2 were.

**2.2 Material finding 1: the learner layer exists but sits behind the wrong gate.**
- `/dashboard` already holds most of the personal learning and professional surface:
  - copilot, questions, tests, adaptive tests, reinforcement, simulation and OSCE prep;
  - CPD, career, logbook, certificates and Passport.
- It is admitted on `platform_membership` and assumes `profiles.hospital_id`.
- PSA-001 §40 forbids granting Platform membership to an Individual user, so Individual cannot simply be pointed at `/dashboard`.

The right move is a separate Individual shell that **composes the existing engines and components with person-scoped reads**, not a rebuild and not a widening of the estate gate.

**2.3 Material finding 2 (escalated): writing personal study into estate tables would disclose it to employers.**
- Institutional analytics find a hospital's staff via `profiles.hospital_id` and read **all** of their person-keyed rows with no origin filter:
  - `src/lib/learning-analytics.ts:72-86` (`quiz_attempts`, `course_enrollments`, `competency_scores`);
  - `src/lib/assessment-analytics.ts:72`;
  - `src/lib/operations/pd-cpd.ts:17-28` (`cpd_logs`);
  - at least 15 further readers (grep `quiz_attempts|knowledge_attempts|cpd_logs` in `src/lib`, `src/app/educator`).
- If Scholar or Professional wrote a person's private study, AI use or CPD into those tables, the person's next employer's educators and unit managers would see it the day `profiles.hospital_id` is set.
- That violates individual consent and professional confidentiality.

The rule should be unrepresentable rather than filtered by every reader. **Individual-originated records live in `individual_*` tables that no institutional reader queries.** Disclosure outward happens only through a consented share. See D1.

**2.4 Information-flow direction.**
- **Institution → person: permitted, read-only.** A person may see records an institution issued about them. Passport 2.0 already does this.
- **Person → institution: only by explicit, per-recipient consent.** There is no automatic flow.

**2.5 Scope fit of reusable engines.**
- Reusable as **code** with a personal store:
  - `generate()` with logging and quota;
  - the SM-2 engine (`delivery/reinforcement.ts`);
  - adaptive delivery;
  - the provenance vocabulary from mig 270;
  - `verifyGrounded`;
  - the Flutterwave settlement logic;
  - notifications;
  - the three-state membership guard.
- Reusable as **read-only data**:
  - global question banks;
  - shared frameworks (`hospital_id` null);
  - `clinical_cases` (once a clinical-review record exists, see §3.3);
  - institution-issued `competency_decisions`, `employment_records` and verified `professional_credentials` (shown to their subject only).
- **Not reusable:** anything hospital-bound for *verification*: `competency_cycles`, `inScope`, the educator and assessor consoles. Independent verification of Individual evidence is a later capability (§4.3), not an MVP rebuild.

**2.6 Two operating entities.** Scholar is run by a subsidiary and Professional by Holdings, over a shared identity, AI context, history and Passport. That makes controller and processor allocation a schema concern, not just a legal one. Each experience entitlement must record its operating entity and the terms and privacy versions the person accepted with that entity. The Practice signup route records `LEGAL_VERSIONS` server-side and is the pattern to follow. See D2.

**2.7 Defects found in passing.** These are out of scope and listed as follow-ups, not fixed:
- `/api/copilot` calls Anthropic directly with a hard-coded model. It has no quota, no `plat_ai_requests` row and no audit, and the client supplies the whole message history (`src/app/api/copilot/route.ts`).
- The Practice assistant logs `tenantId: ctx.workspaceId` (`src/lib/practice/ai-assistant.ts:626`) into `plat_ai_requests.tenant_id`, which has a foreign key to `tenants(id)` (mig 055 l.14). The insert's error is swallowed (`gateway.ts:51`), so Practice AI usage rows are probably being dropped. This was not verified against the database.

---

## 3. Scholar MVP

### 3.1 Vision vs. code

| Stage | What exists | Gap for Scholar |
|---|---|---|
| **Upload** | Owner-keyed `evidence` bucket and route (mig 336, `src/app/api/evidence/route.ts`). | A private study-material store, PDF and DOCX extraction, page-referenced chunks. |
| **Understand** | `generate()`, `verifyGrounded`, record-only prompt rules. | Explanations grounded in the person's own sources, with citations to page and chunk. |
| **Revise** | SM-2 engine (person). | Cards generated from the person's material, not only from hospital decisions. |
| **Apply** | Static `clinical_cases`, AI simulation briefs. | Case practice tied to the uploaded topic (post-MVP). |
| **Assess** | Banks, quizzes, adaptive test. | **AI-generated questions** from the person's material, stored with source references. |
| **Improve** | Attempt history, `/api/ai/coach` pattern. | A longitudinal personal learning record and a weak-area loop. |
| Audio | None | TTS of explanations (post-MVP). |
| OSCE prep | Hard-coded checklist page | Persisted practice, using the `osce_stations` content model (post-MVP). |

### 3.2 Smallest viable end-to-end Scholar release (S-MVP)

One loop, working end to end, for a pilot cohort provisioned by HQ:

1. **Enter.** An HQ pilot-provisioned account holds an Individual membership and a Scholar entitlement. The Scholar home loads from the `/individual` door (WP1).
2. **Upload** a PDF or DOCX (size-capped) to a private personal bucket. Extract text, then store page-referenced chunks in `individual_material` and `individual_material_chunk`.
3. **Understand.** "Explain this section." The AI answers only from the person's chunks, with citations. Chunks are retrieved by Postgres FTS, so no embedding key is needed. `verifyGrounded`-style checking runs on the output, and the answer carries an "AI-generated from your notes, not clinically reviewed" label. Every call goes through `generate()` with logging and quota.
4. **Assess.** Generate N multiple-choice questions from a chunk. Each stores its source chunk and model. The person attempts them; attempts go to `individual_attempt`.
5. **Revise.** Missed items become SM-2 cards, using the existing engine logic over an `individual_review_card` store.
6. **Improve.** A progress page shows per-material mastery, cards due and the trend. The record is labelled *self-directed study*, and none of it is "verified".

**Out of S-MVP:** audio, OSCE prep, clinical cases, adaptive tests, payments (pilot runs free under an entitlement with `source='pilot'`), contribution to shared knowledge, and public signup.

### 3.3 Governed knowledge ecosystem

| Concern | Today | Requirement |
|---|---|---|
| Content provenance | `clinical_cases.source_ref`, mig 356 phrasing provenance | Every AI artefact stores its source chunk ids, model and prompt version. Prompts are inline strings today, so a prompt version constant is needed. |
| Clinical review | `clinical_cases.status` only. No reviewer, date or sign-off. Content QA is a completeness linter (`src/lib/studio/content-qa.ts`). | Before shared clinical content (cases, banks) is served to Scholar, it needs a review record: reviewer, date and scope. Uploaded personal material is never presented as reviewed. |
| Privacy | Service role with app guards. No person export or erasure. | Personal material is private to its owner and erasable by them. The HQ plane reads counts only, through `plane-boundary.ts` entries. Uploads must not hold patient-identifiable data, so this needs a notice and a check. |
| Consent | Per-feature consent switches (mig 215 pattern) | Separate, revocable consents for AI processing of uploads, AI memory, and any contribution. |
| Contributions from personal-AI interactions | None | **Defer.** If later wanted: opt-in, de-identified, entering a clinical-review queue before any shared use. Never automatic. |

---

## 4. Professional MVP

### 4.1 Minimum viable Professional (P-MVP)

Entry is direct (no Scholar needed). It provides:

1. **Professional profile.** Profession, registration body and number, country. Stored in an Individual-owned record that uses mig 270's provenance vocabulary.
2. **Credentials and registration** with expiry. They are self-declared, optionally with an attached document (`source_linked`). Renewal reminders reuse `notify()` and email dispatch.
3. **CPD log** in `individual_cpd_entry`, with the same fields as `cpd_logs`, invisible to employers. Hours by year are shown, with no invented targets (see the `dashboard/cpd` header rule).
4. **Passport.** A composed view of two classes:
   - (a) the person's own records, labelled by provenance;
   - (b) institution-issued records about them, read-only and labelled by issuer: `competency_decisions` with the org stamp, `employment_records`, staff-verified `professional_credentials`.

   It reuses Passport 2.0 composition.
5. **Share.** A revocable link, reusing `passport_share_tokens` and `/verify`. The verify page states each item's evidence class.
6. **Personal AI.** CPD planning and reflection drafting, grounded on the person's own record. It reuses the `/api/me/copilot` pattern and is advisory.
7. **Export** of the person's record (pattern: `exportProfessionalRecord`).

### 4.2 Evidence classes (must be visible everywhere evidence appears)

| Class | Source | Example |
|---|---|---|
| `self_declared` | The person | A CPD entry or licence number with no document |
| `source_linked` | The person, with an attached artefact | A certificate PDF |
| `institution_issued` | An organisation's governed record | A `competency_decisions` row stamped with hospital/org; `employment_records` |
| `independently_verified` | A checker with authority: an operator check (mig 273 pattern), a regulator lookup, a witnessed OSCE | Licence confirmed against a register |

Individual creates only the first two. It displays the third. The fourth is a later governed capability (STRATEGY-001 §4.3-4.4).

### 4.3 Longer-term development

In order:
1. Registration-cycle-aware CPD.
2. Development plan and career target (the `dashboard/career` engine exists; no plan store).
3. Independent verification: an operator check queue, then regulator integrations.
4. Witnessed OSCE through accredited centres.
5. Signed or Open Badges 3.0 / W3C VC export with revocation and custodian arrangement.
6. Consented per-recipient disclosure to Enterprise and Recruitment (§6, WP9).

---

## 5. Lifecycle

### 5.1 Foundation model (recommended)

| Layer | Record | Notes |
|---|---|---|
| Identity | `profiles` (unchanged) | No role write. `profiles.role` stays null for Individual-only people (ADR-001). |
| Product membership | `individual_membership`: one row per person; `status`, `source` (`pilot` / `signup` / `hq_grant`), grant and revoke audit, `primary_experience` (nullable) | Mirrors `platform_membership` (mig 279). Created only by an explicit Individual provisioning event (PSA-001 §40). Never creates `platform_membership`. |
| Experience entitlement | `individual_entitlement`: `(user_id, experience_code ∈ {scholar, professional})`; `status`, `starts_at`, `ends_at`; `source` NOT NULL with no default (`pilot` / `signup` / `payment` / `graduation` / `hq_grant`); `operating_entity`; `terms_version`, `privacy_version` | An append-style ledger following ADR-015 and mig 368. Two rows may be live together. Codes are namespaced inside this table to avoid collision with `plat_plans.code='professional'` (mig 042) and Practice's `request_type='individual'`. |
| Shared personal record | `individual_*` learning, attempt, card, material, CPD, credential and AI-conversation tables, keyed on `user_id`, each carrying `experience_code` of origin | Belongs to the person, not to an experience, so it survives any entitlement change. |

### 5.2 Behaviours

- **Resolution.** `resolveProductDestinations` gains one read and `code: "individual"`. Inside the Individual shell, the landing is chosen in this order:
  1. `primary_experience`, if it is still entitled;
  2. otherwise the single live experience;
  3. otherwise a chooser among live experiences;
  4. otherwise a no-entitlement state that offers activation.

  Every request re-checks, and an unreadable store fails closed (ADR-015 "unreadable is not permission").
- **Switching.** A switcher in the Individual shell lists live experiences only. Switching changes navigation, theme and AI persona, never data scope. The primary experience is a user preference, editable in settings.
- **Direct Professional.** Membership plus a Professional entitlement. No Scholar row is needed.
- **Guided graduation.** A Scholar-side flow, prompted by the person or by course completion:
  1. confirm profession and country;
  2. accept Professional's operating-entity terms;
  3. insert a Professional entitlement with `source='graduation'`;
  4. offer to set `primary_experience='professional'`;
  5. write an audit event.

  Nothing moves: same `user_id`, same history, same Passport. What happens to the Scholar entitlement is D4.
- **Return to Scholar.** Insert a new Scholar entitlement row (postgraduate). Both experiences are live.
- **AI continuity.** There is one conversation store and one context assembler over the person's `individual_*` records. The experience selects the persona, system prompt and tool scope. AI memory sits behind a revocable consent, and the person can view and delete it.
- **Passport continuity.** The Passport is a foundation view over the person. Both experiences contribute; neither owns it.

---

## 6. Development roadmap

### 6.1 Work packages (priority order)

| WP | Name | Content | Depends on |
|---|---|---|---|
| **WP0** | Decisions and contract | Owner rulings on §7. A short Individual foundation spec plus ADR-016 (third product gate, data boundary, evidence classes). | — |
| **WP1** | Individual gate and shell | Migration draft (membership and entitlement ledger), owner-applied. Resolver read. Door `being_built` → `flag_gated`. `/individual` authenticated shell with three-state guard and experience switcher. HQ pilot provisioning (pattern: `practice_pilot_provisioning`). Harness: grants no `platform_membership`, writes no `profiles.role`, entitled-only routing, unreadable fails closed. Plant each violation and watch it go red. | WP0 |
| **WP2** | Personal record and Passport composition | `individual_*` record tables, evidence-class vocabulary, Passport view composing personal and issued records, `/verify` labels. `plane-boundary.ts` entries if HQ reads counts. | WP1 |
| **WP3** | Personal AI foundation | Conversation store, context assembler, consent switches, every call through `generate()` with quota, per-experience personas, prompt version constants. | WP1 |
| **WP4** | Scholar loop (S-MVP) | Material store and extraction (adds a PDF dependency), chunks with FTS, grounded explain, question generation, attempts, SM-2 cards, progress. | WP2, WP3 |
| **WP5** | Professional core (P-MVP) | Profile, credentials, CPD, reminders, share, AI CPD assistant, export. | WP2, WP3 |
| **WP6** | Graduation and return | Graduation flow, entitlement events, primary-experience handover, audit. | WP4 or WP5 shells |
| WP7 | Consumer billing | Per-person checkout over the reused Flutterwave logic. Merchant per operating entity. Entitlement `source='payment'`. | WP1, D2 |
| WP8 | Scholar depth | Audio (TTS), persisted OSCE prep, reviewed clinical cases, adaptive tests. | WP4, clinical-review record |
| WP9 | Consented cross-product disclosure | Per-recipient grant (extend the `passport_share_tokens` concept) to an Enterprise tenant, a Practice workspace or future Recruitment. Receipts and revocation. | WP2 |
| WP10 | Governed contributions and verification | Opt-in contribution queue, clinical review, independent verification, signed credentials. | WP8, WP9, governance entity |

### 6.2 Safe parallelism

- WP1 is serial and first: it owns the only shared schema and the resolver.
- Once the WP1 migration is confirmed applied:
  - WP2 and WP3 can run in parallel. Their tables and files are disjoint: records vs AI.
  - Then WP4 (`src/app/individual/scholar/**`, `src/lib/individual/scholar/**`) and WP5 (`.../professional/**`) can run in parallel. Each needs its own migration file, numbered and applied in sequence by the owner.
- Independent of all of the above, and runnable now as separate small changes: the two §2.7 defect fixes, and adding a clinical-review record for shared content.
- **Must not** run in parallel with WP1: any change to `product-resolution.ts`, `access-doors.ts`, `login/page.tsx` or the website branch's Individual pages. The website workstream must keep `/individual/sign-in` as its only sign-in link until WP1 flips the door.

---

## 7. Owner decisions

Each of these is a genuine choice that this audit cannot settle from code or settled architecture.

| # | Decision | Recommendation |
|---|---|---|
| **D1** | **Data boundary.** Do Individual-originated records (study, attempts, AI, CPD, self-declared credentials) go in separate `individual_*` tables, or are they written to the existing person-keyed estate tables (`quiz_attempts`, `cpd_logs`, …)? | **Separate tables.** §2.3 shows the estate tables are read by hospital analytics with no origin filter, so reuse would disclose private study to employers. Separation makes the leak unrepresentable; an origin column would need every one of 15+ readers to remember a filter. Engines are reused as code, so nothing is duplicated except storage. |
| **D2** | **Controller and operating entity** for the shared foundation (identity, AI context, history, Passport) given that a separate subsidiary operates Scholar. | Holdings is controller of the shared foundation. The subsidiary is controller for Scholar-specific service and billing, under an intra-group data-sharing agreement. Each entitlement records `operating_entity` and the accepted terms and privacy versions. Needs legal confirmation, especially under Uganda's Data Protection and Privacy Act 2019, before any pilot. |
| **D3** | **Institution-issued records in the Individual Passport.** Show records an employer issued about a person (decisions, employment, verified credentials) inside their Individual Passport? | **Yes, read-only, to the subject only, labelled by issuer.** This is the passport thesis (STRATEGY-001 §1). Outward disclosure stays person-initiated. Rights an institution keeps over records it issued (restriction, revocation) are not modelled; flag them for the governance entity conversation. |
| **D4** | **Scholar entitlement on graduation.** | Leave it to run its own term and do not auto-revoke. History is foundation-level, so it never depends on Scholar staying active. |
| **D5** | **Professional identity record.** Does Individual keep its own record, or promote Practice's `practice_practitioner_identity` (mig 218/270) to a shared person-level table? | **Individual keeps its own record, using mig 270's vocabulary.** A consented link to Practice comes later (WP9). Promoting a Practice table would make two products write one record, which is a PSA-001 §20/§29 change, not a drive-by. |
| **D6** | **RLS posture for `individual_*` tables.** | Enable RLS with own-row `select` policies (as `platform_membership`, mig 279), plus app-layer guards and service-role writes. This differs deliberately from Practice's zero-policy posture, because this data is personal and the population is unbounded. |
| **D7** | **Authenticated app routes.** | Use `/individual/scholar/**` and `/individual/professional/**` under the existing Individual gateway (`GATEWAYS.individual`). Marketing keeps `/scholar` and `/professional`. Any branded hostname later is deployment configuration in `domains.ts`, not a new route tree. |
| **D8** | **Scholar minimum age.** | 18+ for the pilot. Minors need a guardian-consent design that does not exist anywhere in the codebase. |

---

## 8. Next GO — smallest sensible implementation package

**GO-IND-003: Individual gate and empty shells (WP0 + WP1).** It is gated on D1, D2 (in principle), D6 and D7.

1. Write the Individual foundation spec and ADR-016 (third product gate, data boundary, evidence classes, entitlement ledger).
2. Draft one migration: `individual_membership` and `individual_entitlement` as in §5.1, with `source NOT NULL` and no default, and own-row RLS. It must pass `scripts/migration-house-rules.ts` and is **sent to the owner, not applied or committed until confirmed**.
3. `product-resolution.ts`: add the `individual` read and code, and extend `product-resolution.test.ts`.
4. Build the `/individual` authenticated shell: a three-state guard, an experience switcher, and Scholar and Professional home pages that honestly render "being built". Move the door to `flag_gated` behind a new `individual_sign_in` flag, left OFF.
5. Provisioning is HQ pilot-grant only. There is **no public signup route**; opening one is a separate owner decision.
6. Write an `individual-gate-harness`. It proves, each with a planted failure:
   - no `platform_membership` is granted;
   - no `profiles.role` is written;
   - only live experiences route;
   - an unreadable store fails closed;
   - an Individual-only person cannot enter `/dashboard`.
   Re-run `access-doors`, `plane-boundary` and `pd-screen-doctrine`.

**Exit criterion:** an HQ-granted pilot account signs in at `/individual/sign-in`, lands on its primary experience, switches to the other when both are granted, and holds no Platform access. That proves the foundation every later work package builds on, before any Scholar or Professional feature work starts.
