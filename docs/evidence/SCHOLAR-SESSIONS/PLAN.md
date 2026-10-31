# SCHOLAR-SESSION-AI-01: Connected Study Sessions and Context-Aware Personal AI

Gap-only plan. Read against main @500df4d4 (31 Oct 2026). Nothing implemented.

**In one line:** the parts all exist. What is missing is one thing that holds the learner's chosen focus across Learn, Revise, Apply and Evaluate, and one function that turns that session's own records into context for the Personal AI. The plan reuses the Learn session (migration 414) as that anchor, adds one small migration, and adds no new engine, assistant or store.

## 1. Built / partial / missing

| Capability | State | What exists (reuse) | Gap |
|---|---|---|---|
| Choose a focus (topic, document, competency) | **Built (Learn only)** | Learn session (414). `scope_kind` can be section, document, documents, topic or competency, with topic and competency_id. `createLearningSession`, `resolveScope`, `LearningScope`. | Only Learn knows the focus. |
| Learning objective as focus | **Partial** | CFCA catalogue (`loadLearnerCatalogue`), chunk-to-competency map (388), `outcome` scope in Evaluate. | Learn's scope list has no outcome kind (see decision D2). |
| Carry focus across stages | **Missing** | Hand-built deep links on specific buttons: Learn to Apply, Revision to Learn, Paper to Revise, Progress next-steps, Evaluate to Revise. | `StudyNav` tabs carry no context. There is no shared client state and no session layout. |
| Per-activity resume | **Built** | Learn `?session=` (step and events), Revision (position and held answers), Flashcards, Adaptive, Case, OSCE autosave, and "Continue learning" on Home. | None. |
| Resume the whole study session | **Missing** | | No "last place" across stages. Evaluate and Progress are recomputed. |
| Activities belong to a session | **Missing** | Each activity has its own session row. | Revision sessions store no scope. Nothing links an OSCE attempt, deck, case or evaluation to a focus. |
| Grounded tutor (Ask, Teach and the rest) | **Built** | `learn/act`: retrieval (FTS, rank, spread), [S]/[R]/[E] citations, `verifyGrounded`, notes/library/research modes, history resent by the browser. | It reads session passages only, not session activity. |
| Personal AI (shared assistant) | **Partial** | `runIndividualAssistant` with data scopes `passport`, `study_context`, `own_learning`, `own_development` (CONFIG-002 `ai.assistant.scholar`). | It is ungrounded, has no history and no session awareness. |
| Learner context for AI | **Partial** | `buildLearnerContext` (words only, "not grounding"), giving programme, level, linked competencies, needs-practice and not-practised. | It does not see recent attempts, feedback, OSCE gaps, flashcards, saved explanations or session progress. |
| Records the AI should see | **Built (unread)** | Artefacts (415), attempts and answers (372/416), learning events (414), OSCE `gaps` and `revision_suggestions` (721), `loadFlashcardGaps`, decks (730), `evaluationEvidence`. | No AI prompt reads them. |
| Allowance, routing, risk | **Built** | `scholarAiRunner`, `runMeteredAi`, `ai.fair_use.scholar`, `ai.model_routing`, `scholarRisk`, `aiPreflight`. | None. Metered under the existing `ask` activity. |
| Avoid repeat AI calls | **Built** | Artefact cache (`findArtefact`). Navigation has no AI. | None, provided navigation stays AI-free. |
| Privacy and product boundary | **Built** | `requireIndividualContext("scholar")`, caller-keyed `store.ts`, harness A1/B1/B2/C1-C3. Professional data only through `own_development` plus migration-700 consent, off in Scholar by default. | Must hold for the new context builder (test). |
| Responsive | **Built** | `StudyNav` (sticky scroll row below `md`), `ReviseNav` container modes, the single `md` breakpoint, `pointer-coarse` sizing. | A compact session bar is needed. |

## 2. Learner journey

