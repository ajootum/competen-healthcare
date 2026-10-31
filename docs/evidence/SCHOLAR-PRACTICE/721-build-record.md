# Migration 721 build record: OSCE practice station definition, versions, autosave, governed stations

**Authority:** SCHOLAR-OSCE-01 (owner, 31 Oct 2026): close the gaps between the built OSCE Practice V1 (720) and the owner instruction. The owner gave GO to prepare and validate on staging. Applying it to production is a separate act by the owner. 720 is not edited: 721 fixes forward.

**State (CLAUDE.md, four migration states):** 2, applied and verified on staging. **Not applied to production.** Production has neither 720 nor 721. The code needs both and fails closed while either is absent (see "Gate").

| | |
|---|---|
| File | `supabase/migrations/721-individual-scholar-osce-definition-versions-library.sql` |
| sha256 | `c3aa437ded2ac8521a7651eca7485a76aea15432418677d60d17bab12bdd8724` |
| Rollback | `docs/evidence/SCHOLAR-PRACTICE/ROLLBACK-721.sql`, sha256 `b9dafeac9ee8904557ba599c5519068b1b75ed71dae0bd090b7f2d2e96d043ee` |
| Precheck | `docs/evidence/SCHOLAR-PRACTICE/PRECHECK-721.sql` (read only, run before and after), sha256 `77442435e59fa9df29eaf87582c4db71bb99d4823c26f217db5c665ac01c708c` |
| Verify | `docs/evidence/SCHOLAR-PRACTICE/VERIFY-721.sql` (staging behaviour checks, always rolled back), sha256 `b4ca15bf8cd6665b8a3cfcd4b6bd8a91dd438cd45b130e99a853dd86dd3458cd` |
| Depends on | 720 (both OSCE tables), 442 (`ckri_knowledge_resource`, `ckri_knowledge_version`, `ckri_knowledge_content_ok`, `ckri_knowledge_approved`). 442 is in production (25 Oct). |
| Application order | **720, then 721.** 721 refers to 720's tables and replaces 720 constraints. |
| House rules | `npx tsx scripts/migration-house-rules.ts` ALL CLEAR: 300 lines, 63 statements, 6 constraints. It contains `$$`, `plpgsql` and `create or replace function`, so it carries the APPLY THIS FILE WHOLE banner: paste and run it in one piece. |
| Risk (OPS-001 s8) | Proposed Low-Medium: one 442 function replaced (every existing kind answered exactly as before), one new trigger. Everything else is additive or a wider CHECK. |

## What it changes

1. **No arbitrary checklist limit.** The station checklist CHECK goes from 6 to 14 items (16000 bytes) to 1 to 60 items (64000 bytes); the item shape (string id, string text, boolean critical, optional string outcome) is the 720 text unchanged. The attempt marking CHECK accepts up to 60 ticks and 60 critical misses (otherwise a longer station could not be marked); the rest of it is the 720 text. 8 to 12 stays the design default in policy.
2. **Station definition columns** (all nullable, or defaulted): `profession`, `programme_code`, `programme_label`, `topic`, `body_system`, `difficulty` (introductory, intermediate, advanced), `learning_outcomes`, `objectives`, `expected_activities` (arrays of non-empty strings), `guidance` (object: suggested responses and assessment guidance), `source_references` (array of objects; named so because `references` is an SQL reserved word), `version` (integer, default 1). Checked by the new `individual_scholar_osce_station_definition_check`.
3. **Governed stations.** `ckri_knowledge_resource_check` gains the kind `osce_station`. `ckri_knowledge_content_ok` keeps its three 442 branches byte for byte and adds an `osce_station` branch (scenario 20 to 4000, instructions 10 to 2000, whole-number duration 3 to 20, checklist 1 to 60 items of the 720 shape, optional sections, objectives, expected activities, learning outcomes, references, guidance, difficulty, profession, programme, topic, body system). A learner copy is a station with `source = 'library'`, `library_resource_id`, `library_version_id`, `review_status = 'library_approved'`; the source CHECK binds all three together. The new trigger `individual_scholar_osce_station_library_guard` refuses a copy unless the version is the published version of an active `osce_station` resource, `ckri_knowledge_approved` is true for it, and scenario, instructions, duration, checklist, expected activities, guidance and version are the published content exactly. One copy per learner and version (unique index).
4. **The attempt.** `station_version`, `station_snapshot` (the exact station the run is marked against), `status` (in_progress, finished, abandoned; finished exactly when `finished_at` is set), `last_saved_at` (autosave), `gaps` and `revision_suggestions` (only on a marked run). Checked by `individual_scholar_osce_attempt_progress_check`. One deterministic backfill: an attempt already finished gets `status = 'finished'` (staging had none).

No reference to `osce_*` (estate), `assessments`, `clinical_cases`, `competency_verification_*`, credentials or Passport tables.

## Pre-application state (staging `ezhvpgtcqcdsgylrxgdb`, 31 Oct 2026)

Read-only probe (a DO block that reports by raising, so the runner rolls back): 720 tables present, 442 present (`ckri_knowledge_approved` present), **0 OSCE stations, 0 attempts, no knowledge resources of any kind**, station 18 columns, attempt 16 columns, `ckri_knowledge_resource_check` exactly the 442 text (three kinds). The 720 constraints were as 720 wrote them (720 was applied verbatim twice on 30 Oct).

