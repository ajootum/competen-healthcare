# SCHOLAR-RESEARCH-TEACH-001 P1: evidence

Owner instruction of 6 Nov 2026, with the owner's direct GO for development and testing the same day. **Production activation is not authorised and needs its own GO.** Default is off.

## What it does

With the new server switch on, the first Teach Me of a lesson consults free scholarly sources and writes one lesson from three identified sources, each sentence saying which:

- `[S n]` the learner's notes, the foundation
- `[E n]` a published abstract from an evidence pack
- `[AI]` Scholar's own explanation

Reopening a saved lesson makes no search and no AI call. If research fails or is thin, Teach Me teaches from the notes and says external research was not included.

## How each owner ruling is met

| Ruling | How | Proof |
|---|---|---|
| Only subject terms leave | Outgoing queries are constants in a closed list in the repo. The lesson is only read, to choose list entries. Nothing is built from learner text | `evidence-pack.ts`, hostile-lesson tests, `run-ledger.json` searches |
| Free sources only | The pack narrows to PubMed, Crossref and PubMed Central | Test with OpenAlex Active: not called. Ledger: no OpenAlex host |
| Citations shared, abstract text not | Shared rows hold bibliographic details and appraisal, one row per topic. Each lesson reads abstracts by PMID | Tests. 20 staging rows read back: no abstract text, no user id |
| Abstracts only | Full text is never fetched, and each reference says so | `shots/3-references-open.png` |
| Search once, no duplicates | A topic row is claimed atomically, and a second learner waits for the result | Test: two learners at once make one search |
| No search on reopening or switching stages | The pack is prepared only after every saved-lesson lookup has missed. A prepared lesson may not search | Route tests, walk |
| Fails soft | Any failure gives a notes lesson and the plain sentence | Route test. A real PubMed timeout on staging took this path |
| Own switch, default off | `scholar_teach_research`, apart from `scholar_learn_source_modes`, so turning it on does not change Ask or Research & Explain (design finding F8) | Test |
| Risk decided before search | Asked in every metering state before anything is sent (design finding F4) | Route test |

## Measured on staging

Two ways: a direct script (`scripts/scholar-research-teach-acceptance.ts`, `run-ledger.json`) and the real route through a browser walk (`scripts/scholar-research-teach-walk.mts`, `walk.txt`). Timings are from a local machine and a dev server, with slow links to PubMed and Supabase seen during the run. **Production speed is not measured.**

| | First lesson on these topics | Second learner, same topics |
|---|---|---|
| Fresh searches | 4 | 0 |
| Outgoing requests | 27 to 28 | 1 (abstracts by PMID) |
| Pack time | about 24 s | about 3 s |
| Whole lesson | about 72 to 75 s (script) | about 45 to 62 s (route, including dev server overhead) |

| AI cost per lesson, recorded by the gateway | Sonnet 4.6 |
|---|---|
| Lesson | USD 0.024 to 0.031 |
| Claim check, after the one-line reply fix | USD 0.008 to 0.010 |
| **Lesson with evidence** | **about USD 0.032 to 0.041** |
| Notes-only lesson on the same route, one sample | USD 0.031 |

Sources cost USD 0. If production's routing requires Opus 4.8 at this risk tier, the same tokens would come to about USD 0.075 (an estimate, not measured). **Production's route for this lesson is not checked here.**

**Test ledger:** 17 model calls across 9 lessons, about USD 0.37: 5 by script and 4 through the route, one of which took the notes fallback. Every call was capped. Research: PubMed 67 requests, Crossref 64, PubMed Central 34. These totals include repeat searches caused by changing the list during development.

**Limits:** per learner, 5 fresh-search lessons a day (the existing research limit) and USD 1 a day (new setting). Reused topics do not count against the first. A lesson at either limit is taught from the notes where the limit applies, and says so.

## Files

- `enhanced-lesson.md`, `references.json`: the lesson used for the comparison
- `route-lesson.md`, `route-references.json`: a lesson through the real route on one slide and its related sections
- `citation-check.md`, `citations-reverified.json`: every citation checked again, separately
- `rubric-comparison.md`: current production lesson against the enhanced one (14 of 30 against 25 of 30, my own scoring), and the acceptance list
- `run-ledger.json`, `walk.txt`, `shots/`

## Temporary staging change

For the walk I published the switch and the research documents on staging, then set them back. Those 4 rows did not exist before and now remain with `published` null, which reads as absent. No configuration was left active. Fixture learner only. Production was never touched.

## Known limits, for the owner's decision

1. **Acceptance items 2 and 3 are only partly met** (see the rubric). The abstracts do not cover cephalocaudal development, or the critical and sensitive distinction itself.
2. **The list is small and hand-written:** 4 curated topics and about 1,240 phrases. A lesson outside it gets no search and says so. Only the 4 curated topics have tuned queries, and the phrase topics have not been tested for result quality. MeSH could widen it, but its licence and fit are not checked.
3. **A failed search is saved with its lesson.** The notes lesson stays until the learner asks for a new one. Selective refresh is P2.
4. **Freshness of 15 years drops older foundational works.** An HQ setting can raise it.
5. **At scale:** NCBI allows 3 requests a second without a key, and the research budget check is not atomic (design finding F6). A free NCBI key is a future decision.
6. **The 120 second route limit and in-flight window** now apply to all Learn actions, not only this one. A crashed request now blocks an identical retry for up to 120 s rather than 60 s.
7. **Cross-learner licensing:** the older Research & Explain cache still shares abstract text across learners. This P1 does not change that path.
8. **The separate query privacy work for Research & Explain** is not in this PR.