1. **Start once.** From Library, a document, Learn search or a competency, the learner chooses **Study this**. This creates (or reopens) a study session, which is a Learn session flagged as connected. Its title is the topic, document or objective.
2. **Session bar.** Every study page shows one slim bar with the focus title and four stage chips (Learn, Revise, Apply, Evaluate), each with a progress mark. It also has **Ask Personal AI** and **End session**. The `StudyNav` tabs keep the session.
3. **Learn.** The existing step-by-step Learn runs on the session's scope.
4. **Revise.** Practice, Flashcards and Adaptive open pre-scoped to the session: same material, topic or competency, with a "From this session" deck or set.
5. **Apply.** OSCE stations filtered to the session's competency or topic, cases from the session's material, and Apply from a section.
6. **Evaluate.** Evaluate opens with the session's scope already chosen. It still reads only its existing evidence.
7. **Ask anywhere.** The Personal AI answers with the session in mind, for example: "you missed the eGFR stage cut-offs twice; your OSCE gaps were fluid balance". Answers stay cited from the notes.
8. **Resume.** "Continue your study session" on Home and Learn reopens the last stage. Each activity resumes where it stopped, as it does today. Another device gets the same result.

## 3. Minimal database and API changes

**One migration** (the next free number, 740 at the time of writing), which is additive:
- `individual_scholar_learning_session` (414): add `connected boolean not null default false`, `objective_outcome_id` (nullable, see D2) and `last_space text` (checked against learn, revise, apply or evaluate).
- New `individual_scholar_study_link`: (session_id, user_id, kind, ref_id, created_at).
  - kind is one of revision_session, osce_attempt, flashcard_deck, case_session, evaluation or exam_paper.
  - Composite FK (session_id, user_id) to the session with cascade, so the links go when the session goes.
  - Unique on (session_id, kind, ref_id).
  - RLS read-own.
  - No foreign keys to the activity tables (refs are checked against the owner in `store.ts`), so deleting an activity is never blocked.
- Staged twice, with rollback. No change to any existing row.

**APIs.** These are extensions of existing routes, with no new engine:
- Create or reopen: the existing Learn session creation path accepts `connected: true`.
- Pages accept `?study=<id>`. The server resolves the scope once by reading the database, not by calling AI, then pre-fills its own existing scope and sets `last_space`.
- The existing create routes accept an optional `studySessionId`: revision sessions, OSCE attempts, flashcard decks, case sessions and evaluations. They check that the learner owns it, then insert a link.
- `learn/act` `ask`, when its `sessionId` is a connected session, adds the study-session context block. There is no new parameter.
- Gate: a new Individual policy key, `scholarStudySessions`, defaults to OFF and fails closed while the migration is absent.

## 4. Context-aware Personal AI

- **One assistant, the existing grounded one.** "Ask Personal AI" in a session uses `learn/act` `ask` on the session's scope. Retrieval, [S n] citations, the grounding check, notes/library/research modes and history resent by the browser are all unchanged.
- **The existing shared assistant** ("Continue with your personal assistant") gets the same block through a new data scope `study_session` in `ai.assistant.scholar`, configured in HQ. It keeps its "general explanation, not checked against your notes" label.
- **New pure function `buildStudySessionContext`** (`store.ts` reads only, then a pure builder):
  - Focus and objectives: scope title, competency and outcome titles.
  - Saved explanations: titles and the first line only.
  - Generated questions: recent stems, with "missed" or "right first time".
  - Flashcards: deck state counts and weak topics (`loadFlashcardGaps`).
  - Formative attempts and feedback: the last N revision answers, OSCE `gaps` and `revision_suggestions`, and clarify verdicts.
  - Gaps: `buildLearnerContext` needs-practice plus OSCE gaps.
  - Progress: steps done out of total, and stages touched.
- **Rules carried over from `CONTEXT_PREAMBLE`:**
  - The block steers emphasis only. It is never grounding and never quoted as fact.
  - Words only (`words()` strips digits and codes).
  - Patient-identifier screen.
  - Capped (D4).
- **Boundaries:**
  - The builder reads only `individual_scholar_*` through `store.ts` (A1). It never reads Professional, employer or estate tables.
  - `own_development` stays as it is: off in Scholar and consent-gated.
- **Cost:** no AI call on navigation or when the session opens. The context is built only when the learner asks, and the ask is metered under the existing `ask` activity. The saved-explanation cache is unchanged.

