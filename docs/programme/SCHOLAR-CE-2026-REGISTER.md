# SCHOLAR-CE-2026 — Competitive Experience Completion Programme: register

Owner GO 2 Nov 2026 (P0 Scholar focus). This register is authoritative across sessions: read it first, continue from its state, never reset it.
Statuses: Not assessed → Gap confirmed → Implementing → Deployed → Accepted → Complete. Merged is not Complete.
Waves: 1 = CE-01, CE-02, CE-03 · 2 = CE-04, CE-05 · 3 = CE-06 · 4 = CE-07 acceptance (CE-07 work runs through every wave).

| ID | Workstream | Status | Last update |
|---|---|---|---|
| CE-01 | Seamless, context-aware Personal AI | Implementing | 2 Nov 2026 |
| CE-02 | AI Notebook and Personal Learning Library | Implementing | 2 Nov 2026 |
| CE-03 | Unified My Plan | Deployed | 2 Nov 2026 |
| CE-04 | Conversational clinical simulation | Gap confirmed | 2 Nov 2026 |
| CE-05 | Richer assessment formats | Gap confirmed | 2 Nov 2026 |
| CE-06 | Audio and voice learning | Gap confirmed | 2 Nov 2026 |
| CE-07 | African-market performance and AI affordability | Gap confirmed | 2 Nov 2026 |

Baseline: one focused read of main @ f60358d6 plus a read-only production configuration check (2 Nov). Evidence paths are under `src/`.

---

## CE-01 — Seamless, context-aware Personal AI — Implementing

**Exists and works**
- One engine, two entry points: `/api/individual/assistant` (Personal AI page) and `/api/individual/scholar/learn/assistant` (Learn "Ask"), both via `runPersonalAssistant` → `runMeteredAi` (identifier screen, clinical-risk classification, eligibility, routing, reservation).
- Learn Ask grounds on the step's sections ([S1..Sn]), cites them, drops unknown tags, says "NOT COVERED"; source kinds labelled (notes / governed reference / AI interpretation / library / research).
- Study-session context block (`study-context.ts studySessionBlock`): focus, sources, missed questions, rubric misconceptions, "not yet" checks, last OSCE gaps, written feedback; deterministic, capped, never cited.
- Shared availability/refusal copy (`ai-availability.ts`), per-activity tiers, token caps, prompt caching of system prompts.
- **Production config (2 Nov):** `scholar_study_sessions` = on; `ai.assistant.scholar` scopes = passport, study_context, own_learning, own_development, study_session (already published).

**Gaps (to implement)**
1. The Personal AI page takes no study/material/section context and shows no per-answer sources.
2. "Ask" from Revise/Apply/Evaluate/My Plan navigates to Learn and loses the learner's place; no "Ask about this" on a question's feedback, case debrief, OSCE feedback or flashcard.
3. The context block lacks flashcard state (weak/due cards) and the learner's plan (goal, next step, exam date).

**Decisions**: reuse the existing engine and Route B grounding; add an in-place Ask panel with a typed context payload; no new tutor or memory store; Personal AI answers stay unsaved (stated product rule).

