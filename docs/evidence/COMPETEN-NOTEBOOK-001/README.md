# COMPETEN-NOTEBOOK-001 P1 and SCHOLAR-NOTEBOOK-UX-002: build record

**Authority:** owner instructions COMPETEN-NOTEBOOK-001 (Personal Notebook and Free-Form Capture) and SCHOLAR-NOTEBOOK-UX-002 (Instant Ideas & Notes Capture), 6 Nov 2026. Owner decision "Coordinated Learning Experience Completion", same day: "Permit optional topic-linked and free-standing notebook entries."

**State of 1000 and 1001 (CLAUDE.md four states):** 2, applied and verified on staging (`ezhvpgtcqcdsgylrxgdb`), each twice, rollback rehearsed. **Not applied to production.** When merged, `main` holds both while production does not. The feature is behind policy `scholar_personal_notebook`, which defaults off, and fails closed without the migrations.

**Application order:** 1000, then 1001. Depends on 372, 414, 820, 975. PostgreSQL 15 or later, as 820. Applied by the owner, by hand, after a separate GO.

**Numbers:** 1000 and 1001. Before claiming: the highest on `origin/main` and every remote branch was 999, with no 1xxx file in any local worktree. Claim note: `NOTEBOOK-001-migration-number-claim.md` in the shared notes.

## What exists after this

The notes are still the one 820 table. No second store and no new table. Existing notes, highlights, bookmarks and summaries keep their rules.

| Owner item | Where |
|---|---|
| My Notebook: recent, pinned, related, search results | `study/notebook/page.tsx`, nav leaf `notebook` |
| Quick Note on every Scholar page, focus at once, no navigation | `_components/quick-note.tsx`, in the sticky header, so nothing floats over anything |
| Blank page: nothing required but words | `study/notebook/new/page.tsx`, `_components/note-editor.tsx` |
| Autosave, saving, saved and failure states, retry, draft recovery | `src/lib/individual/scholar/note-saver.ts`, `_components/note-capture.tsx` |
| My Ideas & Notes in the lesson, compact and expandable | `_components/my-ideas-box.tsx`, after each section and after the teaching and key points |
| Lesson, section and source attach by themselves | The box's context. Quick Note reads which box the reading has reached, once, when opened |
| Several notes per section, existing notes editable in place | `my-ideas-box.tsx` |
| Optional title, tags, pin, links: lesson, section, slide or page with its picture, material, competency, study session, topic | `note-editor.tsx` |
| Amber | Learning tone `ideas` in `tokens.ts`, contrast-checked light and dark by `scholar-learning-tokens.test.ts` |
| Develop this idea, Research this question | The existing Ask panel with the note's words to edit. Nothing goes to AI until the learner presses Ask |
| Make it a study goal | A form with the words and a date. Only "Add to My Plan" adds an entry, through the existing calendar route |
| Export and deletion | `api/individual/scholar/notebook/export` (one Markdown file). Remove, confirmed in place |
| Patient information | The warning is shown. Words, title, tags, section label and topic are all screened. A refused note stays on the device until the words are changed |

### Decisions taken inside the brief

- **A note outlives its source.** 820 cascades a note away with its material or session. A note written through the Notebook is the learner's own writing, so a trigger detaches it first. It stays, as a free-standing note or on its section, and says what it was linked to. Older notes, highlights, bookmarks and summaries still go with what they are on. Erasure still removes everything.
- **Ask's "My saved learning" never carries a note written through the Notebook.** That source sends note text to a model when the learner ticks it for a question. `savedLearningRows` now filters on `client_key is null`. **Older 820 notes still go when the learner ticks it**, because that was the approved behaviour of SCHOLAR-ASK-SOURCES-01.
- **Autosave is not audited.** It is the learner typing. A first save, a pin, a link, a removal and an export are audited, by code only.
- **A note is capped at 50,000 characters** for long-form writing. Highlights and summaries keep their 4,000. A long note is edited on its own page, not the library's short form.
- **The library's older edit now checks the copy it opened from**, so it cannot overwrite newer Notebook words.
- **A topic is its words.** Topics in this product are text labels, so there is no id to key on.

## Migrations

