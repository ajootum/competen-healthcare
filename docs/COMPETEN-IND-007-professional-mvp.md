# COMPETEN-IND-007: Professional MVP build record

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Status** | Built on branch `ind-007/professional-mvp`, cut from `ind-003/individual-foundation` @ `d6252ad6` and merged with it again @ `dde82336` (release gate, experience-module mechanism, `main` @ `6fa4cd52`). Pushed. **Not merged, not deployed.** Ships dark: every Professional page and API is behind the release gate `individual_app` (default OFF). |
| **Authority** | Owner GO for COMPETEN-IND-007. ADR-016 and its owner rulings D1–D10. COMPETEN-IND-002 §4. |
| **Migration** | `373-individual-professional-record.sql`. Drafted, house rules ALL CLEAR. **Not committed and not applied anywhere** (CLAUDE.md: committed only after the owner confirms it is applied). Staging apply is waiting on owner authorisation. |

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
| `individual-professional-acceptance-harness` on staging | **PEND**: 373 is not applied on staging. Nothing was created. |
| Pre-373 browser walk-through on staging (`localhost:3040`, Professional-only pilot) | Welcome offers only Professional → Holdings test terms → Professional shell with the five modules → module pages say the store is not set up and offer no form → `/individual/scholar/cpd` shows the governed not-active state → the Passport shows "Records you added" and points to sharing. Console shows only the pre-existing CSP report-only notice. |

**Still to run once 373 is on staging** (per the IND-003 build record §5 template): `apply-migrations.ts --only 373` twice; `privileged-harnesses.ts --staging --only individual-professional-acceptance` (groups A–M); the full journey in the browser with the pilot identity, at desktop and at 375px, with screenshots to `docs/evidence/COMPETEN-IND-007/`; `/verify` for a Full and a Summary link.

**Schema note.** 373 uses `on delete set null (need_id)` (a column list), which needs PostgreSQL 15 or later. The apply will fail loudly, not partially, on anything older. The version on staging and production was not read from this session.

## 6. Next

After the staging run: an IND-003 review of the foundation diff, then the owner's production decisions (370 first; 373 is blocked by the same schema freeze). Follow-ups noted, not built:
- export of the person's record (IND-002 §4.1 item 7);
- registration-cycle-aware CPD;
- an operator verification queue (`independently_verified`);
- consented per-recipient disclosure (WP9).
