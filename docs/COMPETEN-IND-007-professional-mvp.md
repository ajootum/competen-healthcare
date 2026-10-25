# COMPETEN-IND-007: Professional MVP build record

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Status** | Built on branch `ind-007/professional-mvp`, cut from `ind-003/individual-foundation` @ `d6252ad6` and merged with it again @ `dde82336` (release gate, experience-module mechanism, `main` @ `6fa4cd52`). Pushed. **Not merged, not deployed.** Ships dark: every Professional page and API is behind the release gate `individual_app` (default OFF). |
| **Authority** | Owner GO for COMPETEN-IND-007. ADR-016 and its owner rulings D1–D10. COMPETEN-IND-002 §4. |
| **Migration** | `373-individual-professional-record.sql` (sha256 `4b53519aee7faaef7f2d6aace2f8f24574262677474867f509b21a49e0c75657`). House rules ALL CLEAR. **Applied to STAGING by the owner, twice (2026-10-23), verified, and committed to this branch** under the CLAUDE.md migration-governance amendment (`main` @ `5a9a07cc`). **Not applied to production**; that needs a separate owner GO. See §5a. |

## 1. The first working journey

All of it runs inside the existing Professional shell at `/individual/professional/**`. A Professional-only entitlement reaches every step; no Scholar row is needed.

| # | Step | Where | Store |
|---|---|---|---|
| 1 | **Profile**: profession, registration body and number, country, optional renewal date | `(professional)/registration`, `PUT /api/individual/professional/profile` | `individual_professional_profile`. Every column is `self_declared_*` (mig 270 vocabulary, D5). It is not `practice_practitioner_identity`. |
| 2 | **Development needs**, optionally against a shared framework competency, or raised from a Passport competency that is not current | `(professional)/development`, `/api/.../needs`, `/api/.../frameworks` | `individual_professional_need`. Frameworks are limited to `hospital_id IS NULL` on every read and write. |
| 3 | **Learning plan**: goals with target dates, linked to needs | `(professional)/development`, `/api/.../goals` | `individual_professional_goal`. A composite FK makes a link to another person's need unrepresentable. |
| 4 | **CPD log** (the `cpd_logs` fields, a reflection and a goal link) and **credentials and competency evidence**, each with an optional document | `(professional)/cpd`, `(professional)/evidence`, `/api/.../cpd`, `/api/.../evidence`, `/api/.../documents` | `individual_professional_cpd` and `individual_professional_evidence`, plus the private bucket `individual-professional-evidence`. `evidence_class` is a **generated column**: `self_declared` with no document, `source_linked` with one. No table has a verified column. |
| 4b | **Expiry reminders** for credentials and registration | `src/lib/individual/professional/reminders.ts`, job `individual_professional_reminders` in `src/lib/platform/jobs.ts` (daily 06:00) | Sent through `dispatch()` by email, 60 days ahead, once per expiry date. The once-only mark is on the person's own row, not in `cdp_reminders`. |
| 5 | **Passport**: the person's own records labelled by provenance, alongside institution-issued records labelled by issuer (D3) | foundation `passport.ts` gains `own`; the Passport page gains "Records you added"; `(professional)/share`; `/verify/[token]` | Sharing reuses `passport_share_tokens` (`hospital_id` null) plus a companion row in `individual_professional_share`. `/verify` shows own records **only** when the companion row exists. Each item states its class, and the header drops "Verified" for those links. |
| 6 | **Progress**: plan completion, CPD hours by year, evidence coverage per need | `(professional)/progress`, `src/lib/individual/professional/progress.ts` | Counts of the person's own rows. There are no targets, and an empty denominator renders as "Not measured" with its reason. |
| 7 | **Personal AI**: CPD plan suggestion and reflection drafting | `POST /api/individual/professional/assistant`, `AssistPanel`, `CpdForm` | Uses `generate()` with `attribution: { scope: "person" }`, the foundation persona and rules, the hourly quota and the `ai_assistant_query` audit action. It is advisory and stores nothing (D10). A draft enters the record only if the person edits and saves it. |

The **registry** now drives the navigation. `ExperienceConfig.modules` with `navFor()` and `bottomNavFor()` in `experiences.ts` gives Professional five modules. The `planned` entries that shipped are removed. Career and independent verification stay as governed "not yet available" entries.

## 2. Reused, not rebuilt

