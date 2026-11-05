# Per-question source selection: evidence

SCHOLAR-ASK-SOURCES-01, owner GO 5 Nov 2026. Walks ran on staging with the fixture learner, never on a real learner or on production.

## Files

- `walk.txt`: 47 PASS, 0 FAIL, on the final code. `walk.json` holds what was sent and returned.
- `ds-walk-ask.ts`: the walk.
- `library-ai-check.json`: the AI call behind the Competen Library decision below.
- `shots/`: desktop, phone and history screens.

## Verified

| Requirement | How |
|---|---|
| Notes-only stays the default | Materials alone goes to the existing explain route, with the existing request. A fresh question starts on materials. |
| Material-specific search | One chosen material is sent, and the answer cites only it. |
| Combined sources | Materials plus research, and research alone, in the browser. |
| Explain, Summarise, Simplify, Go deeper | Summarise in the walk, all four in the tests. |
| What was searched | Listed under every answer, with why a source was not searched. |
| Citation provenance | `[S n]` for what is the learner's, `[E n]` for research. A tag in the wrong part withholds that part alone. Materials and saved learning are listed apart. |
| Source discovery versus evidence | "Used as evidence (abstract read, full text not read)" versus "Found, not used as evidence". Scholar reads research abstracts only, never full text. |
| Permissions | Signed out 401. Another learner's material gives nothing. A patient identifier 422 before any search. No source 400. Web asked for by hand is reported as not searched. |
| Clinical safety | The research risk gate runs before anything is sent out. What the research part says is classified by the published rules. Route tests cover both. |
| Search History | The history shows "Searched: ..." with the question. The same words asked of other sources are their own entry, and a double submit still collapses. Before 999 the question is kept without sources. |
| Not operational means hidden | Web is never offered. Research depends on the engine and HQ's source modes. Library depends on the learner reaching approved content. |
| Touch and phone | Each source is at least 44 px tall on touch, and nothing runs off a 390 px screen. |

Staging was restored after the walk: research engine, source modes, reference collections, research allowance and cached abstracts removed. Staging does not publish these settings by default, so they were copied from production's configuration for the walk. That configuration holds no credentials.

## Not verified

- **Live research retrieval.** PubMed returned 500 on and off, and OpenAlex rate-limited anonymous search, throughout the test. The walk used real review abstracts from Europe PMC, placed in staging's research cache under the correct key. Everything after retrieval ran for real: the source-quality and relevance gates, the AI call, the citation check, the display and the history. Production's research searches succeeded on 28 Oct, 1 Nov and 3 Nov.
- **Competen Library in the browser.** Staging's approved competencies sit in unpublished frameworks, and the database correctly refuses to publish those. So the chip is hidden there, which the walk checks. The route is proved by `route.test.ts`, and the layout by a stubbed reply (`shots/library-layout-stub-1440.png`), which shows layout only.
- A real phone or tablet. The phone check used an emulated touch screen at 390 px.
- Production. Nothing has been deployed or applied.

## Decisions made while testing

- **Competen Library is listed, never written from.** Its entries are competency titles and outcomes, not teaching text. A real AI call on them produced an empty statement: "neither entry contains detailed content", with citations (`library-ai-check.json`). So matching approved entries are listed as they stand, with no AI call for them.
- **Library is offered only to a learner who can reach approved content.** It matches the learner's programme or HQ's reference collections. In production 42 approved competencies sit in the nursing framework, and 1 learner has a programme. Everyone else would find nothing, so the chip stays hidden for them.
- **A learner's sentence is searched as keywords.** The lesson query builder quotes runs of words, and "do nurses prevent" as a phrase finds nothing. Lessons keep their existing query.

## Limits

- **Web sources are not offered.** Ask has no web path. Scholar's only web research is the examination tool, off in production, and turning it on is an owner decision on search processor, cost and funding.
- Saved learning is mostly earlier AI teaching. It is labelled "Saved teaching" with its date, and only its notes part is used.
- These are a few real AI answers, not a measured accuracy.
- Existing behaviour, not changed here: a research search that fails during a provider outage still counts against the learner's daily research allowance.

## Migration 999

Applied twice on staging, the second a no-op. Not applied to production. sha256 `4e23ebf3eaa228786bc6a6a7ccab306df721e33ab24de50ceec27be8372ac1e1`. The release package is `RELEASE-2026-10-25/PENDING-59`.
