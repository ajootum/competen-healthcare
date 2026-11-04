# SQIE-HQ — build record for migrations 995 and 996 (SQIE-CLOSE-2026-11 WS-E, WS-G, WS-F)

Owner directive SQIE-CLOSE-2026-11 (4 Nov 2026), §4 (governed Question Library) and §8 (question analytics, privacy).
Tracker: `docs/programme/SQIE-CLOSE-2026-11-TRACKER.md` (PR #269), gap rows WS-E, WS-G, WS-F.
Branch `scholar/sqie-hq-library` from `main` 661caf17. Migration numbers claimed in the shared notes
(`SQIE-HQ-migration-number-claim.md`: 995-999).

**State: 2 — applied and verified on staging** (`ezhvpgtcqcdsgylrxgdb`), each file twice. **Not applied to production.**
Production application needs a separate owner GO. `main` may hold these files before production does; the code fails
closed without them (below).

## Files, checksums, order, dependencies

| Order | Migration | sha256 (LF) | Depends on |
|---|---|---|---|
| 1 | `995-ckri-library-question-metadata.sql` | `8e2fad19e65ad5ad2da524d6b634b716162550290de2ab448e38bf55d0abf00d` | 442 |
| 2 | `996-ckri-library-item-analytics.sql` | `0315b66f39438525a716e136911531d7a96c2f6287aff9c47b38e6aa4b508a50` | 372, 416, 440, 710 (950 optional: `unmarked` is excluded where it exists) |

995 and 996 are independent of each other and of 800/801/802. Neither replaces a function another migration owns:
995 adds its own trigger instead of widening `ckri_knowledge_content_ok`, so it cannot collide with a later widening of
`ckri_question_format_ok` (the WS-A/WS-B/WS-C formats). Rollback: `ROLLBACK-995.sql`, `ROLLBACK-996.sql` (this folder).
Verification: `VERIFY-995.sql`, `VERIFY-996.sql` (this folder).

House rules (`scripts/migration-house-rules.ts`): ALL CLEAR on both (warnings only: the APPLY WHOLE constructs). ASCII
only, LF, no semicolons or apostrophes in comments, no partial unique index, `notify pgrst` last.

## What each adds

- **995 (WS-E).** `ckri_question_meta_ok(jsonb)` and the trigger `ckri_knowledge_version_meta_guard` (before insert or
  update of `content`, revision questions only). A library question's content may carry `meta`: `programmes` (1-10
  programme codes), `level` (certificate, diploma, degree, postgraduate), `difficulty` (1-3). Nothing else in `meta`.
  It sits inside the exact content the educator reviews, the clinician approves and the publisher publishes, and is
  frozen with it. The 800 learner-copy guard is unchanged (it never copies `meta`).
- **996 (WS-G).** `ckri_library_item_stats(uuid[], int, int)` and `ckri_question_format_correctness(timestamptz, int,
  int)`: security definer, `RETURNS TABLE` with declared columns and no learner id or content, execute for
  `service_role` only. Population = people whose `collective_analytics` permission (440) is granted; a cell under
  `greatest(5, p_min)` people is suppressed (all figures null); counts rounded to the CKRI base; first-attempt choice
  cells under the floor are null (the page adds complementary suppression); discrimination = point-biserial
  (corrected item-rest) over at least the floor of learners; `unmarked` attempts (950) are not answers.

## Pre-application state (staging, read 4 Nov 2026 ~10:20Z)

`ckri_question_meta_ok` and `ckri_library_item_stats` absent. Triggers on `ckri_knowledge_version`:
`ckri_knowledge_version_guard`, `_offer_guard`, `_offer_promote`, `_sod_publication`. 0 revision_question resources,
0 library copies, 0 `collective_analytics` grants, 6 published shared frameworks, 1 Scholar programme, 0 holders of
`hq.learning.ckri.educator`, `ckri_research` flag off.

## Staging application (4 Nov 2026, UTC)

Dry run first (both files plus each VERIFY in one rolled-back transaction): VERIFY-995 pass=21, VERIFY-996 pass=17.
A planted copy of 996 without the consent filter turned VERIFY-996 red (`FAIL item a`: 7 learners counted, the
non-consenting one included), so the check can fail.

Applied with `run-staging-sql.mjs`, each twice, committed both times (idempotent): 995 at 10:33:33Z and 10:33:36Z,
996 at 10:33:39Z and 10:33:42Z.

| Script | Result | What it proves |
|---|---|---|
| VERIFY-995 (10:33:55Z) | **pass=21 fail=0** | function and enabled trigger; accepted: no meta, empty meta, full meta, level only; refused: meta not an object, an unknown key, an empty or non-code or 11-long programme list, an unknown level, difficulty 4, "2" (a string) and 2.5; planted: a bad meta refused on update and on insert of a revision question with the trigger message, a good content saved, an explanation never checked. |
| VERIFY-996 (10:33:58Z) | **pass=17 fail=0** | security definer, no execute for anon/authenticated, execute for service_role, no result column naming learner data; planted 7 learners (6 consenting): the non-consenting learner never counted; percent, first-attempt and missed counts; choice cells under the floor null; discrimination positive over 6; an `unmarked` attempt not counted; rounding to 5; a floor of 10 suppresses every figure; 2 withdrawals leave 4, suppressed even when a floor of 1 is asked (never under 5); an unknown version is a suppressed row; per format (library mcq, library short) and its floor. |

Both VERIFY blocks always raise their result, so nothing they plant is kept (the runner reports the PASS as a
rolled-back error). After them: no `verify-99*` resource, 0 participation rows, every trigger enabled.

## Staging walk (4 Nov 2026) — `SQIE-HQ-walk.mts` (shared notes), through the same library functions the routes call

Three separate synthetic staging people: author (knowledge_educator, appointed for the walk), independent clinical
reviewer (existing clinical_content_reviewer, scope over the competency's framework granted for the walk by Estate
Owner A), publisher (quality_council_member, appointed for the walk). Learner: Demo Learner (Sandbox).

Short-answer item: **21 passed, 0 failed** — draft with programme/level/difficulty (995 accepted it, refused a bad
level written directly); a typed competency id outside the published catalogues refused, one picked from them saved;
educator review; submission; independent approval; the author's publication refused ("not authorised"); the separate
publisher published; `ckri_knowledge_approved` true on the exact content; the catalogue filters found it; offered to
the matching learner, not to a learner of a known other level; adaptive reuse includes it (short is an exam format);
exact copy stored through the 800 guard with difficulty 3; the learner answered with consent granted; item
performance and per-format correctness both **suppressed** (1 learner, floor 10). Cleanup: learner copy, mapping and
consent removed, the item retired with **bulk retire**, the walk scope and appointments ended.

The calculation-item walk follows WS-A's format contract (below).

## How the code fails closed

- **995 absent:** 442 ignores the extra `meta` key; the application validator (`library-meta.ts checkLibraryMeta`, via
  `validateLibraryQuestion` at save, submit and publish) still checks it.
- **996 absent:** `question-performance.ts` reads ONLY the two functions. Absent, every learner-derived figure on
  `/super-admin/research/questions` reads "Not measured: ... migration 996 is not installed", never a number. The
  direct reads of learner copies and attempts (`src/lib/hq/library-item-performance.ts`) are removed.

## Production facts this does not change

Production has 0 library questions and metering off. After 996, HQ library performance shows only consented,
suppressed figures; with 0 grants of `collective_analytics` in production it shows every cell suppressed.