- Gate 3, the terms gate and `experiencePage()`.
- `requireIndividualContext("professional")` on every handler.
- The Passport composition, `passport_share_tokens` and `/verify`.
- `generate()`, quota and audit.
- `dispatch()` (Resend).
- Shared frameworks (mig 003/127).
- Mig 270's provenance naming.
- `isExpired` and `isExpiringSoon` from `src/lib/engines/competency.ts`.
- The chrome components and design tokens.

The `dashboard/career` engine's readiness formula and ladder are hospital-promotion constructs, so they were deliberately **not** applied to an Individual person.

## 3. Decisions taken in the build (for review)

1. **Reminders go by email only, not as in-app `notifications` rows.** Estate consoles count `notifications` by type across all users, and an Individual-only person has no inbox to read them in. The in-app surface is the "Renewals due" panel on the evidence page. If the owner wants an in-app row as well, `dispatch(..., ["in_app","email"])` is a one-word change.
2. **Documents get their own private bucket**, not the estate `evidence` bucket or table. Hospital verifiers can list and sign estate `evidence` rows by `hospital_id`.
3. **`/verify` wording.** For a link minted from Professional, the header reads "Competen · Passport" rather than "Verified Passport", and the footer says the self-recorded section is the professional's own account. Estate-minted links render byte-for-byte as before.
4. **A Full link includes the self-declared registration number.** Reflections, needs, plans, notes and documents are never shared. The share page says this before the link is created.

## 4. Foundation changes

IND-003 built the shared mechanism itself (`dde82336`). It agreed proposals A–D, with conditions. IND-007 then made three changes:
- filled `PROFESSIONAL.modules` and trimmed `planned`;
- added two **optional** `ExperienceModule` fields (flagged to IND-003 for review): `summary` for the home cards, and `nav: false` for the share page, which is a listed module reached from the Passport rather than from the nav;
- pointed the `passport_share_tokens` exception at `src/lib/individual/professional/share.ts`, the one module that writes it. Both the share route and the staging harness call it.

The Passport (`passport.ts`, the Passport page) and `assistant.ts` changes are as proposed in C.

/verify (D) shows own records only when the release gate is on **and** the link has a companion row. A Vitest renders the live page and a frozen copy at `d6252ad6` (`src/test-fixtures/verify-page-d6252ad6.tsx`) against the same data, and requires identical markup for every estate-minted link. It covers both scopes, with the gate on and off. A planted one-word change turned 5 of the 6 cases red.

## 5. Verification (2026-10-22)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` on every changed file | clean |
| `vitest run` (after the `dde82336` merge) | **562 / 562**, including 17 Professional cases and 6 /verify identity cases |
| `individual-foundation-harness` | **38 / 38**, including 7d/7e (`experienceModulePage`) and 10a–10e (release gate). Before the experience rule, 2a went red on the Professional writes. |
| `individual-professional-harness` (new, no database) | **47 / 47**. 20 invariants plus **27 planted violations, each proven red in memory on every run**: estate writes (`cpd_logs`, `professional_credentials`, the estate bucket, `passport_share_tokens` outside `share.ts`), employer read paths (an educator page reading, a dashboard importing), a verified column, a writable class, a "Verified" label, a foreign class rendered, `/verify` without the companion-row gate, a Scholar guard, a write policy, a defaulted origin, a single-column link. |
| `access-doors` / `plane-boundary` | 39/39 · 35/35 |
| `auth-boundary` | ALL GREEN after the merge. |
| `migration-house-rules` on 373 | ALL CLEAR: 396 lines, 91 statements, 26 constraints, 0 warnings |
| `individual-professional-acceptance-harness` on staging, after 373 (2026-10-23) | **ALL GREEN, 31 / 31.** G2 is PEND because staging has no hospital-owned framework to refuse. The groups: R (reminder job silent while the gate is OFF), A (direct entry with no Scholar row, the whole journey), B (schema-generated class, no verified column, no default origin), C (cross-person links refused), D (own-row RLS, no browser writes), E (once-only reminders), F (share carries own records only for a Professional link; another person cannot revoke it), G1 (shared frameworks only), M (no row in `cpd_logs`, `professional_credentials`, `evidence`, `cdp_reminders` or `notifications`), Z (fixtures removed, flag restored). The first run was 30/1: A6 expected two CPD entries behind the need, but only one was linked to the goal. That was a harness expectation, not a product defect. It was corrected and re-run green. |
| Pre-373 browser walk-through on staging (`localhost:3040`, Professional-only pilot) | Welcome offers only Professional → Holdings test terms → Professional shell with the five modules → module pages say the store is not set up and offer no form → `/individual/scholar/cpd` shows the governed not-active state → the Passport shows "Records you added" and points to sharing. Console shows only the pre-existing CSP report-only notice. |

