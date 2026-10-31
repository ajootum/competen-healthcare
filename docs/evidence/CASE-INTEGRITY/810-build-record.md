# Build record: migration 810 (SCHOLAR-CASE-INTEGRITY-01)

**Authority:** owner GO 31 Oct 2026, "Scholar Learning Continuity and Assessment Attempt Integrity", item 3, and item 4 for clinical cases. MCQ attempt snapshots (790/791) and the question library are separate branches.
**State (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb). **Not applied to production.** Once merged, `main` holds 810 while production does not; the code fails closed without it (below).
**Release folder:** `RELEASE-2026-10-25/PENDING-32/` (file, PRECHECK, VERIFY, ROLLBACK, README with owner steps).

## File, order, dependencies

| Migration | sha256 | Depends on |
|---|---|---|
| `810-individual-scholar-case-attempt-integrity.sql` | `e4bb0592a42d68f5ba7b5f66030a909ade6327987ed8ef62c7a895a3a179053e` | 422 (`case_library_version.content_hash`), 423/424 (`case_library_session`), 435/436 (private case, session, answer) |

Application order: any time after 436. Independent of 790/791. Passes `scripts/migration-house-rules.ts` (ALL CLEAR, APPLY WHOLE banner). 811 not used.

## What already persisted before 810 (inspected)

- **Private sessions (435/436):** stages reached, findings revealed, current stage, mode, status, completion time, debrief (jsonb on the session), every answer append-only (choice or written text, marking, score, safety criteria, AI feedback + model). Resume across devices already worked from server state for all of that.
- **Gap:** the askReason reason for a choice was client-only (435 CHECK holds a choice OR a written answer). No record of the attempt as completed beyond the live session row (whose debrief is updatable). The private blueprint had no writer that changes it, but the database allowed it.
- **Library sessions (423/424):** progress, answers (with reasons) on `case_library_session`, closed once completed; version content frozen from submission (422 guard). **Gap:** no attempt record; a resumed library play lost the answered view (key, rationales) of answered decisions; feedback list covered only AI-evaluated decisions.

## What 810 adds

1. `individual_scholar_case_reason`: one reason per (private session, decision), 1-1500 chars, only beside a CHOICE already answered (guard), never changed. Library reasons stay on `case_library_session.answers` (one read path per kind).
2. `individual_scholar_case_attempt_snapshot`: one per completed session (unique on private or library session id), `case_ref` own:/lib:, `content_hash` (32 hex, checked against the live case by the guard), `record` (v1), `rubric` + generated `rubric_hash`, `standing` CHECK = formative, `completed_at` taken from the session by the guard. 200000-byte CHECK. UPDATE refused, DELETE only by cascade.
3. `individual_scholar_case_attempt_correction`: append-only, per decision; guard fills `previous_*` from the effective result, refuses a no-op and a decision not in the record; reason 10-500; basis rubric_error/key_error/marking_error/other; `hq_actor` with id or `system_rule`.
4. `individual_scholar_case_blueprint_fixed` trigger: a private blueprint cannot change after it is written (pinning without a new column).

## Staging evidence

- PRECHECK before: all three tables false, `case_fixed_trigger=0`, 435 answer CHECK md5 `855b3e5bbaea853da96de67f6e0aa830`.
- 810 applied twice: Committed, Committed. PRECHECK after: `columns=6/13/13 | checks=1/1/1 | rls=true/true/true | policies=1/1/1 | triggers=1/1/1 | case_fixed_trigger=1 | rows=0/0/0`, answer CHECK md5 identical.
- VERIFY-810 (sha256 `9ad218d0...d7ec`): **pass=41 fail=0 library=run**. R1-R8 reason rules; B1-B2 blueprint fixed, title still editable; S0-S11 snapshot (active session refused, wrong hash, wrong case, other learner, fields incl. completed_at from session and rubric_hash, second refused, UPDATE/DELETE refused, standing verified refused, too large, kind mismatch, no library session); C1-C10 corrections (previous partial/0.5 from record, chain, no-op, unmarked, not in attempt, short reason, actor without id, UPDATE/DELETE, other learner); L1-L4 library snapshot against a planted completed `case_library_session` (wrong hash refused, kept, second refused, cascade); G1-G3 RLS, policies, 435 CHECK; H1-H2 cascade from the session and the material.
- Planted controls: reason and correction guards dropped inside the VERIFY transaction -> pass=29 fail=12 (red as expected), blueprint trigger dropped -> run fails. Both rolled back.
- Rollback rehearsed (0 rows), PRECHECK back to absent, re-applied, VERIFY 41/0 again.
- Store-level probe over PostgREST with the real `clinical-play.ts`, `store.ts` and `case-integrity.ts`: 14/14 (reveal, answer + reason, resume from server, reason UPDATE refused, completion, snapshot kept then "exists", read back formative with reason and rubric hash, snapshot UPDATE refused, correction with previous filled, no-op refused, finished view with the correction, cascade cleanup, rows back to 0). Staging ends with 810 applied, rows 0/0/0.

## Code

- `store.ts`: `insertCaseReason`; `getPrivateCaseSession` reads reasons; `insertCaseAttemptSnapshot` (23505 -> "exists"), `getCaseAttemptSnapshot`, `insertCaseAttemptCorrection`; `caseHistory` adds `kept`. All keyed on the caller's user_id (A1), the only writer (A4).
- `case-integrity.ts` (new): pure `buildCaseAttemptRecord` (bounded by cutting long texts, never dropping a decision), `outcomeOf`, `effectiveDecisions`, `attemptView`; server `keepCaseAttemptSnapshot` (idempotent), `readCaseAttempt` (keeps a missing record on first open of a finished case), `recordCaseAttemptCorrection` (validation + one codes-only `audit_log` row `individual_scholar_case_attempt_corrected`). No HQ UI: a future HQ caller checks its own capability first.
- `clinical-play.ts`: private askReason reason POSTed and kept after the answer (no learner error when not kept); play view returns `reasons` and, when finished, `attempt` and the kept debrief.
- `library.ts`: `LoadedCase.contentHash`, `SessionView.answeredViews`, read-only `sessionAttemptSource` (server-only; K7/K11/K12 unchanged).
- `clinical-routes.ts`: library resume returns every answered decision with its answered view; `finishPlay` keeps the record after the last answer's AI feedback is recorded; finished library views carry `attempt`.
- Answer route: accepts `reason` for both kinds (screened for identifiers); calls `finishPlay`.
- `case-client.tsx`: sends the reason for both kinds; "Your completed attempt" panel (kept date, "This case has changed since you completed it" when the hash differs or a library version is no longer current, corrections beside the original). Apply history: "finished, record kept".
- Formative wording kept; nothing writes Passport, competence or evaluation records.

## Fail closed without 810

Reason insert fails -> false, browser keeps the reason. Snapshot read not provisioned -> no write attempted, no panel. History `kept` false.

## Checks run

vitest: `case-integrity.test.ts` (11, new), `clinical.test.ts`, `library.test.ts`, `learn-guided.test.ts`, `intelligence-complete.test.ts` (67 total, green). Harnesses: `scholar-learning-harness` 163/0, `case-intelligence-harness` 38/0, `design-system-themes-harness` 96/0, `migration-house-rules` ALL CLEAR. `tsc --noEmit` clean. eslint clean on changed files.
