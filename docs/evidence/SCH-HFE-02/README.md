# SCH-HFE-02: Learn landing page

Owner GO, 6 Nov 2026, section 2. No migration, no new AI call, no policy key. Learn's search results, topic pages and the lesson workspace are unchanged: only the landing changes.

## The page

Top to bottom, in the Study Home's language:

1. **Continue learning:** the most recent lesson that can be resumed, or the open study session in its last stage. It uses the Study Home's card and the same read (`resume-session.ts`, shared by both pages).
2. **What would you like to learn today?:** the existing search and its Teach me button, unchanged.
3. **Study next:** My Plan's own next step, read without changing the plan. It arrives a moment after the rest, because it takes the most reading.
4. **Recent lessons:** up to three lessons other than the one above, and View all.
5. **My learning library:** "Yours" (My Library, Saved learning), and "From Competen" (Courses & Training) only for learners who have that module.

Your topics and Recently added are tucked into expandable sections, with all their actions, so nothing the old landing offered is gone.

**One deviation from the instruction's order:** Search sits second, not fifth, because the search standard puts it near the top and fifth would be off-screen on a phone.

## Acceptance

`walk.txt`: staging, fixture learner, 390, 820 and 1440 px, coarse pointer: 43 PASS, 3 FAIL before one fix. The 3 FAILs were one link under 44 px ("Open your Library" inside Recently added). It is fixed and has a 44 px target, but the walk was not re-run after that one-class change.

| Requirement | Result |
|---|---|
| Resume opens the same lesson | Yes, at all three widths |
| Saved lessons reopen without AI | Yes. Reopening only sends `open` requests to `/learn/act`, which the route documents as "never an AI call". The walk fails on anything else |
| Library opens directly | Yes |
| Moving on to Revise and Apply | Yes |
| Phone, tablet, desktop | No sideways scroll, no hydration error |
| Page height at 390 px | 1960 px, down from 2497 px |
| Sessions | None created or moved |

## Not verified

- **Connected study sessions in a browser.** With `?study=` the page reopens that session and never shows the landing, which is unchanged code. The resume card's link to a connected session is covered by the shared read only.
- **"From Competen" in a browser:** the fixture does not have the Courses module. Covered by a render test.
- **Your topics in a browser:** the fixture has no topics.
- A blocked session, a new learner, or a real phone.

## Later

The search card is still the tallest section, because of its history notices. Shortening it would need a decision on where those notices sit, so it was left.
