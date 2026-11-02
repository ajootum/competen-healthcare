# SCHOLAR-CE-2026 — Competitive Experience Completion Programme: register

Owner GO 2 Nov 2026 (P0 Scholar focus). This register is authoritative across sessions: read it first, continue from its state, never reset it.
Statuses: Not assessed → Gap confirmed → Implementing → Deployed → Accepted → Complete. Merged is not Complete.
Waves: 1 = CE-01, CE-02, CE-03 · 2 = CE-04, CE-05 · 3 = CE-06 · 4 = CE-07 acceptance (CE-07 work runs through every wave).

| ID | Workstream | Status | Last update |
|---|---|---|---|
| CE-01 | Seamless, context-aware Personal AI | Gap confirmed | 2 Nov 2026 |
| CE-02 | AI Notebook and Personal Learning Library | Gap confirmed | 2 Nov 2026 |
| CE-03 | Unified My Plan | Deployed | 2 Nov 2026 |
| CE-04 | Conversational clinical simulation | Gap confirmed | 2 Nov 2026 |
| CE-05 | Richer assessment formats | Gap confirmed | 2 Nov 2026 |
| CE-06 | Audio and voice learning | Gap confirmed | 2 Nov 2026 |
| CE-07 | African-market performance and AI affordability | Gap confirmed | 2 Nov 2026 |

Baseline: one focused read of main @ f60358d6 plus a read-only production configuration check (2 Nov). Evidence paths are under `src/`.

---

## CE-01 — Seamless, context-aware Personal AI — Gap confirmed

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

---

## CE-02 — AI Notebook and Personal Learning Library — Gap confirmed

**Exists and works** (PR #218, migration 820, live): My learning library (saved lessons with versions, keyset pages, full-text search over saved teaching, notes, bookmarks, highlights, selected/topic/date-range PDF export), notes API, flashcard deck search, lesson links (`?version=`, "Review saved lesson"), visuals (#224) linked from flashcards/revise.

**Gaps (to confirm in Wave 1 build)**: one search across uploaded material sections + saved lessons + questions + notes; organisation by material / topic / session / competency; actions from a saved item to revise / practise / ask; standalone (not attached) notes; mobile check of the library.

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
| 2 Nov 2026 | My Plan (PLP-01..04 + calendar entries) | PR #225, mig 840, dpl_Di2ecqHj | CE-03 |
| 2 Nov 2026 | Lesson visuals + classification + page picker | PR #224, dpl_FXSAcnBP | CE-02 (visual notes), CE-07 |
| 1 Nov 2026 | Library + Flashcards; Flashcards 3 experiences; inline checks; monthly review + calendar | PRs #218, #220–#222, migs 820, 830 | CE-02, CE-03, CE-05 |
