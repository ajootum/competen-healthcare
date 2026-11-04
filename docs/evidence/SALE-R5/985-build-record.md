# SALE-R5 — build record for migration 985 (SALE-2026-11 R5: SALE-15, SALE-16, SALE-18)

Owner directive SALE-2026-11 (4 Nov 2026) §10 (learning effectiveness and optimisation), §3, §13 (privacy), §14.
Tracker `docs/programme/SALE-2026-11-TRACKER.md` rows SALE-15, SALE-16, SALE-18. Branch `scholar/sale-r5-effectiveness`
from `main` ab25a09e. Migration number claimed in the shared notes (`SALE-R5-migration-number-claim.md`: 985-989; only 985 used).

**State: 2 — applied and verified on staging** (`ezhvpgtcqcdsgylrxgdb`), twice. **Not applied to production.** Production
needs a separate owner GO. The code fails closed without it: the readout says "Not measured: ... (migration 985) are not
installed here" and shows no learner-derived figure. Cost, reuse and latency (SALE-16) need no migration.

## File, checksum, order, dependencies

| Migration | sha256 (LF) | Depends on |
|---|---|---|
| `985-scholar-effectiveness-analytics.sql` | `3fe768c221eae587221a7df223a37dc947cd75c2147e7e5512595c8dc8ee2b30` | 372, 414, 416, 440, 950 (all in production) |

Independent of 990-998 and of every other in-flight number. Adds one function, no table, column or row.
Verification: `VERIFY-985.sql` (strict, plants and always rolls back; sha256 `fa224c41…07bd`) and `VERIFY-985-prod.sql`
(structure only, no DML or ALTER; sha256 `295958f3…f29c`). Rollback: `ROLLBACK-985.sql` (drops the function, never refuses).
House rules (`scripts/migration-house-rules.ts`): ALL CLEAR (3 warnings: the APPLY WHOLE constructs). ASCII, LF.

## What it adds

`ckri_scholar_effectiveness_stats(p_since timestamptz, p_min int, p_round int)`: security definer, stable, search_path pinned,
`RETURNS TABLE(measure, arm, cell_state, learners, denominator, numerator, rate, value)`, execute for `service_role` only.
Population = learners whose `collective_analytics` permission (440, scope all) is granted. A cell under `greatest(5, p_min)`
learners is `below_floor` with every figure null, a cell nobody contributed to is `none`. Counts rounded to the CKRI base,
rates from exact counts. Always the full 15-row catalogue (measures and definitions in the migration header and in
`src/lib/hq/effectiveness/measures.ts`). Reads only `response.kind`, the R1 `response.adaptive` need/round/capped, and the
transfer marker of a response; never a stem, an answer text, feedback or an evaluator output.

## Pre-application state (staging, 4 Nov 2026 ~15:53Z)

`ckri_scholar_effectiveness_stats` absent. 1 `collective_analytics` grant (Demo Learner (Sandbox), no Scholar activity).
`ai_fair_use` flag off (metering off).

## Staging application (4 Nov 2026, UTC)

- Dry run first: 985 + VERIFY-985 in one rolled-back transaction: **PASS pass=25**.
- Controls proved able to fail: a planted 985 without the `status = 'granted'` filter → `FAIL withdrawn still counted or floor
  under 5`. A planted 985 without `greatest(5, …)` → the same FAIL. Neither was applied.
- Applied with a staging-only runner (refuses the production ref), committed twice: 15:53:10Z and 15:53:13Z. No error.
- VERIFY-985 after application: **PASS pass=25** (15:53:17Z). VERIFY-985-prod on staging: **PASS pass=13** (0 of 15 cells
  reported: under the floor).

## Staging walk (HQ readout)

`walk/sale-r5-walk.mts` against the staging dev server (port 3195), signed in as the synthetic "ASMT demo reviewer"
(Individual Product Administrator, holds `hq.scholar.analytics.view`). **20 PASS, 0 FAIL** (`walk/walk.log`): anonymous export
refused (401); 15 cells; 12 suppressed ("Fewer than 10 learners", no figure); 3 "No data yet"; nothing reported; "Metering off,
no data" shown, no `$0` anywhere; engagement and no-target notes; no consenting learner id in the HTML or either export;
standard vs adaptive "Not compared"; Markdown and CSV exports download; phone width 390 without horizontal scroll; Learner
Engagement links to it; 0 console errors; no 5xx. Shots in `walk/shots/`, export samples `walk/export-sample.md|csv`.
Five Chromium notices about the platform report-only CSP header (`upgrade-insecure-requests`, next.config.ts, every page)
were counted apart, as the R1 walk does.

**Staging data change for the walk:** to have cells with data that must be suppressed, the synthetic R1 fixture learner
`harness-guided-browser` (32142f0d…) was given a `collective_analytics` grant (`notice_version = 'sale-r5-walk'`, row
f7a974ce…) at 16:21Z and **withdrawn** at 17:29Z after the walk (the 440 trail refuses deletion by design, so the row stays
as withdrawn). No other staging row was changed.

## Gates

- `tsc --noEmit`: clean. ESLint on every touched file: clean.
- Vitest: new suites `src/lib/hq/effectiveness/measures.test.ts`, `src/lib/ai/activity-cost.test.ts` (26 tests), and the touched
  areas `src/lib/hq`, `src/lib/ai`, `src/lib/knowledge`, `src/app/api/hq/individual`: 69 files, 722 tests passed.
- `scripts/ci-harnesses.ts`: 67/68 on the first run; the red one was `individual-config-harness` G5 (a new route under
  `/api/hq/individual` must be pinned). Added **G8** pinning the new door (view capability first, GET only, page gated first,
  learning figures from 985 only) with three planted red cases: harness ALL GREEN 56/56.
- `scripts/plane-boundary-harness.ts`: ALL GREEN 63/63. A planted direct read of `individual_scholar_attempt` in the loader
  turned A1 red; restored, green.

## Open

- Owner GO: merge, and 985 in production (with VERIFY-985-prod).
- Transfer: RESOLVED by migration 986 (`986-build-record.md`). R2 sets no `response.transfer` marker: transfer is read from the 970 join, `not_measured` while 970 is absent. VERIFY-986 and VERIFY-986-prod supersede VERIFY-985 and VERIFY-985-prod once 986 is applied.
