# Build record: migrations 790 and 791 (SCHOLAR-CONTINUITY-01)

**Authority:** owner GO 31 Oct 2026, "Scholar Learning Continuity and Assessment Attempt Integrity", items 1, 2, 4 and 5 (item 3, clinical case attempt integrity, and the question library are separate work).
**State (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb). **Not applied to production.** When merged, `main` holds both migrations while production does not; the code fails closed without them (below).
**Release folder:** `RELEASE-2026-10-25/PENDING-30/` (both files, PRECHECK, VERIFY, ROLLBACK, README with the owner steps).

## Files, order, dependencies

| Migration | sha256 | Depends on |
|---|---|---|
| `790-individual-scholar-learning-position.sql` | `17b142f9f72d69454996de290f3d99aa7c1291ce7db39a26673a1c8779be7341` | 414 (session, its `(id, user_id)` unique index) |
| `791-individual-scholar-attempt-snapshots.sql` | `334fd2af3d0f16271767fd6224fa442acb0d73e101ba0c7ee081afb5e9ec9f01` | 372, 416 (attempt table) |

Application order: **790 then 791** (independent; either may go alone). Both pass `scripts/migration-house-rules.ts` (ALL CLEAR; `APPLY THIS FILE WHOLE` banner, ASCII, no semicolons in comments, no partial unique index, `notify pgrst` last).

## Staging evidence

- Pre-application (PRECHECK): `position_table_790=false | put_function=false`; `snapshot_table_791=false | correction_table_791=false`; 416 `individual_scholar_attempt_choice_check` = `CHECK ((((chosen_index IS NULL) <> (response IS NULL)) AND ... (octet_length((response)::text) <= 8000))))`.
- 790 applied twice, 791 applied twice: all Committed. Post-PRECHECK: 790 table 15 columns, checks=1, rls=true, policies=1, function present, execute anon=false / authenticated=false / service_role=true. 791 snapshot 17 columns, correction 12, checks 1/1, rls true/true, policies 1/1, triggers 1/1, and the 416 CHECK text identical before and after.
- VERIFY-790: **pass=24 fail=0** (S1-S11 the stale-write rule, scenario by scenario; C1-C5 CHECK refusals; F1-F3 foreign key and required fields; G1-G4 RLS, policy, grants, one row; H1 cascade with the session).
- VERIFY-791: **pass=22 fail=0** (snapshot kept; second snapshot refused; UPDATE and direct DELETE refused by the trigger; another learner refused; too large, bad version, bad outcome, wrong question refused; correction chain fills `previous_*` from the effective result; a no-op correction refused; correction UPDATE and DELETE refused; short reason and actor without id refused; the original attempt unchanged; RLS and policies; 416 CHECK unchanged; snapshot and corrections removed with the attempt).
- Rollback rehearsed for both (0 rows), both re-applied, both VERIFY green again.
- Store-level probe over PostgREST with the real store functions: 11/11 (rpc first write, stale refusal, read-back, another learner refused as not_found, snapshot insert, correction with filled previous, no-op refused as unchanged, integrity read-back, API UPDATE refused, cascade cleanup). Staging ends with 790 and 791 applied, rows 0 and 0.

## 790: the stale-write rule (database-enforced, mirrored by `learn-position.ts` decidePositionWrite)