**End-to-end journey on staging, after 373 (2026-10-23)**
- **Setup:** `localhost:3040` pointed at staging, with staging-only test legal versions. The pilot was a Professional-only identity (`harness-ind007-pilot@competen.test`, granted through the foundation grant service, no Scholar row). `individual_app` was held ON for the walk-through, then restored to no row, verified.
- **Path:** welcome (only Professional offered) → Holdings test terms → Professional home with the five journey modules →
  1. registration saved, self-declared;
  2. a need against the shared *Emergency Nursing / Participates in Advanced Resuscitation*;
  3. a goal with a target date linked to that need, marked in progress;
  4. personal AI CPD-plan suggestion: grounded in the need and goal, labelled advisory and not saved, no invented hour target;
  5. CPD entry with an AI-drafted reflection linked to the goal;
  6. CPD entry with a PDF certificate, labelled *Self-declared with a document attached, not verified*, which opens only through a 5-minute signed URL on the private bucket;
  7. a credential expiring within 60 days and the registration renewal, both shown under *Renewals due*;
  8. competency evidence linked to the need;
  9. Progress: 0% done of 1 goal, 1 in progress; 2026: 7.5 hours over 2 entries, 1 with a document; coverage 100% (1 of 1);
  10. the Passport's *Records you added* lists all five items by class;
  11. a Full share link created;
  12. `/verify` shows *Competen · Passport* (not *Verified*), each own item with its class and the not-verified notice. The subtitle is the self-declared profession.
- **Layout:** 390 px: no horizontal overflow on any page; five bottom tabs: Home, Plan, CPD, AI, Passport.
- **Evidence:** `docs/evidence/COMPETEN-IND-007/staging-desktop-1440-*.jpg` (11) and `staging-mobile-390-*.jpg` (5). Desktop 06 shows the reflection saved *before* defect 1 below was fixed.

**Genuine defects found in the walk-through, both fixed and re-verified**
1. **The AI reflection draft carried chat framing** ("Here is a draft…", "Feel free to adjust…"), which would be saved into the CPD record as written. The reflection task now returns only the reflection. Re-checked live: no preamble and no sign-off.
2. **`/verify` showed the estate default `profiles.role` ("Nurse") as the subtitle** of a Professional-minted link. Individual must not rely on that value (ADR-016). Such a link now shows the person's self-declared profession, marked *(self-declared)*, or nothing. Estate-minted links still render byte-identically (the identity test passes), and a new assertion pins the subtitle.

**Other staging rows from this turn** (all test data, all removed by the harness cleanup unless noted):
- the walk-through's records, its share token and the pilot itself, removed by the second acceptance run;
- AI usage rows in `plat_ai_requests` for 4 test calls (2 plan, 2 reflection);
- email delivery rows marked *skipped* in `notif_deliveries` from the reminder groups.

The `plat_ai_requests` and `notif_deliveries` rows stay as the platform's usage and delivery log. No pre-existing row was altered or deleted.

**Schema note.** 373 uses `on delete set null (need_id)`, which needs PostgreSQL 15 or later. Staging runs 17.6. Production has not been checked from this session.

## 5b. Migration state, dependencies and application order (CLAUDE.md, `main` @ `5a9a07cc`)

| | |
|---|---|
| **State** | Applied and verified on **staging** (state 2). Eligible for PR review into `main`. Merging records release history only; it does **not** authorise production (state 4 needs a separate owner GO and the COMPETEN-OPS-001 safeguards). |
| **Production** | **Not applied.** If merged, `main` holds 373 while production does not. |
| **Checksum** | sha256 `4b53519aee7faaef7f2d6aace2f8f24574262677474867f509b21a49e0c75657`. Identical for the file applied on staging, the committed file (`cd878e8f`) and the copy handed to the owner. The file is never edited; any fix goes forward in a new migration. |
| **Schema dependencies** | `profiles`, `frameworks` and `framework_competencies` (003), `passport_share_tokens` (122), `storage.buckets`. None on 370, 371 or 372. |
| **Functional dependency** | 370 (gate 3). The code that uses 373 is reachable only through the Individual guards, and those answer 404 while the release gate `individual_app` is OFF (default, absent row, or unreadable). Production has no `individual_app` row. If 373 is absent while the gate is on, every reader treats the missing tables as *no records* (`isNotProvisioned`) and the pages offer no forms. |
| **Order applied on staging** | 370 (2026-10-22) → 371 (already present) → 372 (IND-004, 2026-10-23) → 373 (owner, 2026-10-23, twice). |
| **Recommended production order** | 370 → 373. 371 is already in production. 372 and 373 are independent and may go in either order. |
| **Rollback** | 373 creates only new objects: six tables, their constraints, indexes and policies, and one bucket row. Rollback is dropping those six tables (`cascade`) and deleting the bucket row once it is empty. The SQL is to be written with the production GO, as COMPETEN-OPS-001 requires. |

