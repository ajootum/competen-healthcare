# Migration 720 build record: Scholar OSCE practice stations and attempts, and the adaptive revision mode

**Authority:** SCHOLAR-PRACTICE-EXAMS-01 (owner, 30 Oct 2026): OSCE Practice and Adaptive Exams in Competen Scholar, educational and formative only, never verification. The owner gave GO to prepare the migration and validate it on staging. Applying it to production is a separate act by the owner.

**State (CLAUDE.md, four migration states):** 2, applied and verified on staging. **Not applied to production.** Code that depends on 720 detects whether it is present and fails closed when it is absent (see "Gate" below).

| | |
|---|---|
| File | `supabase/migrations/720-individual-scholar-osce-practice-adaptive-mode.sql` |
| sha256 | `37036ea82760afa619185a8a5d1eca9927d9b79ceb9ecb484f2ee9269d0c50f2` |
| Rollback | `docs/evidence/SCHOLAR-PRACTICE/ROLLBACK-720.sql`, sha256 `4a6aba967031d0c16ca9c51f9f8bd895cfeaa8bfec3ffa3334675e3347b7344c` |
| Precheck | `docs/evidence/SCHOLAR-PRACTICE/PRECHECK-720.sql` (read only, run before and after), sha256 `a3c5401432376a691c06bdad9b7834f292d6c249181488dcff54b9c79a92c9bc` |
| Verify | `docs/evidence/SCHOLAR-PRACTICE/VERIFY-720.sql` (staging behaviour checks, always rolled back), sha256 `6ecbfdf95e25a4f38f5a7ab2b84a63582a7ad95f38dff527d28a755785146669` |
| Depends on | `profiles`, 372 (`individual_scholar_material`, `individual_scholar_chunk`), 388 (`framework_competencies`, referenced as `individual_scholar_question.competency_id` references it), 417 (`individual_scholar_revision_set`, `individual_scholar_revision_session`). PostgreSQL 15 or later. |
| Application order | Any time after 417. It does not depend on 710 or any other migration after 417. Production already has 372, 388 and 417. |
| House rules | `npx tsx scripts/migration-house-rules.ts` reports ALL CLEAR: 238 lines, 36 statements, 8 constraints. No `$$`, no function, so no banner is needed. |
| Risk (OPS-001 s8) | Proposed Low. Two new tables. Two CHECKs replaced by wider ones that every existing row already satisfies. No row is changed. No function, no trigger. |

## What it changes

1. **Adaptive revision mode.** `individual_scholar_revision_set_check` and `individual_scholar_revision_session_check` gain `'adaptive'` in the mode list. Every other part of both is the 417 text unchanged. (Used by the Adaptive Exams work, built in parallel.)
2. **`individual_scholar_osce_station`.** A simulated station the learner practises alone.
   - title, scenario, candidate instructions, `duration_minutes` 3 to 20 (default 8);
   - `sections`: 1 to 6 non-empty strings, the response sections the learner writes under;
   - `checklist`: 6 to 14 objects, each with a non-empty string `id`, a non-empty string `text`, a boolean `critical` and an optional string `outcome` (checked by `jsonb_path_exists`, which is immutable);
   - `source` one of `template`, `competency`, `ai`, `own`. A template row has a `template_key` (one copy per learner and key, unique index). An AI row has a `material_id` and its `model` and `prompt_version`. Only AI rows have a model;
   - `content_status`: the label shown with the station (for example "Competen practice template - not clinically reviewed");
   - `review_status` can **only** be `private_formative`.
   - `competency_id` references `framework_competencies` on delete set null. `material_id` and `chunk_id` are composite `(id, user_id)` foreign keys on delete cascade (the AI station text came from that material).
3. **`individual_scholar_osce_attempt`.** One timed run.
   - `started_at`, `finished_at`, `duration_seconds` (0 to 1200, set together with `finished_at`), `time_up` (only on a finished run);
   - `responses`: an object of section to text, at most 24000 bytes;
   - the self-check: `ticks` (1 to 14 objects `{itemId, mark}`, mark one of `done`, `partly`, `missed`), `score` 0 to 1, `critical_missed`, `marking` (`self_graded` or `ai_evaluation`). These four are written together and only on a finished run;
   - `ai_evaluation` holds exactly when `evaluator_model` is set, and the model and prompt version are set together (the 416 rule);
   - `feedback`: an object, at most 16000 bytes.
   - The station is a composite `(station_id, user_id)` foreign key on delete cascade.
