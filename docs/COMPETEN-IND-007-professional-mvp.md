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

## 6. Next

After the staging run: an IND-003 review of the foundation diff, then the owner's production decisions (370 first; 373 is blocked by the same schema freeze). Follow-ups noted, not built:
- export of the person's record (IND-002 §4.1 item 7);
- registration-cycle-aware CPD;
- an operator verification queue (`independently_verified`);
- consented per-recipient disclosure (WP9).
