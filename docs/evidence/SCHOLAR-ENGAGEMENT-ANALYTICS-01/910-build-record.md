# SCHOLAR-ENGAGEMENT-ANALYTICS-01: Learner Engagement & Usage Analytics (build record, migration 910)

**Authority:** owner instruction 3 Nov 2026, "Competen Scholar: Learner Engagement & Usage Analytics" (pilot scope, section 13). **Branch:** `scholar/engagement-analytics-01` (worktree `competen-mmods`).
**State of 910 (CLAUDE.md):** 2, applied and verified on STAGING (ezhvpgtcqcdsgylrxgdb) 3 Nov 2026, left APPLIED. **Not applied to production.** Production needs its own owner GO with the OPS-001 safeguards. The page fails closed without it: the API answers 409 "not set up" while `hq_config.analytics_pseudonym_salt` is absent, and the two capabilities do not exist, so nobody but an owner can even open the page.

## What was reused (nothing duplicated)
| Need | Reused |
|---|---|
| Who is a learner | `individual_live_entitlement` (experience scholar, database clock) and `hq_account_classification` (migration 650: human / demo / test / system / unclassified) |
| Activity records | the Scholar tables that already exist: uploads (`individual_scholar_material`), Learn sessions + steps (`_learning_session`, `_learning_event`), saved explanations (`_artefact`), flashcard reviews (`_review`), revision sessions, clinical case sessions, OSCE attempts, Evaluate (`_evaluation`), My Plan (`_study_plan`, `_calendar_entry`), competency self-assessments (`asmt_instance`, respondent = subject) |
| AI usage and cost | `plat_ai_requests` (the gateway's per-request estimate and tokens), `ai_usage_ledger` (settled costs, AI-FAIR-USE-01) and `ai_allowance_account` (allowance utilisation). No second ledger. |
| Access and audit | HQ capabilities and positions (264), `requireHqCapability` / `hqApiGate`, the plane boundary allowlist, `audit_log` |
| Navigation | the HQ nav registry (`nav-tables.ts`, version 1.5.0), under Competen Individual |

## What is new
- **Migration 910** (plain SQL, additive): `hq.scholar.analytics.view` (granted to Individual Product Administrator and Individual Product Reviewer), `hq.scholar.analytics.identifiable.read` (granted to NO position: owner decision through HQ Positions), `hq_config.analytics_pseudonym_salt` (random, generated once).
- **`src/lib/hq/scholar-analytics/`**: `metrics.ts` (pure: activities, active days, sessions, estimated active time, AI sums, summary, breakdowns, weekly trend, detail), `pseudonym.ts` (HMAC pseudonyms "Learner XXXX", unique in the set, resolvable only on the server), `range.ts` (Today / 7 / 30 / 90 / custom, reporting days in Africa/Nairobi), `load.ts` (narrow reads, `onlyFrom` this folder), `dashboard.ts` (the one builder behind the page's first render and the API: identity rule, testing filter, audit row).
- **API** `GET /api/hq/individual/scholar-analytics` (`hq.scholar.analytics.view`): `named=1` and `include=demo,test` need the identifiable right or ownership, else 403 before any read. An anonymous answer carries pseudonyms only (no name, email, id). Each identifiable answer inserts one `audit_log` row (`scholar_analytics_identifiable_read`, counts and range only, no name).
- **Page** `/super-admin/individual/scholar/analytics` (nav: Competen Individual, "Learner Engagement"): summary cards, date-range controls, Anonymous | Show learner names (drawn only when the caller may), include demo/test (same), learning activity breakdown (started / completed / abandoned / resumed), AI expenditure by activity, searchable sortable leaderboard (Top 20 per page), learner detail panel (summary, weekly trend, progress participation, AI incl. allowance, recent 20), and the method/limits disclosure. No composite score.
- **Plane boundary**: exact entries for eleven Scholar activity tables (ids, timestamps, statuses, counts only, never content) readable from the analytics folder alone; `asmt_instance` gets a second entry for that folder (self-assessment start and submission only), and `policyFor` now picks the entry whose `onlyFrom` covers the reading file. Harness controls AC10b/AC10c prove the folder cannot read an answer table or widen `asmt_instance`.

## Definitions (also shown on the page)
- **Meaningful activity**: one per record of the kinds above; flashcard reviews and plan edits are bundled per reporting day. A Learn session with no step is not an activity. A page refresh writes no record and is never counted.
- **Active day**: a reporting day (Africa/Nairobi) with at least one activity started or completed. **Study session**: Learn, revision, case, OSCE or self-assessment started.
- **Abandoned**: started, not completed, nothing for 7 days. **Resumed**: Learn resume events.
- **Active study time (estimated)**: Learn = step gaps up to 30 min each + 5 min for the last step; revision and case = start to last activity up to 60 min; OSCE = recorded duration; everything else carries no time. Never inferred from an open tab or from login/logout.
- **AI expenditure**: gateway estimate (`cost_usd` per request) shown as "est."; settled ledger figures shown separately, never added. Allowance utilisation from the current `ai_allowance_account`.
- **Accounts**: demo, test and system excluded; human and not-yet-classified included (the unclassified count is shown). Demo/test can be included by an authorised person for testing.

## Verification
- Vitest 18/18: `metrics.test.ts` (dedupe, no-step session, idle cap, abandon, flashcard bundling by Nairobi day, self vs assessor-led, per-learner figures, summary, breakdowns, ranges), `pseudonym.test.ts` (stable, salted, unique, resolve), `route.test.ts` (anonymous body names nobody, 403 before any read, Named View adds names + one audit row without a name, owner testing filter, detail by key only, 409 without salt).
- Harnesses: plane-boundary 63/0, hq-guard 51/0, hq-nav-registry 33/0, auth-boundary ALL GREEN, migration-house-rules ALL CLEAR on 910. `tsc` and `eslint` clean.

## sha256
```
5daa24b35661ea0380df9d9db4a4d6afd85460a2448618eceb236f7d54312f2c  910-scholar-engagement-analytics.sql
```
Helpers: `VERIFY-910.sql` (6 checks, raises its RESULT line), `ROLLBACK-910.sql`.

## Staging records (ezhvpgtcqcdsgylrxgdb, 3 Nov 2026)
```
APPLY-1                 Done, Committed.   VERIFY-1: RESULT VERIFY 910 pass=6 fail=0
APPLY-2 (no-op)         Done, Committed.   VERIFY-2: RESULT VERIFY 910 pass=6 fail=0
ROLLBACK-910            Done, Committed.   VERIFY: pass=2 fail=4 failed: V1:capabilities=0 V2:view_grants=0 V4:salt_column=0 V5:salt_value  (as expected)
APPLY-3 (re-apply)      Done, Committed.   VERIFY-3: RESULT VERIFY 910 pass=6 fail=0   (staging left APPLIED)
```
Headless walk (staging owner, dev server on the branch): see the PR text and `docs/evidence/SCHOLAR-ENGAGEMENT-ANALYTICS-01/walk-3nov.txt`.

## Production facts (read-only, 3 Nov 2026) and genuine limitations
- 4 live Scholar learners, all **unclassified** (50 accounts: demo 37, human 12, test 4). With the default rule they are included and flagged "not yet classified"; a human-only default would show nobody until the owner classifies them.
- `ai_usage_ledger` holds 0 rows in 30 days (metering OFF), so every AI figure is the gateway's estimate; `ai_allowance_account` has 0 rows, so allowance utilisation reads "no allowance account".
- `plat_ai_requests`: 96 rows in 30 days, `attribution_scope` person, operations such as individual_scholar_learn, personal_ai_scholar_teach.
- No page-view or presence tracking exists and none was added: active study time is estimated from the records above and labelled so. If the owner wants measured time, that is a new client event stream (section 7 of the instruction), deferred.
- Learn sessions on production: 8 rows, all `active`; nothing is ever marked completed by the product today, so Learn "completed" will read 0 until the product records completion.

## Owner decisions
1. Who holds `hq.scholar.analytics.identifiable.read` (currently no position; owners only).
2. Keep unclassified accounts included by default (recommended until the 4 live learners are classified), or human-only.
3. GO to merge and deploy; separate GO to apply 910 to production (owner applies; package RELEASE-2026-10-25/PENDING-41).