4. **RLS** on both, own-row SELECT policy only (D6, as 372 and 417). The server writes through the service role.

No reference to `osce_*`, `assessments`, `clinical_cases` or `competency_verification_*`.

## Pre-application state (staging `ezhvpgtcqcdsgylrxgdb`, 30 Oct 2026)

`PRECHECK-720.sql`, read only:
- **Dependencies:** all seven present (profiles, 372 material and chunk, framework_competencies, 417 set and session, server version 15 or later).
- **720 tables:** both absent.
- **Constraints before** (`pg_get_constraintdef`), exactly as 417 left them: the mode list `today, quick, spaced, weak, mock, flashcards, custom` on both.
- **Rows:** no revision set or session rows on staging.

## Applied twice (idempotent)

Command: `echo 'ezhvpgtcqcdsgylrxgdb' | node C:/Users/elish/CompetenBackup/bin/run-staging-sql.mjs supabase/migrations/720-individual-scholar-osce-practice-adaptive-mode.sql`. Each run is one transaction.

- Run 1: `Done on ezhvpgtcqcdsgylrxgdb. Committed.`
- Run 2: `Done on ezhvpgtcqcdsgylrxgdb. Committed.` The re-run is a no-op.

## Post-application state and verification

- Both tables present, RLS on, one SELECT policy each (`*_read_own`). Foreign keys: station to profiles (cascade), material and chunk (composite, cascade), framework_competencies (set null). Attempt to profiles (cascade) and station (composite, cascade). 0 rows.
- Both mode CHECKs now include `'adaptive'::text`, the rest unchanged.

**Behaviour checks (`VERIFY-720.sql`): 29 pass, 0 fail.** The block always ends by raising its result, so the runner rolled everything back: `VERIFY 720 RESULT pass=29 fail=0`.

| Accepted | Refused |
|---|---|
| own station, 6 items, 4 sections | checklist of 5 items |
| template station with key | `critical` not boolean, item without `id`, empty `text`, `outcome` not a string, item not an object |
| attempt started (no ticks) | duration 25 minutes |
| finished, self-graded, time up | review status other than `private_formative` |
| finished, ai_evaluation with model, prompt version and feedback | ai station with no material or model |
| adaptive revision set | no sections |
| adaptive revision session | template with no key |
| deleting the station removes its attempts | AI station on another user's material (foreign key) |
| | ticks on an unfinished run |
| | mark `5`, mark `passed`, score 1.5 |
| | ai_evaluation without model, marking `verified` |
| | duration 5000 seconds |
| | attempt by another user on this station (foreign key) |
| | revision mode `exam` |

**Rollback rehearsal**, each inside a transaction that was rolled back:
- A: `ROLLBACK-720.sql` with no dependent rows dropped both tables and restored both 417 definitions, identical to the pre-application `pg_get_constraintdef` output.
- B: with one adaptive session planted, it refused: `ROLLBACK 720 refused: 0 OSCE station(s), 0 OSCE attempt(s), 0 adaptive set(s), 1 adaptive session(s) depend on 720.`
- After the rehearsals staging was confirmed to still carry 720 (precheck post-state).

## Gate: how the code fails closed without 720

- OSCE: `src/lib/individual/scholar/osce-store.ts` probes `individual_scholar_osce_station` once per process. A missing relation (`42P01`, `PGRST205`) is remembered as absent. A transient error counts as "not available" for that request only. While absent, the Apply page shows the OSCE entry as unavailable with a plain reason, and every OSCE route answers 409 with that reason. Nothing else in Scholar changes.
- Adaptive: owned by the Adaptive Exams work. Until 720 is applied the 417 CHECK refuses `mode = 'adaptive'`.

## Production

**Not applied.** For a production GO, the owner:
1. runs `PRECHECK-720.sql`;
2. records the recovery reference (OPS-001);
3. pastes the migration into the SQL editor (sha256 above; no function, so a splitting runner is also safe);
4. re-runs the precheck for the post-state: both tables present and `adaptive` in both mode CHECKs.

The release copy is in `RELEASE-2026-10-25/PENDING-24/`.
