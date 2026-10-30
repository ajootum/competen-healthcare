# Migration 710 build record: Scholar structured questions, stored MCQ/case rubrics, governed library reuse

**Authority:** SCHOLAR-SQIE-CLOSE-01 (owner, 30 Oct 2026), the two P1 items. The owner gave GO to prepare the migration and validate it on staging. Applying it to production is a separate act by the owner.

**State (CLAUDE.md, four migration states):** 2, applied and verified on staging. **Not applied to production.** Code that depends on 710 detects whether it is present and fails closed when it is absent (see "Gate" below).

| | |
|---|---|
| File | `supabase/migrations/710-individual-scholar-structured-rubrics-library.sql` |
| sha256 | `6b45117c90c8ec4b08c391980b87f99b8db3fbc283f5fd63a1a7a4b5df68f164` |
| Rollback | `docs/evidence/SCHOLAR-QUESTIONS/ROLLBACK-710.sql`, sha256 `9a86db021e915ab2340333b77028a5e003def93f21dc153822fc81fab5c165be` |
| Precheck | `docs/evidence/SCHOLAR-QUESTIONS/PRECHECK-710.sql` (read only), sha256 `e358bd17dd3d5fed6aa0aac1a12cf5e2f18e78ec1ee35fce9bf3cc53b5f0e339` |
| Depends on | 372, 388, 416 (`individual_scholar_question`), and 442 (`ckri_knowledge_resource`, `ckri_knowledge_version`, `ckri_knowledge_approved`) |
| Application order | Any time after 442. It does not depend on any migration numbered after 442. Production already has 442 (B4, 25 Oct). |
| House rules | `npx tsx scripts/migration-house-rules.ts` reports ALL CLEAR: 163 lines, 35 statements, 3 constraints. There are 3 warnings for `$$`/plpgsql, which is expected. The file has the APPLY THIS FILE WHOLE banner. |
| Risk (OPS-001 s8) | Proposed Low-Medium. It adds one new trigger function, and three CHECK constraints are replaced by wider ones. No row is changed. |

## What it changes

1. **`kind` CHECK.** Adds `structured`.
2. **Options CHECK.**
   - An `mcq` or `case` row may now carry `answer` as `{ rubric: {...} }` and nothing more. A row with `answer` null stays valid.
   - A `structured` row has no options and no `correct_index`. Its `answer.parts` holds 2 to 4 parts. Each part needs a string `prompt` and whole-number `marks` from 1 to 5, checked by `jsonb_path_exists`, which is immutable.
   - The other 416 branches are unchanged.
3. **Review status.**
   - `review_status` may be `private_formative` or `library_approved`.
   - `library_approved` holds exactly when `library_version_id` is set.
   - A library row must be an `mcq` written by `competen-library`.
4. **Library provenance.**
   - New column `library_resource_id`, referencing `ckri_knowledge_resource`.
   - New column `library_version_id`, referencing `ckri_knowledge_version`.
   - New unique index `(user_id, library_version_id)`.
5. **Guard trigger** `individual_scholar_question_library_guard`. It refuses a library copy unless all of the following hold when the copy is written:
   - the version is the `published` version of an `active` `revision_question` resource;
   - `ckri_knowledge_approved(version)` is true;
   - the stem, options and key equal the published content exactly.

## Pre-application state (staging `ezhvpgtcqcdsgylrxgdb`, 30 Oct 2026)

