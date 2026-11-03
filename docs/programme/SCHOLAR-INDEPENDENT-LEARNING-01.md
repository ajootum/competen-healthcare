# SCHOLAR-INDEPENDENT-LEARNING-01 — AI-independent, AI-enhanced learning engine

Owner instruction, 3 Nov 2026. Competen Scholar's core learning activities must work without generative AI; AI stays
an enhancement. An enhancement of the existing Scholar, never a new engine or product. The eight-stage journey
Join → Upload → Classify → Learn → Revise → Apply → Evaluate → Progress is preserved (Classify stays a background
capability with an optional learner view). This document is the audit (item 1), the three modes (item 2), the unit
model (item 3) and the state of the increments (items 4–12). Evidence paths are under `src/`; migrations under
`supabase/migrations/`.

## 1. Implementation audit (one pass, 3 Nov 2026, main @ add3b412)

Classes: **A** works fully without AI · **B** AI-dependent today but can run deterministically from existing data ·
**C** AI-generated once, then reusable without AI · **D** genuinely needs live AI.

| Capability | Class | Evidence | Material gaps |
|---|---|---|---|
| Upload and parsing | **A** (extraction) · C (topics, once analysed) · D (proposing topics and mappings) | `api/.../materials/route.ts:26` "Extraction runs on this server. Nothing is sent to an AI provider"; `extract.ts` (unpdf, pptx-drawingml, mammoth, utf8), `chunkPages` deterministic; AI only for scanned exam papers on attestation (`:75-82`) and picture-only slides on request (`slides/route.ts`), both with provenance in `extraction_quality.ai_provenance`. | **Auto-AI on open**: `competency-client.tsx:148-152` runs the analysis by itself the first time a material page is opened with consent on (metered, consent-gated, but no click). No deterministic topic fallback (headings exist in the text and are not used as topics). |
| Knowledge and content engine (retrieval, search) | **A** | `retrieval.ts` Postgres full-text on `chunk.tsv` (372), `learn-search.ts:3-10` "Search works the same with AI help off", `library.ts` pure. | "Document Studio" is a Professional feature (`(professional)/progress/documents`), not Scholar; "Content Engine" has no module. Topic filters are empty until an analysis has run once. |
| Personal Learning Library and AI Notebook | **C** (saved teaching) · **A** (notes, bookmarks, highlights, search, filters, export) | `individual_scholar_artefact` (415): owner, sources (chunk ids), action, depth, model, prompt_version, dedupe_key, review_status = private_formative; 820 `superseded_at` versions; `act/route.ts:84-95, 286-305` saved-first, AI preflight only after the cache path. Notes 820, learner-written, PII-screened. | No integer version on artefacts (only `superseded_at` + prompt_version). Ask answers are not saved (stated rule). |
| Document sections and source references | **A** | chunk ordinal / page_from / page_to (372), `citeChunk` "page N / slide N / section N", artefact_source rows, `coversLesson`. | Granularity is the chunk; a Word/text file is cited by ordinal only. |
| Learning sessions and Connected Study Sessions | **A** (plan, resume, position) · D (lesson generation) | `learn.ts planSteps` no AI; 790 position (step, furthest_step, card_id `lesson-<n>:<anchor>`, offset_hint, stale-write rule in the database); `learn-journey.ts:8-17` a resume never teaches; `study-context.ts` reads only. | **Guided auto-teach** of the first lesson of a NEW scope (`learn-journey.ts:11-12`, consent-gated, metered) is an AI call without a Teach click. |
| Competency mapping / classification | **D** (proposing) · **A** (deciding, adding, counting) | `generation.ts runAnalysis` → one LLM call; map rows source ai/student/reviewer with model + prompt_version (388/390); decisions append-only; `competency-progress.ts:10-19` counts practice only through ACCEPTED links. | With AI off, Ready says "Not found: AI help is off"; only manual links work. `competency-progress.ts:85` counts PROPOSED links toward `notes_linked`. The indicator labels of item 8 do not exist on main (the Competency Explorer session is building them). |
| Learn and Personal AI | **A** (planning, outline, recall self-rating, quick check from stored questions) · **C** (six saved explanation kinds) · **D** (Ask, check marking, tutoring) | `act/route.ts:368` open:true never calls AI; `learn-inline.ts` recall is a self-rating; quick check reads stored MCQs, scores by code. | **Before this work a lesson with nothing saved and AI off showed only "Learning needs AI help, which is off"**: the original sections were one click away on the material page, never inside the lesson (`learn-client.tsx:1037`, sources as links only `:1170-1178`). Multi-material lessons are never saved (`storable` requires one material). |
| Flashcards and spaced repetition | **A** (review, scheduling SM-2, own cards, decks) · **C** (AI cards) · D (new cards) | `flashcards.ts` → `revision.ts scheduleReview` (sm2); `revision/sessions/route.ts:104-125` a deck session sets `generated: 0`; own cards `POST /flashcards` with model `learner`. Provenance: model, provider, prompt_version, review_status, library_version_id, content_version. | A deck-less "make cards" request spends AI on a shortfall unless policy is `saved_only` (the note says so only afterwards). |
| Question banks, revision, adaptive exams | **A** (mcq, mrq, true/false, cloze, match, sequence, case, self-graded flashcards) · B/A (short, structured, scenario: code first, AI only on `ai_then_self`, else self-grade) · D (extended marking) · C (stored questions) | `revision.ts markResponse:245-278`; `answer/route.ts` AI only inside `needsJudgement`; `adaptive-service.ts chooseNext` library → stored → one AI call → nearest difficulty; attempts carry `marking` deterministic / self_graded / ai_evaluation with evaluator model. | The format picker does not say beforehand which formats need AI; extended with AI off is always self-marked and said only at answer time. |
| Clinical cases and OSCE | **A** (play stored case, deterministic debrief, OSCE self-checklist and score) · **C** (private AI cases, AI stations) · D (new cases, written-answer feedback, Talk to the patient) | `clinical-play.ts` same engine as library cases, `markDecision` by key, `caseDebrief` deterministic; OSCE `scoreTicks` self-graded, `station_snapshot` on the attempt (721); library content only when published AND clinically approved. | The Apply page reads standing for `case_steps` only, so answer feedback can fall back silently to self-review. Private cases/stations carry review_status private_formative only (by design). |
| My Plan and study calendar | **A** | `plan-proposal.ts`, `study-plan.ts`, `plan-service.ts` "NO AI"; 840 events record learner decisions only; completion is recomputed from attempts, reviews, learning events, case decisions, evaluations, OSCE runs. | Proposal labels depend on AI topics (falls back to headings / "Section n"). |
| Learning analytics / progress / evaluation | **A** | `mastery.ts:8`, `progress-next.ts:13`, `progress-data.ts:7`, `evaluation.ts:13-22` all no AI; AI-marked answers weighted 0.5, self 0.35; FORMATIVE_NOTICE on every progress surface. | None material. "% right on latest try" appears under "What my learning evidence shows" (knowledge, not competence, and labelled so). |
| AI allowance, metering, governance | governance | `allowance.ts getAiStanding / runMeteredAi`, `fair-use-policy.ts` levels full / optimised / essential / continuity, `consumption.ts` attribution, `gateway.ts` one `plat_ai_requests` row per call, CAU ledger `ai_usage_ledger`; shared copy `ai-availability.ts` (10 reasons). | Provider down / not configured is **not** in the shared reason set (`http.ts:47,52,54` raw strings, "environment" wording); eight server-rendered pages hand-write their own AI-off wording; several cover consent only and ignore an exhausted allowance. |
| Operating modes | none | `src/lib/ai/operating-mode.ts` is the clinical-RISK mode (strict_production / supervised_pilot / clinical_production), not a learner mode. | No learner-level notion of independent / AI-prepared / live. The name "operating mode" is taken: this work says **learning modes**. |