## 5a. Migration 373 on staging (2026-10-23)

**Who applied it.** The owner ran `npx tsx scripts/apply-migrations.ts --only 373` twice from this worktree. Each run printed `production is rnnqhlrcgvsauigxwszl – guard passed`, `373-individual-professional-record.sql ... ok` and `All 1 migration(s) applied.`. This session's own attempt was refused by its permission check and was not retried. The second run completing without error is the idempotency proof: every statement is `if not exists`, drop-then-add or `on conflict do nothing`.

**Checked with `scripts/ind007-staging-schema-check.ts`.** The script is read-only: it runs inside a read-only transaction, refuses production and refuses the transaction pooler.

| | Before (pre-check) | After the owner's two runs |
|---|---|---|
| Server | PostgreSQL 17.6 | same |
| Dependencies | `profiles`, `frameworks`, `framework_competencies`, `passport_share_tokens`, `storage.buckets`; 370's tables; 371's `attribution_scope` | same; 372 also present (IND-004 applied it in between) |
| 373 tables | none | all six |
| Private bucket | absent | `individual-professional-evidence`: private, 10 MB, PDF/PNG/JPEG/WebP |
| Name collisions with other relations | none | none |
| Pre-existing rows | `profiles` 20, `frameworks` 14, `framework_competencies` 277, `passport_share_tokens` 0, `storage.buckets` 3 | `profiles` 20, `frameworks` 14, `framework_competencies` 277, `passport_share_tokens` 0, `storage.buckets` 5 (372's and 373's buckets). No existing row changed. |
| 373 schema | (empty) | 76 columns, 43 constraints, 15 indexes, 6 policies, RLS on 6/6. Fingerprint `bb0de985d084d6079e9e740b3d2e6af5efda05c99df67f9fa333e8b9189b7d9f`, unchanged across repeated reads. |

**Detail (`--detail`).**
- Each table has exactly one policy, `<table>_read_own FOR SELECT USING (auth.uid() = user_id)`, and no write policy.
- `evidence_class` is `GENERATED ALWAYS AS (CASE WHEN document_path IS NULL THEN 'self_declared' ELSE 'source_linked' END)` on both CPD and evidence.
- There are three composite foreign keys, `(…, user_id)` with `ON DELETE SET NULL (col)`.
- No column names *verif*, and no hospital, organisation, tenant or workspace column exists.

**Staging rows this session created.** All of them are test identities.
- `harness-ind007-pilot@competen.test` and `harness-ind007-grantor@competen.test`: `auth.users` and `profiles` rows, created 2026-10-22.
- The pilot's `individual_membership` and one Professional `individual_entitlement` row.
- The pilot's test-terms acceptance, written to those same two rows.

No pre-existing row was altered or deleted.

## 7. Acceptance review (owner GO, 2026-10-23)

Every row rests on code, a harness check or staging evidence. Scope is the approved MVP, so capabilities discussed for later are classified, not built.

- **PASS:** works end to end.
- **PARTIAL:** works, with a named gap.
- **BLOCKED:** cannot work today, for the reason given.

Check ids:
- **PH-** `individual-professional-harness` (47/47);
- **FH-** `individual-foundation-harness` (44/44);
- **PA-** staging Professional acceptance (31/31, §5);
- **IA-** staging foundation acceptance (IND-003 §8).

