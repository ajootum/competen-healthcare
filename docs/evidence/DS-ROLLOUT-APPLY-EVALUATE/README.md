# Scholar design system rollout 1: Apply and Evaluate

Presentation only. No learning, AI, prompt, routing, scoring, rubric, citation, saved-record or progress rule changed. The page words, disclaimers and roles (`role="alert"` on safety and late escalation, `aria-live` on feedback) are kept. Spec: `docs/design/SCHOLAR-LEARNING-DESIGN-SYSTEM.md` section 6.1.

## Method

- **Servers:** two dev servers against staging (`ezhvpgtcqcdsgylrxgdb`):
  - before: `main` d26f22dc, port 3191;
  - after: this branch, port 3192.
- **Learner:** the fixture learner. Credentials were read from a file and never printed.
- **Walk:** `ds-walk.ts`. It shoots Apply and Evaluate at 1440, 820 (touch) and 390 (touch), runs axe (wcag2a/2aa/21aa on `<main>`), and checks horizontal overflow, 44px touch targets on touch, console errors and 5xx responses.
- **Results:** `walk-before.txt` and `walk-after.txt`.

## Results

| Check | Before (main) | After (this branch) |
|---|---|---|
| axe violations, 6 page and viewport pairs | 0 | 0 |
| Horizontal overflow | none | none |
| 5xx | 0 | 0 |
| Touch targets under 44px on touch | the StudyNav tab bar (Learn / Revise / Apply / Evaluate) | same, unchanged; not touched here |
| Console errors | 4 hydration-attribute notices (dev) | 3, the same notice |

The two FAILs are the same on `main` and on this branch. The StudyNav tab bar is shared by every Scholar stage and is left for its own change.

The fixture learner has no stored case, so the case player could not be shot. Its restyle is covered by the type-check, the scholar-learning harness (182/182) and the case-intelligence checks in ci-harnesses.

## Gates

- **tsc:** non-incremental, 0 errors.
- **eslint:** clean on the 4 changed files.
- **scholar-learning-harness:** 182/0.
- **design-system-themes-harness:** 98/0. Its 6j check first caught two grey hex fallbacks in a button class; they were removed.
- **ci-harnesses:** green apart from the 6j check above, which now passes.
- **vitest:** the individual, design, evaluation and cases suites pass.
