# Build record: migration 820, the personal learning library (SCHOLAR-LIBRARY-01)

- **Authority:** owner instruction 1 Nov 2026, "Competen Scholar -- Persistent Learning Library and Search" (GO to implement), plus the coordinator additions of 1 Nov (flashcard search, linked vs matched lessons, version history view, deck `archived_at`, no 500-row cap, nothing exposed to Professional).
- **State:** 2 (applied and verified on staging). Not in production. Code behind policy `scholar_learning_library` (fallback on) AND 820 schema detection, failing closed.
- **File:** `supabase/migrations/820-individual-scholar-learning-library.sql`, sha256 `981c3584bf0359e3237360501ceb2c591e23c3e4b062a72777a465314003688d` (the same bytes as `RELEASE-2026-10-25/PENDING-33/`).
- **Depends on:** 372, 414, 415, 416, 730. PostgreSQL 15+. Application order: any time after 730; independent of 790/791/810.
- **House rules:** `scripts/migration-house-rules.ts` ALL CLEAR (3 non-blocking warnings: `$$`, plpgsql, function, all under the APPLY THIS FILE WHOLE banner).

## Pre-application state (staging ezhvpgtcqcdsgylrxgdb, PG 17.6)

`pg15 true | depends true/true/true/true | artefact_kind_check=b5eb18f0a777978e0b2488532c767473 | note_table_820=false | note_columns=0 | note_checks=0 | artefact_cols_820=0 | artefact_checks=2 | artefact_session_fk=false | deck_archived=false | search_fn=false | note_trigger=0 | rls=false | policies=0 | indexes note=0 artefact_new=0 card_tsv=0 | rows notes=0 superseded=0 archived=0` (6 artefacts, 0 decks).

## Staging results (1 Nov 2026)

1. Applied twice: Committed, Committed.
2. PRECHECK after: `note_table_820=true | note_columns=15 | note_checks=2 | artefact_cols_820=4 | artefact_checks=3 | artefact_session_fk=true | deck_archived=true | search_fn=true | note_trigger=1 | rls=true | policies=1 | indexes note=6 artefact_new=3 card_tsv=1 | rows 0/0/0`; `artefact_kind_check` unchanged.
3. VERIFY-820: `pass=52 fail=0` (artefact link/full text/kept versions and their refusals, note shapes and refusals, one bookmark per target, cross-learner FKs, touch trigger, search over teaching/notes/session/flashcard front and back/card note, never a superseded version, never another learner, `{{hl}}` marks, total, grants, session delete keeps teaching and nulls the link, cascades, deck column, RLS and policy).
4. Planted refusals: with `ux_individual_scholar_note_bookmark`, `individual_scholar_artefact_library_check` and `individual_scholar_note_kind_check` dropped inside the VERIFY transaction, VERIFY goes red: `pass=38 fail=14`.
5. Rollback rehearsal: ROLLBACK-820 (0 rows) back to the exact pre-application state, re-applied, VERIFY `pass=52 fail=0`.
6. Store-level probe with the real `store.ts` / export code over the staging API: `38/0` (refresh keeps v1 and serves v2, `learnLessonRecords` sees the current version only, 31 current rows read as 25+6 with keyset and none repeated, earlier-versions view, date filter, notes/bookmark dedupe/highlight, foreign chunk and another learner's artefact refused, search for teaching/note/session with exact total and paging, exports selected/material(31)/lesson(with note and highlight)/range, PDF builds, cleanup verified).

Staging ends WITH 820 applied, 0 learner rows.

## Behaviour

- **Library (study/saved, title "My learning library")**: views Recently studied / Continue learning / Completed learning / Saved for revision; filters material, topic, competency, date range, status (any, has your notes, bookmarked, earlier versions), sort; 25 a page, keyset on (created_at, id) or (last_active_at, id), no 500 cap. Each saved teaching: title (its lesson when linked or matched, else its first heading), material, date, version label, "Earlier versions (n)", provenance chips, "Linked to its lesson" vs "Matched by sections", Review saved lesson (Learn session deep link, or Learn on its own sections for unlinked rows; no AI on open), flashcards and practice counts, OSCE gaps link, its session, PDF.
- **Lesson link**: written on new saves only (act route SAVE path, the caller's own recorded session). Older rows are never guessed: matched only when the most specific lesson's chunk set leads their sources exactly (learn-journey `coversLesson`), and an equally specific tie stays unlinked.
- **Versions**: a refresh marks the previous row superseded (key rewritten to `key:superseded:id`) and inserts the new one; a failed insert restores the previous row as current. `?version=<id>` lists every version with its own citations and provenance.
- **Search**: one RPC, `websearch_to_tsquery('english')`, ranked `ts_rank` then recency, over current teaching, notes, session titles, flashcards (front and back) and flashcard notes; snippets marked `{{hl}}`, rendered as `<mark>` from text parts only. No AI.
- **Notes**: `api/individual/scholar/library/notes` GET/POST/PATCH/DELETE, own rows only, lengths validated (note 1-4000, highlight quote 1-500), patient-identifier screen, codes-only audit; UI in each Learn lesson card ("Your notes on this lesson": add a note, bookmark, highlight selected text) and in each library item.
- **Export**: `?selected=` (up to 100, any version, also one box per item), `?topic=`, `?from=&to=` added to lesson/material/study; exactly one scope; the learner's notes and highlights under "Your notes". Material and range exports page through (up to 1000 teachings).
- **Fallback without 820**: lists and filters work (statuses limited to Any), search is a basic all-words match over the newest 500 and says so, notes hidden, refresh replaces as before.
- **Professional / lifecycle**: every row is keyed on user_id and read only through the Scholar store under `requireIndividualContext("scholar")` / `experienceModulePage(..., "study")`; nothing in Professional, employer or HQ surfaces reads `individual_scholar_artefact` or `individual_scholar_note` (no plane-boundary entry), and no code deletes them on experience change. Erase-all now also deletes notes explicitly (they cascade anyway).

## Acceptance note: more than 500 rows

The library never reads saved teaching 500 at a time: views and exports page by keyset. Proved by the vitest "pages through more than 500 rows with no row skipped or repeated" (1234 rows) and the staging probe (31 rows across two pages). The coordinator's 30-lesson staging acceptance and a >500-row seeding remain browser/seed checks. Remaining bounded reads: the basic (no-820) search looks at the newest 500 by design and says so; topic/competency filters consider at most 300 matching saved teachings per page query; one export holds at most 1000 teachings.

## Harness change

`scripts/scholar-learning-harness.ts` S1 bans "learning library" in Scholar code (a shared library). The owner named the learner's own private library, so exactly `My learning library`, `scholar_learning_library` and `scholarLearningLibrary` are removed before the S1 test; new plant P14b proves S1 still goes red on "shared learning library" and on any other `learningLibrary` name.
