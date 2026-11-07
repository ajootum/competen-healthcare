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
| Only subject terms leave | Outgoing queries are constants in a closed list in the repo (`evidence-pack.ts` for the curated topics, `holdings/research/subject-phrases.ts` for the general phrases). The lesson is only read, to choose list entries. Nothing is built from learner text | `evidence-pack.ts`, hostile-lesson tests, searches in `run-ledger-fresh-search.json` |
| Free sources only | The pack narrows to PubMed, Crossref and PubMed Central | Test with OpenAlex Active: not called. Ledger: no OpenAlex host |
| Citations shared, abstract text not | Shared rows hold bibliographic details and appraisal, one row per topic. Each lesson reads abstracts by PMID | Tests. Staging rows read back: no abstract text, no user id |
| Abstracts only | Full text is never fetched, and each reference says so | `shots/3-references-open.png` |
| Search once, no duplicates | A topic row is claimed atomically, and a second learner waits for the first learner's result, for up to about 32 s from the start of its own preparation | Test: two learners at once make one search and both get the result |
| No search on reopening or switching stages | The pack is prepared only after every saved-lesson lookup has missed. A prepared lesson may not search | Route tests, walk |
| Fails soft | A failed pack or failed lesson model call gives a notes lesson and the plain sentence. A refusal after the lesson is written keeps that lesson, with nothing cited to research | Route tests. A real PubMed timeout on staging took this path |
| Own switch, default off | `scholar_teach_research`, apart from `scholar_learn_source_modes`, so turning it on does not change Ask or Research & Explain (design finding F8) | Test |
| Risk decided before search | Asked in every metering state before anything is sent (design finding F4) | Route test |
| Corrections are never put in the notes | A refinement shows both sides with both citations. The upload is never changed | Tests |

## Measured on staging

Two ways: a direct script (`scripts/scholar-research-teach-acceptance.ts`) and the real route through a browser walk (`scripts/scholar-research-teach-walk.mts`, `walk.txt`). Timings are from a local machine and a dev server, with slow links to PubMed and Supabase seen during the run. **Production speed is not measured.**

| From `run-ledger-fresh-search.json` | First lesson on these topics | Second learner, same topics |
|---|---|---|
| Fresh searches | 4 | 0 |
| Outgoing requests | 27 | 1 (abstracts by PMID) |
| Pack time | 28.2 s | 3.6 s |
| Whole lesson | 64 s | about 40 s (`run-ledger.json`) |

| AI cost per lesson | Sonnet 4.6 |
|---|---|
| Lesson | USD 0.024 to 0.031 |
| Claim check, once it answers in one line | USD 0.008 to 0.011 |
| **Lesson with evidence** | **about USD 0.032 to 0.041** |
| Notes-only lesson on the same route, one sample | USD 0.031 |

Sources cost USD 0. If production's routing requires Opus 4.8 at this risk tier, the same tokens would come to about USD 0.066 (an estimate from `run-ledger.json`, not measured). **Production's route for this lesson is not checked here.**

**Test ledger:** 25 model calls across 13 lessons, about USD 0.52: 9 lessons by script and 4 through the route, one of which took the notes fallback. Every script run was capped. Research requests across the whole of development: PubMed about 70, Crossref about 75, PubMed Central about 35, at no charge. Those totals include repeat searches caused by changing the list during development.

**The lesson in the evidence used 6 records rather than the default 5.** With 4 topics and 5 records, attachment got only one, and the source that cautions against deterministic readings dropped out. For activation I recommend publishing `maxEvidence` at 6 in the research policy, which is a setting and needs no code. It adds about USD 0.001 per lesson.

**Limits:** per learner, 5 fresh-search lessons a day (the existing research limit) and USD 1 a day (new setting, claim check included). Reused topics do not count against the first. A lesson at either limit is taught from the notes where the limit applies, and says so.

## Files

- `enhanced-lesson.md`, `references.json`: the lesson used for the comparison, from the final code
- `route-lesson.md`, `route-references.json`: an earlier lesson through the real route on one slide and its related sections, before the final prompt changes
- `citation-check.md`, `citations-reverified.json`: every citation checked again, separately
- `rubric-comparison.md`: current production lesson against the enhanced one (14 of 30 against 24 of 30, my own scoring), and the acceptance list
- `run-ledger.json`, `run-ledger-fresh-search.json`, `walk.txt`, `shots/`

## Temporary staging change

For the walk I published the switch and the research documents on staging, then set them back. Those 4 rows did not exist before and now remain with `published` null, which reads as absent. My first restore failed on a not-null constraint and the second succeeded, so the switch stayed on for staging from 17:05 to 19:17 UTC. No configuration is left active. Fixture learner only. Production was never touched.

The last Library and reopen checks ran with the switch off, which also shows a saved lesson with evidence still opens if the switch is later turned off. The phone check is from the walk before the last small label change.

## Known limits, for the owner's decision

1. **Acceptance items 2 and 3 are not fully met** (see the rubric). The abstracts do not cover cephalocaudal development, or the critical and sensitive distinction itself.
2. **The list is small and hand-written:** 4 curated topics and about 1,240 phrases. The phrases sit in Holdings as shared research data. They include subjects such as "nursing process" and "teamwork training", which Scholar's own code may not name (harness K9 and S1), and those rules still hold for all Scholar code. A lesson outside it gets no search and says so. Only the 4 curated topics have tuned queries, and the phrase topics have not been tested for result quality. MeSH could widen it, but its licence and fit are not checked.
3. **A failed search is saved with its lesson.** The notes lesson stays until the learner asks for a new one. Selective refresh is P2.
4. **Freshness of 15 years drops older foundational works.** An HQ setting can raise it.
5. **At scale:** NCBI allows 3 requests a second without a key, and the research budget check is not atomic (design finding F6). A free NCBI key is a future decision.
6. **The 120 second route limit and in-flight window** now apply to all Learn actions, not only this one. A crashed request now blocks an identical retry for up to 120 s rather than 60 s. A duplicate still waits 40 s, so a reload during a first lesson (about a minute) can see a retry message.
7. **Exports** (`learning-export.ts`) keep raw tags and omit the notes-and-evidence part. Left for P2.
8. **The claim check is not complete.** See `citation-check.md`.
9. **The Crossref concurrency cap of 3** also applies to Research & Explain, with the switch off. It changes timing only.
10. **Cross-learner licensing:** the older Research & Explain cache still shares abstract text across learners. This P1 does not change that path.

The separate query privacy work for Research & Explain is not in this PR.