## Applied twice (idempotent)

`echo 'ezhvpgtcqcdsgylrxgdb' | node C:/Users/elish/CompetenBackup/bin/run-staging-sql.mjs supabase/migrations/721-individual-scholar-osce-definition-versions-library.sql`. Each run is one transaction.

- Run 1: `Done on ezhvpgtcqcdsgylrxgdb. Committed.`
- Run 2: `Done on ezhvpgtcqcdsgylrxgdb. Committed.` The re-run is a no-op. sha256 before and after run 2: `c3aa437d...8724`, unchanged.

## Post-application state and verification

Probe: station 32 columns, attempt 22 columns, the guard trigger present, 0 rows, `ckri_knowledge_content_ok('osce_station', ...)` true, the kind CHECK lists `osce_station`, the checklist CHECK bound is 60. Check constraints on the two tables: 720's text, sections, run checks unchanged; checklist, source, marking replaced; definition and progress added.

**Behaviour checks (`VERIFY-721.sql`): 46 pass, 0 fail**, rolled back: `VERIFY 721 RESULT pass=46 fail=0 : A1 A2 A3 B1 D1 D2 D3 D4 E1 E2 G1 G5`.

| Accepted | Refused |
|---|---|
| checklists of 1, 20 and 60 items | 61 items, 0 items, `critical` not boolean |
| a station with every definition field (profession Physiotherapy, programme, topic, body system, intermediate, outcomes, objectives, activities, guidance, references, version 2) | difficulty `expert`, objective not text, guidance not an object, reference not an object, version 0, blank profession |
| an attempt with version, snapshot, autosave time (status defaults to in_progress) | finished without status finished, status `paused`, snapshot an array, gaps on an unmarked run |
| finished, then marked with 20 ticks, gaps and revision suggestions | source library without a version, library_approved without a version, an unknown library version |
| an abandoned attempt | kind `osce_exam` |
| `ckri_knowledge_content_ok`: a full osce_station, 60 items, revision_question and explanation unchanged | osce content with 61 items, duration 8.5, `"8"`, 25, no scenario, bad item, no sections, bad difficulty, guidance/objectives/checklist as text, an unknown kind |
| **G1** a copy of a published, approved osce_station version, exactly | **G** an edited checklist copy, a copy of a draft version, guidance edited after copying, **G5** a copy once the approval is removed |

Path G needed a published, approved version. Staging has none and the CKRI and 395 guards need appointed HQ people, so the verify switched the USER triggers of the four CKRI/395 tables off inside its own transaction to plant one, switched them back on before every assertion, and rolled everything back.

**App-shape check:** the station rows the code itself builds (the respiratory template, and a 24-item competency station with profession, programme, topic and references) and their attempt snapshots were inserted in a rolled-back block: `APP-SHAPE RESULT inserted=2 of 2`.

**Rollback rehearsal**, each in a rolled-back transaction:
- A: `ROLLBACK-721.sql` with no dependent rows: station back to 18 columns and attempt to 16 (the pre-application counts), the guard gone, `ckri_knowledge_content_ok('osce_station', ...)` false again, the checklist CHECK back to 6 to 14 / 16000 and the kind CHECK back to the 442 text, marking back to 14.
- B: with one 1-item station planted it refused: `ROLLBACK 721 refused: 0 osce_station resource(s), 0 governed copy(ies), 1 station(s) outside 6 to 14 items, 0 station(s) with 721 definition fields, 0 attempt(s) with 721 fields depend on 721.`
- The post-state probe was taken after the rehearsals: staging still carries 721.

## Gate: how the code fails closed without 721

`store.ts osceSchema` now probes `select id, version` on the station table: a missing table (`42P01`, `PGRST205`) or a missing 721 column (`42703`, `PGRST204`) is remembered as not installed. OSCE practice is then shown as unavailable with its plain reason, and every OSCE route answers 409. 720 and 721 are one unit. Policy `scholar_osce` (default on) is unchanged.

## Production

**Not applied.** For a production GO, the owner applies **720 first** (its own record), then for 721:
1. runs `PRECHECK-721.sql` (all dependencies present, 721 absent, the osce_station probe false);
2. records the recovery reference (OPS-001);
3. pastes the WHOLE of the 721 file into the SQL editor (sha256 above; it has functions, so it must not be split);
4. re-runs the precheck: 721 present, the osce_station probe true, revision_question still true.

The release copy is in `RELEASE-2026-10-25/PENDING-24/` beside 720.

## Known gap reported to the owner: HQ authoring of governed stations

The read path, the database shape check and the copy guard are built, so a published, clinically approved `osce_station` resource is offered to learners and copied exactly. **The HQ CKRI authoring screen cannot yet author one**: `src/lib/knowledge/educator.ts` (`RESOURCE_KINDS`, `contentOf`) and `src/app/super-admin/research/_components/KnowledgeControls.tsx` know three kinds with flat fields, and a station needs a structured checklist editor (items, critical flags, guidance). That is more than a generic reuse, and no parallel studio was built. Until HQ authoring is extended, the station library is empty and the learner page says "No clinically approved station has been published yet."
