# SCHOLAR-CE-2026 — Competitive Experience Completion Programme: register

Owner GO 2 Nov 2026 (P0 Scholar focus). This register is authoritative across sessions: read it first, continue from its state, never reset it.
Statuses: Not assessed → Gap confirmed → Implementing → Deployed → Accepted → Complete. Merged is not Complete.

**Reconciled 4 Nov 2026 (LEARNING-CLOSE-2026-11, CLOSE-01).** The status of every open item now lives in ONE tracker, `docs/programme/LEARNING-CLOSE-2026-11-TRACKER.md`, which uses the owner's status values (Not started / Implementing / Ready for review / Blocked / Ready for release / Live — verification pending / Complete). This register keeps the narrative per workstream; where the two differ, the tracker wins. The CE-01..CE-07 entries below were reconciled against `main` @ `e19a363a` (app `e19a363a` in production, DB head 942 per the coordinator): each now states what is shipped, what is live versus behind a switch, and the remaining verified gaps as tracker IDs. Production was not read for this reconciliation; cells that need it say so and point to the queued read-only queries (tracker appendix A).
Waves: 1 = CE-01, CE-02, CE-03 · 2 = CE-04, CE-05 · 3 = CE-06 · 4 = CE-07 acceptance (CE-07 work runs through every wave).