**Implementing (branch `programme/scholar-ce-2026-wave1`, 2 Nov 2026)** — not yet merged, deployed or accepted.
- **Ask about this** (one shared panel, `study/_components/ask-panel.tsx`): native modal `<dialog>` with the shared `useModalFocus` hook, side drawer from `md`, bottom sheet on a phone; posts to Route B (`/api/individual/scholar/learn/assistant`) with `askContext { surface, chunkIds (max 6), materialId?, studyId?, refLabel, prefill? }` (`scholar/ask-context.ts`). Answers use the Learn rendering: source chips, "NOT COVERED", `PERSONAL_AI_LABEL`, depth, follow-ups, the shared unavailability copy (`useAiAvailability("ask")`, button disabled with the reason). Nothing is stored.
- **Server (Route B)**: every chunk id is read again by the caller's id (`getPassage`); ids that are not the caller's are dropped silently; no owned section left = general explanation under the same label. Intent, risk, eligibility and allowance path unchanged. Surface maps onto existing intent surfaces (revise, flashcards -> revise; case, osce -> apply; plan, library, learn -> learn; personal_ai -> personal_ai); `refLabel` is framing only and dropped if it carries an identifier shape.
- **Entry points live**: Revise and Adaptive question feedback (the question's section), Flashcards answer side (the card's section; none for a library card), Apply case debrief (sections of the case's decisions), OSCE result (the station's own source sections, ids via `stationView`; template and library stations: general), Saved library item (the lesson's session step, else its sections).
- **Personal AI page continuity**: `/assistant?study=&material=&section=` resolved on the server (`scholar/ask-link.ts`, the caller's own only); chip "Using your study session: <focus>" with remove; questions then go through Route B grounding and show sources. Without params: as before.
- **Study-session block**: adds flashcard state (due count in words; up to five weakest card fronts of the session's materials, `store.weakFlashcards`) and the learner's plan (goal type, own goal words, how far off the exam is in words, up to three priorities, from `getStudyPlan`); same 3000-character cap, words only, identifier-screened, never cited.
- **Decisions / deviations**: (1) My Plan Today entry point is OUT of this branch (owner reopened CE-03; separate rebuild) -- the panel is exported, `askPrefill("plan")` and `sectionIdsInHref`/`sessionIdInHref` exist to add it there later. (2) Today's next-step title is not read into the block (the Today planner is heavy and records carry-overs); plan settings plus due count only. (3) `personal_ai` added to the ask surfaces for the Personal AI page. (4) `?material=` alone grounds nothing and is ignored; it only narrows `?section=`. (5) No migrations.
- **Files**: `ask-context.ts`, `ask-link.ts`, `ask-panel.tsx`, Route B `route.ts`, `study-session-context.ts`, `study-context.ts`, `store.ts` (`weakFlashcards`), `osce-service.ts`, `revision-client`, `adaptive-client`, `flashcards-client`, `case-client`, `osce-client`, OSCE station page, `saved-library-view`, `AssistantPanel`, assistant `page`; tests `ask-context.test.ts`, `study-session-context-ce01.test.ts`, Route B `route.test.ts`.
- **Acceptance still to do**: staging/browser walk of each entry point on desktop and phone; production acceptance after deployment.

---

## CE-02 — AI Notebook and Personal Learning Library — Implementing

**Exists and works** (PR #218, migration 820, live): My learning library (saved lessons with versions, keyset pages, full-text search over saved teaching, notes, bookmarks, highlights, selected/topic/date-range PDF export), notes API, flashcard deck search, lesson links (`?version=`, "Review saved lesson"), visuals (#224) linked from flashcards/revise.

**Gaps (to confirm in Wave 1 build)**: one search across uploaded material sections + saved lessons + questions + notes; organisation by material / topic / session / competency; actions from a saved item to revise / practise / ask; standalone (not attached) notes; mobile check of the library.

**Implementing (branch `programme/scholar-ce-2026-wave1`, 2 Nov 2026)** — not yet merged, deployed or accepted. No migration, no AI call anywhere in this workstream.
- **One search** (`study/saved?q=`): the 820 search (saved lessons, notes, flashcards/questions, sessions) is now shown in groups, then **From your materials**: the learner's own uploaded sections found by the same words (`searchSectionRows` + `rankChunks`, no AI). Each hit: material title, page/slide/section, a marked excerpt, **Open in Learn** (`study/learn?section=`), **View original slide/page** (PowerPoint slide picture or PDF at that page, the routes the material page already uses), **Open source**, **Revise**, **Ask about this** (the CE-01 `AskAbout` panel with that section). First 10, then **More from your materials** (10 more per click, `?msec=`, from the best 200 candidates).
- **Organisation**: filters Material, Topic, Study session (sessions that hold saved items), Competency (accepted mappings only) on every view and on search, URL-driven (`?material=&topic=&session=&competency=`), shown as removable chips. A filter id that is not the learner's is dropped (`ownedQuery`). With a filter on, search reads the best 200 library matches, filters and pages them (said on the page).
- **Actions from a saved item**: saved lessons, notes, bookmarks and search hits carry Revise (Flashcards `?material=&section=`), Practise (the section in Learn, which has its own quiz; the material's questions in Revise when only a material is known), Open source and Ask about this (where a section is known).
- **Notes**: new **Your notes** view (notes and highlights; bookmarks stay in Saved for revision). Notes are now **editable in place** (the PATCH route existed, the UI did not), removable (asks once), and show provenance: what each is attached to, written and edited dates. **Write a new note** on a material and optionally one of its sections from the library page (existing 820 material/section targets; sections read by `GET /api/individual/scholar/library/notes?sections=<material>`).
- **Mobile/tablet**: filters sit behind a **Filter** disclosure below `md` (open from `md`), selects/inputs/actions meet `--cmp-touch-min` on touch, the download tick box has a 44px target, text wraps (no horizontal scroll).
- **Decisions / deviations**: (1) The Competency filter now means accepted mappings only (was proposed or accepted). (2) A note on a *topic* is not a separate target (820 has none and no schema change was allowed): notes attach to a material and optionally a section; section choices show the section's first topic. (3) Study-session filter on saved lessons = lessons recorded against the session (820) plus older lessons wholly inside the session's own steps; the session list holds sessions with a saved lesson or a note against them. (4) Your notes and Saved for revision read the newest 1000 and page in memory (page numbers instead of keyset), saying so past 1000. (5) The "Continue/Completed" session views keep date and sort only.
- **Files**: `library-organise.ts` (pure), `library-scope.ts`, `saved-library.ts` (`session`, `msec`, `notes` view), `store.ts` (`sessionsWithSavedItems`, `artefactIdsForSession`, `chunksForCompetency acceptedOnly`), `saved-library-view.tsx`, `library-notes-client.tsx` (`NoteEntry`, `StandaloneNote`, `NewNoteForm`), `saved/page.tsx`, notes route (`?sections=`); tests `library-organise.test.ts`, `library-scope.test.ts`.
- **Acceptance still to do**: staging/browser walk of search, filters, notes (create/edit/remove) on desktop and phone; production acceptance after deployment.

---

## CE-03 — Unified My Plan — Deployed

**Delivered**: PR #225 (merge f60358d6), migration 840 (applied in production 2 Nov, VERIFY 35/0), deployment `dpl_Di2ecqHjj8mLqjvRBtPPaXQCAD3A`. My Plan first tab (Today / Calendar / Insights), unified local study-day definition, stable calendar keys with safe legacy reconciliation, 3-question setup, post-upload proposals, decisions log (declines, postponements, Undo for carry-overs, settings history), weekly reflection (offers only), learner calendar entries with recurrence and per-occurrence changes, busy/placement/deadline/exam integration, self-reported completion kept apart, Professional adapter (not surfaced). Design: `RELEASE-2026-10-25/PLANS/PLP-01-04-DESIGN.md`.

**Acceptance**: staging, browser (2 Nov) — see PR #225. **Production acceptance: pending** (signed-in walk).

**Limitations**: time zone from network location; day-level (not timed) planning; series date/rule edits not supported; no predictions (PLP-07 deferred); Professional UI later.

---

## CE-04 — Conversational clinical simulation — Gap confirmed

**Exists and works**: versioned case engine (`lib/cases/blueprint.ts`: staged facts, requestable findings, decision points incl. free text, branching progression, safety criteria, reflection, objectives → competencies); private and library play; guided/independent modes; debrief with labelled AI reasoning feedback; attempt integrity (810); OSCE stations (timer, written sections incl. "Escalation and plan", self-checklist, critical misses, optional AI feedback, library stations); HQ Case Studio authoring and per-version clinical approval (422).

**Gaps**: no conversational patient/caregiver turn loop (patientVoice exists in schema but unused); no SBAR/handover/documentation task; deterioration is branching only (no clock); case and OSCE feedback/records are separate surfaces; library availability depends on `case_library` and published content.

---

## CE-05 — Richer assessment formats — Gap confirmed

**Exists and works**: mcq, mrq (partial credit), match and sequence (fractional), true/false, cloze (code-marked), short (code then AI/self), structured (part marks; production on), extended (key-point marks; off by default); rubric snapshots + attempt snapshots (791) reconstruct what an attempt was marked against; remediation links to competencies and notes.

**Gaps**: no evolving multi-stage scenario format in Revise; format knowledge spread across several lists; "marked against" provenance line not shown for every format; extended off and several formats not blind-verified by default (cost decision).

---

## CE-06 — Audio and voice learning — Gap confirmed

**Exists**: browser dictation component in Practice (`components/practice/Dictation.tsx`); site-wide microphone permission policy. **Scholar has no read-aloud, no speech input, no voice simulation.**

**Plan**: device-native first (browser speech synthesis / recognition, no server cost), transcript visible and editable, shared component reused by lessons, Personal AI and simulation.

---

## CE-07 — African-market performance and AI affordability — Gap confirmed

**Exists**: stored-output reuse (saved lessons, in-flight dedupe, research cache), fair-use policy with per-activity tiers and level downgrade, published model routing with a cheap tier, signed direct uploads, CPR-MOB-001 mobile rules, private image caching.

**Gaps**: Scholar AI calls all request the "reasoning" tier (cheap tier unused for low-risk activities); large client bundles (Learn ~1.6k lines, Flashcards ~1.1k) without lazy loading; no Scholar manifest or bundle budget; no data-saver handling; uploads not resumable; no device/network/AI-cost evidence yet.

---

## Increment log

| Date | Increment | Evidence | Workstreams |
|---|---|---|---|
| 2 Nov 2026 | CE-04 built on branch scholar/ce04-conversation-01 (not merged, not live): Talk to the patient (text), SBAR handover task, SBAR OSCE template, mig 880 authored (not applied) | docs/evidence/CASE-CONVERSATION/880-build-record.md | CE-04 |
| 2 Nov 2026 | My Plan (PLP-01..04 + calendar entries) | PR #225, mig 840, dpl_Di2ecqHj | CE-03 |
| 2 Nov 2026 | Lesson visuals + classification + page picker | PR #224, dpl_FXSAcnBP | CE-02 (visual notes), CE-07 |
| 1 Nov 2026 | Library + Flashcards; Flashcards 3 experiences; inline checks; monthly review + calendar | PRs #218, #220–#222, migs 820, 830 | CE-02, CE-03, CE-05 |
