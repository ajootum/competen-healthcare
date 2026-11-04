# SALE-R5 — build record for migration 986 (transfer read from the R2 transfer checks; fix forward of 985)

SALE-2026-11 R5, tracker rows SALE-15 (and SALE-10, whose data it reads). Branch `scholar/sale-r5-effectiveness`.
Number from the R5 claim (985-989).

**State: 2 — applied and verified on staging** (`ezhvpgtcqcdsgylrxgdb`), twice. **Not applied to production.**

## Why

985 counted a transfer attempt by a `response.transfer` marker. The R2 session confirmed on 4 Nov that R2 sets no such
marker. Instead, a transfer attempt is an ordinary 416 attempt made in a transfer-check revision session. It is identified
by a join to `individual_scholar_transfer_check` (migration 970, R2 branch `scholar/sale-r2-retention`, staging only) on
`(revision_session_id, question_id, user_id)`. It counts as answered well when `score >= 0.75`, or when `correct` is true
and there is no score: the learning-state rule A2. 985 is committed and applied on staging, so it is not edited. 986
replaces its function.

## File, checksum, order, dependencies

| Order | Migration | sha256 (LF) | Depends on |
|---|---|---|---|
| after 985 | `986-scholar-effectiveness-transfer.sql` | `55c3d38d7b9233d1d1fd6e0dd94075d1e3c9b1cfded2900cbc350af0d9d8e3de` | 985 (and 372, 414, 416, 440, 950). 970 optional |

- **970 is optional.** The 970 read is a dynamic query behind a `to_regclass` presence check. 986 therefore installs and
  runs before 970: transfer reads `not_measured` while 970 is absent. Once 970 is applied, transfer is counted with no
  re-run. Production can take 985, 986 and 970 in any order after 985.
- **Verification files:**
  - `VERIFY-986.sql` (strict, plants and always rolls back; sha256 `fe13a00f…4072`). It supersedes VERIFY-985 once 986 is
    in: VERIFY-985 expects the marker behaviour.
  - `VERIFY-986-prod.sql` (structure only, no DML or ALTER). It supersedes VERIFY-985-prod: run it after 986.
- **Rollback:** `ROLLBACK-986.sql` restores the 985 function, byte for byte. ROLLBACK-985 removes the function entirely.
- **House rules:** ALL CLEAR (warnings for the APPLY WHOLE constructs only). ASCII, LF.

## What changes

- **Language.** The function is now plpgsql, with the same name, arguments, declared columns, security definer, pinned
  search_path and service_role-only execute.
- **transfer / all.** Counted from the 970 join over consenting learners and marked attempts in the window, with the 0.75
  rule. The cell is `not_measured` (every figure null) while 970 is absent.
- **The other 14 cells** are computed exactly as in 985.
- **The readout and export** show `not_measured` as "Not measured", with the reason. `src/lib/hq/effectiveness/measures.ts`
  has updated wording and a test.

## Pre-application state (staging, 4 Nov 2026 18:30Z)

- 985 installed (language sql).
- 970 present with 16 transfer-check rows.
- 1 `collective_analytics` grant (Demo Learner, no activity).

## Staging application (4 Nov 2026, UTC)

- **Dry run** of 986 + VERIFY-986 in one rolled-back transaction: **PASS pass=29**. That is every 985 check plus the
  following:
  - transfer = 6 learners, 4 answered well, 67%. A learner with score 0.5 who was marked correct is not counted as well,
    because the score rule wins. An unmarked answer, an answer to a non-transfer question in the same session, and a
    non-consenting learner are all excluded.
  - floor 7 suppresses the transfer cell.
  - with 970 renamed (inside the transaction only), transfer is `not_measured` with every figure null, and the other
    cells are unchanged.
- **Controls proved able to fail.** These planted versions were not applied:
  - a 986 that uses `a.correct` only → `FAIL transfer: numerator 5`;
  - a 986 without the consent subquery → `FAIL nobody consents but a cell is not none`.
- **Applied twice**, committed, at 18:30:39Z and 18:30:41Z. VERIFY-986: **PASS pass=29** (18:30:43Z). anon cannot
  execute and service_role can.
- **VERIFY-986-prod on staging: PASS pass=17.** Rehearsed with 970 absent (renamed in a rolled-back transaction):
  **PASS pass=17**. That is the production situation until 970 is applied.
- **ROLLBACK-986 rehearsed** in a rolled-back transaction: the function goes back to language sql and the privileges are
  kept. Staging stays on 986.

## Gates

- `individual-config-harness`: ALL GREEN 56/56.
- `plane-boundary-harness`: ALL GREEN 63/63.
- Vitest (`src/lib/hq/effectiveness`): 15/15.
- ESLint: clean.
- tsc: see the PR body.
