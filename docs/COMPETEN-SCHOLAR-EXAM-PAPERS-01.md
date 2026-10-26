# COMPETEN-SCHOLAR-EXAM-PAPERS-01: studying uploaded examination papers

| | |
|---|---|
| **Directive** | Owner, 2026-10-26: "Scholar exam paper learning and evidence research". Reuse first, build only what is missing, integrate into the eight-stage architecture. |
| **Migration** | `570-individual-scholar-exam-papers.sql`, sha256 `e0f887f9d950182c8cca878e1359177ab5a310b15c9cfd51be98f88de46999a7`. Applied ×2 on staging by the coordinator's guarded runner: idempotent (fingerprint `2b625aba…`, 84 items), rollback rehearsed back to PRE, re-applied (`docs/evidence/COMPETEN-SCHOLAR-EXAM-PAPERS-01/`). **Not on production.** Every read fails closed without it: pages hide the feature or say it is not set up. Rollback: `ROLLBACK-570.sql` (drops the four tables). Depends on 372. |
| **Defaults** | Papers offered with **notes and the Competen library** as evidence. **Live web research OFF. AI transcription of scanned pages OFF.** Both are owner decisions (below). |

## What existed and what was built

| Need | Before | Now |
|---|---|---|
| Live web search | None anywhere | `generate()` gains an Anthropic-only `webSearch` option (server web search tool, `allowed_domains`, `max_uses`). Sources come from the provider's result blocks, never from model text (`webSourcesOf`). |
| Question extraction | None (text extraction only) | `exam-paper.ts`: deterministic parser. It reads instructions, sections, numbering (`4(b)(ii)`), options, marks and lead-ins, and flags unreadable pages, numbering gaps, figures, missing options and `[UNREADABLE]`. Nothing is guessed. |
| Scanned papers | Refused ("OCR not available") | `generate()` gains PDF `documents` input. Pages are transcribed by the existing provider, two per call, at most 12. Each page is screened for patient identifiers and each question is labelled as transcribed. Policy-gated: fully scanned uploads at upload time, partly scanned papers when prepared. |
| Answers, follow-ups, guides | n/a | `exam-answer.ts` runs on the Learn engine: metered runner, risk, and the Holdings grounding verifier. Evidence is tagged `[N]` (the student's notes, never the paper itself), `[L]` (governed CFCA library, with review status) and `[W]` (web, with publisher, date and retrieval date). Uncited, miscited or ungrounded output is **withheld**. |
| Exam context and current guidance | n/a | `examAnswer` and `currentGuidance` are separate fields, with `guidanceStatus` set to agrees, differs, no current source or not applicable. Guidance that cites no current source (web, or an approved library entry) is dropped and the student is told why. Conflicts, unsupported claims and uncertainty are listed. |
| Saving results | n/a | `individual_scholar_exam_answer` holds the attempt, answer, evidence, research summary and model. It is private formative by CHECK. Follow-ups are not stored, as with Learn's explanations. |
| Revision | Existing flashcards and SM-2 cards | An answer becomes a flashcard through `insertRevisionQuestions`, and its card is due today. |
| Reusable research | n/a | `individual_scholar_research_cache` is a public cache: sources only, keyed by sha256 of the question, provider, domains and depth, with no user id. A cache hit spends nothing and does not count towards the daily cap. |

## Where it sits in the eight stages

- **Upload.** On the upload form, an optional "past or practice examination paper" choice, with its attestation. A single paper goes straight to its questions.
- **Classify.** A paper's sections keep their existing competency links, which feed the `[L]` evidence.
- **Learn.** Explanations come with evidence and follow-up questions. The Learn page points to papers.
- **Revise.** Answers can be added as flashcards. Revise shows what came from papers.
- **Apply.** Papers are listed in Apply, and each is studied at `study/apply/papers/[materialId]`: attempt first, then reveal.
- **Evaluate.** Formative practice figures: questions attempted, choices matching the suggested option (shown as "Not measured" with no data), and how often current guidance differs. These are never a mark.
- **Library and material page.** An "Examination paper" badge on the material, and a "Study as an examination paper" action on its page.

## Configuration

All settings are Individual policy, edited at HQ (`policy.ts`, `scholar_exam_*`):

| Setting | What it controls | Default |
|---|---|---|
| Offered | Whether papers are offered at all | on |
| Evidence sources | Notes, library, web | notes and library |
| Web provider | None, or Anthropic web search | none |
| Research depth | Quick (1 search), standard (3), deep (5) | standard |
| Approved domains | Where web research may search | WHO, Uganda MoH, NICE, NHS, CDC, NIH, Cochrane, Resus Council, SIGN |
| Daily web cap per student | Fresh research requests per day | 10 |
| Cache days | How long public research is reused | 30 |
| Scanned pages | Flag them, or transcribe with AI | flag |

AI activity codes reuse the approved Scholar list (`EXAM_ACTIVITY`, `exam-service.ts`): answer = deeper, follow-up = ask, guide = teach, research = deeper, transcription = map. Changing that is a one-line edit once HQ publishes dedicated codes.

## Safeguards

- **Privacy.**
  - Web research sends only the printed question: no notes, attempt, name or other upload.
  - A question that looks like it identifies a patient is never researched or answered.
  - Answers and transcriptions are screened for patient identifiers.
  - Every student row is own-row RLS and cascades with its material.
- **Live examinations.**
  - A practice-paper attestation is stored by version.
  - Every paper surface says "Do not use it during a live examination".
- **Consent.** Every AI call goes through `aiPreflight`: consent, quota and configuration.
- **Copyright.** The attestation covers the student's permission to use the paper. Retention is the material's own: deleting a material deletes its paper.
- **Formative only.** Suggested answers are labelled as AI-written, and are not an answer key or a mark. Nothing here changes Passport or verified competence.

## Owner decisions (blockers to turning things on, not to merging)

1. **Live web research.** Anthropic runs searches through a search provider.
   - That is a sub-processor for the privacy notice and legal drafts 02 and 04.
   - Searches are billed per search, in addition to tokens, and the allowance ledger prices tokens only. Pricing it is the coordinator's FX and margin area.
   - Turning it on means publishing `scholar_exam_evidence_sources` (with web) and `scholar_exam_web_provider`.
2. **AI transcription of scanned pages.** Page images go to the existing AI provider.
   - Whether the current consent notice covers images of uploads is the owner's call.
   - Turning it on means publishing `scholar_exam_scanned_pages = ai_transcription`.
3. **Copyright and retention of uploaded papers.** The existing upload attestation plus the practice-paper attestation are used. Any stricter rule (for example, refusing papers from named examining bodies) is an owner policy.

## Verification

- **Unit tests** (`npx vitest run src/lib/individual/scholar/ src/lib/ai/ src/lib/individual/policy.test.ts`): 368 pass. The new tests are `exam-paper.test.ts`, `exam-answer.test.ts` and `exam-research.test.ts`. They cover:
  - the parser and its flags;
  - evidence tags;
  - withholding uncited, miscited or ungrounded answers;
  - the guidance downgrade;
  - the patient-identifier refusal;
  - transcription splitting;
  - web-research gating and the query being the question only;
  - the cache key;
  - domain and https filtering;
  - what the research and transcription calls send.
- **Harnesses against a staging-pointed dev server:**
  - `scholar-exam-papers-harness.ts`: ALL GREEN, 17/0, with real AI. Groups P (prepare), I (isolation), A (answer, follow-up), R (revision), E (deletion) and Z (cleanup).
  - `scholar-upload-harness.ts`: 15/0.
  - `individual-foundation-harness.ts`: 74/0.
  - `individual-config-harness.ts`: 45/0.
- **Not exercised live:** web research and AI transcription. Both are off by default, and turning them on means writing shared staging configuration, which this work does not do. Their request shapes are unit-tested.
