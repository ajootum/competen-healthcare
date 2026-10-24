# Migration 424 (AI feedback and the debrief on a library case session): staging record

**Authority:**
- Owner GOs COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (CR4) and COMPETEN-HOLDINGS-AI-CONSUMPTION-01 (s10, C4).
- The case interface approval.
- The coordinator's decision on the Stage 5A session overlap, option (a), agreed by IND-004 and IND-007: one session record for a library play. Scholar never keeps a second store of it, and IND-004's 436 removes the library column from its private-session table.
- Coordinator range 421 to 424.

**Who and where:** the main session applied 424 on 25 October 2026 from the cfca worktree (branch `holdings/case-session-feedback`), in the order 395, 422, 423, 424, with the guarded runner. The target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok".

**OPS-001 s8 tier:** Low-Medium: a replaced guard on a table that is empty in production. The rollback was rehearsed.

**Fingerprint tool** (read-only): `npx tsx scripts/ind007-staging-schema-check.ts --cases423`. It reads `case_library_session`'s columns, constraints, triggers and the `case_%` functions.

| Step | `--cases423` |
|---|---|
| PRE (= the staging F1 of 423) | dfbea91a… |
| Apply ×2 | ok. F1 = 520d6808… |
| Rollback (ROLLBACK-424.sql, 0b3a0c3f, committed; no feedback or debrief data) | F2 = dfbea91a… = PRE (the session guard of 423 restored) |
| Re-apply ×2 | ok. F3 = 520d6808… = F1 |

**Files** (bytes matched before and after the runs):
- 424-case-session-ai-feedback.sql: sha256 90897b39a88f54802b8c3f8167f1c6f68eac33f671591996fbf28f9b9ee8c009. House rules ALL CLEAR (143 lines, 51 statements, 1 constraint, 3 APPLY-WHOLE warnings only).
- ROLLBACK-424.sql: sha256 0b3a0c3f57e45444be87d2440b4103be681b60b195859d2048db95b701571ae5. It is generated from the 423 file, so it restores the session guard of 423 byte for byte. It refuses once any session holds feedback or a debrief.

**What 424 does:**
- `case_library_session.feedback` is append-only. Each entry has `kind ai_evaluation` and names its provider, model, request, text and time, and names a decision the session has answered.
- `debrief` is written once, on a completed session, as the same AI evaluation, and is then fixed.
- 423's session guard is replaced, fix-forward. Everything it froze stays frozen. On a closed session only feedback and the debrief move. An insert cannot bring its own.
- The only writers are `recordSessionFeedback` and `recordSessionDebrief` (`src/lib/cases/library.ts`). Static K11 refuses any other writer of `case_library_session`, and has a plant.

**Proven locally before staging** (Postgres 17, after t423), `t424.sql`, sha256 f213dcc0…, Y1 to Y6 all PASS:
- **Y1:** defaults are set, and an insert cannot bring its own feedback.
- **Y2:** feedback on an answered decision is appended. Feedback on an unanswered decision, feedback calling itself an approval, and feedback with no model are all refused.
- **Y3:** feedback cannot be rewritten or removed.
- **Y4:** a debrief only at the end, and only once.
- **Y5:** a closed play is fixed, but feedback can still be appended.
- **Y6:** 423's other rules still hold, and the helper is closed to the browser roles.

Five planted violations each turned the suite red. Local rehearsal: PRE (equal to 423's local F1) = F2, F1 = F3. The rollback refuses with data present.

**Frozen.** Further changes are fix-forward.

**Dependencies:** 423. **Application order:** 395, 422, 423, 424.

**Production:** not applied, not authorised. It needs its own GO. The code is behind the `case_library` gate with the rest of the case library.

## Staging acceptance run (25 October 2026, target ezhvpgtcqcdsgylrxgdb)

`npx tsx scripts/privileged-harnesses.ts --staging --only case-intelligence-acceptance-harness`: **ALL GREEN, 23 passed, 0 failed** (commit 3374ba8c). This adds J7d to the 22 checks of the 423 run, on the real 424:
- feedback on an answered decision and the debrief are recorded on the one session, and returned labelled "AI evaluation" with their model;
- feedback naming no decision is refused, and so is a second debrief;
- direct writes are refused: emptying the feedback, changing the finished play's answers, and an entry calling itself an approval.

No model was called: the entries are synthetic and named `harness-no-call`, so J7c (no AI request) still holds.

As in every run, one retired fixture case (`CASE-HARNESS-<stamp>`) stays as the record. The flag was restored, and every fixture person was removed.
