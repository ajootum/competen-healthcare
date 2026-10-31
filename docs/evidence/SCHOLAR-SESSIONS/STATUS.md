# SCHOLAR-SESSION-AI-02: STATUS (handover between slices)

Branch `scholar/study-sessions-01` (worktree `C:\Users\elish\Documents\Competen\competen-sessions`, base main 500df4d4).
Approved plan: `PLAN.md` (this folder). Owner GO for implementation: 31 Oct 2026. **Not for production deploy without a separate owner GO.**

## Owner rulings (binding on every slice)

- **D1. Session foundation.**
  - The existing Learn session (`individual_scholar_learning_session`, migration 414) is the anchor.
  - No parallel session engine and no ninth stage.
  - Migration 740 is additive: new columns plus a small activity-link table.
  - Existing Learn sessions and learning history are preserved untouched.
- **D2. Learning objectives.**
  - Use the learner's programme CFCA competency outcomes where available.
  - Where no approved mapping exists, the session uses its existing topic, uploaded document or a free-text educational objective.
  - Never block learning an unmapped topic.
- **D3. AI conversation.**
  - Keep the browser-only conversation model. No server-side chat history.
  - Session, saved assets, attempts and progress must work across devices.
  - Tell the learner, where relevant, that the conversation stays on this device.
