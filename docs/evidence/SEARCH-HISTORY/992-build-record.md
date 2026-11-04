# Build record: migration 992 and branch `scholar/search-history-01` (SCHOLAR-SEARCH-HISTORY-01, My Search History)

**Authority:** owner directive "COMPETEN SCHOLAR — MY SEARCH HISTORY" (4 Nov 2026, P1, SALE learner continuity). Retention: owner decision 4 Nov 2026 (learner-owned records kept until the learner deletes them; deletion follows the documented policy for primary records and backups).
**State of 992 (CLAUDE.md four states):** 2, applied and verified on staging (`ezhvpgtcqcdsgylrxgdb`) twice, rollback rehearsed. **Not applied to production.** When merged, `main` holds 992 while production does not. The feature is behind `scholar_search_history`, which defaults OFF, and fails closed without 992.
**Number:** 992, from the coordinator's 992-994. Before claiming: no 992-994 on `origin/main` or any remote branch, and no 992-994 objects on staging. 993 and 994 are unused. Claim note: `SEARCH-HISTORY-migration-number-claim.md` in the shared notes.

## Phase 1: what Scholar already keeps (read-only inventory, 4 Nov 2026)

| Activity | Kept per learner today? | Table and writer | In the history |
|---|---|---|---|
| Learn material search (`study/learn?q=`) | **No**, address only | None. `learn-search.ts` reads | **Captured from now on** |
| Library search (`study/saved?q=`) | **No**, address only | None. 820 search function reads | **Captured from now on** |
| Ask Scholar in a lesson (Learn `ask`) | **Words no.** One event with the action and step, in recorded sessions only | `individual_scholar_learning_event` (414), through `learn/act` | **Captured from now on.** Old events hold no words, so they are not shown |
| Ask about this panel (`learn/assistant`) | **No** | None. It keeps nothing | **Captured from now on** |
| Understand questions (`explain`) | **No** (owner ruling D10; the audit row holds ids and counts) | None | **Captured from now on** |
| Ask answers, all three | **No, and still not.** | None | Never. The entry says the answer was not kept |
| Research searches | **Not per learner.** The cache has no user id, and `plat_research_requests` has no user or query | `individual_scholar_research_cache` (570, shared public cache) | Keywords are not recoverable. Saved teaching that includes research is shown as **Teaching with research** |
| Teaching requests and saved explanations | **Yes** | `individual_scholar_artefact` (415, 820), through `learn/act` | **Recovered at read time**, current versions |
| Lessons and study sessions | **Yes** | `individual_scholar_learning_session`, `_step` (414) | **Recovered at read time** |
| Revision sessions, question history, checks | Yes | Their own tables | Not searches. Left in Revise and Question history |
| Topic bookmarks in Learn | This device only | `localStorage` | No: not a record |
| Practice `practice_search_history` | Another product | Practice | Not reused (product separation) |
| `plat_ai_requests`, `ai_usage_ledger` | Platform records, no question text | Platform | Not used. Platform records are not the learner's history |

**So, for the pilot learners:** their saved teaching and lessons appear at once. Their earlier searches and Ask questions were never kept and cannot appear. Nothing is backfilled, invented or regenerated.

## Migration 992

| File | sha256 | Notes |
|---|---|---|
| `supabase/migrations/992-individual-scholar-search-history.sql` | `9905e719e3c3873d770aa8a3268daef7a2a4f0aa703f4f2fd088b372a5c539b0` | Depends on 372, 414, 415, 820. Any time after those. Needs PostgreSQL 15 (as 820) |
| `VERIFY-992.sql` | in the PR | Staging only: 24 shape probes and the behaviour probes, all undone |
| `VERIFY-992-prod.sql` | `f21b98892dacba726bb1b5a3e6ba320ea98b876009c33c11f498df90d78efa80` | Structure only: catalogue reads, no learner row, no DML, ALTER or trigger change |
| `ROLLBACK-992.sql` | `40305c6b5190d97efd32c2d9305927d3eb5c548fa5faf5a46f0e3f076e9c3461` | Drops the two functions and the table. Refuses while any entry exists |
| `PRECHECK-992.sql` | `df657f473f020538806e2c04190643de25d952e1f82ff5ad2df8f051fef27af0` | Read only |

Additive only: one table, two functions. No existing table, column, constraint or row changes.
- **`individual_scholar_search_history`:** `captured` rows hold the learner's submitted words, an optional topic and references, never an answer. `recovered` rows are marks only: pinned or removed from the history. Composite foreign keys refuse another learner's material, saved teaching or lesson. Plain unique index on `(user_id, request_key)`. RLS on, read own, one policy.
- **`individual_scholar_search_history_list(...)`:** newest first, full text, filters. Captured rows plus current saved teaching and lessons, read at request time. SECURITY INVOKER, service_role only.
- **`individual_scholar_search_history_clear(p_user_id)`:** one statement, touches this table only. SECURITY INVOKER, service_role only.