## 2. The three learning modes (what they mean in Scholar)

| Mode | What it covers | How Scholar does it |
|---|---|---|
| **1 Independent** (no AI at all) | open documents, read original content, navigate learning units, search, bookmark/annotate, record progress, resume, review existing flashcards, complete existing quizzes/cases/OSCE, follow plans, view competency progress and evidence | Everything in class A above, plus (this work) **the lesson reader**: the original sections inside every Learn lesson, read-marked, with their competencies and what already exists to practise with. No AI, no allowance, no standing read. |
| **2 AI-prepared** (generated once, reused) | summaries, explanations, flashcards, questions, cases, suggested unit groupings, suggested mappings | Class C above: artefacts (415/820), questions and cards (372/416/730), private cases (435), OSCE stations (720/721), mappings (388/390) — each with owner, source references, generation method (model, prompt_version), review status and (where it exists) version. Never auto-shared between learners: every row is `user_id`-keyed, and only published AND clinically approved library content is shown as approved. |
| **3 Live AI** | Teach Me, Explain, Simplify, Go Deeper, Ask Scholar, tutoring, clinical reasoning simulations, context-aware Personal AI, AI formative feedback, recommendations | Class D above, through `runMeteredAi` (consent, risk classification, eligibility, routing, allowance, `plat_ai_requests`). Unavailability is said with the shared `ai-availability.ts` copy and never substitutes for deterministic scoring. |