Checked in order; the first that holds decides:
1. `first`: no row yet.
2. `same_device`: the stored row came from this device and the incoming `client_seq` is greater. (A device's own moves arrive in order, so a deliberate jump back on the device in use is recorded; a late retry is not.)
3. `informed`: the incoming `base_revision` equals the stored `revision` (the writer saw the latest position): any move, back or on.
4. `progress`: otherwise, only if `client_updated_at` is later AND (`step` greater OR the completed activity is newer).
5. else `stale`: refused. Only `furthest_step` (a grow-only maximum) is merged.

Device clocks are compared only with device clocks, and only in rule 4, so skew can at most decide whether an advance is taken, never cause a regression. A device more than 10 minutes ahead of the server is refused at the route. On refusal the client adopts the server revision and drops the stale write; the learner's next move on that device is informed.

## 790: when Learn writes (`PositionSync`)

At once (coalesced 300 ms): a lesson after its 3 s dwell, a navigator jump, Continue, a learning mark (activity, check verdict, practice answered). Scrolling: never a write by itself, at most one write per 15 s while interacting, only if the position changed. Page hidden or `pagehide`: what is dirty, with `keepalive`. Nothing before the learner engages. One write in flight. The device-local copy stays (fast restore, offline). On open, the server position wins when its device time is later than the local copy; revealed lessons are the furthest either knows. `unfinished` holds only `{ v: 1, practiceOpen }`, never AI output or notes content. 790 absent: the first answer is `{ provisioned: false }` and writing stops; GET answers `position: null`.

## 791: snapshots, corrections, read path

Snapshot fields: `question_version` (`lib:<version id>` or `own:<content_version>`), `content_hash` (16 hex over stem, options, key, marking guide, rationale), `presented` (stem, options in the order shown with original indexes, match choices with their key indexes, structured part prompts), `response` (a choice as presented and original index), `answer_key` (+ rationale), `rubric` + `rubric_hash` (rubric-snapshot.ts v1), `score`, `outcome`, `marking`, `feedback` (formative feedback where AI-evaluated), `competency_ids`, `assessed_at`. Bounded to 16384 bytes; cut back in a fixed order (feedback, rubric detail, long answer text, rationale, option text, stem).

Write path: `POST /attempts` (mcq, case) and both `revision/answer` paths call `keepAttemptSnapshot` after the attempt is stored. 791 absent: nothing kept, nothing said. Any other failure: one `audit_log` row `individual_scholar_attempt_snapshot_failed` (codes only), the answer stands. The 416 CHECK is unchanged: a choice keeps `chosen_index` on the attempt.

Read path: the revision session route, the Revise page and the adaptive report (`getRevisionSession(..., { integrity: true })`) read snapshot and corrections; `feedbackView` shows the question as answered with "This question has changed since you answered" when the live hash differs, and each correction with its basis, date and reason beside the original result. The mistakes notebook still reads the live question (not changed here).

Corrections: append-only; `previous_*` filled by the trigger from the effective result; a no-op refused; `corrected_by_kind` `hq_actor` (with id) or `system_rule`. Effective result = latest correction, else the attempt. Entry point: `recordAttemptCorrection(admin, { learnerId, attemptId, correctedScore, correctedOutcome, reason, basis, actor })` in `attempt-integrity.ts`, with one `audit_log` row `individual_scholar_attempt_corrected` (codes only). No HQ UI: a future HQ action must check its own capability before calling it. Corrections are display-level: mastery and progress still read the attempt row.

## Item 5: prompt caching (measured from code, tokens ~ chars/4)

Minimum cacheable prefix: 1024 tokens (Sonnet/Opus), 2048 (Haiku). Learn and every other Scholar AI call use the `reasoning` tier (Sonnet). The Anthropic adapter marks the whole system block. Every Scholar system prompt is static text, identical for every learner, except High-yield with exam evidence.

| Surface | System size |
|---|---|
| Learn teach, notes only | 3479 chars ~870 tok (with references ~938, + background ~1006, + research ~1128-1264) |
| Learn high-yield | ~977-1046 tok; with exam evidence ~1081 tok (contains the learner's own past-paper count) |
| Other Learn actions | ~454-1018 tok |
| Revision generation, verification, evaluation, cases, OSCE, exam papers | ~140-794 tok |
| EDUCATIONAL_BOUNDARY (appended only for risk-flagged requests) | ~150 tok |

Shared stable prefix across Learn actions (EXPLAIN_SYSTEM / teaching base) ~363 tok: below the minimum, so splitting a stable block out would cache nothing. Systems already over 1024 (research, some reference variants) are static and already cache as they are. No restructure. One change: High-yield with exam evidence no longer marks its system block (`GenerateArgs.cacheSystem: false`), because that block is per learner (cache-write premium, no reuse).

## Checks run

vitest: `learn-position.test.ts` (31), `attempt-snapshot.test.ts` (19), and 25 existing test files of touched code (402 tests, one wiring expectation updated for the `kept` variable). `scholar-learning-harness.ts` ALL GREEN 163/0 (A1, A4). `individual-foundation-harness.ts` 74/0 (2a write sites). `design-system-themes-harness.ts` 96/0. `migration-house-rules.ts` ALL CLEAR for both. `tsc --noEmit` clean. eslint clean on changed files.
