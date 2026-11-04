# Build record: migration 955 (LEARNING-CLOSE-2026-11 WS03, LE-03 / LE-05)

**Authority:** owner directive LEARNING-CLOSE-2026-11 (4 Nov 2026), decision D03 (learning-unit management: reorganise lesson boundaries, split or combine, re-cut session lessons without losing completed work; recalculate affected progress safely rather than transferring completion indiscriminately) and workstream WS03 LE-03 / LE-05.
**State (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb) twice (final file), strict VERIFY passed. **Not applied to production.** When merged, `main` holds 955 while production does not; the code fails closed without it (below).

## File, order, dependencies

| Migration | sha256 | Depends on |
|---|---|---|
| `955-individual-scholar-learning-session-recut.sql` | `472cf84d53f1292d8263949b97c0886bffd0a6b9348c3feaa22e0c7054df7caa` | 414 (session, step, event, event_source), 790 (position), 820 (note and artefact session columns). Independent of 950 (CYU-03) and 960 (CE-07C), which touch other columns of the same tables. |

One file. It adds two nullable columns (`individual_scholar_learning_session.lesson_titles jsonb`, `individual_scholar_learning_event.detached_at timestamptz`), one CHECK on `lesson_titles` (a JSON array of at most 200), one index (`individual_scholar_learning_event (user_id, session_id, step)`), and one plpgsql function `individual_scholar_learning_session_recut(p_user_id uuid, p_session_id uuid, p_steps jsonb, p_titles jsonb) returns jsonb`, SECURITY INVOKER, executable by `service_role` only (revoked from public, anon, authenticated). No row is written by applying it; no backfill.

Apply whole (the file carries the APPLY THIS FILE WHOLE banner: one function between dollar quotes). House rules: `scripts/migration-house-rules.ts` ALL CLEAR (the only warnings are the expected `$$` / plpgsql / create-or-replace notices for a file applied whole).

## What the function does (one transaction)

1. Locks the caller's session row (another person's session: SQLSTATE P0002, nothing touched).
2. Checks the new lessons: a non-empty JSON array of lessons, each a non-empty array of section ids; every section one the session already holds, each exactly once, none left out; 1 to 200 lessons; one title (text of at most 120 characters, or null) per lesson, or no titles. Any failure: SQLSTATE 22023, nothing touched.
3. Events, by containment: an event of old lesson k counts for every new lesson whose sections all lay inside old lesson k, or all lay inside the sections the event itself recorded as its sources. It moves to the first such lesson and is copied to the others (sources copied; a 950 `attempt_id`, where present, stays on the original only). No such lesson: `detached_at = now()` — kept as history (study days, last studied), no longer counted as any lesson's progress.
4. Step rows rewritten (delete and insert of the same sections, regrouped).
5. The current step follows the first section of the old current lesson.
6. The 790 position follows its section where it names one (card anchor, section and offset kept), else the first section of the old lesson (anchor dropped); `furthest_step` follows the same rule and never falls below the new step; `unfinished` (practice panel state keyed by lesson numbers) is cleared; revision + 1.
7. Lesson-targeted notes (820) follow the first section of the old lesson. Artefacts linked to a lesson (820) follow their own first source section, else the first section of the old lesson.
8. Returns `{ steps, sections, current_step, events_moved, events_copied, events_detached, position_moved, notes_moved, artefacts_moved }`, which the route writes to the audit row.

Nothing that hangs off the sections is touched: questions, flashcards, attempts, citations, saved explanations (415 artefact sources), section notes.

## Staging evidence (4 Nov 2026)

- Applied through the owner's runner (`run-staging-sql.mjs`, target ezhvpgtcqcdsgylrxgdb): the first draft twice (`Done ... Committed`), then the final file (the containment rule widened to the event's own sources) twice: both `Done ... Committed`. Re-running is a no-op.
- VERIFY (`verify-955-strict.sql`, a DO block that raises on failure): both columns present, the CHECK and the index present, the function present with the exact signature, `service_role` may execute it, `anon` and `authenticated` may not, and a session that is not the caller's is refused (P0002). Passed after the final application.
- Rollback: `ROLLBACK-955.sql` drops the function, index, CHECK and columns, and refuses while any detached event or lesson title exists.
- **LE-05 walk** (`le05-walk-2026-11-04.json`, the fixture learner, this branch's dev server on 3173, verification by read-only pg): a recorded document session (75 sections, 7 lessons) with read marks on lessons 0 and 1, a 790 position inside lesson 1 (`lesson-1:s15`, section followed, offset 40, an unfinished practice panel), a lesson note on lesson 1 and a saved Teach me on lesson 0.
  - Refusals first: an unchanged cut answers 400 "Nothing changed."; a cut that leaves a section out answers 400 "Every section of the session must stay in a lesson."
  - Re-cut A (split lesson 0 after its first section, merge lessons 1 and 2, name lesson 0): lesson 0's events stay on the first half and are **copied** to the second half (both halves show read + teach); lesson 1's read event is **detached** (the merged lesson is larger than anything it covered); the position follows its section to the merged lesson with its anchor (`lesson-2:s15`, offset kept, unfinished cleared); the lesson note follows to the merged lesson; the artefact link stays on lesson 0 (its first source is there); the current step follows; the title shows in the session view (`lessonTitles`).
  - Re-cut B (merge the two halves back): the merged lesson equals the sections the read mark recorded as its sources, so that mark is kept (one copy moved onto it); the Teach me event, whose recorded sources cover fewer sections than the merged lesson, is detached. The saved teaching itself is still served for the lesson (it covers the same sections, `learnLessonRecords` / `coversLesson`), so nothing the learner was taught is lost.
  - Invariants over before / after A / after B, all PASS: the material's questions, attempts, flashcards, artefacts and section notes unchanged; the session's section count unchanged (75); no event, note, artefact or position step outside the lesson range (no orphans); notes, artefact links and the position all kept; event rows never lost (copies only add).
- Browser evidence: `shots/` (the "Change the lessons" panel at 1280 and 390 wide, with Rename and Split open).

## Fail closed without it

The store probes `individual_scholar_learning_session.lesson_titles` once per process (`learningRecutSchema`). Absent: `recutLearningSession` answers `not_provisioned` and the route answers 409 "Changing the lessons is not available here yet. Your session is unchanged."; `getLearningSession` reads the 414 columns only (`lessonTitles: null`); `learningEvents` and `evaluationEvidence` read events as before (no `detached_at` filter). The "Change the lessons" panel is shown for a recorded session; its save then shows the 409 message and changes nothing.

## Not competence

A re-cut moves no learning content and creates no evidence. Events moved or copied are the learner's own learning history, re-attributed to the lessons they covered; a detached event is history only. Nothing here is assessment evidence, verified competence or a Passport record.