- **Dependencies:** all five present (416 `answer`, 388 `competency_id`, 442 tables and function).
- **710 columns:** none.
- **Rows:** 2 `mcq` and 1 `case`. All three have `answer` null and are `private_formative`. There are no CKRI knowledge versions.
- **Constraints before** (`pg_get_constraintdef`), exactly as 416 left them:
  - `individual_scholar_question_kind_check`: `CHECK ((kind = ANY (ARRAY['mcq'::text, 'case'::text, 'mrq'::text, 'short'::text, 'flashcard'::text, 'match'::text, 'sequence'::text])))`
  - `individual_scholar_question_revision_check`: `CHECK ((((difficulty IS NULL) OR ((difficulty >= 1) AND (difficulty <= 3))) AND (review_status = 'private_formative'::text) AND ((answer IS NULL) OR (octet_length((answer)::text) <= 16000))))`
  - `individual_scholar_question_options_check`: the 416 form, in which the mcq/case branch requires `(answer IS NULL)`.

## Applied twice (idempotent)

Command: `echo 'ezhvpgtcqcdsgylrxgdb' | node C:/Users/elish/CompetenBackup/bin/run-staging-sql.mjs supabase/migrations/710-individual-scholar-structured-rubrics-library.sql`. Each run is one transaction.

- Run 1: `Done on ezhvpgtcqcdsgylrxgdb. Committed.`
- Run 2: `Done on ezhvpgtcqcdsgylrxgdb. Committed.` The re-run is a no-op.

## Post-application state and verification

**Constraints after:**
- `kind_check` includes `'structured'::text`.
- `revision_check` reads `review_status = ANY (ARRAY['private_formative', 'library_approved'])`, with the library binding described above.
- `options_check` has the mcq/case branch `(answer IS NULL) OR (jsonb_typeof(answer) = 'object' AND jsonb_typeof(answer -> 'rubric') = 'object' AND (answer - 'rubric') = '{}')`, plus the structured branch.
- The trigger and the two columns are present. The 3 existing rows still validate.

**Behaviour checks:** 17 pass, 0 fail. Every write ran inside one transaction that was always rolled back, so nothing was kept.

| Expected to be accepted | Expected to be refused |
|---|---|
| mcq with no answer | mcq whose answer holds more than a rubric (options_check) |
| mcq with a rubric only | mcq whose rubric is not an object (options_check) |
| case with a rubric only | structured with 1 part or 5 parts |
| structured with two valid parts | structured with marks of 0 or 1.5 |
| | structured with a part that has no prompt |
| | structured with options |
| | `library_approved` with no version (revision_check) |
| | any other review status (revision_check) |
| | a library copy of an unknown version, refused by the trigger: "unknown library version, or not of the named resource" |

Staging has no unpublished `revision_question` version, so the trigger refusing a real draft could not be exercised there. The trigger body checks state, status and kind, then `ckri_knowledge_approved`, then exact content.

**Rollback rehearsal:** `ROLLBACK-710.sql` was run inside a transaction and then rolled back, so nothing changed.
- It restored all three 416 definitions, identical to the pre-application `pg_get_constraintdef` output. It also removed the guard function and both library columns.
- With one structured row planted, it refused: `ROLLBACK 710 refused: 1 structured question(s), 0 mcq or case rubric(s), 0 library copy(ies) depend on 710.`
- After the rehearsal, staging was confirmed to still carry 710.

## Gate: how the code fails closed without 710

- `store.ts sqieSchema(admin, userId)` reads the 710 column `library_version_id`, keyed on the caller, once per process.
  - A missing column (`42703`, `PGRST204`) is remembered as absent.
  - A transient error counts as "no" for that request only.
- A 710 refusal seen later also marks 710 absent: a CHECK or column error on an mcq/case rubric write, or on a structured insert.
- When 710 is absent:
  - mcq and case are stored without the rubric. The first refused write retries without it.
  - Structured is filtered out of the formats offered on the revise page and in the sessions route.
  - No library copy is attempted.
- That is the 416 behaviour exactly.

## Production

**Not applied.** For a production GO, the owner:
1. runs `PRECHECK-710.sql`;
2. records the recovery reference (OPS-001);
3. pastes the file whole into the SQL editor, with sha256 above;
4. re-runs the precheck for the post-state.

The release copy is in `RELEASE-2026-10-25/PENDING-23/`.