House rules: ALL CLEAR (2 warnings, the APPLY WHOLE constructs).

### Staging evidence (run with `run-staging-sql.mjs`, whole file, one transaction)

| Step | Result |
|---|---|
| PRECHECK before | no table, no functions; 15 artefacts, 5 sessions, 285 events, 12 notes, 138 attempts, 9 materials |
| VERIFY-992 before 992 | **red**: "table individual_scholar_search_history is missing" |
| 992 applied twice | 18:29:13Z and 18:29:16Z (4 Nov), Committed both times, same sha256 |
| VERIFY-992 | Committed (PASS), three runs in a row |
| Planted expectation (`captured_empty` expected accepted) | **red**: "probe captured_empty was refused, expected accepted". The control can fail |
| ROLLBACK-992 rehearsal (one transaction, rolled back) | table and both functions gone, then rolled back on purpose; staging unchanged, VERIFY passes |
| VERIFY-992-prod on staging | passes |

The first VERIFY pass hid a flaky probe: two rows with the same transaction clock tied on "newest first". It went red on a later run and was fixed by giving the second probe a later time. The list itself breaks ties by entry key.

### Fail closed
- **Without 992:** `historySchema` is false. The page says it is not available yet, GET, PATCH and DELETE answer 409, and a capture keeps nothing and shows no error. Unit tests cover codes 42883, PGRST202 and 42P01, and that no table is touched. A transient error is never remembered as absent.
- **Key off (the default), proven live on staging** (`walk-key-off-*.log`, 6/6): the page says it is not offered, GET, PATCH and clear answer 403, a capture answers `{ kept: false, reason: "off" }`, Learn has no link and no key field, the library has no link, no row is written.

## What was built

- **Model:** `search-history.ts` (pure), `search-history.test.ts`.
- **Reads and writes:** appended to `store.ts`, the one Scholar write site (harness rule A4).
- **Route:** `api/individual/scholar/library/history` (GET, POST capture, PATCH pin, DELETE one or all).
- **Page:** `study/saved/searches`, linked from Learn's search box and the library's views. Filters for activity, material, topic, date and pinned; full text with marked snippets; a pinned strip; 25 a page.
- **Actions:** Pin, Save for revision (the existing 820 bookmark), Remove, Clear with a confirm step.
- **Capture:** a hidden `hk` key on the two search forms and `RecordSearch` on their results; `recordHistory` after a reply in Learn's Ask, the Ask panel and Understand.
- **Design system:** `LearningSectionHead`, `LearningIcon`, `DisclaimerBadge`, `learnBox`, `learnTone`. Each activity names a tone and an icon and says what it is in words.

**Links.** "Open the saved answer" (library version view), "Open its saved lessons" (library filtered to the lesson), "Open the section" and "Search again" cannot call a model. "Continue the lesson" is separate and plainly worded: Learn opens saved teaching as saved, but writes teaching for a part not yet reached and records the visit. The page says so.

**Capture rules.** Submitted only: no keystrokes, empty queries or clicks. Words are 2-300 characters and must hold a letter or digit. One key per submission, so a retry is the same row; a reload reuses the address's key. The same words of the same activity within two minutes are one entry. Words that look like patient identifiers are never kept (`findPatientIdentifiers`). A question is kept once Scholar replied, including "this isn't in your notes". A clarify prompt is not yet a reply, so it is kept when the learner answers it.

## Privacy and retention

- Learner-owned, keyed on the guard's id. RLS read own. Service role on server routes only.
- **HQ:** `=individual_scholar_search_history` is governed in `plane-boundary-scan.ts` with NO allowlist entry, so any landlord-plane read is refused. No audit row is written, because a row naming a learner's searching would itself be identifiable activity outside their plane.
- **Employers, educators, other learners:** nothing reads it. A test lists the only files that may name the table (the model, the store, the scan).
- **Personal AI:** nothing feeds it. The same test holds that no AI context file reads the table.
- **Deletion:** Remove deletes a captured row, or marks a recovered record removed. Clear does both in one statement. Neither touches saved teaching, lessons, attempts, evidence, notes or materials (walk step 10, VERIFY).
- **Retention:** kept until the learner deletes it; no new rule. Primary rows go at once. Backups follow the documented backup and retention policy. Account deletion cascades from `profiles`.

## Proof

**Plane boundary:** `plane-boundary-1-green.log` (63 passed); a planted HQ read in `scholar-analytics/load.ts`: **red**, `REFUSED ... [TABLE_NOT_ALLOWED] individual_scholar_search_history` (`plane-boundary-2-planted-red.log`); restored, green (`plane-boundary-3-restored-green.log`).

**Staging walks** (`walk/`, screenshots in `walk/shots/`). Two fixture learners, A `harness-guided-browser@competen.test`, B `scholar-demo@competen.demo`, with magic-link sessions minted by the staging service role: no password read or typed.

