# Competen Universal Search Standard, Professional: evidence

Owner's Universal Search Standard, Professional stage. **No migration. No AI.** Off until HQ publishes `professional_global_search` (default off). What is typed is not kept.

## What changes

Global Search in the Professional header, and page search on Professional's own pages. It covers the person's own competencies, evidence, CPD, development goals and needs, and registration. It reads no Scholar record. A module the person may not open is never read.

## Walk on staging, real HTTP and Chromium

Two temporary Professional people with one matching CPD entry each, then removed. Only this run's own policy row was written, because another session has an unpublished draft on staging. Results are in `walk.txt`.

| Check | Result |
|---|---|
| Policy off | The route answers 404 |
| Policy on | My own entry is found |
| Another person's matching entry | Not returned, in the API or the browser |
| Not signed in | No results |
| A single letter, or a term with no match | Nothing returned |
| A Professional-only person calling Scholar's search | 403 |
| Desktop, Ctrl K then type | My entry shows, with what is being searched stated |
| Phone (390) and tablet (820) | Search opens and my entry shows, no sideways scrolling. The phone check passed on the previous run; the final run covered tablet only, to fit the time limit |

**Worth knowing about this walk:** it took several runs. Failures came from my script and the busy dev server: pressing keys before the page woke up, a 500 while the dev server recompiled, and one run killed by a time limit that left temporary data, which I then removed. The same steps passed once the script waited properly.

## Not verified

- **Pressing Enter on a result.** In the walk the address stayed on the home page, so I can't say Enter opens the record. `enter-target.test.ts` covers the rule, and the first version of this walk could not settle it.
- Real phones, a screen reader, production.