| Area | Capability | Status | Evidence | Missing |
|---|---|---|---|---|
| **Identity** | One Competen identity; gate 3 admits by membership; Professional-only entitlement admitted | PASS | `src/lib/individual/guard.ts:63` (release gate first), `:97` (experience live); PA-A1 (no Scholar row) | — |
| | Professional identity record: profession, registration body and number, country, renewal date | PASS | `373-…sql:68` (`self_declared_*` names, D5); `(professional)/registration`; staging journey step 1 | — |
| | Registration checked against a register | BLOCKED | Governed empty state on the registration page; registry `planned: verification` | No regulator lookup or verifier exists. Owner/governance capability, not MVP. |
| | No use of Practice's identity (D5) | PASS | `grep practice_practitioner_identity` over the Individual code: 0 hits | — |
| **Passport continuity** | One Passport across experiences: own records (provenance) beside institution records (issuer, D3) | PASS | `src/lib/individual/passport.ts:124` (`own`), `:46` (`source_linked` label); PA-A4, PA-A5; desktop and mobile screenshots 09/04 | — |
| | Own records survive the end of the Professional entitlement and stay readable | PASS | `passport.ts` reads `own` regardless of experience; documents route needs gate 3 only (`api/individual/professional/documents/route.ts`) | — |
| | Consented, revocable sharing; `/verify` states each class; estate links unchanged | PASS | `verify/[token]/page.tsx:68` (gate AND companion row); `verify-estate-identity.test.tsx` (6 cases: estate links byte-identical, gate on and off, plus the Professional case); PA-F1–F6; PH-E5 | — |
| | Scholar study (`individual_scholar_*`) shown in the Passport | PARTIAL | Not read by `passport.ts` or `history.ts` (0 references) | Scholar material and progress are not Passport items. Their shape is IND-004's and the owner's to decide. |
| **Competencies** | Needs against a shared framework competency (`hospital_id IS NULL` only) | PASS | `professional/frameworks.ts:18,27,60`; PA-G1; journey step 2 (*Emergency Nursing*) | — |
| | Needs raised from a Passport competency that is not current | PASS | `(professional)/development` "From your Passport" (institution decisions, read-only) | — |
| | Self-recorded competency evidence, linked to a need, never "verified" | PASS | `373-…sql:300` (class generated); PH-E1–E6; PA-B1–B3 | — |
| | Assessment or sign-off of an Individual's competence | BLOCKED | `competency_cycles` and `inScope` are hospital-bound (IND-002 §2.5) | No assessor path for a person without an organisation. A governed later capability. |
| **Learning** | Learning plan: goals with target dates, linked to needs, status | PASS | `api/individual/professional/goals/route.ts`; `373-…sql` composite FK; PA-C1, PA-C3; journey step 3 | — |
| | Private CPD log (cpd_logs fields + reflection + goal link), hours by year, no target | PASS | `progress.ts:39`; PH-W2/W4 (no `cpd_logs`); PA-A6; journey steps 5–6 | — |
| | Registration-cycle-aware CPD (hours against the regulator's cycle) | PARTIAL | Hours by calendar year only, by design (no invented targets) | No store of a regulator's requirement or cycle. Needs a governed source. |
| **Assessment** | Progress: plan completion, CPD by year, evidence coverage, "Not measured" when empty | PASS | `progress.ts:24,39,69`; `professional.test.ts`; PA-A6; screenshot 08 | — |
| | Knowledge or skills assessment inside Professional | BLOCKED | Not in the IND-007 brief; Scholar holds question generation | Out of MVP scope. |
| **Evidence** | Documents in a private bucket, owner-only five-minute signed download, never the estate `evidence` table | PASS | `professional/documents.ts:43`; `373-…sql` bucket and path CHECK; PA-C2; PH-R4, PH-W1 | — |
| | Upload size works on the deployed site | PASS (fixed) | `vocabulary.ts` `DOCUMENT_MAX_BYTES` = 4 MB, below Vercel's ~4.5 MB request body (finding shared with IND-004); `professional.test.ts` | — |
| | Expiry reminders: once per date, silent while the gate is off, nothing in `cdp_reminders` or `notifications` | PARTIAL | `professional/reminders.ts:48,90`; PA-E1–E3, PA-R1, PA-M1 | Email only, and only where Resend is configured. The in-app surface is the "Renewals due" panel. An in-app notification is a one-word owner choice (§3.1). |
| **Access controls** | Release gate default OFF; 404 when off, including page titles | PASS | FH-10a–e, FH-11a–e; `gatedMetadata` on all six pages | — |
| | Experience-owned pages 404 outside Professional | PASS | `shell-context.ts:46` `experienceModulePage`; FH-7e/7f; PH-D1 (and its planted reds) | — |
| | Own-row RLS, no browser writes, cross-person links unrepresentable | PASS | `373-…sql:273` (SELECT only); PA-D1–D3, PA-C1–C2; PH-S1/S2 | — |
| | No employer-visible write or read path (D1) | PASS | PH-W1–W4, PH-R1–R5; PA-M1; `plane-boundary` 35/35 | — |
| | Terms before use (D2) | PASS | FH-9d; terms gate in the staging journey | — |
| **UX** | Desktop and mobile journey; one `md` edge; five-tab bottom bar; no horizontal overflow at 390 | PASS | Screenshots desktop 01–11 and mobile 01–05; journey notes (§5) | — |
| | Every evidence class in words; governed empty and unreadable states | PASS | `_components/professional/bits.tsx` `ClassLabel`; PH-E4 | — |
| | Personal AI: CPD plan and reflection draft, grounded, advisory, not stored (D10) | PARTIAL | `api/individual/professional/assistant/route.ts:65` (person attribution); `assistant.ts:39`; staging journey 4–5 | Works when the AI provider has credit. On 2026-10-23 the key's balance ran out (IND-004 report), and calls then fail with an honest error. Operational, owner's. |
| | After a create in a collapsed "Add …" panel, the confirmation is hidden when the panel closes on refresh | PASS (fixed, 2026-10-25) | The need and goal panels are `AddPanel` (`_components/professional/forms.tsx`): suggested open while nothing is recorded, then open until the person closes it, so the refresh after a save no longer closes it on the confirmation. `AddPanel.test.tsx` (4, red on the old behaviour); PH-U1 with 3 planted reds | — |
| **Student → Professional lifecycle** | A person can hold Scholar and Professional together and switch; Professional can be added without ending Scholar (D4) | PASS | IA-A (dual), IA-D (graduation keeps Scholar), IA-E (primary fallback); `ExperienceSwitcher` `chrome.tsx:46` | — |
| | What carries over: identity, Passport (institution and own records), profile and history, personal AI. Professional records belong to the person, not the experience. | PASS | `passport.ts`, `history.ts:36` (all entitlement periods); IA-L | — |
| | Guided graduation: a Scholar-side flow that confirms profession and terms and writes `source='graduation'` | BLOCKED | Grants write `source: "pilot"` only (`src/lib/individual/grants.ts:82`). `graduation` appears only in a test fixture. | Not built. Professional is added by HQ pilot grant. The flow is WP6 (IND-002 §6) and needs its own GO. |

**What happens today when a Scholar user becomes a Professional:**
1. An HQ Individual Product Administrator grants Professional through `POST /api/hq/individual/grants`.
2. The person keeps their account, Scholar entitlement, history and Passport, and the switcher appears.
3. On first entry to Professional they accept the Holdings terms. If they already accepted them for the foundation, nothing is asked again.
4. Their Professional record starts empty. Scholar's study material stays in Scholar and is not copied or surfaced in Professional.

**Defects found in this review:**
- **Fixed (4 MB upload limit):** Professional documents uploaded through a route handler with a 10 MB ceiling, which Vercel would cut off above about 4.5 MB. The app now refuses anything over 4 MB, with a test. The bucket keeps its 10 MB outer limit.

## 8. Professional reminders and migration 374 (owner continuation GO, Option A, 2026-10-23)

**Behaviour**
- **In-app reminders.** Default ON. They show as "Renewals due" on the Professional home and the Credentials & evidence page while the in-app switch is on.
- **Email reminders.** Default OFF, opt-in. They go through the existing `dispatch()` email sender, once per expiry date, 60 days ahead.
- **Switches.** The two switches are independent and set by the person (`PUT /api/individual/professional/reminders`, Reminders section of Credentials & evidence).
- **Who is emailed.** Only a person who opted in AND holds Professional now (`individual_live_entitlement`, active membership), and only while the release gate is on.
- **Separation (D1).** Individual notifications stay separate from Enterprise and Practice. Nothing reads or writes `notifications`, `notification_preferences`, `notif_deliveries` or `cdp_reminders` (PH-N1).
- **No invented renewal rules.** Reminders come only from the dates the person recorded. The surfaces say Competen does not know their regulator's renewal rules.
- **Without 374.** Preferences are read with their own query (`preferences.ts`). Where 374 is absent, in-app stays on, the switches are not offered, and nobody is emailed. Production has 373 but not 374, and stays safe.

**Migration 374** (`374-individual-professional-reminder-preferences.sql`)

| | |
|---|---|
| sha256 | `8ccd5a48500d53df30d0fe44845df6fb3e6e384ca4e857477dc9cea4a99b25a7` (file applied = file committed = copy handed to the owner) |
| Content | `alter table individual_professional_profile add column if not exists reminder_in_app boolean not null default true` / `… reminder_email boolean not null default false`, two comments, `notify pgrst`. APPLY THIS FILE WHOLE banner. House rules ALL CLEAR, 0 warnings. |
| Dependencies | `individual_professional_profile` (373) only. Independent of 375. |
| Staging pre-state (read-only, `ind007-staging-schema-check.ts`) | Fingerprint `bb0de985…` (unchanged since 373). 76 columns, 43 constraints, 15 indexes, 6 policies. Rows: `profiles` 18, `frameworks` 14, `framework_competencies` 277, `passport_share_tokens` 0, all six Professional tables 0, `storage.buckets` 5. |
| Application | The owner applied it twice from this worktree on 2026-10-23, with `apply-migrations.ts --only 374`. Both runs printed "guard passed", "… ok" and "All 1 migration(s) applied". This session's own attempt was refused by its permission check and was not retried. |
| Staging post-state | Fingerprint `bc71a0f3cb80a60d28f160a968a417694f76eecbd11cc80d5a84c390edcbe668`, stable across reads. Columns 76 → 78; constraints, indexes, policies and RLS unchanged. `reminder_in_app boolean NOT NULL DEFAULT true`, `reminder_email boolean NOT NULL DEFAULT false`. All row counts identical to the pre-state. No verified or scope column. |
| Production | **Not applied. Not authorised** (owner GO item 5). |
| Rollback | `alter table individual_professional_profile drop column if exists reminder_email;` then `alter table individual_professional_profile drop column if exists reminder_in_app;` then `notify pgrst, 'reload schema';`. No code change is needed: the application falls back to the defaults. |

**Staging acceptance** (`individual-professional-acceptance-harness`, after 374): **ALL GREEN, 35 / 35.**
- **New checks:**
  - N1: defaults are in-app ON and email OFF;
  - N2: the switches are independent;
  - N3: email goes only to the person who opted in;
  - N4: an opted-in person whose Professional ended is not emailed;
  - N5: no row in the estate `notification_preferences`. M1 now also covers it.
- **E1–E3** now run with the opt-in.
- **R1 PEND by design:** `individual_app` was held ON for the owner's viewing session, so the run did not switch it, and Z2 confirms it is left as found.
- **G2 PEND:** staging has no hospital-owned framework to test against.

**Local checks**
- `individual-professional-harness` 57 / 57: N1–N4, with 6 planted reds.
- Reminder unit tests 6 / 6.
- vitest 618 / 618, foundation 44 / 44, tsc and eslint clean.

### 8a. Owner review: reminders APPROVED as the MVP baseline (2026-10-23). Release conditions verified.

| # | Condition | Result | Evidence |
|---|---|---|---|
| 1 | A failed email stays observable and does not consume the once-only reminder | **Defect found and fixed** (`e4efc18a`). The scan wrote the marker before `dispatch()` and ignored the outcome, so a failed send, or a skipped one (provider not configured), used the reminder up. Now the marker is **claimed** (atomic, no double send) and **kept only when the email delivery reports `sent`**. Otherwise it is released to its prior value and the next run retries. | Unit tests: a planted failed or skipped send releases the claim, and the retry delivers once; red when planted back (`reminders.test.ts`, 8/8). Harness N5 and 3 planted reds (61/61). **Staging acceptance E4**: a failed send against real rows leaves the marker unchanged, and the next run delivers and marks it once (36/36). Observability: `dispatch()` records a `notif_deliveries` row per attempt (status, error); the scan logs each failure and returns `failed` and `failures`; the job run reports "n not delivered, retried next run" plus a warning platform event (counts only). |
| 2 | 60 days is a configurable policy candidate, not a permanent product rule | Done. It is one named constant, `REMINDER_HORIZON_DAYS` (`vocabulary.ts`), documented as a policy candidate. The email scan, the in-app panels and all UI text read it, and no other "60" remains. No config surface was built: where it is configured is for the CONFIG-001 audit to propose. | `vocabulary.ts`; `ReminderSettings.tsx`; registration and evidence hints |
| 3 | In-app ON / email OFF defaults and independent preferences preserved | Unchanged by the fix | Acceptance N1, N2 (staging); unit "preferences" tests; harness N4 (schema defaults) |
| 4 | The missing-374 fallback remains safe | Unchanged | Unit tests: the preferences read as defaults and not configurable when 374 is absent; the email scan sends to nobody when the opt-in cannot be read. The route answers 409 "not available" (`preferences.ts`, `reminders.ts`). |
| 5 | 374 prepared for the next controlled production batch | Batch sheet below. Nothing applied. | — |

### 8b. Production batch sheet: migration 374 (prepared, NOT applied; needs an owner production GO)

| | |
|---|---|
| File | `supabase/migrations/374-individual-professional-reminder-preferences.sql` |
| sha256 | `8ccd5a48500d53df30d0fe44845df6fb3e6e384ca4e857477dc9cea4a99b25a7`. The applied file must match `main` once PR #18 is merged. Check with `git show main:supabase/migrations/374-individual-professional-reminder-preferences.sql \| sha256sum`. |
| Dependencies | 373 (`individual_professional_profile`), **applied in production** (OPS-001 §11). Nothing else. Independent of 375. |
| Order | After 373. It may go alone or in a Low batch with other independent Low migrations. |
| Risk tier (OPS-001 §8) | **Proposed Low, owner to confirm the wording.** In substance it is additive and non-destructive: two new columns with constant defaults, which is a catalogue-only change on PostgreSQL 11+ with no rewrite and no data change. It adds no constraint, index, policy, grant, trigger or function, and nothing existing relies on it, because the code reads it with its own query and falls back to the defaults without it. **But §8's Low text says "no change to existing tables", and 374 adds columns to an existing (Individual-only) table.** It is not Medium either: it changes none of the things Medium lists. So it needs either an explicit Low classification, or §8 amended to cover "additive columns with constant defaults on Individual tables". The gate for Low: a verified backup under 24 hours old, a recovery reference, and this rollback SQL. |
| Release gate | `individual_app` stays **OFF** (no row) in production. 374 neither reads nor writes the flag. |
| Applied by | The owner, by hand, in the Supabase SQL editor for production, as one script (APPLY THIS FILE WHOLE). |

**Pre-check (read-only, production, before applying):**
```sql
select count(*) as profile_rows from individual_professional_profile;              -- record it
select column_name from information_schema.columns
 where table_schema='public' and table_name='individual_professional_profile'
   and column_name in ('reminder_in_app','reminder_email');                         -- expect 0 rows
select count(*) from information_schema.tables
 where table_schema='public' and table_name like 'individual_professional_%';      -- expect 6 (373 present)
select enabled from practice_platform_flags where flag='individual_app';           -- expect no row (gate OFF)
```

**Post-check (read-only, production, after applying):**
```sql
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema='public' and table_name='individual_professional_profile'
   and column_name in ('reminder_in_app','reminder_email') order by column_name;
-- expect: reminder_email boolean NO false / reminder_in_app boolean NO true
select count(*) as profile_rows,
       count(*) filter (where reminder_in_app) as in_app_on,
       count(*) filter (where reminder_email)  as email_on
  from individual_professional_profile;            -- profile_rows = pre-check; in_app_on = profile_rows; email_on = 0
select enabled from practice_platform_flags where flag='individual_app';           -- still no row
```

**Rollback SQL:**
```sql
alter table individual_professional_profile drop column if exists reminder_email;
alter table individual_professional_profile drop column if exists reminder_in_app;
notify pgrst, 'reload schema';
```
No code change is needed after a rollback: without the columns, the app falls back to in-app ON, email OFF, switches not offered, and nobody emailed.

**Recommended release action:**
1. Merge PR #18 on an owner GO. CI should be green apart from the known staging-secrets smoke job.
2. Confirm the sha256 on `main`.
3. Classify 374 Low explicitly, or amend §8's wording.
4. Apply 374 in the next controlled production batch under the Low gate, with the pre-check, the post-check and this rollback SQL.
5. Keep `individual_app` OFF. Individual activation is a separate GO.

## 6. Next

After the staging run: an IND-003 review of the foundation diff, then the owner's production decisions (370 first; 373 is blocked by the same schema freeze). Follow-ups noted, not built:
- export of the person's record (IND-002 §4.1 item 7);
- registration-cycle-aware CPD;
- an operator verification queue (`independently_verified`);
- consented per-recipient disclosure (WP9).
