# ASK-RESEARCH-GUARD-01: evidence

Owner's instruction of 6 Nov 2026: fix the Ask name leak. **No migration. No AI change.**

## The problem

A test question about "Mrs Nambi age 72 at Mulago" produced the outgoing query `mrs nambi age mulago ward sepsis qsofa`. It would have gone to PubMed and OpenAlex wherever research is on. The keyword functions remove identifier shapes and capitalised names, so a lowercase name still passes.

## The fix

What a learner types no longer leaves Competen, on any path. `withoutTypedQuestion` sits at the one point every Scholar search passes (`learnResearch`), and Ask no longer offers research as a source.

| Path | Before | Now |
|---|---|---|
| Ask across my materials, research source | Typed question searched | Not offered; a stale request answers "not run" |
| Ask in a lesson | Typed question searched | The lesson's own title and topics are searched, not the question |
| Evidence recovery, external references | Keywords from the typed question searched | No external search; notes and library still work |

It is closed in code (`TYPED_QUESTIONS_MAY_LEAVE`), not by a setting, so no one can turn on a known leak by publishing a policy. I told the owner it would be its own switch, off by default. A switch that opens a known leak is the wrong tool, so opening this comes with the name-safe query, decision D1 and gate G1 in `docs/design/SCHOLAR-ASK-WEB-SOURCES-DESIGN.md`.

## Behaviour that changes

Only where research is on. A learner loses external research on typed questions, and evidence recovery loses its external references step. Learn's lesson research on lesson topics is unchanged.

## Not fixed here

- **Lesson titles and topics come from the learner's uploaded notes**, and they still go out for lesson research. They could hold a name if the notes do. This belongs to SCHOLAR-RESEARCH-TEACH-001, whose ruling allows only sanitised academic subject terms, and must be settled before its activation.
- **Past searches.** This cannot tell whether anything was sent before the fix; `plat_research_requests` holds no query text.
- **The name-safe query itself** is not built.

## Tests

`ask-sources.test.ts`, `learn-research.test.ts`, the Ask route test and the evidence recovery tests pass. Harnesses `scholar-learning` 182 of 182 and `research-engine` 17 of 17. The dormant research path in the Ask route keeps its tests by opening it inside the test only. No browser walk: the change removes an option and a search.
