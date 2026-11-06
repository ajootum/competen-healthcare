# Universal Search Standard, stage 2: Scholar

Owner directives, 5 and 6 Nov 2026. No migration, no AI, no new policy key.

## What changed

- **Shared box:** Saved learning, My Search History, Flashcards and the OSCE filter now use `PageSearch`, and their filters are kept.
- **New boxes:** My Progress overview (goes to its history), My Courses, My Programmes, Learning Progress, Assessments and My Evidence.
- **No box, on purpose:** Courses overview and Explore list nothing. The redirect-only My Competencies pages have no list of their own.
- **Global Search:** adds Courses, and Revise records. Revise costs 2 extra reads per search.
- **Spelling and synonyms on Learn and Saved learning:** synonyms come from the closed list, single words only, so "copd" no longer pulls in every "disease". A correction runs only when a search finds nothing, with no filters set and no quotes, minus or OR. It uses the learner's own topics and titles, and the page says "Showing results for X". Global Search never corrects.
- **Open your Library (P0):** Learn's link now goes straight to `study/library`, with no stop at the Study Home.

## Walk

`walk.txt`: staging, fixture learner, 1280 and 390 px, coarse pointer on 390: 30 PASS, 1 FAIL.

The one FAIL was my check, not the product. It looked for "Documents (1)" in the tab text. A separate check at 390 px on the same search found the document by title with no false correction, and it confirmed:
- the Library link goes straight to `study/library` and shows the library
- Assessments answers 200 and has its box

Confirmed in the walk:
- Clear search on OSCE and the card browser removes only the words.
- Searching My Search History keeps no new entry.
- My Search History keeps what the learner typed, not the correction.
- A "hyp" word is never corrected, and neither is a search with an exclusion or a filter.
- No AI or session call, and no hydration error.

## Not verified

- **Seen in a browser:** the Courses boxes (the fixture learner gets 404, because the module is private), and the deck box scope line (the fixture has no deck box). These rest on code review and tests.
- **My Evidence:** its box was seen in the walk, but its filtering was not exercised.
- **Library link at tablet and desktop:** clicked at phone width only. It is the same link at every width.
- A real phone, and pilot learners' records.