| File | sha256 | Notes |
|---|---|---|
| `supabase/migrations/1000-individual-scholar-personal-notebook.sql` | `a5453ef6d36352d56e4ff5df0e0fca1ebd84941f86d6504ab038a514a703e2b3` | Free target, 50,000 characters, title, tags, pin, client key, revision, context columns, detach triggers, search |
| `supabase/migrations/1001-individual-scholar-notebook-topic.sql` | `73cfa2ba5d044e96bc4dbcddb0bb2dce9368ff13d5a661371be538473c7733ca` | Topic target, topic in the notebook search, marker |
| `VERIFY-1000.sql` | `06a4b324a944b77791c69b3aa9685651f06306987a31cefcf9fb88573f50c979` | Staging only. Probes, all undone |
| `VERIFY-1001.sql` | `a19e90d9a3e4174e02545568a00481f9aeb3da10b2130cf9a758bb55f75edfeb` | Staging only. Probes, all undone |
| `VERIFY-1000-prod.sql` | `3065f6aa414328d350219b2724de094cd5aef2ade5d3323873d39b5552c6ac5d` | Structure only. For the owner after applying |
| `VERIFY-1001-prod.sql` | `fdc727b43de573dbbdbd6028a76d550420275b877066c55a6f240a8f1d62b1cd` | Structure only. For the owner after applying |
| `ROLLBACK-1001.sql` | `59bf6654f1549c24eeb96baba0317da8f24ebf8033d2dc07f1b7c5a726938399` | Run first. Refuses while a topic note exists |
| `ROLLBACK-1000.sql` | `07b5e30b458679192e26ecd0155a18f68431d02d3494da075624d0a0c0be23f9` | Then this. Refuses while a note written through the Notebook exists |
| `PRECHECK-1000.sql` | `518ff7672b69ea1876d6dfe4f3b0454709cc7496d762b920b904952c0d422449` | Read only |

House rules: ALL CLEAR on both (warnings are only the APPLY WHOLE constructs).

### Staging evidence (`staging-apply.log`, `staging-apply-1001.log`)

| Step | 1000 | 1001 |
|---|---|---|
| Precheck before | 0 new columns, 13 notes, text md5 `a46a3f9c...` | 122 notes (walk rows), text md5 `dbab4adb...` |
| VERIFY before applying | **red**: "columns missing" | **red**: "topic column missing" |
| Applied twice, same sha256 | Committed both | Committed both |
| Precheck after | 13 notes, same md5: no existing word changed | 122 notes, same md5 |
| VERIFY | PASS, twice | PASS, twice. VERIFY-1000 still passes |
| Planted expectation | **red**: "planted: revision expected 2" | **red**: "planted: marker expected false" |
| Rollback rehearsal, rolled back | Passed, staging unchanged | Passed, staging unchanged |
| Prod verify, run on staging | 16 of 16 true | 8 of 8 true |

**Rollback on staging today:** ROLLBACK-1000 and ROLLBACK-1001 would now refuse, by design, because the walks left notes on the fixture learner. VERIFY-1000's first pass found its own wrong probe (a column that does not exist on the session table). The probe was fixed, and the checksum above is the fixed file.

### Fail closed

- **Without 1000 or 1001:** the marker is absent, so nothing is offered. No Quick Note, no box, no leaf, the page says it is not available, and the routes answer 409. `savedLearningRows` asks for 1000 first, so it never names the new column while it is absent. Tests cover 42883 and a transient error, which keeps the filter on.
- **Key off (the default), on staging:** `walk/walk-key-off.log`.

## Independent review

A separate second read before the PR (blockers 1 to 4, should-fix 5 to 14). All were fixed except where stated, each with a test where the logic is pure:

Remove is honoured, even with words waiting (`discard`). A link problem is no longer read as a removed note, which had made a second note. A restored draft cannot overwrite newer words. An in-place edit stays current. A proxy's page is not a save. A lost reply plus more typing is not a false conflict. A pin refused for an old revision goes again. Save link no longer wipes the section. A highlight with no comment can be pinned. A stale study id cannot block a save. A section link opens once. The library's older edit checks its copy. Unlinking during a first save is honoured. A retry cannot save into another person's notebook after a sign-out and sign-in. Section labels are screened. Filtered search says when it was cut off. Ask no longer receives the prefill.

**Left, for the owner:** see the PR's decisions.

## Tests

Vitest: `note-saver.test.ts`, `personal-notebook.test.ts`, `personal-notebook-store.test.ts`, `api/individual/scholar/notebook/notes/route.test.ts`, plus the pinned updates to `nav.test.ts`, `policy.test.ts` and `scholar-learning-tokens.test.ts`. Harnesses: `scholar-learning-harness` (182 of 182), `individual-foundation-harness` (77 of 77) and `sidebar-active-harness` (15 of 15). `scholar-learning-harness` found two real breaks on the way: notebook writes outside the one Scholar store, moved into it, and the reserved phrase "learning library" in page words.

## Walk

`walk/notebook-walk.mts` at desktop 1440, tablet 820 and phone 390, fixture learner on staging, dev server. Logs `walk/walk-*.log`, screenshots `walk/shots/`. It also serves as the CE-02-2 acceptance walk.

The fixture's Growth and Development deck has no section titled "Cephalocaudal development". Slide 1 is "Principles of Growth and Development", which lists cephalocaudal, and that is the section the walk writes on.

**Limits of the walk.** It ran on a dev server on a busy machine, with a touch-enabled browser at those widths, not on real phones. A real on-screen keyboard was not exercised. Dark mode is contrast-checked by test only: it stays staged, because no Scholar shell sets it today. The fixture keeps the notes the walks wrote. No agent hard-deleted them. It also keeps one study-goal calendar entry per desktop run.
