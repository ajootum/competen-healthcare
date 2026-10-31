# Migration 740 build record: connected study sessions

**Authority:** SCHOLAR-SESSION-AI-02 (owner GO for implementation, 31 Oct 2026; rulings D1 to D5 in `STATUS.md`; coordinator ruling on `objective_outcome` in the `STATUS.md` Log). Applying it to production is a separate act by the owner.

**State (CLAUDE.md, four migration states):** 2, applied and verified on staging. **Production does not have 740. The code that needs it is gated OFF** (policy `scholar_study_sessions`, default off) and fails closed while 740 is absent (see "Gate").

| | |
|---|---|
| File | `supabase/migrations/740-individual-scholar-study-sessions.sql` |
| sha256 | `6d4b9b6f46297d82e35279100bbabd38796b5834b1b01459c0520561cd4a79c3` |
| Rollback | `docs/evidence/SCHOLAR-SESSIONS/ROLLBACK-740.sql`, sha256 `431c33645d58eefc707a89587a0d0197ebdd03f0dac209c185ccb75d11ff7f41` |
| Precheck | `docs/evidence/SCHOLAR-SESSIONS/PRECHECK-740.sql` (read only, reports by raising, run before and after), sha256 `464beca1137b8678db2a75c334f2efd4d94eadad9004120ffbb313d783d109f9` |
| Verify | `docs/evidence/SCHOLAR-SESSIONS/VERIFY-740.sql` (staging behaviour checks, always rolled back), sha256 `b42bb6a52595effc8d156750405c084b5caa90610a2e6d2f65e30ce0e0b09104` |
| Depends on | **414 only** (`individual_scholar_learning_session`, its `competency_id`, and `ux_individual_scholar_learning_session_id_user`). 414 is in production. |
| Application order | 414, then **740**. 740 does not depend on any other migration (it names no activity table). |
| House rules | `npx tsx scripts/migration-house-rules.ts supabase/migrations/740-individual-scholar-study-sessions.sql` **ALL CLEAR**: 120 lines, 26 statements, 2 constraints, 3 warnings (not blocking: `$$`, `plpgsql`, `create or replace function`, each covered by the APPLY THIS FILE WHOLE banner in line 2). |
| Risk (OPS-001 s8) | Proposed **Low**: additive. Four defaulted or nullable columns and one CHECK on 414 (every existing row satisfies it), one small trigger, one new table with RLS. No backfill, no row changed, no column removed. |

## What it changes