| ID | Workstream | Status | Last update |
|---|---|---|---|
| 3 Nov 2026 | SCHOLAR-AI-COST-CONFIG-01 (owner corrected decisions, late): evidence runs on staging (55f56e85 map/flashcards/mcq; 85282319 D5-v2 re-run), `scenarios` activity split in code (fallback to questions), scenario off by default in code, monitoring queries; production package in the coordinator folder activates the flashcards activity only; map on Haiku and questions on Sonnet blocked by evidence | branch scholar/independent-learning-p3, docs/evidence/SCHOLAR-INDEPENDENT/p3-mapping-comparison.md, p3-monitoring-queries.md. **Merged: #262 (evidence), 4 Nov.** | CE-07 |
| 3 Nov 2026 | SCHOLAR-INDEPENDENT-LEARNING-01 P3: AI cost measured on staging (scenarios 59 %, `questions` Opus-only, Learn 54/59 served from saved); flashcards as their own activity with fallback, the tier taken from the published policy per activity, OSCE station reuse before generation; staging config staged, production config = owner decision | branch scholar/independent-learning-p3, docs/evidence/SCHOLAR-INDEPENDENT/p3-cost.md. **Merged: #259, 3 Nov.** | CE-07 |
| 3 Nov 2026 | SCHOLAR-INDEPENDENT-LEARNING-01 P2: My Plan counts a lesson read, opened or taught as a section started (policy `scholar_plan_started_signal`, default learning; `store.ts learnedChunkIds`, pure `startedSections`); the other adaptation rules audited as existing (table in the programme doc); no migration | branch scholar/independent-learning-p2 (stacked on P1). **Merged: #254, 3 Nov.** | CE-03 |
| 3 Nov 2026 | SCHOLAR-INDEPENDENT-LEARNING-01 P1: reader links carry the study session; Revise narrowed to the lesson's sections (`?sections=`, sources scope, "Use the whole material"); Ask about this per section; Scholar AI refusals carry codes and the shared copy gains provider_unavailable (no "environment" wording) | branch scholar/independent-learning-p1 (stacked on P0). **Merged: #253, 3 Nov.** | CE-01, CE-05, CE-07 |
| 3 Nov 2026 | SCHOLAR-INDEPENDENT-LEARNING-01 P0: the independent lesson reader (original sections inside every Learn lesson, exact-place resume on the original text, Mark as read, linked competencies, existing resources opened directly; mig 920 authored, staging ×2 + VERIFY, not in production) | branch scholar/independent-learning-p0, docs/programme/SCHOLAR-INDEPENDENT-LEARNING-01.md, docs/evidence/SCHOLAR-INDEPENDENT/920-build-record.md. **Merged: #251, 3 Nov; mig 920 applied in production (coordinator).** | CE-01, CE-02, CE-07 |
| CE-01 | Seamless, context-aware Personal AI | Deployed (#228, #230, #239); open: CE-01-1, CE-01-2, CE-01-3 | 4 Nov 2026 |
| CE-02 | AI Notebook and Personal Learning Library | Deployed (#218, #228); open: CE-02-1, CE-02-2 | 4 Nov 2026 |
| CE-03 | Unified My Plan | Deployed (#225, #254, #256); production walk pending (tracker CE-03) | 4 Nov 2026 |
| CE-04 | Conversational clinical simulation | Deployed, switched OFF (#237, mig 880); open: CE-04A, CE-04B, CE-04C, CE-04D | 4 Nov 2026 |
| CE-05 | Richer assessment formats | Deployed, evolving scenario format OFF (#236); open: CE-05 | 4 Nov 2026 |
| CE-06 | Audio and voice learning | Partly deployed (#234, #239, #241); open: CE-06A, CE-06A-1, CE-06B | 4 Nov 2026 |
| CE-07 | African-market performance and AI affordability | Implementing (P3 tier-from-policy shipped; gaps CE-07A, CE-07B, CE-07C confirmed) | 4 Nov 2026 |

Baseline: one focused read of main @ f60358d6 plus a read-only production configuration check (2 Nov). Evidence paths are under `src/`.

---

## CE-01 — Seamless, context-aware Personal AI — Deployed (reconciled 4 Nov 2026)

**Reconciled state (4 Nov 2026, read from `main` @ `e19a363a`).**
- **Shipped:** PR #228 (merge 4a9753a0; Ask about this panel, Personal AI continuity, flashcard and plan context in the study block), PR #230 (answers labelled by what happened, `[S#]` required at every depth, a lesson step with no section grounded), PR #239 (Ask about this on the Learn lesson). Entry points: Learn lesson, Revise and Adaptive feedback, Flashcards, Apply case debrief, OSCE result, Saved library items, Personal AI page via `?study=&material=&section=`. No migration. Tests: `ask-context.test.ts`, `ask-grounding.test.ts`, `study-session-context-ce01.test.ts`.
- **Live vs switch:** live in production with app `e19a363a`; not behind a switch (the AI itself stays governed by consent, allowance and the clinical-risk gate). Production config recorded 2 Nov: `scholar_study_sessions` on and the `ai.assistant.scholar` scopes published; production not re-read.
- **Verified remaining gaps (tracker):** CE-01-1 (no Ask about this from My Plan Today: no caller in the plan components), CE-01-2 (no recorded acceptance walk of the entry points, desktop and phone), CE-01-3 (the learner's next step is not in the context block). Gaps 1 and 3 of the original list below are otherwise closed.
- **Status in the tracker:** CE-01 Live — verification pending.

> The sections below, "Exists and works", "Gaps" and "Implementing (branch …)", are the 2 Nov record kept for history. Where they say "not yet merged, deployed or accepted", the reconciled state above supersedes them.

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

## CE-02 — AI Notebook and Personal Learning Library — Deployed (reconciled 4 Nov 2026)

**Reconciled state (4 Nov 2026, read from `main` @ `e19a363a`).** Each original gap was checked against the code.
- **Shipped:** PR #218 (library, notes, search, PDF export; mig 820, applied), PR #224 (lesson visuals), PR #228 (merge 4a9753a0; commit c0b5f15a). Gap by gap: (1) one search across the learner's own uploaded sections, saved lessons, questions/flashcards, notes and sessions: shipped (`saved-library.ts`, `library-organise.ts`, `searchSectionRows`); (2) organisation by Material, Topic, Study session and Competency (accepted mappings only), URL-driven filters: shipped (`library-scope.ts`); (3) actions from a saved item to revise / practise / ask / open source: shipped (`saved-library-view.tsx`); (4) standalone notes: shipped for a material or a section (Your notes view, in-place edit/remove, provenance); (5) mobile: filters sit behind a Filter disclosure below `md`, 44px targets in code, **not walked**. No migration, no AI call in #228. Tests: `library-organise.test.ts`, `library-scope.test.ts`.
- **Live vs switch:** live in production with app `e19a363a`; no switch. Production not re-read.
- **Verified remaining gaps (tracker):** CE-02-1 (a note cannot target a topic: 820 has no topic target, so it needs a schema decision), CE-02-2 (no recorded desktop and phone acceptance walk).
- **Status in the tracker:** CE-02 Live — verification pending.

> The "Implementing (branch …)" text below is the 2 Nov record; the reconciled state above supersedes its "not yet merged, deployed or accepted".

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

## CE-03 — Unified My Plan — Deployed (reconciled 4 Nov 2026)

**Reconciled state.** Shipped: #225 (mig 840 applied in production), refined by #254 (started signal, policy `scholar_plan_started_signal`) and #256 (learning units). Live, no switch. Production signed-in walk still pending; open item in the tracker: CE-03 (Live — verification pending). Related open item raised by CE-01: CE-01-1 (Ask about this from Today).

**Delivered**: PR #225 (merge f60358d6), migration 840 (applied in production 2 Nov, VERIFY 35/0), deployment `dpl_Di2ecqHjj8mLqjvRBtPPaXQCAD3A`. My Plan first tab (Today / Calendar / Insights), unified local study-day definition, stable calendar keys with safe legacy reconciliation, 3-question setup, post-upload proposals, decisions log (declines, postponements, Undo for carry-overs, settings history), weekly reflection (offers only), learner calendar entries with recurrence and per-occurrence changes, busy/placement/deadline/exam integration, self-reported completion kept apart, Professional adapter (not surfaced). Design: `RELEASE-2026-10-25/PLANS/PLP-01-04-DESIGN.md`.

**Acceptance**: staging, browser (2 Nov) — see PR #225. **Production acceptance: pending** (signed-in walk).

**Limitations**: time zone from network location; day-level (not timed) planning; series date/rule edits not supported; no predictions (PLP-07 deferred); Professional UI later.

**Refinement (3 Nov 2026, SCHOLAR-PLAN-UNITS-01)**: a proposal no longer plans every classified section at a fixed 12 minutes. Sections are grouped into learning units by the Learn lesson planner, each unit estimated from the notes' own text (reading, learning, revision, practice apart, basis shown), and the learner reviews the units (merge, split, leave out, put first) before adding them. Finding and design: `docs/programme/SCHOLAR-PLAN-UNITS-01.md`.

---

## CE-04 — Conversational clinical simulation — Deployed, switched OFF (reconciled 4 Nov 2026)

**Reconciled state (4 Nov 2026).** The 2 Nov "Gap confirmed" text below is out of date: the work was built and merged as **PR #237** (merge 7ca7f7ae, 2 Nov).
- **Shipped (A, B, D):** Talk to the patient (text): a server loop that answers in the patient's or caregiver's voice using only what the case says is known at that stage, with a grounding filter, a per-stage cap (`scholar_case_conversation_turns`, default 20), a labelled simulated conversation and plain notices when unavailable or capped; patient `voice` and `handover` live inside the approved blueprint JSON (Case Studio authoring and review display); SBAR handover boxes with marking and a rubric snapshot in the kept attempt; an SBAR OSCE template; migration 880 (one append-only table, cascade-deleted with the attempt, erase-all path, copied into the 810 attempt snapshot at completion); owner ruling "D10 exception" recorded in ADR-016. Evidence: `docs/evidence/CASE-CONVERSATION/880-build-record.md`. Tests: `ce04.test.ts`, `case-talk.test.ts`, `case-conversation-scope.test.ts`.
- **Live vs switch:** the code is in production. Talk to the patient is behind `scholar_case_conversation` (**default off**; only cases whose approved version defines a voice show it) and needs migration 880, which **is applied in production** (read 4 Nov: table, erase and guard functions present). No policy row exists for the switch, so the default (off) applies, and there are **0 turns and 0 sessions**: the conversation has never been used in production. The handover task has no HQ switch; it appears where a case defines a handover.
- **Verified remaining gaps (tracker):** CE-04A (release: the switch, one clinically approved case with a patient voice, a production walk; 880 is already applied), CE-04B (verification), **CE-04C (deterioration clock: confirmed missing, nothing in `src/lib/cases/*` or `case-talk.ts`)**, CE-04D (a retention rule for D05; nothing to verify in production until the switch is used). The conversation is text only; spoken exchange is CE-06B.
- **Status in the tracker:** CE-04A Ready for release, CE-04B Live — verification pending, CE-04C Not started, CE-04D Live — verification pending.

> Original 2 Nov record follows.


**Exists and works**: versioned case engine (`lib/cases/blueprint.ts`: staged facts, requestable findings, decision points incl. free text, branching progression, safety criteria, reflection, objectives → competencies); private and library play; guided/independent modes; debrief with labelled AI reasoning feedback; attempt integrity (810); OSCE stations (timer, written sections incl. "Escalation and plan", self-checklist, critical misses, optional AI feedback, library stations); HQ Case Studio authoring and per-version clinical approval (422).

**Gaps**: no conversational patient/caregiver turn loop (patientVoice exists in schema but unused); no SBAR/handover/documentation task; deterioration is branching only (no clock); case and OSCE feedback/records are separate surfaces; library availability depends on `case_library` and published content.

---

## CE-05 — Richer assessment formats — Deployed, evolving scenario format OFF (reconciled 4 Nov 2026)

**Reconciled state (4 Nov 2026).** The 2 Nov "no evolving multi-stage scenario format" gap is closed in code by **PR #236** (merge 45e82533, 2 Nov): one question-format registry (`question-formats.ts`; the scattered lists derive from it); the evolving scenario stored as the existing `short` kind with `answer.format = 'scenario'` (no migration); a stage route where a later stage is sent only after a valid answer to the previous one, with an HMAC progress token (server-controlled progression, `scenario.ts`); per-stage marking and snapshots; the "marked against" provenance line on every format; scenario-v3 generation (a decision about this person at every stage, cited, nothing invented); validation that refuses answer leakage into an earlier stage, "notes / passage / learner / revising" framing, and findings or figures the cited section does not hold (`scenario-quality.test.ts`); a stored scenario re-checked against today's rules before it is offered. The `scenarios` AI activity (own tier, falls back to `questions`) shipped in #259.
- **Live vs switch:** the format is **not offered**: the code default and (per the coordinator) production `scholar_revision_formats` (published 3 Nov 10:05Z) exclude scenario (owner cost decision 3 Nov: scenarios were 59 % of Scholar AI cost, on Opus). Extended response is off by code default but is enabled in the production policy row.
- **Verified remaining gaps (tracker CE-05):** no clinician read of generated scenarios is recorded; the learner-wide activation of the scenario policy is an owner decision (decision register D-3). Not claimed: that existing scenarios meet their clinical content requirements.
- **Status in the tracker:** CE-05 Ready for review.

> Original 2 Nov record follows.


**Exists and works**: mcq, mrq (partial credit), match and sequence (fractional), true/false, cloze (code-marked), short (code then AI/self), structured (part marks; production on), extended (key-point marks; off by default); rubric snapshots + attempt snapshots (791) reconstruct what an attempt was marked against; remediation links to competencies and notes.

**Gaps**: no evolving multi-stage scenario format in Revise; format knowledge spread across several lists; "marked against" provenance line not shown for every format; extended off and several formats not blind-verified by default (cost decision).

---

## CE-06 — Audio and voice learning — Partly deployed (reconciled 4 Nov 2026)

**Reconciled state (4 Nov 2026).** The 2 Nov "Scholar has no read-aloud, no speech input" text is out of date. Shipped, device-native (browser speech synthesis and recognition; no server audio, no AI call, no audio kept by Competen): **PR #234** (merge 38cce1ec: Listen on lessons, inline-check questions, saved lessons, flashcards, Personal AI answers and the Ask panel, the case so far and each case stage; Dictate into case answers, Revise answers, Library notes, assistant questions and the My Plan activity description; a Read-aloud and dictation setting), **PR #241** (resume from the paused word; flow, map and timeline diagrams read aloud) and **PR #239** (dictation final-result merge for Android). The shared components are `src/app/individual/_components/speech/*`; pure layer `speech.ts`, `speech-engine.ts`. The text always stays visible. The on/off setting is kept on the device.
- **Live vs switch:** live in production; no HQ switch (there is no speech key in `policy.ts`).
- **Verified remaining gaps (tracker):** CE-06A-1 (Listen is absent from the independent lesson reader and from OSCE stations/results, and no persisted resume position was found), CE-06B (no spoken patient or Personal AI conversation, no HQ voice/AI usage control), CE-06A (verification of the shipped surfaces).
- **Status in the tracker:** CE-06A Live — verification pending, CE-06A-1 Not started, CE-06B Not started.

> Original 2 Nov record follows.


**Exists**: browser dictation component in Practice (`components/practice/Dictation.tsx`); site-wide microphone permission policy. **Scholar has no read-aloud, no speech input, no voice simulation.**

**Plan**: device-native first (browser speech synthesis / recognition, no server cost), transcript visible and editable, shared component reused by lessons, Personal AI and simulation.

---

## CE-07 — African-market performance and AI affordability — Implementing (reconciled 4 Nov 2026)

**Reconciled state (4 Nov 2026).** Shipped since the 2 Nov baseline: the AI-cost half. SCHOLAR-INDEPENDENT-LEARNING-01 P3 (#259, evidence #262) measured Scholar AI cost, made flashcards their own activity with fallback, took the tier from the published policy per activity (the "all calls request the reasoning tier" gap is closed in code), added OSCE station reuse before generation, and wrote the monitoring queries (`docs/evidence/SCHOLAR-INDEPENDENT/p3-monitoring-queries.md`). Production configuration of the flashcards package is not applied (tracker AI-02).
- **Verified remaining gaps (tracker):** CE-07A (no lazy loading anywhere in `src/app/individual` or `src/components`; no bundle budget), CE-07B (no data-saver or connection handling in `src/`), CE-07C (upload is a single-shot signed-URL upload with no progress and no resume, `study/_components/client.tsx:242`). A separate session is assigned to CE-07 slow-network work. AI cost monitoring and routing validation are carried by AI-03/AI-04/AI-05.
- **Live vs switch:** the shipped part is live; the remaining gaps are unbuilt.
- **Status in the tracker:** CE-07A Not started, CE-07B Not started, CE-07C Implementing.

> Original 2 Nov record follows.


**Exists**: stored-output reuse (saved lessons, in-flight dedupe, research cache), fair-use policy with per-activity tiers and level downgrade, published model routing with a cheap tier, signed direct uploads, CPR-MOB-001 mobile rules, private image caching.

**Gaps**: Scholar AI calls all request the "reasoning" tier (cheap tier unused for low-risk activities); large client bundles (Learn ~1.6k lines, Flashcards ~1.1k) without lazy loading; no Scholar manifest or bundle budget; no data-saver handling; uploads not resumable; no device/network/AI-cost evidence yet.

---

## SCHOLAR-INDEPENDENT-LEARNING-01 — AI-independent, AI-enhanced learning engine — Implementing

Owner instruction 3 Nov 2026 (cross-cutting over CE-01, CE-02, CE-03, CE-05, CE-07). Audit, the three learning modes, the unit model and the increment plan: `docs/programme/SCHOLAR-INDEPENDENT-LEARNING-01.md`.

**Audit finding (3 Nov)**: extraction, search, sessions, position/resume, flashcard review and scheduling, code-marked question formats, stored case play and OSCE self-marking, My Plan, progress and evaluation all work without AI; saved explanations, AI cards/questions/cases/stations and mappings are generated once and reused with provenance. The one P0 gap: a Learn lesson with nothing saved and AI off showed only "Learning needs AI help, which is off", the original sections one click away on the material page and never inside the lesson.

**P0 Implementing (branch `scholar/independent-learning-p0`, 3 Nov 2026)** — not merged, not deployed. The lesson reader: every Learn lesson shows its own sections (original text, headings, speaker notes, citation, AI-read mark, original picture) before any AI teaching (`learn-reader.ts`, `learn-reader.tsx`, `GET learn/sessions/[id]/read`); each section is a 790 anchor so the exact place in the original text is resumed on any device; the learner's own **Mark as read** (migration 920, event action `read`, staging-applied and verified, production pending GO) completes a lesson as AI teaching does; competencies linked to the sections (accepted apart from proposed, never competence); existing flashcards / questions / cases / OSCE stations opened directly, never regenerated. With AI off the session says what works before the reason. Evidence: `docs/evidence/SCHOLAR-INDEPENDENT/`.

**P1 Implementing (branch `scholar/independent-learning-p1`, stacked on P0, 3 Nov 2026)** — not merged, not deployed: study-session context on every reader link, Revise narrowed to the lesson's sections, Ask about this per section, one AI-off voice (refusal codes + provider_unavailable).

**P2 Implementing (branch `scholar/independent-learning-p2`, stacked on P1, 3 Nov 2026)** — not merged, not deployed: My Plan treats a lesson read / opened / taught as started (policy `scholar_plan_started_signal`); the remaining adaptation rules were found to exist and are tabled in the programme doc.

**P3 Implementing (branch `scholar/independent-learning-p3`, from main c06c1953, 3 Nov 2026)** — not merged, not deployed: flashcards as their own AI activity (fallback to questions), the tier from the published policy per activity, OSCE station reuse before generation; staging config staged; production config and eligibility = owner decisions (p3-cost.md §4).

**Next**: owner decisions on the P3 production configuration (flashcards activity, routing, eligibility; Sonnet for questions; scenario default); production acceptance of P0–P2 with the pilot learner.

---

## SCHOLAR-CUMULATIVE-TEACHING-01 — Cumulative teaching intelligence — Implementing

Owner instruction and GO 3 Nov 2026 (cross-cutting over CE-01, CE-02, CE-05, CE-07). Root causes, changes, before/after and decisions: `docs/programme/SCHOLAR-CUMULATIVE-TEACHING-01.md`; evidence `docs/evidence/SCHOLAR-CUMULATIVE-TEACHING-01/`.

**Finding (3 Nov, Bed bath on staging)**: the shallow, repetitive teaching came from the prompts (a 220-word bullet lesson), from every action but Ask being given the passages alone (Go deeper could not know what Teach me had covered), from the saved-answer key (a second Go deeper returned the same saved answer, cached), from the planner's capacity (8 lessons x 10 sections packed the 75-slide deck so Bed bath was taught with half of Eye care), from a grounding false positive ("positive pressure ventilation") and, on staging only, from no model being approved for the explain family. Not from the model.

**Implementing (branch `scholar/cumulative-teaching-01`, 3 Nov 2026)** — not merged, not deployed, no migration: the lesson gains an UNDERSTANDING part and room to teach (teach v3, deeper v2); a concise TAUGHT SO FAR block (`learn-context.ts`, rebuilt per request from saved teaching and the visit's checks, never stored) reaches Go deeper, Explain again, Guide me, Challenge me, Teach back, Explain my mistake and the checks; Go deeper extends (round-keyed, at most three by AI, "depth reached" otherwise); Guide me is a dialogue that answers the attempt; Challenge me demands reasoning and the clarification judges it; an opened lesson restores its saved rounds; lessons follow heading families (section cap 16, family-aware cuts, family titles).

---

## Increment log

| Date | Increment | Evidence | Workstreams |
|---|---|---|---|
| 4 Nov 2026 | LEARNING-CLOSE-2026-11 CLOSE-01: the register reconciled against `main` @ `e19a363a`; one authoritative tracker created; AI-01 clinical review pack prepared | `docs/programme/LEARNING-CLOSE-2026-11-TRACKER.md`, `docs/evidence/SCHOLAR-INDEPENDENT/AI-01-flashcard-clinical-review.md` | CE-01..CE-07 |
| 3 Nov 2026 | SCHOLAR-CUMULATIVE-TEACHING-01 (improvement of the existing Learning Engine, not a new workstream): UNDERSTANDING part in every lesson, TAUGHT SO FAR context for Go deeper / Explain again / Guide me / Challenge me / checks, additive Go deeper rounds with depth reached, Guide me dialogue, reasoning-judged clarification, saved rounds restored on open, heading-family lesson planning; branch scholar/cumulative-teaching-01 | `learn-context.test.ts`, `learn-cumulative.test.ts`; before/after on Bed bath (staging) in docs/evidence/SCHOLAR-CUMULATIVE-TEACHING-01/ | CE-01, CE-02, CE-05, CE-07 |
| 3 Nov 2026 | My Competencies Explorer (HFE improvement of the existing Overview, not a new workstream): Framework -> Area -> Domain -> Competency in the saved Holdings order via the shared `framework-tree.ts` helper, seven independent progress indicators (accepted mapping = Material linked, never Practised), search/filters/sort, banded rows, detail drawer; branch scholar/competency-explorer-hfe-01 | `competency-explorer.test.ts`, `framework-tree.test.ts`; staging walk (PR) | Scholar competencies (CE-07 HFE) |
| 2 Nov 2026 | CE-04 built on branch scholar/ce04-conversation-01 (not merged, not live): Talk to the patient (text), SBAR handover task, SBAR OSCE template, mig 880 authored (not applied). **Reconciled 4 Nov: merged as #237; mig 880 applied and verified on staging, production not read; conversation switch default off.** | docs/evidence/CASE-CONVERSATION/880-build-record.md | CE-04 |
| 3 Nov 2026 | Learning units for My Plan (SCHOLAR-PLAN-UNITS-01): proposals grouped into learning units with reading / learning / revision / practice estimates and a review step (merge, split, leave out, put first) before Add to My Plan; no migration | branch scholar/plan-units-01, docs/programme/SCHOLAR-PLAN-UNITS-01.md | CE-03 |
| 2 Nov 2026 | My Plan (PLP-01..04 + calendar entries) | PR #225, mig 840, dpl_Di2ecqHj | CE-03 |
| 2 Nov 2026 | Lesson visuals + classification + page picker | PR #224, dpl_FXSAcnBP | CE-02 (visual notes), CE-07 |
| 1 Nov 2026 | Library + Flashcards; Flashcards 3 experiences; inline checks; monthly review + calendar | PRs #218, #220–#222, migs 820, 830 | CE-02, CE-03, CE-05 |
