# Scholar fixes, phone length and DS rollout 5: evidence

Owner request, 5 Nov 2026: implement the known-issues list. The walk ran on staging with the fixture learner, never on a real learner. No migration.

## Files

- `walk.txt`: 38 PASS, 0 FAIL. `shots/`: screens at 1440 and 390 px.
- The before build for the word comparison had the same Scholar code as main `a684bd51`.

## What changed

| Item | Change | Evidence |
|---|---|---|
| OSCE false "could not be saved" | A save or finish whose run was closed by another request now reports the run as closed or finished. A finish waits for a save in flight, and no new save starts during a finish. | `osce/attempts/[id]/route.test.ts` (6 tests). Walk: Finish at three timings around the autosave, no false message, no failed request |
| Ask panel on the library list | The export form no longer wraps the list, so the panel's own form is not nested in it. Tick boxes join the form by id. | Walk: no nested form, a ticked lesson belongs to the form, the panel stays open and the page stays put after asking |
| Library card double count | A library question studied as a card is stored as `mcq`, so its rating counted as an attempt and a review. `isCardRating` now skips the attempt in `mastery-data.ts` and `learning-state-data.ts`. A real multiple-choice answer still counts. | `card-rating-evidence.test.ts` |
| Dates in client components | Fixed to en-GB and UTC, so server and browser write the same date. | Code only. See the hydration note below |
| Phone length | See the table below. | Walk |
| DS rollout 5 | Library, Saved learning, papers, OSCE and Monthly review use the design system. Spec section 6.1 updated. | Walk: words unchanged on six pages |

## Phone height at 390 px, coarse pointer

| Page | Before | After |
|---|---|---|
| Evaluate | 3504 px | 2894 px |
| My Progress | 2370 px | 2045 px |

- **Evaluate:** evidence tiles in two columns, one next step with the rest one tap away, the last three past evaluations with the history link.
- **My Progress:** learning activity, reading coverage and framework coverage fold on a phone. They stay open on wider screens and open with one tap.
- On Evaluate, "Next learning actions" now reads "Next steps", replacing the separate heading above it.

## Exact findings

- **OSCE.** At route level the race reproduced as a false 500 on the save, in 1 of 6 rounds with save and finish sent together. The finish 500 that the R4 session saw was not reproduced. The fix covers both paths, by route tests and by the walk.
- **Hydration warning: not reproduced, so not claimed as fixed.** The trace found 0 warnings in 18 loads of six pages. The walk also saw none. The date changes remove one possible cause, and the Ask panel change removes nested forms, which is another.
- **StudyNav touch: no change needed.** The Learn, Revise, Apply and Evaluate tabs measure 44 px with a real coarse pointer.
- **The walk's first blocker was test data.** The route race script left six finished, unmarked runs on the fixture. After each mark the page opened the next unmarked run, as designed. From reading the code, a learner using the screens should not build up several, because the page opens an unmarked run before offering a new one.

## Not verified

- A real phone or tablet, and pilot learners' records.
- The double count on real data. It is covered by the test above, and no figures were compared before and after.
- The Ask panel's reply text. The walk checks that the panel stays open and shows a reply or its reason, not what the reply says.
- Papers: the walk did not open a paper, or show the papers sections on Apply, Revise or Evaluate, so those restyled screens were not seen. They were type checked only. Monthly review was seen in its done state only.
- `next build` locally. CI's Vercel preview builds it.

## Known, not changed

- Saved learning is about 12,600 px at 390 px for this fixture, because every saved lesson is a full card.
- On Saved learning, row links such as "Open the lesson" are 19 px tall on touch. "Manage AI help in Settings" on the Library is 32 px.
- A paper's own answer controls keep their earlier colour, and monthly results keep the evaluation view.
- The Library's lower sections were restyled only in the materials list. Programme, AI choice, Collections and Ask keep their existing cards.
