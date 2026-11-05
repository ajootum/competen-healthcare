# SCH-HFE-01: Study Home

Owner directive, 5 Nov 2026, with `competen_scholar_study_home_prototype.html` as the design reference. Presentation only: no migration, no policy key, no change to a session, a material or AI use. Not for production until the owner has reviewed it visually.

## What changed

| Where | Change |
|---|---|
| `study/page.tsx` | New: the Study Home at the same `/study` route the Study tab opens |
| `study/_components/study-home.tsx`, `study-home-model.ts` | New: its three sections and what they say |
| `study/library/page.tsx` | The former `/study` page, moved with only its import paths and a header comment changed |
| `spaces.ts` | My Library is now `study/library`, and `study` still belongs to it, so a material's page and the tab logic are unchanged |
| `[materialId]/page.tsx`, `courses/programmes/page.tsx`, `competency-section.tsx` | Links that lead to the library or the programme choice now go to `study/library`, so they land where they always did |

## How it connects

| Action | Goes to | Notes |
|---|---|---|
| Continue learning | The open study session in its last stage, else the latest active session (`study/learn?session=`) | Resumes; nothing is created |
| View all sessions | `study/learn?tab=sessions` | The existing list |
| Start learning | `study/learn?q=` | Learn's own search takes over. No AI, no session. Teaching starts only when the learner chooses it there |
| A material | `study/<id>` | Its existing page |
| Open my library | `study/library` | Upload, suggestions, programme, collections, Ask across your library, all as before |
| `study#upload` | Stays on the Home and opens the upload form | Existing links keep working |

## Walk

`walk.txt`: staging, fixture learner, coarse pointer, at 320, 390, 820 and 1440 px: 50 PASS, 0 FAIL. Sessions before and after: 4 and 4, with no step changed.

| Width | Page height | Continue button ends | Start button ends |
|---|---|---|---|
| 390 | 1552 px | 410 px | 834 px |
| 820 | 1307 px | 421 px | 721 px |
| 1440 | 1242 px | 404 px | 677 px |

The earlier `/study` page was 2837 px at 390 wide. Full-page shots show the bottom bar part-way down because it is fixed to the screen; the `first-screen` shots show what a learner sees on opening.

## Not verified

- A new learner, a learner with materials and no sessions, a session that cannot be resumed, and a material with no readable text. The fixture has none of these, so they are covered by unit and render tests, not seen in a browser.
- A real phone or tablet, and pilot learners' records.

## Limits

- There is no processing state to show: extraction finishes during the upload, so a material is never "processing" once listed. A material with no readable sections says "No readable text" and opens its own page.
- A session's step is its current position. The marks are that position drawn out, not a percentage.
- The search history notice stays by the field, because what is typed there is kept where that setting is on.
- Learn is out of scope, so its "Open your Library" link now lands on the Study Home, one tap from the library.
- The sidebar has no Study leaf, so My Library stays highlighted on the Study Home.
