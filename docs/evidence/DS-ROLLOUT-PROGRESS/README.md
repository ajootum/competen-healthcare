# DS rollout 2: Progress

Presentation only: no learning rule, record, route, migration or policy key changes.

- **Screens:** `study/progress` and `study/progress/explore`, as the fixture learner on staging. Shots are `before-*` (c805ee61) and `after-*`, at 1440, 820 and 390, each with folds closed and with every fold open (`-open-`).
- **Walk:** `walk-before.txt` 25 PASS, 5 FAIL. `walk-after.txt` 30 PASS, 0 FAIL. The checks are horizontal overflow, axe (WCAG 2.1 AA), touch targets, console errors and 5xx responses.
- **Touch check:** run with a real coarse pointer (Blink `primaryPointerType`). Playwright's own touch emulation does not report one, so the CPR-MOB-001 `pointer-coarse` rule is not exercised without it. The StudyNav tabs are left out: they are a separate item of the rollout.
- **Fixed from the baseline:**
  - A `dl` with `dt`/`dd` nested in an extra `div` (What your evidence shows; the same structure in Applying what you learned).
  - Under 44px on touch: the period links, "How this was worked out" and "See the evidence".
  - Red, green and sky status colours, replaced by words with a shape.
- **Words:** the visible text of both pages was compared before and after. Differences are only the headings moving from CSS capitals to sentence case, the "·" before a band (now a chip), and one paragraph of the Passport text split in two.
- **Not exercised on the fixture:** these states need data or keys it lacks, so they were not seen in the browser: "Study next", the plan card (My Plan is on there, so "Your plan" shows instead), Applying what you learned with records, the prerequisite and transfer boxes, and a programme with competencies. They use the same components and passed typecheck and the harnesses.
