# Migration 780 build record: Scholar study plan settings

**Authority:** SCHOLAR-COMPANION-01, Learning and Progress Intelligence E (owner GO 31 Oct 2026). Applying it to production is a separate act by the owner.

**State (CLAUDE.md, four migration states):** 2, applied and verified on staging. **Production does not have 780.** The code that needs it is gated OFF (policy `scholar_study_plan`, default off) and fails closed while 780 is absent.

| | |
|---|---|
| File | `supabase/migrations/780-individual-scholar-study-plan.sql` |
| sha256 | `b51368c5040a603d5b883aa0efa3f03a4f72fd2a9992b3662dfbad2625eeed32` |
| Precheck | `PRECHECK-780.sql`, sha256 `c72935a8601b4ab8ab3ca1e059a5c4dc675e4fe4d102cc7811dde12c56b63339` (read only, reports by raising) |
| Verify | `VERIFY-780.sql`, sha256 `f951cb4d7159efb5e955cb946ba96e82850f8b741d15bb83df0fdf6702a47bfc` (always rolled back) |
| Rollback | `ROLLBACK-780.sql`, sha256 `6332cf1489b6f03cbe8e29c5d63b6fa908729e2a8b2bb5a589e956df857b4e22` (refuses while any plan row exists) |
| Depends on | `profiles` only. Application order: any time, then 780. Independent of 730 and 740. |
| House rules | `npx tsx scripts/migration-house-rules.ts` ALL CLEAR (76 lines, 6 statements) |
| Risk (OPS-001 s8) | Proposed **Low**: one new table, no existing object touched, no function or trigger, no backfill |

## What it changes

`individual_scholar_study_plan` (user_id PK, FK to profiles ON DELETE CASCADE; exam_date, exam_label, weekly_minutes, days_per_week, goal, priorities text[], created_at, updated_at). CHECKs: exam_label non-blank and up to 120 characters, weekly_minutes 30 to 3000, days_per_week 1 to 7, goal non-blank and up to 300, cardinality(priorities) at most 10 and their joined length at most 2000. RLS on, one read-own SELECT policy `individual_scholar_study_plan_read_own`. No grants. Writes only by the server (service role) in `store.ts`. The plan itself is computed on request and never stored.

## Pre-application state (staging, 31 Oct 2026)

`PRECHECK-780.sql`: `profiles_table=true | study_plan_table_780=false | columns=absent | checks=0 | rls=false | policies=0 | plans=0`.

## Applied twice (idempotent)

`echo ezhvpgtcqcdsgylrxgdb | node C:/Users/elish/CompetenBackup/bin/run-staging-sql.mjs supabase/migrations/780-individual-scholar-study-plan.sql`
- Run 1: `Done on ezhvpgtcqcdsgylrxgdb. Committed.`
- Run 2: `Done on ezhvpgtcqcdsgylrxgdb. Committed.` sha256 before and after identical.

## Post-application state and verification

`PRECHECK-780.sql` after: `study_plan_table_780=true`, columns `user_id:uuid:NO, exam_date:date:YES, exam_label:text:YES, weekly_minutes:integer:NO, days_per_week:smallint:NO, goal:text:YES, priorities:ARRAY:NO, created_at:timestamptz:NO, updated_at:timestamptz:NO`, `checks=5 | rls=true | policies=1 | plans=0`.

**`VERIFY-780.sql`: `VERIFY 780 RESULT pass=21 fail=0`** (rolled back). Accepted: defaults (A1), the limits themselves and a full row (A2), a second learner's own row (C1). Refused: 29 and 3001 minutes, 0 and 8 days, 121-character name, blank name, 301-character goal, 11 priorities, null priorities, null minutes, a second row for the same learner, a row with no profile. Posture: RLS on, exactly one SELECT policy `(auth.uid() = user_id)`, 5 CHECKs, FK to profiles with cascade, primary key, 9 columns.

## Rollback rehearsal

`ROLLBACK-780.sql` committed on staging: precheck showed the table absent. 780 re-applied (Committed) and VERIFY again `pass=21 fail=0`. **Staging ends WITH 780.** (Refusal with a plan row present is by construction: the guard counts rows before the drop.)

## Gate: how the code fails closed without 780

- `store.ts studyPlanSchema` probes the table once, keyed on the caller. `getStudyPlan` answers `{ ok: false, notProvisioned: true }`, `saveStudyPlan` refuses `not_provisioned` and `clearStudyPlan` answers `not_provisioned` when the table is missing (42P01 or PGRST205). None throws.
- Policy `scholar_study_plan` (choice on/off, fallback off) resolves to `IndividualPolicy.scholarStudyPlan`. `isStudyPlanOn(policy, schema780)` is true only with both. Shown in HQ Individual configuration with the other policies.
- The Progress page hides the card when the policy is off or the table is absent. The route `/api/individual/scholar/study-plan` answers 403 (policy off) or 409 (780 absent).

## Production

**Not applied.** See `RELEASE-2026-10-25/PENDING-29/README.md` for the owner steps.