- **D4. Context-aware Personal AI.**
  - Extend the EXISTING tutor (`learn/act` ask and the shared assistant's data scopes) with a compact, permission-controlled session summary of about 3,000 characters.
  - Priority order: current focus, relevant source references, recent misconceptions, formative feedback, progress.
  - Deterministic selection.
  - No extra AI call to build context.
  - The summary is educational context, NOT clinical evidence. Factual clinical explanations stay grounded in the learner's notes and approved references (existing grounding check unchanged).
  - Existing routing, allowance and safety controls are unchanged.
- **D5. Assessment separation.**
  - OSCE, Adaptive and Flashcards stay formative.
  - Their results may inform tutor recommendations but must never become Evaluate evidence, verified competencies, DACUM grades or Passport-verified achievements.
  - Never write `competency_verification_*`, `individual_scholar_evaluation` (except by the learner's own existing Evaluate action) or passport tables from session code.
- **Privacy and cost.**
  - Only the learner's own `individual_scholar_*` records.
  - No Professional, employer, estate or other learners' data.
  - Stage navigation makes ZERO AI calls.
  - Each Personal AI question is one metered call on existing activity routing.
- **Gate.**
  - The feature sits behind an Individual policy configuration switch, OFF by default, failing closed while 740 is absent (CLAUDE.md Database state 3).
- **Platform rules.**
  - CPR-MOB-001: one `md` breakpoint, `pointer-coarse` touch sizing, container queries allowed.
  - scholar-learning-harness A1: only `store.ts` queries `individual_scholar_*`, every statement keyed on the caller.
  - B1/B2: no estate tables.
  - C1-C3: `generate()` only in `generation.ts`, `aiPreflight` before AI.
  - Migration house rules (`scripts/migration-house-rules.ts`).

## Slices

| Slice | Scope | State |
|---|---|---|
| A | Migration 740 (author, stage x2, PRECHECK/VERIFY/ROLLBACK, build record), store functions, policy gate key | **done 31 Oct** (staging has 740; production does not) |
| B | Carry focus: `withStudy`, `StudySessionBar`, `?study=` prefill (Revise, Apply incl. OSCE, Evaluate), `last_space`, Study this / Continue entries, link recording in create routes, D3 note | pending |
| C | `buildStudySessionContext` + `learn/act` ask integration + `study_session` assistant data scope | pending |
| D | Staging acceptance harness, 12 checks (PLAN.md section 6) | pending |
| E | Browser 375 / 768 / 1440 (coordinator) | pending |

## Commands

- Staging SQL (one transaction): `echo 'ezhvpgtcqcdsgylrxgdb' | node C:/Users/elish/CompetenBackup/bin/run-staging-sql.mjs <file>`
- Targeted tests only: `npx vitest run <paths>`. tsc: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`
- Harnesses: `npx tsx scripts/<name>.ts` (scholar-learning, individual-config, migration-house-rules)
- Evidence pattern to copy: `docs/evidence/SCHOLAR-FLASHCARDS/` (730 build record, PRECHECK/VERIFY/ROLLBACK).

## Log
- 31 Oct (coordinator ruling, within owner D2): CFCA outcomes have no ids; they are text in `framework_competencies.learning_outcomes` (384). Follow the 408 / Evaluate pattern: NO `objective_outcome_id`. Instead `objective_outcome text` (nullable, 1-500 chars) paired with the session's EXISTING `competency_id` (414, FK to framework_competencies, on delete set null), with CHECK `objective_outcome is null or competency_id is not null`. Facts for 740: `ux_individual_scholar_learning_session_id_user` (id,user_id) already exists (use it for the link FK); 414 has no GRANTs, only RLS read-own `for select using (auth.uid() = user_id)` -> mirror that. Dependencies: 414 only.
- 31 Oct (slice A DONE, branch commits 51549bdd + b3159267 + this one, not pushed):
  - Migration `supabase/migrations/740-individual-scholar-study-sessions.sql`, sha256 `6d4b9b6f46297d82e35279100bbabd38796b5834b1b01459c0520561cd4a79c3`. House rules ALL CLEAR. Depends on 414 only.
  - Staging `ezhvpgtcqcdsgylrxgdb`: PRECHECK (740 absent, 10 columns, 0 sessions), E0 pre-existing-row proof (rolled back, 414 columns unchanged), applied x2 (both Committed), VERIFY `pass=27 fail=0`, rollback refusal rehearsed, rollback committed (back to 10 columns), 740 re-applied, VERIFY 27/0 again. **Staging ends WITH 740. Production does not have 740.** Record: `740-build-record.md`, with PRECHECK/VERIFY/ROLLBACK-740.sql in this folder.
  - Store (`src/lib/individual/scholar/store.ts` only): `createLearningSession` now takes optional `connected`, `objectiveOutcome`, `objectiveText` (no 740 column named unless asked; `study_not_provisioned` without 740); `studySessionSchema` / `resetStudySessionSchema`; `getConnectedSession`; `latestConnectedSession` (active only); `setLastSpace`; `addStudyLink` (session must be the caller's connected one, ref proved the caller's own in its table per kind, exam_paper ref = material_id, idempotent upsert on the unique key, non-disclosing `not_found`); `listStudyLinks` (`[]` none, `null` absent or unreadable). Pure vocabulary in `src/lib/individual/scholar/study-session.ts` (STUDY_SPACES, STUDY_LINK_KINDS, `studyFields`).
  - Gate: policy key `scholar_study_sessions` (choice on/off, fallback off; HQ config page lists it generically) -> `IndividualPolicy.scholarStudySessions: boolean`; `isStudySessionsOn(policy, schema740)` in `src/lib/individual/policy.ts`. Callers: `isStudySessionsOn(policy, await studySessionSchema(admin, userId))`.
  - Checks: vitest `study-session.test.ts` + `policy.test.ts` 28/28, plus 22 related files 427/427; scholar-learning-harness 160/0 (A1 planted failure on a new ownership read went RED, restored GREEN); individual-config-harness 47/0; individual-foundation-harness 74/0; tsc clean.
  - Deviations: (1) one plpgsql trigger added (`individual_scholar_learning_session_outcome_follows`, clears `objective_outcome` when `competency_id` becomes null), because the ruled CHECK plus 414's ON DELETE SET NULL would otherwise make HQ deletes of `framework_competencies` fail (HQ does delete them); VERIFY D2/D3 prove it. File therefore carries the APPLY THIS FILE WHOLE banner. (2) The policy key is snake_case `scholar_study_sessions` like every sibling, a choice on/off (the codebase has no boolean policy kind), resolved to the boolean field `scholarStudySessions`. (3) Extra index `(user_id, kind, ref_id)` on the link table for reverse lookups.
  - For slice B: screen `objectiveText` for patient identifiers in the route before calling the store (as the 414 topic is); `pruneEmptySessions` deletes any Learn session left with no steps, connected ones included.
