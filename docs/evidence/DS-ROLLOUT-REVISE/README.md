# DS rollout 3: Revise

Presentation only. No words, routes, data, migrations or policy keys change, apart from one removed prop (`accent`) that nothing needs now. Spec: `docs/design/SCHOLAR-LEARNING-DESIGN-SYSTEM.md` section 6.1.

## Walk (staging, fixture learner, at 1440, 820 and 390 with a real coarse pointer)

| Run | Pages | Result |
|---|---|---|
| `walk-before.txt` (main 57475560) | Revise, Mistake notebook, Adaptive exam, six Flashcards views, a session, a flashcards session | 116 PASS, 7 FAIL: six axe `definition-list` on the Mistake notebook, one hydration console error |
| `walk-after.txt` | The same, plus one answered question's feedback panel | 134 PASS, 0 FAIL |
| `walk-retention.txt` | Revise with the three R2 keys on and a simulated delay (SALE-R2 setup files, undone afterwards) | 11 PASS, 2 FAIL: "Why now" 36px on touch. Fixed after the run with the class that passed on "What this means here". This run was not repeated |
| `walk-touch.txt` | Apply and Evaluate, re-checked | 24 PASS, 0 FAIL, after fixing "What this means here" (20px) in `BoundaryNotice` |

`walk-before-feedback.txt` is the old feedback panel's run (46 PASS, 0 FAIL), for the before shots.

The earlier touch checks in DS rollout 1 (#284) were not valid: Playwright's touch emulation does not report a coarse pointer, so `pointer-coarse` never applied. This walk uses a browser launched with coarse-pointer settings and fails if the pointer is not coarse.

## Other checks

- Typecheck clean. ESLint clean on every changed file.
- `scholar-learning-harness` 182 passed. `design-system-themes-harness` 98 passed.
- Vitest (scholar and components): 2556 of 2557. The one failure is `learn-guided.test.ts` timing out when the whole set runs. It fails the same way on unchanged main, and passes 12 of 12 alone.
- Visible text compared before and after (`text-*.txt`): heading case, and figures the walks themselves moved on the fixture.

## Not exercised

- Grading paths: self-marking, structured parts, scenario stages, the safety callout, the AI-evaluation note, a wrong or partly right verdict. The shots show a right answer.
- A running adaptive exam and its report. Only the set-up form and the exam list were walked.
- A saved revision set, and a review card after "Show answer".
- `next build` was not run locally. CI's Vercel preview builds it.
- `scholar-revision01-harness`, `individual-config` and `individual-professional` harnesses: they need Supabase env, and this change touches none of their logic.

## Deliberately unchanged

- Flashcards: the study card, deck header, segmented control, stat tiles and test tiles keep the owner's mock-up and the `--cmp-fc-*` states (spec section 6). Only Revision History adopts the tones.
- The Revise sub-navigation keeps its indigo selected state, which the flashcard mock-up set.

## Known, not from this change

- An intermittent hydration warning in sessions and on Progress: seen on old and new builds, and in neither final run. Not traced.
- The dev server sometimes fails with "Manifest file is empty" after a hot reload. Restarting clears it. Seen in dev only.
