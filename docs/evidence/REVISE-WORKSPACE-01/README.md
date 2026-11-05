# SCHOLAR-REVISE-WORKSPACE-01: the Revise workspace

Owner GO, 5 Nov 2026. Branch `scholar/revise-workspace-01`. No migration. No new AI call. No schedule rule changed.

## Navigation

**Before: one long page**

Exam papers, Due for retrieval, the start form, the Mistake Notebook link, Adaptive exam, Flashcards, Carry on, Saved revision sets, Review cards due, and a statistics side panel. A second row of tabs: Practice Questions, Flashcards, Adaptive Exams, Revision History, My Decks.

**After: one view at a time**

| View | What it answers | What it holds |
| --- | --- | --- |
| **Today** (opens here) | What needs attention, why, and how do I begin? | One queue: unfinished revision, due cards, due retrieval, what keeps being missed, mistakes, today's plan, one suggestion. Then the ways to revise. |
| **My Priorities** | What am I working towards? | Goal, exam countdown, priority topics, the next 7 days and suggestions, read from My Plan. Changes are made only in My Plan. |
| **Studied This Month** | What did I really study? | This month's learning by material: the days it was studied, the upload date shown apart, and what needs consolidating. |
| **All Topics** | Where is everything? | The searchable catalogue with filters, older learning included, and saved revision sets. |
| **Revision Insights** (secondary) | How is it going? | The statistics, recall over six weeks, what keeps being missed, revision by competency, due retrieval, adaptive exams and exam papers. |

Shortcuts stay on every view: Flashcards, Practice Questions, Adaptive Exams, Revision History, Mistake Notebook, My Decks. Every old link still opens.

Choosing a material or a topic asks how to revise it: Quick Recall, Deep Understanding, Clinical Reasoning or Mixed Challenge, on that scope. A finished session ends on "See what to revise next", which returns to Today.

## Page height

Same fixture learner, staging, in pixels. `before.json` and `walk.json`.

| Width | Before: the one page | Today | My Priorities | Studied This Month | All Topics | Revision Insights |
| --- | --- | --- | --- | --- | --- | --- |
| 820 | 4,485 | 2,200 | 1,773 | 1,332 | 1,310 | 2,595 |
| 390 | 4,752 | 2,574 | 1,784 | 1,477 | 1,433 | 2,624 |

At 1440 the old page was 2,795 in two columns (`shots/before-1440.png`). The old page's height depended on how much of it was collapsed, so these figures compare this one learner, not every learner. On a phone, where to start now sits on the first screen (`shots/today-390.png`).

## The contradiction

The owner's supplied screenshots were not attached to the directive, so this was found from the code, not from those images.

- A topic moved to a later day by the daily limit could read `Due today · for 2026-11-12`. `retrievalLine` now reads `Planned for 12 Nov`, and `Planned for 7 Nov, was due 1 Nov` where it was overdue. Each date has one meaning.
- Revise counted due cards by the UTC date while retention used the learner's own date, so the two could disagree around midnight. Revise now uses the learner's local date for cards, statistics and months.
- A card rated in the Flashcards list no longer shows "Due today" beside a separate next-review date.

## Found and fixed during the walk

- **Opening Revise could change the plan.** The shared plan read also records a carry-over the first time a missed activity is shown. Revise now reads with `readOnly: true`, so nothing is recorded. My Plan keeps its behaviour. Unit test in `plan-data.test.ts`; the walk confirms the plan settings and the plan-event count do not change.
- **The due cards appeared three times** (the card row, a plan activity and a suggestion). They are now one row.
- **Unfinished sessions could fill the queue.** The two newest get a row; the rest gather into one row with a page listing them all.
- **A server page called a function from a client module** (`learnTone`), which `practice-defects.test.ts` caught. It now uses the plain classes.

## Verified

- Walk on staging, fixture learner, three widths: `walk.txt`. Script: `ds-walk-workspace.ts`. Old page: `walk-before.ts`.
- A plan with a priority was set for the fixture through the API on staging, confirmed, then removed again: the priority shows, the matching queue row says "In your priorities", and the priority topic opens on that scope.
- Unit tests: `revise-workspace.test.ts`. No sideways scroll and nothing scrolling inside the page at 820 and 390; view and shortcut links at least 44 px on touch.

## Staging harnesses

- `scholar-revision01-harness`: updated to the new views, but its checks R1-R14 pended on staging because AI consent could not be given there (403). The walk covers the views; the harness's R1, R7, R11 and R14 changes have not run.
- `scholar-sessions-acceptance-harness`: H1c (Revise opens on the session's topic) passes. These fail, and none is on a page this branch changes:
  - H5a-c look for "Continue your study session" on Home. That link is on the Learn landing page (`learn-landing.tsx`), so the harness looks in the wrong place.
  - H4a: the Revise page shows nothing of another learner's session. On `/learn?study=<another learner's id>` the words "respiratory distress" appear in the page's data, though not on screen. Whether that is the other learner's session or shared content was not established. Raised as a follow-up.
  - Z1 failed on one of three runs. The harness's own setting was confirmed removed; a burst of other staging policy writes landed within the same minute, which points to another session changing staging settings at the time, though that was not confirmed.

## Limits to know about

- **Card rescheduling still uses the UTC date.** `reviewCard` computes the next review from UTC, so a rating just after local midnight can land a day early. A complete fix touches every card write (the ratings, three answer routes, new and reset cards), which goes beyond this redesign. It is left as it is. SM-2 is unchanged.
- **Materials have no archived state,** so All Topics lists every material. Archived decks stay under My Decks.
- **The fixture has no analysed topics,** so the topic chips and topic filter were checked by unit tests and by following a priority topic, not by clicking a chip.
- **Real pilot learners were not looked at.** Agents never sign in as real learners, and the read-only production runner (`run-prod-readonly.ps1`) was not on this machine, so no pilot counts were taken. Studied This Month and All Topics are proven on staging and in tests only.
- **Staging only.** Nothing here is merged or deployed.
