# Competen Universal Search Standard: Scholar

Owner directive, 5 Nov 2026. This is the first stage: the shared standard, Global Search in Scholar, and the seven Scholar areas named in section 6. Professional and HQ follow. No migration and no new service.

## What was built

| Piece | File | What it does |
|---|---|---|
| The one search box | `src/app/individual/_components/search/PageSearch.tsx` | Same icon, words, height and scope line everywhere. A form version keeps the words in the address, and a version for lists filtered in the browser |
| One way to match | `src/lib/individual/search/match.ts` | Part of a word, the curated synonym list, and one slip of the keyboard |
| The registry | `src/lib/individual/search/registry.ts` | Each module's record types, fields, filters, target and access rule |
| Global Search | `GlobalSearch.tsx`, `api/individual/scholar/search`, `scholar/global-search.ts` | One entry in the shared header. A field on wide screens, an icon opening a full-width panel on phones, Ctrl or Cmd K anywhere |

## Where it applies

| Area | Search | Goes to |
|---|---|---|
| My Library | Filters as you type, with file type and sort | Stays on the page, words in the address |
| Learn | The existing server search, with a scope line and Clear search | `study/learn?q=` |
| Revise | Box on every view | Topics list with its filters |
| Apply | Box on every view | My Practice Library with its filters |
| Evaluate | Box on every view | Evaluation history |
| My Plan | New: goal, exam, priorities and own calendar entries | `study/plan?q=` |
| My Competencies | The explorer's box, with shared matching | Stays on the page |

## Rules

- **No AI.** Typing or searching calls no AI and creates no session. A section result opens in its material, never as a new lesson.
- **Access is decided first.** The route checks sign-in and the registry's rule before reading. A module the person may not see is never read, so it returns no result, count or preview.
- **Own records only.** Every source reads with the signed-in person's id. HQ stays on its own route and catalogue, because the landlord plane never reads a learner's records.
- **Opposite clinical terms never swap.** One slip only: hypertension does not find hypotension.
- **A failed source says so,** and is never shown as nothing found.
- **Search history.** Words are sent to be searched as the learner types, and are not kept. They are kept only when a result or Enter is chosen, and only where My Search History is on, with its notice in the panel.
- **Off by default.** Global Search is new for learners, so `scholar_global_search` stays off until HQ publishes it. Page boxes are there either way.

## Walk

`walk.txt`: staging, fixture learner, at 1440, 820 and 390 px, with a real coarse pointer on the last two: 82 PASS, 0 FAIL. It covers: partial words, a misspelling, no results, arrow keys, Escape, opening a result, coming back with the search kept, Clear search, each page's box, a real My Plan priority, and 8 other learners' materials searched by their exact titles with none returned. Global Search stays published on staging.

## Not verified

- A real phone or tablet, and pilot learners' records.
- Global Search speed with a large library. Each search reads several sources, and the dev server is too slow to measure it.
- My Plan calendar entries as results in the browser: covered by unit tests. The walk used a priority.
- A second signed-in learner. Separation was checked by searching other learners' exact titles as the fixture learner.

## Limits

- **Learn and Saved learning** use their existing full-text search: word stems and partial scoring, but no spelling tolerance or synonyms. Global Search has the same limit for those two sources.
- **Revise** has no records in Global Search yet, only a link to search its own page, because its list is expensive to build on each keystroke.
- **Not moved to the shared box yet:** Saved learning, My Search History, Flashcards and the OSCE station filter. They work as before.
- **No search yet:** My Progress overview, Courses, and the other My Competencies pages.
- **Other products:** Professional has no search today. HQ has a navigation palette (`HqSearchLauncher`) that reads no records. LifeOS is not in this repository.