AI availability never decides whether the platform works: with AI off the learner is told what works (`WORKS_WITHOUT_AI`,
`learn-reader.ts`) and the reason for the rest (the shared copy).

## 3. Source units, learning units, activities, competency relationships

| Term | What it is | Where it lives |
|---|---|---|
| Source unit (document section) | One chunk of the learner's notes: a slide, a page part, a Word/text section. The unit of citation, of navigation, of questions and cards, of mappings. | `individual_scholar_chunk` (372). Unchanged. |
| Learning unit | A contiguous run of sections of one material that teaches one thing. Two faces of one model: in **Learn** it is a *lesson* (`learn.ts planSteps`, the steps of a 414 session); in **My Plan** it is a *planned unit* (SCHOLAR-PLAN-UNITS-01, the same planner tuned for planning, stored by section ordinals with the acceptance — the sibling session's work, built on here, not duplicated). Deterministic from headings, slide titles and topics; no fragmentation (79 slides ≠ 79 lessons). | `individual_scholar_learning_step` (414); plan event `proposal.value.units` (840). |
| Learning activity | A Learn lesson opened / read / taught / checked; a flashcard review; a question attempt; a case session; an OSCE attempt; an evaluation. | learning_event (414, + `read` with 920), review, attempt, case_session, osce_attempt, evaluation. |
| Competency relationship | A link from a section to a competency: proposed (AI) or accepted (learner / reviewer). A link is never practice and never competence. | competency_map + decision (388/390). |

Learners combine, split, exclude and put first their My Plan units at the proposal review (sibling work). Renaming a
unit and re-cutting a Learn session's lessons are not yet offered (follow-up, item 3).

## 4. Increments

### P0 — the independent lesson reader (branch `scholar/independent-learning-p0`, PR pending)

- **Read route** `GET /api/individual/scholar/learn/sessions/[id]/read?step=<n>`: the lesson's sections with their ORIGINAL text (the caller's own chunks, read again by their id), heading, speaker notes apart, citation, AI-read mark; competencies linked to those sections (accepted apart from proposed, labels from the learner's catalogue); what already exists for them (`store.ts lessonRelated`: flashcards, questions, attempts, private cases, OSCE stations, saved explanations). No AI, no allowance, no learning event by itself.
- **Reader panel** (`learn-reader.tsx`) inside every lesson card, **before** any AI teaching: open by itself when nothing is taught or AI is not available (`readerOpenByDefault`), collapsed one click away otherwise. Each section is an anchor `lesson-<step>:s<ordinal>` (`learn-reader.ts readAnchor`), so the existing 790 position saves and restores the exact place inside the original text on any device. Open in the material, the original slide/page picture (existing `SourcePictureButton`), highlights and notes through the lesson's existing 820 notes panel.
- **Mark as read**: `PATCH sessions/[id] { move: "read", at }` → learning event action `read` (migration 920), current_step untouched. The mark is a live activity at once (and so in the 790 position); the server says whether it was recorded (920 absent: kept on the device). `learn-journey.ts lessonFacts`: `marked` stands where `taught` stands in the completion rule, so a lesson studied from the notes alone completes exactly as one taught by AI does. Never assessment evidence.
- **P1 (part, in the same panel)**: existing flashcards, questions, cases and OSCE stations for the lesson's sections are opened directly (`lessonFlashcardsHref`, Revise by material, `ReplayCase`, the station page) — never regenerated — with the honest "nothing has been made for these sections yet" and the alternatives.
- **AI unavailability**: the session banner says what works without AI before the reason; the empty-lesson placeholder no longer says learning needs AI.
- Performance: one read per lesson per visit, and only for the active lesson or one the learner opened (never every lesson of a long session at once).
- Evidence: `docs/evidence/SCHOLAR-INDEPENDENT/920-build-record.md` (staging ×2, VERIFY, rollback), headless walk 16/16, desktop / tablet / phone screenshots.

### P1 — connected activities and one AI-off voice (branch `scholar/independent-learning-p1`, stacked on P0, PR pending)
- Every link out of the reader carries the open study session (`study-active carry`): Open in the material, flashcards, questions, OSCE stations, cases.
- **Revise narrowed to the lesson**: "Answer these questions" opens Revise with `?material=&sections=`; `RevisionStart` then starts a `sources` scope of exactly those sections (the existing `parseScope` / `resolveScope`), says "Only the N sections of the lesson you came from", and offers "Use the whole material". Existing questions on those sections are offered first (the route's saved pool), and the shortfall rules are unchanged.
- **Ask about this** on every section of the reader: the CE-01 in-place panel grounded on that one section (surface `learn`, the session and step); it says why when AI is not available and never blocks reading.
- **One AI-off voice**: the Scholar preflight and provider errors (`scholar/http.ts`) now carry a `code` (`consent_off`, `consent_outdated`, `consent_awaiting_legal`, `not_configured`, `failed`), every `AI_ERROR` consumer passes it through, and the shared copy (`ai-availability.ts`) gains `provider_unavailable` ("AI help is not available right now, so nothing was sent. Everything you have saved still works."). The word "environment" is gone from Scholar's AI errors. Professional's own strings (`professional/assistant`, `mappings`, `needs-ai`) are out of scope and listed as a follow-up.
- Not in P1: Evaluate narrowed to a lesson (Evaluate already reads sessions and attempts by section through the study session), My Plan "Today" entry point (CE-03 owner rebuild).

### P2 — deterministic adaptation from existing records (branch `scholar/independent-learning-p2`, stacked on P1, PR pending)

The owner's rules, checked one by one against what already runs (no separate adaptive engine):

| Rule | State | Where | Configurable |
|---|---|---|---|
| Incorrect answers raise revision priority | exists | Revise "Weak areas" mode and "Go over what you keep missing" (`revision.ts`, `mistakes.ts`), Progress next-step rules | `scholar_progress_next_rules`, `scholar_revision_modes` |
| Overdue cards return | exists | SM-2 scheduling (`revision.ts scheduleReview`), "Cards due" on Revise, My Plan `due_revision` rule | `scholar_srs_*`, `scholar_plan_rule_order` |
| Completed units update My Plan | **gap, closed here** | My Plan counted a section as started only when a question on it was answered (`plan-data.ts assembleMaterials`): a lesson read from the notes alone (P0's Mark as read), opened or taught stayed "unstarted" and was planned again as new. Now `startedSections` (pure) counts any learning event except a skip whose sources name the section (`store.ts learnedChunkIds`, 414 event sources, 920 read marks). | new key `scholar_plan_started_signal`: `learning` (default) or `practice` (the earlier rule) |
| Repeated difficulties flag gaps | exists | Mistake notebook (`scholar_mistake_notebook`), Insights "What to revise next", flashcard gaps scope | `scholar_mistake_notebook` |
| Existing questions recommended before generation | exists | Revise sessions read the saved pool and library copies first and generate only for a shortfall (`revision/sessions/route.ts`); adaptive `chooseNext` library → stored → one AI call; P1's narrowed Revise offers the lesson's existing questions first | `scholar_revision_generation = saved_only` stops generation entirely |
| Cases revisitable | exists | stored cases replay with no AI (`ReplayCase`, `clinical-play.ts`); P0 reader opens them directly | — |
| Activities update competency-related progress | exists, accepted links only | `competency-progress.ts` counts practice through ACCEPTED section→competency links; mapping never counts as practice; knowledge performance is never verified competence (FORMATIVE_NOTICE) | — |

No migration. Evidence: vitest `plan-data.test.ts` (startedSections), `policy.test.ts` (the key, its fallback and clamp), plan / policy suites green; tsc clean.

### P3 — AI optimisation (later)
Saved-output reuse before generation everywhere, less generation, cheaper tiers for low-risk activities (CE-07).

## 5. Owner decisions and blockers

1. **Migration 920** (the `read` action): staging-applied and verified; production needs the owner's separate GO. Until then "Mark as read" is kept on the device and in the 790 position only (the page says so).
2. **Guided auto-teach of a new scope** and **auto-analysis on a material's first open** are the two AI calls made without a click (consent-gated, metered). Keep, or make them explicit? (Recommendation: keep guided auto-teach as the learner's chosen mode; make the first analysis a button.)
3. The eight pages with hand-written AI-off wording, and the provider-down reason missing from the shared copy, are a small consistency PR (item 9) — proposed as P1 scope.
4. Unit renaming and re-cutting a Learn session's lessons (item 3) are not offered yet.
