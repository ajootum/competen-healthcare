# Build record: migration 950 (LEARNING-CLOSE-2026-11, WS01 CYU-03, owner decision D01)

**Authority:** owner directive LEARNING-CLOSE-2026-11 (4 Nov 2026), decision D01 "Check Your Understanding response storage" (approved); Wave 1 CYU-01..04 (begin without further approval).
**State (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb) twice, rollback rehearsed, re-applied. **Not applied to production.** When merged, `main` holds 950 while production does not; the code fails closed without it (below).

## File, order, dependencies

| Migration | sha256 | Depends on |
|---|---|---|
| `950-individual-scholar-check-attempts.sql` | `987b1c0829ecfb72821e0895185ab614a9799c05917a9a7b1f0215dd8ccc3c8f` | 372 (`individual_scholar_attempt`), 414 (`individual_scholar_learning_event`), 416 (`marking`, `response`), 730 (`content_version`); PostgreSQL 15 or later for `on delete set null (attempt_id)` |

One file, no new table, no row written, no backfill:
1. `ux_individual_scholar_attempt_id_user` unique (id, user_id) on the attempt table (the 372 owner-scoped identity).
2. `individual_scholar_attempt.content_version integer` (>= 1 or null): the 730 question version answered.
3. The 416 marking CHECK re-added with `'unmarked'` (an answer kept without a judgement: no score, never correct).
4. `individual_scholar_learning_event.attempt_id uuid`, FK (attempt_id, user_id) to the attempt of the same owner, `on delete set null (attempt_id)`, indexed on (user_id, attempt_id).

Passes `scripts/migration-house-rules.ts` (ALL CLEAR; warnings only for apostrophes inside comments).

## Staging evidence (4 Nov 2026)

- Pre-state (from the schema files and the first application's effect): the 416 marking rule without `unmarked`, no `attempt_id` on the event table, no `content_version` on the attempt table, no (id, user_id) index on the attempt table; 45 attempts, 127 events.
- Applied twice through the owner's runner (`run-staging-sql.mjs`, target ezhvpgtcqcdsgylrxgdb): both `Done ... Committed`.
- VERIFY (`verify-950-strict.sql`, a DO block that raises on failure): index present, column present, marking rule carries `unmarked` and keeps `ai_evaluation` / `self_graded`, `attempt_id` present, the FK is the column-list `SET NULL (attempt_id)` form, the event table carries exactly one CHECK constraint. Passed after the second application.
- Rollback rehearsed: `ROLLBACK-950.sql` applied (`Done ... Committed`), then VERIFY failed as expected (`VERIFY-950: unique index missing`), then 950 re-applied and VERIFY passed. Post-state: 45 attempts, 127 events (no row written by the migration).
- Rollback refuses while any unmarked attempt or any event referencing an attempt exists.
- Walk against this branch's staging dev server (fixture learner, session "Essential Nursing Care of the Critically Ill", lesson 2): a judged check answer kept as a `short` (extended format, 3 key points) question row and an `ai_evaluation` attempt (verdict not_yet, score 0, the written-feedback copy present, 3002 bytes) with its clarify event linked; a refused answer kept through the self-review as a `self_graded` attempt (score 0.5) with a clarify event (verdict null) linked; a revision card made for the missed check, due today.

## Fail closed without it

The store writes `content_version` and `attempt_id` only where the columns exist: a missing column is answered by keeping the attempt without the version and the event without the link (what 414 and 416 already hold). An `unmarked` answer cannot be kept while 950 is absent (the 416 CHECK refuses it; the route says "could not be saved"). The history reader (`listCheckAttempts`) answers an empty list when `attempt_id` is absent, so the lesson shows no history and the Saved learning section is not shown.

## Not competence

A kept check is the learner's own learning record: their typed answer, how it was judged (by AI, by themselves, or not at all) and what they were shown. Never assessment evidence, never verified competence, never a Passport record. Nothing that makes an evaluation or a verification reads `response`.

## Retention and deletion

A check question and its attempts go with the material (372 cascades); the event goes with the session (414), and its `attempt_id` is set null when the attempt is erased. Read access is owner-only (372 RLS unchanged); the HQ plane reads none of it.
