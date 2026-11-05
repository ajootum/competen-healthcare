# DS rollout 4: My Plan

Presentation only. No words, routes, data, migrations or policy keys change, apart from `accent` props that nothing needs now. Spec: `docs/design/SCHOLAR-LEARNING-DESIGN-SYSTEM.md` section 6.1.

## Walk (staging, fixture learner, at 1440, 820 and 390 with a real coarse pointer)

| Run | Pages | Result |
|---|---|---|
| `walk-before.txt` (main 460c5e05) | Calendar, Today, Insights | 35 PASS, 0 FAIL |
| `walk-after.txt` | The same | 35 PASS, 0 FAIL |

Visible text compared before and after (`text-*.txt`): no differences.

## Not exercised

These blocks did not appear for the fixture: Missed, An exam in your calendar, the weekly reflection and its offer, Monthly review, Revision due as its own card, and the empty Today.

`next build` was not run locally. CI's Vercel preview builds it.

## Deliberately unchanged

The three view tiles and the Calendar view keep the owner's mock-up. Rows inside Planned for today keep their own controls, because the Calendar shares them.
