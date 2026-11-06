# SCHOLAR-PERF-02: Home and Revise

Owner: yes to more speed work on the two slowest pages, 6 Nov 2026. No migration, and no change to what a page shows once loaded.

## What was found

Traced on staging with a hash of each query:

- Home makes 116 database calls and Revise 121, with only 2 and 1 exact repeats. Caching identical reads would save almost nothing, so that was not done.
- Most of the wait is on the plan, retention and assessment reads, which are read one group after another.

## What changed

The slowest section now arrives after the rest of the page, in the same response.

- **Home:** the greeting and module cards show first, and the activity rows follow.
- **Revise, Today:** the heading and tabs show first, and the queue and form follow.
- A short loading shape holds the place. A screen reader hears "Loading".

The total reads and the time for the whole page are unchanged. What changes is how soon the learner sees a page.

## Measured

`walk.txt`: staging, fixture learner, dev server, 390 and 1440 px, coarse pointer: 20 PASS, 0 FAIL. Dev server times show the order of arrival, not real speed.

| Page | First part shows | All of it arrives |
|---|---|---|
| Home | 3.3 to 3.4 s | 8.7 to 8.9 s |
| Revise, from a tap | 6.0 to 11.7 s | 11.5 to 19.9 s |

No AI or session call, no hydration error, no sideways scroll, no loading shape left behind, and Revise's priorities view still loads.

## Not verified

- Real speed on production. Re-measure on the owner's account after release, against SCHOLAR-PERF-01's numbers.
- A real phone.
- Revise's first part still waits for its catalogue reads, which is why its heading is slower than Home's cards. Cutting those reads is separate work.