| Acceptance item | Result |
|---|---|
| Existing history appears | A's total = current saved teaching + lessons + captured; newest first |
| A cannot read B's history, nor B A's | Page and API hold none; pin, remove and hide answer 404; naming A's lesson, teaching or material keeps none of those references; filtering by A's material shows nothing |
| Saved answers and lessons reopen with 0 AI calls | AI rows 412 → 412 across both; learning events unchanged across the lesson open |
| New searches appear | Learn search, library search and Ask, at the top |
| Retries do not duplicate | Reload of the same results adds nothing; same key is `existing`; typing without submitting and an empty query keep nothing |
| Filters and search | Full text with marks; activity, material, topic and date |
| Delete and clear | Remove deletes the row; a removed lesson leaves the history and stays in its table; clear asks first, Cancel keeps all, confirm empties B, A unchanged, B's records unchanged |
| Across devices | 1440 and a 390 phone context show the same entries in the same order; a phone search tops the desktop's list |
| Records and progress unchanged | artefacts, sessions, events, attempts, materials, cards, notes: before = after |
| Responsive | No horizontal overflow at 1440, 820, 390 |
| Real Ask UIs (`walk-ask-ui-*.log`, 8/8) | The Ask panel and Learn's Ask each keep one row with its reference, and the page says the answer was not kept. **2 AI calls, made on purpose.** No column can hold an answer |

Final `walk-*.log`: **ALL PASS, 59/59**, 0 AI calls, 0 application console errors, no 5xx.

`walk-194357-events-moved-by-another-session.log` is kept on purpose. Its one red line is A's events going 359 → 371: every new row was teach or resume on session 2b9fccd2 at 19:46-19:48Z, the lesson another session's walk uses. That walk never opened a lesson. Later runs show no change.

## Defects the walks found, fixed here

1. A submit before hydration sent an empty key: nothing was kept, safely. The key is now written on mount and again on submit.
2. `!withheld` dropped questions answered "this isn't in your notes", and the clarify path skipped capture. Both are now kept.
3. "Open the lesson" could not honestly promise no AI, so lessons got a library link and a separate Continue link.
4. The Ask panel said "Nothing is saved", which is untrue once the question is kept. It now says the answer is not saved and, where the history is offered, that the question is kept there.

## Limits

- Earlier searches and Ask questions cannot appear: they were never kept.
- Research keywords are not kept. Only saved teaching that includes research shows.
- Removing a recovered entry has no undo in the page.
- Understand's follow-up tutor turns are not captured; only its first question box is. Personal AI's own page is not captured: it is not Scholar's Ask.
- Search words are kept when a material is erased (the material link goes). They are the learner's own words and clear separately. Account deletion removes them.

## Staging rows left

- `scholar_search_history` published ON (`staging-config.sql`). Production stays at the default, OFF.
- On fixture A: a few captured entries and one 820 bookmark from Save for revision.
- 2 AI calls on A from the Ask proof, and the earlier debugging runs of that script.
- Walk rows from earlier runs were removed (history table only).

## Follow-up: the owner's mock-up (branch `scholar/search-history-mockup`, after #287)

Page only. **Migration 992 is unchanged**: same file, same sha256, same VERIFY and ROLLBACK. No new migration, policy key, route or table.

- One card: "My Search History", its subtitle, Clear all and a history icon in the header, a rounded search box ("Search your history..."), chips All, Searches, Ask Scholar, Lessons, Research, and a Filters control holding material, topic, date and pinned.
- Rows: an icon tile, a bold title, a muted line with the activity and date, a ⋯ menu (Continue the lesson, Pin, Save for revision, Remove) and a chevron. The whole row opens the saved item through its first "open" link, never Continue. The mock-up's sample rows are not used: only real records, with an honest empty state.
- The Activity filter became the chips. `?activity=` became `?show=`. Searches and Lessons each span two activities: 992 lists one activity at a time, so `listSearchHistory` reads each list as far as the page needs and `mergeHistoryPages` merges them. This avoids a second migration. It is bounded by the page cap.
- Row labels follow the mock-up: Ask Scholar, Materials search, Library search, Previous lesson. **Deliberately not "Research search":** research keywords were never kept, so the row says Teaching with research.
- The AI disclaimer badge now shows where AI-written words are on a row (a search snippet), not on every saved-teaching row. Opening the answer still shows the library's label. The Research chip could not be exercised with real rows on staging: fixture A has no teaching with research, so the walk proves only that it shows nothing else.
- `LearningIcon` gains `clock`, `search` and `chevron` (additive).
- **Defect found by looking at the screenshot, not by the assertions:** later rows' ⋯ buttons painted through an open menu. Fixed. The first version of the check passed on the broken code, so it was replaced by a grid across the panel: 7 of 585 points covered on the old stacking (red), 0 on the fix.

Proof: the walk logs in `walk/` from this branch. Earlier logs are from #287.