## 5. UI integration

- **`StudySessionBar`** is one shared component, rendered inside `StudyNav` when `?study=` is present.
  - Below `md`: one row with the title, the current stage, an **Ask** button and an overflow menu.
  - At `md` and above: the title, four chips and the actions.
  - Uses `pointer-coarse` touch sizing and no new breakpoint.
- `StudyNav` and `ReviseNav` links carry `study=` through one helper, `withStudy(href)`.
- The Personal AI opens as the existing Learn ask panel: a bottom sheet on phones, a side panel on desktop.
- **Study this** buttons go on the existing document, topic, competency and Learn landing cards. "Continue your study session" goes on Home and the Learn landing, reusing the "Continue learning" slot.
- Evaluate's `EvaluationStart` takes a default scope prop. Nothing else changes in Evaluate.

## 6. Focused acceptance tests

Unit (Vitest):
1. `buildStudySessionContext`:
   - includes each of the seven sources;
   - words only;
   - respects the cap;
   - leaves out Professional and `own_development` content even when present;
   - removes patient-like identifiers.
2. `withStudy` keeps the id on every tab and sub-tab, and adds nothing without it.
3. The scope to pre-fill mapping for Revise, Apply (OSCE filters) and Evaluate.

Harness (`scholar-learning-harness`, plus a planted failure for each new check):
4. The new table holds RLS read-own and the composite FK.
5. Cross-user `?study=` and `studySessionId` get a non-disclosing 404. A link to someone else's activity is refused.
6. A1, B1, B2 and C1-C3 still hold. The builder is in the A1 file set.

Staging acceptance (renal and respiratory notes, as before):
7. Start a session from renal notes. Learn step 1. Revise is pre-scoped; answer and miss one. Apply shows OSCE stations filtered to the topic. Evaluate opens with the session's scope. Every stage shows the bar.
8. `plat_ai_requests` count stays the same across all navigation (zero AI calls).
9. Ask in the session: the request carries the missed concept and the OSCE gap. The answer cites [S n] and passes the grounding check. One metered `ask`.
10. Resume from a second browser lands on the last stage with Learn step, revision position and OSCE autosave intact.
11. Ending a session and deleting it removes its links and leaves the activities.
12. Browser at 375, 768 and 1440: the bar fits with no overflow, and the Ask panel opens and closes.

## 7. Smallest safe sequence

1. **Migration 740.** Author it, stage it twice, write the rollback and build record. This is the only database work.
2. **Carry the focus, no AI.** Store functions, `withStudy`, `StudySessionBar`, `?study=` pre-fill on Revise, Apply and Evaluate, `last_space`, and the **Study this** and **Continue** entries. Behind `scholarStudySessions`.
3. **Link activities.** Add the optional `studySessionId` to the five create routes and the session's stage progress marks.
4. **Context-aware AI.** `buildStudySessionContext`, the `learn/act` ask integration, and the `study_session` data scope in HQ AI config.
5. **Acceptance.** Tests 1-12 on staging, then the browser checks, then a PR.
6. **Release.** You apply 740 after a backup. Deploy on your GO, then switch `scholarStudySessions` on.

Steps 2 and 3 can run in parallel after step 1. Step 4 depends on step 3.

## Owner decisions

- **D1. The anchor.** Reuse the Learn session (414) as the study session, so it is one migration and Learn resume and "Continue learning" are reused (recommended). The alternative is a new session table: cleaner naming, more code.
- **D2. What a "learning objective" is.** Recommended: a CFCA competency outcome from the learner's programme catalogue, stored as `objective_outcome_id` and retrieving through the competency's mapped notes. Free-text objectives would be a label only, never used for retrieval.
- **D3. Personal AI conversation storage.** Recommended: keep today's rule. Turns are not stored on the server and live in the browser per session, so they are lost on another device while learning progress is kept. The alternative is to store turns per session, which needs a table and a retention period.
- **D4. Context size.** Cap the session block at about 3,000 characters (roughly 750 extra input tokens per ask), metered as `ask`.
- **D5. Unchanged, for the record.** OSCE, exam-paper and flashcard results stay out of Evaluate evidence. The AI may read them as context only.
