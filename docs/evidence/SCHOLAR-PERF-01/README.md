# SCHOLAR-PERF-01: Scholar page speed

Owner request, 5 and 6 Nov 2026: "why is scholar taking time to load its pages?", then "Make Scholar pages load faster". No migration, no change to what a page shows, and no access or policy gate changed.

## What changed

| Change | File | Why |
|---|---|---|
| Functions run in Dublin (`dub1`) | `vercel.json` | They ran in Washington (`iad1`) while the database is in Ireland (`eu-west-1`), so every read crossed the Atlantic |
| A progress bar from the moment of a tap | `NavigationProgress.tsx`, `layout.tsx`, `globals.css` | The old page stayed on screen with no sign anything had happened |
| Shared navigation links no longer fetch ahead | `ShellNav`, `ScholarSidebar`, `ScholarDrawer`, `StudyNav`, `library-list`, `study-home` | Each visible link made its own request, running sign-in and membership reads, for pages that cannot be fetched ahead |
| Assessment definitions are read together, not one after another | `assessment/adapters/scholar/store.ts` | A learner's assessment history took about 12 rounds of database calls in a row |

## Measured

Local production build against staging, fixture learner, `walk.txt`: 22 PASS, 0 FAIL at 390 and 1440 px. Times are from this machine to the staging database, so they show the shape, not what production will do.

| On Study, doing nothing for 12 s | Before | After |
|---|---|---|
| 390 px | 82 database calls, 22 requests | 14 calls, 4 requests |
| 1440 px | 117 database calls, 32 requests | 14 to 21 calls, 4 to 6 requests |

The requests that remain come from one link on the Study page (My Search History) and `/settings`.

| Tap | Bar shows | Page arrives | Database calls |
|---|---|---|---|
| Revise | 17 to 20 ms | 9.2 to 10.0 s | 118 to 119 |
| Apply | 17 ms | 7.0 to 7.1 s | 63 to 64 |
| Evaluate | 16 to 18 ms | 7.7 to 7.8 s | 86 to 88 |
| Learn | 16 to 17 ms | 2.7 to 2.9 s | 23 |

Rounds of database calls after the assessment change, staging: Revise fell from 43 to 47 to 31, Home from 34 to 22 and My Progress from 13 to 10.

## Production baseline

Owner's account, signed in, in the Browser pane, 5 Nov on `e98bd326`, functions in Washington. These are full page renders, not taps, because a real tap skips the shared layout. Compare like with like after release.

| Page | Full load |
|---|---|
| Study | 2.5 to 2.9 s |
| My Plan | 3.3 s |
| Learn, My Library, Home | 3.4 to 3.6 s |
| My Progress, Evaluate | 4.3 s |
| Apply | 4.5 s |
| Revise | 6.6 s |

## Not verified

- **The Dublin move.** It only takes effect on Vercel, so its gain is unknown until production is measured with a signed-in account. Staging's database region was not checked.
- A real phone, and a learner with a long list.
- A link that cancels its own navigation would show the bar until it gives up after 30 s. One Scholar link cancels and then navigates itself, which is fine, and no self-cancelling link was found by a pattern search. That search was not exhaustive.

## Not done

Revise and Evaluate still make about 120 and 90 database calls per page. Reducing them means changing the plan and next-action loaders, which is a separate piece of work.

## Rejected

`loading.tsx` screens were built and removed. They appeared in about 20 ms but need a full page shape for each space, and Next's documentation says uncached reads in a layout can hold them back. The bar gives the same instant response with no new files per page.