1. **414 session becomes a study session when connected** (D1). `connected boolean not null default false`, `last_space text` (null or learn / revise / apply / evaluate), `objective_outcome text` (null or 1 to 500 characters, and never without `competency_id`), `objective_text text` (null or 1 to 300 characters, the D2 free-text objective). One CHECK, `individual_scholar_learning_session_study_check`, holds all four rules.
2. **One trigger**, `individual_scholar_learning_session_outcome_follows` (BEFORE UPDATE OF `competency_id`): when `competency_id` becomes null, `objective_outcome` is cleared. Reason: 414's `competency_id` is ON DELETE SET NULL and HQ authoring does delete `framework_competencies` (`/api/content/competencies`, `/api/studio/authoring`). With the CHECK alone, a learner's private session naming an outcome would make that delete fail. VERIFY D2 proves the delete now succeeds and clears the outcome.
3. **`individual_scholar_study_link`** (id, session_id, user_id, kind, ref_id, created_at). `kind` CHECK: revision_session, osce_attempt, flashcard_deck, case_session, evaluation, exam_paper (an exam paper's ref is its `material_id`, the 570 key). Composite FK (session_id, user_id) onto (id, user_id) of 414 via the existing unique index, ON DELETE CASCADE. Full unique constraint (session_id, kind, ref_id). Index (user_id, kind, ref_id). **No FK to any activity table**: `store.ts` proves each ref is the caller's own before writing.
4. **RLS** enabled on the link table, one read-own SELECT policy (`auth.uid() = user_id`), no grants, mirroring 414.

Nothing references `competency_verification_*`, `assessments`, Passport tables, Professional or estate tables (D5).

## Pre-application state (staging `ezhvpgtcqcdsgylrxgdb`, 31 Oct 2026)

`PRECHECK-740.sql`: 414 table, its unique (id, user_id) index and `competency_id` present; every 740 column, the CHECK, trigger, function and link table **absent**; session table **10 columns**; **0 sessions** (0 with a competency); `sessions_414_hash=none`.

Because staging holds no session, preservation of existing rows was proved separately (**E0**, one rolled-back transaction): a 414 session planted before 740 (topic, step 3, completed), then the whole 740 file, then a comparison: `E0 RESULT 414 columns unchanged=t new columns=false/null/null/null`. Nothing persisted (precheck afterwards: 740 absent).

## Applied twice (idempotent)

`echo 'ezhvpgtcqcdsgylrxgdb' | node C:/Users/elish/CompetenBackup/bin/run-staging-sql.mjs supabase/migrations/740-individual-scholar-study-sessions.sql`, each run one transaction.

- Run 1: `Done on ezhvpgtcqcdsgylrxgdb. Committed.`
- Run 2: `Done on ezhvpgtcqcdsgylrxgdb. Committed.` sha256 before and after: `6d4b9b6f...4a79c3`, unchanged.

## Post-application state and verification

`PRECHECK-740.sql` after: every 740 object present; session table **14 columns**; 0 sessions.

**Behaviour checks (`VERIFY-740.sql`): `VERIFY 740 RESULT pass=27 fail=0`**, rolled back.

| Accepted | Refused |
|---|---|
| E1 every existing session reads not connected, no space, no objective | B1 last_space `home` |
| A1 connected topic session with a free-text objective and last space | B2 an outcome without a competency |
| A2 connected competency session with an outcome of that competency | B3 a blank outcome; B4 a 501-character outcome |
| A3 last_space moves through revise, apply, evaluate | B5 a 301-character objective; B6 a blank objective; B7 connected null |
| B8 exactly 500 / 300 characters accepted | C2 the same link twice (unique); C3 an unknown kind |
| C1 six links, one of each kind | C4 a link under another user to the caller's session (composite FK); C5 a link by the caller into another user's session (composite FK) |
| D1 deleting the session removes its six links | C6 a null ref; C7 a link to no session |
| D2 deleting a (temporary) competency succeeds, the session stays, competency and outcome both null | |
| D3 clearing competency_id by hand clears the outcome | |
| D4 a plain Learn insert (as 414 code writes it) gets false/null/null/null | |
| F1 RLS on; F2 exactly one policy, SELECT, `(auth.uid() = user_id)`; F3 composite FK with cascade; F4 no other FK on the link table | |

## Rollback rehearsal

1. **Refusal**, rolled back: one connected session planted, then `ROLLBACK-740.sql`: `ROLLBACK 740 refused: 1 connected session(s), 0 with a last space, 0 with an outcome, 0 with a free-text objective, 0 study link(s) depend on 740.`
2. **Rollback committed**: `Done on ezhvpgtcqcdsgylrxgdb. Committed.` Precheck: every 740 object absent, session table back to **10 columns**, 0 sessions (the pre-application state).
3. **740 re-applied**: `Committed.` Precheck: every 740 object present, 14 columns. VERIFY again: `pass=27 fail=0`. **Staging ends WITH 740.**

## Gate: how the code fails closed without 740

- `store.ts studySessionSchema` probes the four 740 columns and the link table, keyed on the caller. A missing column or table (42703, PGRST204, 42P01, PGRST205) is remembered as absent. Every study function then answers null, `[]`, `"unavailable"` or `"study_not_provisioned"` and never throws (vitest `study-session.test.ts`).
- `createLearningSession` names no 740 column unless the caller asks for a study session, so Learn works exactly as before where 740 is absent.
- Policy `scholar_study_sessions` (choice on/off, **fallback off**) resolves to `IndividualPolicy.scholarStudySessions: boolean`. `isStudySessionsOn(policy, schema740)` is true only with both. It is shown on the HQ Individual configuration page with the other policies.

## Production

**Not applied.** For a production GO, the owner:
1. runs `PRECHECK-740.sql` (414 present, 740 absent, record the session count and `sessions_414_hash`);
2. records the recovery reference (OPS-001);
3. pastes the 740 file into the SQL editor **whole** (sha256 above);
4. re-runs the precheck: 740 present, `sessions_414_hash` unchanged;
5. only then, on a separate GO, switches `scholar_study_sessions` on in HQ.
