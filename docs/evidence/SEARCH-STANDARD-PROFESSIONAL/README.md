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

- **Pressing Enter in a browser after the fix.** In the walk Enter did nothing when results had not arrived yet, and could have opened the previous search's area. The independent read found why. Enter now waits for results for what is typed, and a highlighted result still opens at once. The rule is unit tested (`enter-target.test.ts`), and the fix passes the type check, but it has not been walked again. With results, Enter opens the first area's filtered list, not the record, by design.
- Real phones, a screen reader, production.

## Independent read

No blockers or should-fix items. Scoping, Scholar isolation, the policy gate, unreadable sources and Scholar's own search were all clean. Left as a note: opening a need or goal from a filtered list drops the search term.
