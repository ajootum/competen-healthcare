# LEARNING-CLOSE-2026-11 — the one authoritative tracker (CLOSE-01)

**Authority:** owner directive LEARNING-CLOSE-2026-11, 4 Nov 2026 (§4: "one authoritative tracker"). This file is it. The CE-01..CE-07 register (`SCHOLAR-CE-2026-REGISTER.md`) holds the narrative per workstream and points here for status. Nothing is duplicated in a second tracker.
**Created:** 4 Nov 2026 by CLOSE-01 against `main` @ `e19a363a` (PR #263). **Production state given by the coordinator:** app `e19a363a`, DB head 942.
**Rule (directive §1 and §4):** a row is **Complete** only when it is implemented, integrated, available in its intended environment, governed, tested against its acceptance criteria and accurately recorded here. **Merged is not Complete.** At creation **no row is Complete**.

**Status values (exact):** Not started · Implementing · Ready for review · Blocked · Ready for release · Live — verification pending · Complete.
**Programme values:** Learning Engine · CE · AI · Governance · Release.
**Priority:** P0 / P1 / P2 as the directive set them; rows added by this tracker carry a proposed priority marked *(proposed)*.

## How this was filled, and what is not verified

- Current state, evidence and acceptance criteria come from the repository at the head above: `git log`, `docs/programme/*`, `docs/evidence/*`, `src/**` and `supabase/migrations/**`. Where a statement rests on code, the file is named. Where the repository cannot show production, the cell says **"production not read"** and a read-only query is queued (appendix A, file `LEARNING-CLOSE-2026-11-prod-readonly-queries.sql` in the coordinator folder).
- Rows owned by parallel sessions (CYU-01..04 by session local_edea2037; LE-01..05 by local_0272e81f; CE-07 slow-network by a session starting 4 Nov) carry the status the coordinator reported at creation. This tracker does not verify their in-flight work. They are updated only when the coordinator sends a status change.
- **GOV-03, REL-01..04 and OPS-01 are parallel commitments, not Learning Engine features** (directive §4, closing paragraph). They stay visible here as dependencies and are marked **PARALLEL**. They must not count toward "unfinished Learning Engine".
- The directive's initial statuses ("Gap confirmed", "Awaiting review", "Decision pending", "Partially delivered", "Awaiting owner GO") are not in its own status vocabulary. They are mapped below; every mapping that differs from the directive's wording is explained in the reconciliation table.

## Summary

| ID | Programme | Priority | Owner | Status | Blocker | Completed |
|---|---|---|---|---|---|---|
| CYU-01 | Learning Engine | P0 | CYU session (local_edea2037) | Implementing | — | — |
| CYU-02 | Learning Engine | P0 | CYU session | Implementing | — | — |
| CYU-03 | Learning Engine | P0 | CYU session | Implementing | Migration for D01 storage needs the owner's staging→production path | — |
| CYU-04 | Learning Engine | P1 | CYU session | Implementing | Depends on CYU-03 | — |
| CE-01 | CE | P1 | Engineering (CE) | Live — verification pending | Open children CE-01-1..3 | — |
| CE-01-1 | CE | P2 *(proposed)* | Engineering (CE) | Not started | — | — |
| CE-01-2 | CE | P1 *(proposed)* | Engineering (CE) | Not started | — | — |
| CE-01-3 | CE | P2 *(proposed)* | Engineering (CE) | Not started | — | — |
| CE-02 | CE | P1 | Engineering (CE) | Live — verification pending | Open children CE-02-1..2 | — |
| CE-02-1 | CE | P2 *(proposed)* | Engineering (CE) | Not started | Needs a schema decision (820 has no topic target) | — |
| CE-02-2 | CE | P1 *(proposed)* | Engineering (CE) | Not started | — | — |
| CE-03 | CE | P1 *(proposed)* | Engineering (CE) | Live — verification pending | Production signed-in walk | — |
| CE-04A | CE | P0 | Engineering (CE) | Ready for release | Production 880 state not read; switch off; needs an approved case with patient voice | — |
| CE-04B | CE | P1 | Engineering (CE) | Live — verification pending | — | — |
| CE-04C | CE | P1 | Engineering (CE) | Not started | Depends on CE-04A | — |
| CE-04D | CE | P0 | Engineering (CE) | Ready for release | Production 880 state not read | — |
| CE-05 | CE | P0 | Engineering (CE) + clinical reviewer | Ready for review | Clinician read of scenario content; owner scenario-policy decision (owner asked for an explanation; pending) | — |
| CE-06A | CE | P1 | Engineering (CE) | Live — verification pending | — | — |
| CE-06A-1 | CE | P1 *(proposed)* | Engineering (CE) | Not started | — | — |
| CE-06B | CE | P1 | Engineering (CE) | Not started | — | — |
| CE-07A | CE | P1 | CE-07 session | Not started | — | — |
| CE-07B | CE | P1 | CE-07 session | Not started | — | — |
| CE-07C | CE | P0 | CE-07 session | Implementing | — | — |
| LE-01 | Learning Engine | P1 | LE session (local_0272e81f) | Implementing | — | — |
| LE-02 | Learning Engine | P1 | LE session | Implementing | — | — |
| LE-03 | Learning Engine | P1 | LE session | Implementing | Depends on LE-02 identity rules | — |
| LE-04 | Learning Engine | P1 | LE session | Implementing | — | — |
| LE-05 | Learning Engine | P1 *(proposed)* | LE session | Not started | Depends on LE-02, LE-03 | — |
| AI-01 | AI | P0 | Independent clinical reviewer (to be named) | Ready for review | Reviewer not yet named | — |
| AI-02 | AI | P0 | Coordinator (config) | Blocked | AI-01 signed review | — |
| AI-03 | AI | P1 | Coordinator (read-only runs) | Blocked | AI-02 | — |
| AI-04 | AI | P1 *(proposed)* | Coordinator | Not started | AI-03 | — |
| AI-05 | AI | P1 *(proposed)* | Coordinator | Not started | AI-03 | — |
| GOV-01 | Governance | P1 | Owner | Ready for release | Owner grants the right to six positions in Organisation & Appointments; coordinator verifies | — |
| GOV-02 | Governance | P1 | Owner | Blocked | Owner: activate after 20 Nov 2026 (decided: stay off during the pilot) | — |
| GOV-04 | Governance | P2 *(proposed)* | Owner | Complete | — | 4 Nov 2026 |
| GOV-03 **PARALLEL** | Governance | P1 | Clinical governance (nursing audit scoring) | Blocked | Clinical-governance approvals | — |
| REL-01 **PARALLEL** | Release | P1 | Owner | Live — verification pending | — (owner GO given; production already has 550) | — |
| REL-02 **PARALLEL** | Release | P1 | Owner | Live — verification pending | — (owner GO given; production already has 610) | — |
| REL-03 **PARALLEL** | Release | P1 | Owner | Blocked | Owner: payments deferred, revisit 18 Nov 2026 | — |
| REL-04 **PARALLEL** | Release | P2 | Owner | Blocked | **On hold by owner directive** (keep on hold) | — |
| OPS-01 **PARALLEL** | Release | P1 | Owner (DNS) | Blocked | DNS record scheduled 5 Nov | — |
| CLOSE-01 | Learning Engine | P0 | Coordinator + this session | Implementing | — | — |

## Reconciliation against directive §4

Where the verified repository state differs from the directive's initial table, the difference is listed so nothing is silently re-graded.

| Row | Directive said | Verified | Why |
|---|---|---|---|
| CE-04A | Gap confirmed | Built and merged (#237), switched off | `scholar_case_conversation` default off; "Talk to the patient" server loop, caps, grounding and tests exist |
| CE-04B | Gap confirmed | Built and merged (#237) | SBAR handover task and SBAR OSCE template; no migration |
| CE-04C | Gap confirmed | **Confirmed gap** | No deterioration clock/timeline in `src/lib/cases/*` or `case-talk.ts` |
| CE-04D | Gap confirmed — verify | Built (mig 880, #237), **production not read** | Append-only table, cascade delete with the attempt, erase-all, copied into the 810 attempt snapshot |
| CE-05 | Partially delivered | Confirmed partial | Format shipped (#236) and off by default; clinical read and policy decision outstanding |
| CE-06A | Gap confirmed | **Partly built** (#234, #239, #241) | Listen on most surfaces; missing on the lesson reader and OSCE (CE-06A-1) |
| CE-06B | Gap confirmed | Confirmed for spoken conversation | Dictation shipped; no spoken patient/AI conversation; no HQ voice control |
| CE-07A/B | Gap confirmed | **Confirmed** | No `next/dynamic`/lazy loading or data-saver handling in `src/` |
| CE-07C | Gap confirmed | **Confirmed** | `uploadToSignedUrl` single-shot, no progress, no resume (`study/_components/client.tsx:242`) |
| LE-04 | Decision approved; implementation verify | **Gap: cap is a code constant** | `DEEPER_ROUNDS_MAX = 3` in `learn-context.ts:51`; no HQ policy key exists |
| CE-01 / CE-02 | Implementing — verify | Merged and live (#228) | Missing requirements are the child rows; "Implementing" no longer describes them |

---

## Rows

Field order in every row: Programme · Deliverable · Current state (verified) · Priority · Owner · Dependency · Acceptance criteria · Environment · Evidence · Status · Blocker · Completed date.

### CYU-01 — Checks distributed throughout lessons
- **Programme:** Learning Engine · **Priority:** P0 · **Owner:** CYU session (local_edea2037)
- **Deliverable:** Meaningful understanding checks at suitable points through each lesson, following the teaching sequence, not only at the end.
- **Current state:** Increment 1 only: the Check my answer panel always answers beneath the learner's answer (7908ca24, merged in #252). Inline checks exist as policy-placed recall/quick checks (#221, `learn-inline.ts`, `scholar_learn_inline_*`); the engine writes at most two check questions per Teach me answer. Placement across a lesson's units is increment 3 of the series and is not on `main`. In build by the CYU session (coordinator report; no PR yet).
- **Dependency:** none · **Environment:** development
- **Acceptance criteria:** A proportionate number of checks per lesson by length, objectives and complexity; never one per slide; optional; no excessive interruption; answers survive refresh (directive §6.1, §6.2).
- **Evidence:** `docs/programme/SCHOLAR-UNDERSTANDING-CHECKS-01.md`; PR #252; PR #221; `learn-check.test.ts`.
- **Status:** Implementing · **Blocker:** — · **Completed:** —

### CYU-02 — Existing question types integrated
- **Programme:** Learning Engine · **Priority:** P0 · **Owner:** CYU session
- **Deliverable:** Checks reuse the governed question and assessment infrastructure, including formats beyond four-option MCQ, with format-specific scoring and feedback. No second question engine.
- **Current state:** The format registry is a single source (`question-formats.ts`, #236); marking exists for mcq, mrq, match, sequence, true/false, cloze, short, structured, extended and scenario. Learn's check path today is free-text Check my answer plus MCQ practice (`learn-practice.tsx`). Not yet wired to the registry (CYU series increment 4). In build.
- **Dependency:** CYU-01 · **Environment:** development
- **Acceptance criteria:** Short answer, explanation, application, clinical judgement and MCQ checks use existing marking, rubric snapshots and "marked against" provenance; no duplicated engine.
- **Evidence:** `question-formats.ts`; PR #236; `docs/programme/SCHOLAR-UNDERSTANDING-CHECKS-01.md` "Next increments" item 4.
- **Status:** Implementing · **Blocker:** — · **Completed:** —

### CYU-03 — Responses and feedback persisted
- **Programme:** Learning Engine · **Priority:** P0 · **Owner:** CYU session
- **Deliverable:** Store question and version ids, the learner's response (free text included), feedback and explanation, outcome, lesson/section/session/competency references, attempt timestamps and history, AI model and generation metadata (decision D01). Learner-owned record with access control, deletion, retention and interrupted-session recovery. Formative only; never establishes verified competence.
- **Current state:** Learn today stores nothing the learner types (stated in the checks doc); the `clarify` learning event records only an informal verdict. The existing place for a written answer and its marking is the revision attempt table (416: `response`, `marking`, `evaluator_*`) plus the 791 attempt snapshots. D01 is approved; storage is not built on `main`.
- **Dependency:** D01 (approved). A new migration, if needed, follows the CLAUDE.md four-state path; production application needs a separate owner GO.
- **Environment:** development
- **Acceptance criteria:** Answers and feedback survive refresh, logout and device change (§6.2); attempts remain distinguishable; deletion and retention work; erase-all covers them; no employer-controlled copy (D01).
- **Evidence:** `docs/programme/SCHOLAR-UNDERSTANDING-CHECKS-01.md`; migration 416, 791 files.
- **Status:** Implementing · **Blocker:** a new migration cannot reach production without an owner GO · **Completed:** —

### CYU-04 — Session, progress and competency integration
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** CYU session
- **Deliverable:** Results connect to the study session, My Plan and progress, the Library/Notebook, competency evidence views, and Personal AI session context within existing permissions; repeated attempts stay distinguishable.
- **Current state:** The study-session context block already reads `not_yet` check verdicts (`study-context.ts`); My Plan treats a lesson read/opened/taught as started (#254, `scholar_plan_started_signal`). Nothing reads a stored check response yet because none is stored (CYU-03).
- **Dependency:** CYU-03 · **Environment:** development
- **Acceptance criteria:** §6.1 a learner moves between activities without losing session context; results appear in My Plan, Library and the Personal AI context block; accepted mappings are evidence, never competence.
- **Evidence:** PR #254; `study-context.ts`.
- **Status:** Implementing · **Blocker:** CYU-03 · **Completed:** —

### CE-01 — Seamless, context-aware Personal AI (reconciliation)
- **Programme:** CE · **Priority:** P1 · **Owner:** Engineering (CE)
- **Deliverable:** Reconcile and close remaining criteria.
- **Current state:** Delivered on `main` and in production (app `e19a363a` ⊇ #228): in-place Ask about this panel with a typed context payload, entry points on Revise/Adaptive feedback, Flashcards, Apply case debrief, OSCE result and Saved library items (#228); Learn lesson Ask (#239); grounding labels and `[S#]` citation at every depth (#230); Personal AI page continuity via `?study=&material=&section=` (`ask-link.ts`); the study-session block gained flashcard state and plan settings (#228). Verified missing requirements are CE-01-1, CE-01-2, CE-01-3.
- **Dependency:** none · **Environment:** production (code); acceptance not recorded
- **Acceptance criteria:** see the register, CE-01 gaps 1-3, and the derived rows below.
- **Evidence:** PRs #228, #230, #239; `ask-context.ts`, `ask-link.ts`, `ask-panel.tsx`, route B; tests `ask-context.test.ts`, `ask-grounding.test.ts`, `study-session-context-ce01.test.ts`.
- **Status:** Live — verification pending · **Blocker:** CE-01-1..3 · **Completed:** —

### CE-01-1 — Ask about this from My Plan Today (verified missing)
- **Programme:** CE · **Priority:** P2 *(proposed)* · **Owner:** Engineering (CE)
- **Deliverable:** An Ask about this entry point in My Plan (Today).
- **Current state:** Deliberately left out of the CE-01 branch because My Plan was being rebuilt (register decision 1). My Plan was then delivered (#225) but no `AskAbout`/`askPrefill("plan")` caller exists in the plan components; the importers of the panel are Learn, reader, Revise, Flashcards, Case, OSCE and Saved library only. `askPrefill("plan")` and `sectionIdsInHref`/`sessionIdInHref` are ready.
- **Dependency:** CE-03 · **Environment:** development
- **Acceptance criteria:** From a Today item the learner opens the panel on that item's sections; answers cite sections; AI-off shows the shared copy; the learner's place in My Plan is kept.
- **Evidence:** grep of `src/app/individual` for the panel's importers (4 Nov 2026); register CE-01 "Decisions / deviations (1)".
- **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-01-2 — CE-01 acceptance walk (desktop and phone)
- **Programme:** CE · **Priority:** P1 *(proposed)* · **Owner:** Engineering (CE)
- **Deliverable:** A recorded staging and production walk of every Ask about this entry point and the Personal AI continuity link, desktop and phone.
- **Current state:** The register recorded this as "Acceptance still to do". No walk evidence exists under `docs/evidence/` for CE-01 (search for CE-01 / Ask about this found only the SCHOLAR-PRACTICE acceptance of 31 Oct, which predates the panel).
- **Dependency:** none · **Environment:** staging, then production
- **Acceptance criteria:** One screenshot or transcript per entry point; unowned section ids are dropped; AI-off and allowance-limited states shown; no console errors.
- **Evidence:** none yet. · **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-01-3 — Learner's next step in the study-session context block
- **Programme:** CE · **Priority:** P2 *(proposed)* · **Owner:** Engineering (CE)
- **Deliverable:** Today's next step (not only plan settings and due count) reaches the context block.
- **Current state:** Register gap 3 asked for goal, next step and exam date. Goal, exam proximity and up to three priorities are read; the next step is not (register decision 2: the Today planner is heavy and records carry-overs). `study-session-context.ts` has no next-step read.
- **Dependency:** CE-03 · **Environment:** development
- **Acceptance criteria:** The block names the next step in words without a read that records carry-overs; 3000-character cap and identifier screen unchanged.
- **Evidence:** register CE-01 decision (2); `study-session-context.ts`. · **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-02 — AI Notebook and Personal Learning Library (reconciliation)
- **Programme:** CE · **Priority:** P1 · **Owner:** Engineering (CE)
- **Deliverable:** Reconcile and close remaining criteria.
- **Current state:** Library and notes live since #218 (mig 820); in #228: one search over saved lessons, notes, questions/flashcards, sessions **and the learner's own uploaded sections** with Open in Learn / View original / Revise / Practise / Ask about this; URL-driven filters Material, Topic, Study session, Competency (accepted mappings only); Your notes view with in-place edit/remove/provenance and standalone notes on a material or section; filters collapse on a phone. No AI call, no migration in #228. Verified missing: CE-02-1, CE-02-2.
- **Dependency:** none · **Environment:** production (code); acceptance not recorded
- **Acceptance criteria:** register CE-02 gaps (one search; organisation; item actions; standalone notes; mobile check).
- **Evidence:** PRs #218, #224, #228; `library-organise.ts`, `library-scope.ts`, `saved-library.ts`, `saved-library-view.tsx`, `library-notes-client.tsx`; tests `library-organise.test.ts`, `library-scope.test.ts`.
- **Status:** Live — verification pending · **Blocker:** CE-02-1, CE-02-2 · **Completed:** —

### CE-02-1 — Notes attached to a topic (verified deviation)
- **Programme:** CE · **Priority:** P2 *(proposed)* · **Owner:** Engineering (CE)
- **Deliverable:** A note can target a topic, not only a material or section.
- **Current state:** Not available: migration 820 has no topic target and #228 allowed no schema change (register decision 2). Section choices show the section's first topic.
- **Dependency:** owner/engineering decision on whether a topic target is wanted (new migration, four-state path). · **Environment:** development
- **Acceptance criteria:** Create, edit, remove and filter a topic note; erase-all and export include it.
- **Evidence:** register CE-02 decision (2); `supabase/migrations/820-*`. · **Status:** Not started · **Blocker:** schema decision · **Completed:** —

### CE-02-2 — CE-02 acceptance walk (desktop and phone)
- **Programme:** CE · **Priority:** P1 *(proposed)* · **Owner:** Engineering (CE)
- **Deliverable:** A recorded walk of search, filters, notes create/edit/remove and item actions on desktop and a phone-width viewport.
- **Current state:** Register: "Acceptance still to do"; no CE-02 walk evidence under `docs/evidence/`.
- **Dependency:** none · **Environment:** staging, then production
- **Acceptance criteria:** touch targets ≥ `--cmp-touch-min`, no horizontal scroll, filters work, notes keep provenance.
- **Evidence:** none yet. · **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-03 — Unified My Plan (not in directive §4; added)
- **Programme:** CE · **Priority:** P1 *(proposed)* · **Owner:** Engineering (CE)
- **Deliverable:** Close the Deployed workstream with a production acceptance.
- **Current state:** Deployed 2 Nov: PR #225 (merge f60358d6), migration 840 applied in production (VERIFY 35/0 per register); refined by learning units (#256) and the started-signal (#254). Limitations recorded in the register. Production signed-in walk pending.
- **Dependency:** none · **Environment:** production
- **Acceptance criteria:** register CE-03 acceptance; signed-in walk with the pilot learner.
- **Evidence:** PRs #225, #254, #256; `docs/programme/SCHOLAR-PLAN-UNITS-01.md`; register CE-03.
- **Status:** Live — verification pending · **Blocker:** — · **Completed:** —

### CE-04A — Multi-turn patient simulation
- **Programme:** CE · **Priority:** P0 · **Owner:** Engineering (CE)
- **Deliverable:** Genuine multi-turn simulated-patient interaction; patient replies reflect clinical context; correct answer not exposed early.
- **Current state:** Built and merged (#237, 2 Nov): "Talk to the patient" (text) with a server loop that answers only from what the case says the person knows at that stage, a grounding filter that keeps future findings out, a per-stage turn cap (`scholar_case_conversation_turns`, default 20), a labelled simulated conversation, unavailable/cap states as notices; authored through Case Studio (voice persona, style, knowledge, key questions) and approved with the blueprint hash. **Switched off by default** (`scholar_case_conversation` = off) and needs migration 880. Production state of 880 and of the switch: **not read** (queries Q1-Q3). Voice is text only; there is no spoken exchange (see CE-06B).
- **Dependency:** mig 880 in production; a clinically approved case version that defines a patient voice. · **Environment:** staging verified (880 staging ×2 plus VERIFY 46/0); production not read
- **Acceptance criteria:** directive §6.4 turn order preserved and no leakage of future scenario information; replies grounded in the stage; per-stage cap; works the same when off or AI unavailable; learner's AI allowance applies; clinical review and approval kept.
- **Evidence:** PR #237; `docs/evidence/CASE-CONVERSATION/880-build-record.md`; `case-talk.ts`, `src/lib/cases/{conversation,voice,handover}.ts`; tests `ce04.test.ts`, `case-talk.test.ts`, `case-conversation-scope.test.ts`; policy keys in `policy.ts`.
- **Status:** Ready for release · **Blocker:** production 880 state (appendix A Q1); owner GO for 880 if absent; HQ switch; one approved case with a patient voice · **Completed:** —

### CE-04B — Handover tasks
- **Programme:** CE · **Priority:** P1 · **Owner:** Engineering (CE)
- **Deliverable:** Structured handover (SBAR) tasks.
- **Current state:** Built and merged (#237): SBAR handover boxes in case play, handover marking kept as a written answer (no migration), a handover rubric snapshot in the kept attempt, an SBAR OSCE template, Case Studio handover authoring and review display. Appears wherever a case version defines a handover; no HQ switch gates it. Whether any production case defines one: not read.
- **Dependency:** a published case with a handover spec · **Environment:** staging; production not read
- **Acceptance criteria:** learner completes and receives marked feedback; the answer is part of the attempt record; correct handover not shown beforehand.
- **Evidence:** PR #237; `src/lib/cases/handover.ts`; `ce04.test.ts`; build record 880 ("SBAR handover task needs no migration").
- **Status:** Live — verification pending · **Blocker:** — · **Completed:** —

### CE-04C — Deterioration clock
- **Programme:** CE · **Priority:** P1 · **Owner:** Engineering (CE)
- **Deliverable:** A configurable deterioration timeline as a governed simulation mechanism, not an uncontrolled clinical decision system.
- **Current state:** **Confirmed gap.** Deterioration in cases is branching only (blueprint stages and branching progression); there is no clock, timeline or timed-event construct in `src/lib/cases/blueprint.ts`, `conversation.ts`, `voice.ts` or `case-talk.ts` (`conversation.ts` states it "has no clock").
- **Dependency:** CE-04A; clinical approval of timeline content through the existing case approval (422) · **Environment:** development
- **Acceptance criteria:** timeline authored per case version in Case Studio and approved with the version; progression server-controlled; no premature reveal; clock labelled as simulation; works with the conversation cap and debrief.
- **Evidence:** repo search 4 Nov 2026; register CE-04 gaps.
- **Status:** Not started · **Blocker:** CE-04A · **Completed:** —

### CE-04D — Attempt-linked conversation storage
- **Programme:** CE · **Priority:** P0 · **Owner:** Engineering (CE)
- **Deliverable:** Turns kept with the learner's individual simulation attempt; available for debrief; deleted with the attempt; not Personal AI memory (decision D05).
- **Current state:** Built (mig 880): one append-only table `individual_scholar_case_conversation` (turn / communication note / handover note), RLS read-own, update refused, delete only by cascade, bounded 400 turns per session; copied into the 810 attempt snapshot at completion; `…_erase(p_user)` so Settings "erase all my study material" removes library-play conversations; owner ruling ADR-016 "D10 exception" (turns are assessment evidence of one case attempt, not Personal AI memory), pinned by `case-conversation-scope.test.ts`. Retention period: not configured in the repository (D05 "subject to applicable retention requirements" is open). Production applied state: **not read**.
- **Dependency:** mig 880 in production · **Environment:** staging verified; production not read
- **Acceptance criteria:** turns survive refresh; deleted attempt removes its turns; erase-all removes library-play turns; no turn reaches Personal AI memory or unrelated answers; a retention rule is recorded.
- **Evidence:** PR #237; `supabase/migrations/880-individual-scholar-case-conversation.sql` (sha256 `df966c11…2450f` at staging); `docs/evidence/CASE-CONVERSATION/880-build-record.md`; `docs/adr/ADR-016-individual-product-gate.md`.
- **Status:** Ready for release · **Blocker:** production 880 state (Q1-Q2); retention rule to record · **Completed:** —

### CE-05 — Clinical scenario quality and policy activation
- **Programme:** CE · **Priority:** P0 · **Owner:** Engineering (CE) with a clinical reviewer
- **Deliverable:** Existing scenarios meet clinical content requirements; no answer leakage; no "student notes" framing; unfolding information; server-controlled progression; scenario policy confirmed before learner-wide activation.
- **Current state:** Delivered in #236 (2 Nov) and tuned in later commits: one format registry; evolving scenario stored as `short` with `answer.format = 'scenario'` (no migration); stage-by-stage route where each later stage is sent only after a valid answer, with an HMAC progress token over learner, question, marking guide and results (`scenario.ts`); per-stage marking and snapshots; "marked against" line on every format; scenario-v3 prompt (a decision about this person at every stage, 2-4 stages, cited, nothing invented); validation refuses leakage of a later answer into an earlier stage, "notes/passage/learner/revising" framing, uncited or unsupported findings and figures (`scenario-quality.test.ts`); a stored scenario is re-held to today's rules before it is offered. **Not active for learners:** `scholar_revision_formats` code default excludes scenario ("OFF by default", owner cost decision 3 Nov), production excludes it (coordinator). The `scenarios` AI activity (Opus, falls back to `questions`) is in code (#259). No clinician read of generated scenarios is recorded in the repository. Production `scholar_revision_formats` excludes "scenario" (coordinator read, 4 Nov). The owner has asked for an explanation of the activation choice; the decision is still pending.
- **Dependency:** owner decision D-3; clinician read of a sample of generated scenarios · **Environment:** production (code, format off)
- **Acceptance criteria:** clinician confirms a sample has accurate clinical content, no leakage, patient-centred framing; progression cannot be skipped from the browser; the policy decision is recorded.
- **Evidence:** PR #236; `scenario.ts`, `scenario-service.ts`, `scenario-quality.test.ts`, `scenario-sessions-wiring.test.ts`; `docs/evidence/SCHOLAR-INDEPENDENT/p3-cost.md` (scenarios 59 % of Scholar AI cost); policy `scholar_revision_formats` in `policy.ts`.
- **Status:** Ready for review · **Blocker:** owner D-3; clinician read · **Completed:** —

### CE-06A — Read-aloud across lessons
- **Programme:** CE · **Priority:** P1 · **Owner:** Engineering (CE)
- **Deliverable:** Read-aloud for lesson content with playback controls, resume, text alternatives, usage controls, reusing existing audio infrastructure.
- **Current state:** Delivered device-native (browser speech synthesis; no server audio, no AI call, no audio kept): shared `ReadAloudButton` / `DictateButton` / `SpeechSetting` (`src/app/individual/_components/speech/`), pure layer `speech.ts`/`speech-engine.ts`. **Listen** on Learn lessons and inline-check questions, saved lessons, flashcards, Personal AI answers, Ask panel, case so far and each case stage (#234); resume from the paused word and flow/map/timeline diagrams read aloud (#241); text always stays visible. The on/off setting is **device-local** (localStorage). Missing surfaces are CE-06A-1.
- **Dependency:** none · **Environment:** production (code); verification not recorded
- **Acceptance criteria:** §6.6 voice and read-aloud retain accessible text alternatives; speed/stop/resume controls; unsupported browsers degrade to text.
- **Evidence:** PRs #234, #241; `speech.ts`, `speech-engine.ts`, `speech-buttons.tsx`, tests `speech.test.ts`, `speech-engine.test.ts`.
- **Status:** Live — verification pending · **Blocker:** — · **Completed:** —

### CE-06A-1 — Listen on the lesson reader and OSCE; persisted resume (verified missing)
- **Programme:** CE · **Priority:** P1 *(proposed)* · **Owner:** Engineering (CE)
- **Deliverable:** Read-aloud on the independent lesson reader's original sections (#251, which merged after the speech layer), on OSCE stations/results, and a resume position that survives leaving the page.
- **Current state:** `learn-reader.tsx` and `osce-client.tsx` do not import the speech components (importers: ask-panel, case-client, flashcards-client, learn-client, learn-inline-check, library-notes-client, plan-entries, revision-client, saved-library-view, AssistantPanel). Resume is within a reading; no persisted position found.
- **Dependency:** none · **Environment:** development
- **Acceptance criteria:** Listen present with the shared controls on both surfaces; text stays visible; resume works after navigation.
- **Evidence:** import search 4 Nov 2026. · **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-06B — Expanded voice interaction
- **Programme:** CE · **Priority:** P1 · **Owner:** Engineering (CE)
- **Deliverable:** Voice interaction where technically supported, with clear AI and voice usage controls.
- **Current state:** Dictation into answers, notes, Ask boxes, assistant questions and My Plan descriptions is live (#234; Android repeated-words fix in #239). **No spoken patient or Personal AI conversation** (speech in, speech out) exists, and there is no HQ policy for voice (`policy.ts` has no speech key; the setting is device-local).
- **Dependency:** CE-04A for the patient conversation; owner/HQ decision on voice controls · **Environment:** development
- **Acceptance criteria:** spoken turns with a visible, editable transcript; same AI allowance and cost controls as typed turns; accessible alternative always present.
- **Evidence:** repo search 4 Nov 2026; PRs #234, #239. · **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-07A — Smaller downloads
- **Programme:** CE · **Priority:** P1 · **Owner:** CE-07 session
- **Deliverable:** Smaller lesson and document downloads; avoid unnecessary repeated downloads.
- **Current state:** **Confirmed gap.** No `next/dynamic` / `React.lazy` usage in `src/app/individual` or `src/components`; Learn (~1.6k lines) and Flashcards (~1.1k) are single client bundles; no Scholar manifest or bundle budget. Existing: stored-output reuse, private image caching, signed direct uploads (register CE-07 "Exists").
- **Dependency:** none · **Environment:** development
- **Acceptance criteria:** measured payload reduction on representative constrained network conditions; no repeated fetch of unchanged material.
- **Evidence:** repo search 4 Nov 2026; register CE-07. · **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-07B — Data-saver mode
- **Programme:** CE · **Priority:** P1 · **Owner:** CE-07 session
- **Deliverable:** A data-saver mode honoured across Scholar.
- **Current state:** **Confirmed gap.** No `saveData`, `navigator.connection`, `effectiveType` or data-saver handling in `src/` (the only `effectiveTypes` match is unrelated, Practice).
- **Dependency:** CE-07A · **Environment:** development
- **Acceptance criteria:** learner-visible setting; defers images/visuals and heavy panels; text-first lessons keep working.
- **Evidence:** repo search 4 Nov 2026. · **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-07C — Slow-network upload reliability
- **Programme:** CE · **Priority:** P0 · **Owner:** CE-07 session
- **Deliverable:** Reliable uploads on slow networks, interrupted-upload recovery, transparent upload progress.
- **Current state:** **Confirmed gap.** Upload is a single-shot `uploadToSignedUrl` to a one-time signed URL for a server-chosen path (`study/_components/client.tsx:242`; `store.ts` `createSignedUploadUrl`); no progress events, no chunking, no resume. Session starting 4 Nov per coordinator.
- **Dependency:** none · **Environment:** development
- **Acceptance criteria:** §6.5 interrupted uploads recover safely with no duplicate or corrupted material; progress shown; tested on constrained conditions.
- **Evidence:** `client.tsx`, `store.ts`, `api/individual/scholar/uploads/route.ts`; tests `upload01.test.ts`, `upload-limits.test.ts` (limits only).
- **Status:** Implementing · **Blocker:** — · **Completed:** —

### LE-01 — Consistent AI-off wording
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** LE session (local_0272e81f)
- **Deliverable:** One AI-unavailable experience for Scholar and Professional (D06).
- **Current state:** Scholar has the shared copy (`ai-availability.ts`, `AiAvailability.tsx`; P1 #253: refusal codes, `provider_unavailable`, no "environment" wording). Bespoke strings still exist on Apply and OSCE pages ("AI help is off, so …", `apply/page.tsx:63`, `apply/osce/page.tsx:71`). No use of the shared component found under the Professional routes in this pass. In build.
- **Dependency:** none · **Environment:** development
- **Acceptance criteria:** same wording and next step across Scholar and Professional; supported non-AI functions stay usable; no internal detail exposed.
- **Evidence:** PR #253; `src/lib/individual/ai-availability.ts`. · **Status:** Implementing · **Blocker:** — · **Completed:** —

### LE-02 — Rename learning units
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** LE session
- **Deliverable:** Learners rename learning units (D03) with stable identities and mappings to original materials.
- **Current state:** Learning units exist as My Plan proposals (#256) and Learn lessons planned by heading family (#257). No rename of a unit found in the repository. In build.
- **Dependency:** none · **Environment:** development
- **Acceptance criteria:** rename persists; progress, annotations, saved explanations, questions, flashcards, attempts and citations keep working.
- **Evidence:** PRs #256, #257; `docs/programme/SCHOLAR-PLAN-UNITS-01.md`. · **Status:** Implementing · **Blocker:** — · **Completed:** —

### LE-03 — Re-cut lesson structure
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** LE session
- **Deliverable:** Reorganise lesson boundaries, split/combine sections, re-cut session lessons without losing completed work (D03); recalculate affected progress safely.
- **Current state:** Not on `main`. Plan-unit review (merge, split, leave out, put first) exists for My Plan proposals only. In build.
- **Dependency:** LE-02 identity rules · **Environment:** development
- **Acceptance criteria:** §6.3 restructuring orphans no saved record; progress recalculated, not transferred indiscriminately.
- **Evidence:** PR #256. · **Status:** Implementing · **Blocker:** LE-02 · **Completed:** —

### LE-04 — Configurable Go Deeper limit
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** LE session
- **Deliverable:** Three cumulative Go Deeper rounds by default; the maximum configurable in HQ (D02).
- **Current state:** **Verified gap.** Three cumulative rounds are delivered (#257, `learn-context.ts` `DEEPER_ROUNDS_MAX = 3`, enforced in `learn/act/route.ts`:404, "depth reached" beyond it). The maximum is a **code constant**; `policy.ts` has no Go Deeper key. Raising it needs an HQ policy.
- **Dependency:** none · **Environment:** development
- **Acceptance criteria:** HQ policy with default 3, clamped by the policy engine; takes effect without redeploy; existing AI fair-use and cost controls unchanged.
- **Evidence:** `learn-context.ts:51`; `learn-context.test.ts`; PR #257.
- **Status:** Implementing · **Blocker:** — · **Completed:** —

### LE-05 — Verify history, citations and progress after restructuring (§3, absent from §4; added)
- **Programme:** Learning Engine · **Priority:** P1 *(proposed)* · **Owner:** LE session
- **Deliverable:** Evidence that learning history, citations and progress remain intact after rename and re-cut.
- **Current state:** Not started; depends on LE-02/LE-03.
- **Dependency:** LE-02, LE-03 · **Environment:** development, then staging
- **Acceptance criteria:** §6.3.
- **Evidence:** none yet. · **Status:** Not started · **Blocker:** LE-02, LE-03 · **Completed:** —

### AI-01 — Flashcard clinical review
- **Programme:** AI · **Priority:** P0 · **Owner:** Independent clinical reviewer (to be named by the owner)
- **Deliverable:** Independent clinical review of flashcard outputs.
- **Current state:** Review pack delivered: `docs/evidence/SCHOLAR-INDEPENDENT/AI-01-flashcard-clinical-review.md` — every recorded kept card from Haiku (6), Sonnet (7) and Opus (8), the dropped drafts with reasons, the Opus `q.postop` item, mark columns and a sign-off block. **Limit found:** the evaluation recorded at most two kept cards per section, so Haiku kept 7 and Opus kept 9 but only 6 and 8 are in the file; dropped drafts are recorded by reason only; the source section text is not in the file (a read-only staging query is in the pack).
- **Dependency:** D04 · **Environment:** staging evidence
- **Acceptance criteria:** a named independent clinician marks each card Safe/Unsafe/Inaccurate/Unclear, comments, and signs the pack with name, role and date; outcome recorded.
- **Evidence:** `p3-eval-2026-11-03.json`; `docs/evidence/AI-EVAL/run-d5v2-2026-11-03-cost-config.json`; run `55f56e85-87d5-4cab-b22a-f1dbbb20c89d`.
- **Status:** Ready for review · **Blocker:** reviewer not named · **Completed:** —

### AI-02 — Flashcard AI configuration
- **Programme:** AI · **Priority:** P0 · **Owner:** Coordinator (owner-run configuration)
- **Deliverable:** Apply the approved flashcard settings package: `flashcards` fair-use activity (cheap tier, risk floor standard educational), route `scholar.flashcards` = Haiku › Sonnet › Opus, three activity-scoped eligibility rows (Haiku standard-educational; Sonnet and Opus clinical-educational). Sonnet stays for mapping and Opus for question generation (D04); the clinical floor is untouched.
- **Current state:** Code on `main` (#259, #262): flashcards as their own activity with fallback to `questions`, tier from the published policy per activity. The production package is prepared (SQL §7 of `SCHOLAR-AI-COST-CONFIG-01.md` in the coordinator folder; staging counterpart `p3-staging-config.sql`). Production configuration: **not read** (appendix A Q4).
- **Dependency:** AI-01 signed · **Environment:** production (configuration)
- **Acceptance criteria:** §6.7 routing follows published permissions and fair-use controls; post-activation queries show clinical notes on Sonnet and standard notes on Haiku; questions, scenarios and OSCE unchanged on Opus; rollback SQL recorded.
- **Evidence:** PRs #259, #262; `docs/evidence/SCHOLAR-INDEPENDENT/p3-staging-config.sql`, `p3-cost.md`.
- **Status:** Blocked · **Blocker:** AI-01 · **Completed:** —

### AI-03 — Cost comparison and report
- **Programme:** AI · **Priority:** P1 · **Owner:** Coordinator (read-only runs)
- **Deliverable:** Before-and-after cost report from the existing monitoring queries.
- **Current state:** Queries M1.. ready (`p3-monitoring-queries.md`); baseline measured: 93 calls, about USD 1.37 over 30 days to 3 Nov, `map` 34 % on Sonnet, Learn 43/43 served from saved. After-window cannot start until AI-02.
- **Dependency:** AI-02 · **Environment:** production (read-only)
- **Acceptance criteria:** cost per relevant activity, quality outcomes, safety failures and latency reported for a stated window.
- **Evidence:** `docs/evidence/SCHOLAR-INDEPENDENT/p3-monitoring-queries.md`, `p3-cost.md`.
- **Status:** Blocked · **Blocker:** AI-02 · **Completed:** —

### AI-04 — Report cost, quality, safety failures and latency (§3, absent from §4; added)
- **Programme:** AI · **Priority:** P1 *(proposed)* · **Owner:** Coordinator
- **Deliverable:** The reporting output of AI-03 in directive §8 form. **Current state:** Not started. **Dependency:** AI-03 · **Environment:** production (read-only) · **Acceptance criteria:** the five measures in directive §3 AI-04 · **Evidence:** none yet · **Status:** Not started · **Blocker:** AI-03 · **Completed:** —

### AI-05 — Recommended routing changes documented, none auto-deployed (§3, absent from §4; added)
- **Programme:** AI · **Priority:** P1 *(proposed)* · **Owner:** Coordinator
- **Deliverable:** Written recommendations only. **Current state:** Existing evidence already recommends: `map` stays on Sonnet (Haiku blocked by quality, p3-mapping-comparison.md); `questions` stays Opus-only (no model clears the D5 bar); scenarios are 59 % of cost, a policy choice (p3-cost.md §4). **Dependency:** AI-03 · **Environment:** documentation · **Acceptance criteria:** no unapproved clinical model substitution is deployed · **Evidence:** `p3-mapping-comparison.md`, `p3-cost.md`, `SCHOLAR-AI-COST-CONFIG-01.md` · **Status:** Not started · **Blocker:** AI-03 · **Completed:** —

### GOV-01 — Identifiable learner analytics access policy
- **Programme:** Governance · **Priority:** P1 · **Owner:** Owner
- **Deliverable:** Grant the identifiable-names right at the level the owner decided, through HQ.
- **Current state:** **Decided 4 Nov 2026: "Executive level".** Analytics dashboard live (#248, migration 910). The capability `hq.scholar.analytics.identifiable.read` exists in production with **no grants today** (coordinator read-only check, 4 Nov). None of the five 940 executive positions is held yet; only the legacy `chief_executive` (mullenokaisu) is. The action is a configuration step with no code: the owner grants it to **six positions** (the five 940 executive positions plus the legacy `chief_executive` seat, held by mullenokaisu) in HQ Organisation & Appointments, and the coordinator verifies. Each identifiable read writes an `audit_log` row.
- **Dependency:** the executive positions being appointed (940) · **Environment:** production (configuration)
- **Acceptance criteria:** the capability is granted to exactly those six positions; a holder can open an identifiable answer and the audit row appears; non-holders still get 403 before any read.
- **Evidence:** PR #248; `docs/evidence/SCHOLAR-ENGAGEMENT-ANALYTICS-01/910-build-record.md`, `VERIFY-910.sql`, `walk-3nov.txt`; owner decision and production fact via the coordinator, 4 Nov.
- **Status:** Ready for release · **Blocker:** owner grants; coordinator verification pending · **Completed:** —

### GOV-02 — AI metering activation
- **Programme:** Governance · **Priority:** P1 · **Owner:** Owner
- **Deliverable:** Activate metering with initial limits.
- **Current state:** **Decided 4 Nov 2026: stay OFF during the pilot; revisit on or after 20 Nov 2026.** Metering is dark until the platform flag `ai_fair_use` (`practice_platform_flags`) is switched on; with it off the policy's routing and model eligibility still apply, fail-closed for clinical risk (`allowance.ts`). Initial limits are not yet decided.
- **Dependency:** none · **Environment:** production
- **Acceptance criteria:** on or after 20 Nov the owner decides activation and initial limits; activation verified with a before/after read.
- **Evidence:** `src/lib/ai/allowance.ts`; `docs/evidence/AI-FAIR-USE/`, `AI-CONSUMPTION/`; migration 410; owner decision via the coordinator, 4 Nov.
- **Status:** Blocked (by date) · **Blocker:** owner: activate after 20 Nov 2026 · **Completed:** —

### GOV-04 — Approver may also publish under DA-000001 (new row; decision register item)
- **Programme:** Governance · **Priority:** P2 *(proposed)* · **Owner:** Owner
- **Deliverable:** Owner ruling on whether an approver may also publish.
- **Current state:** **Decided 4 Nov 2026: keep the current state.** The 940 guard allows the approver to publish when the author differs. Observed: DA-000001 v1 was published 4 Nov 06:26Z by competenelisha, who approved it; the author is elisha.okaisu.
- **Dependency:** none · **Environment:** production
- **Acceptance criteria:** the ruling is recorded; no change to the 940 guard.
- **Evidence:** migration 940 (`docs/evidence` unified-governance record); DA-000001 v1 publication of 4 Nov 06:26Z (production read by the coordinator).
- **Status:** Complete · **Blocker:** — · **Completed:** 4 Nov 2026

### GOV-03 — Nursing audit scoring and catalogue readiness — PARALLEL, not a Learning Engine feature
- **Programme:** Governance · **Priority:** P1 · **Owner:** Clinical governance (nursing audit scoring)
- **Deliverable:** Approved nursing audit scoring and a catalogue ready for use.
- **Current state:** Built under the separately approved specification: catalogue and governed import (#255, mig 930), pathway (#258), import scoring (#260), scoring profiles for the three audit instruments (#263, merged 4 Nov). The graded profile has **no threshold configured** and its competency decision template is a **draft** until clinical governance approves it. Use that specification, not rules invented here (directive §7).
- **Dependency:** clinical-governance approval · **Environment:** staging verified; production per coordinator
- **Acceptance criteria:** per the nursing audit scoring specification (`ASMT-SCORING-INTEGRATION-01-owner-spec.md`, coordinator folder).
- **Evidence:** PRs #255, #258, #260, #263; `docs/evidence/ASMT-CATALOGUE-IMPORT-01/`, `ASMT-PATHWAY-01/`, `ASMT-IMPORT-SCORING-01/`, `ASMT-SCORING-INTEGRATION-01/` (walks A, C, G).
- **Status:** Blocked · **Blocker:** thresholds, critical items and the graded competency decision need clinical-governance approval · **Completed:** —

### REL-01 — Production package 550 — PARALLEL, legacy release
- **Programme:** Release · **Priority:** P1 · **Owner:** Owner
- **Deliverable:** Migration 550 (Professional progress and documents) in production.
- **Current state:** Owner GO given. The coordinator's read-only check (4 Nov) found production **already has 550** (all four `individual_professional_progress_*` tables present). **Nothing to apply.** Code merged (#132); file `supabase/migrations/550-individual-professional-progress-and-documents.sql`.
- **Dependency:** none · **Environment:** production
- **Acceptance criteria:** the objects are present and VERIFY-550 passes (not yet re-run).
- **Evidence:** PR #132; `docs/evidence/COMPETEN-PROFESSIONAL-PROGRESS-01/`; production check via the coordinator, 4 Nov.
- **Status:** Live — verification pending · **Blocker:** — · **Completed:** —

### REL-02 — Governance migration 610 — PARALLEL, legacy release
- **Programme:** Release · **Priority:** P1 · **Owner:** Owner
- **Deliverable:** Migration 610 in production.
- **Current state:** Owner GO given. The coordinator's read-only check (4 Nov) found production **already has 610** (`hq_gov_body`, `hq_gov_seat`, `hq_gov_seat_exclusion`, `hq_gov_seat_appointment` present). **Nothing to apply.** The repository's 610 build record still lists staging ×2 as pending and production as not applied; that record is stale.
- **Dependency:** none · **Environment:** production
- **Acceptance criteria:** objects present; VERIFY run; the build record updated to say so.
- **Evidence:** PR #152; `docs/evidence/SCHOLAR-GOV-IMPLEMENT-01/610-build-record.md`; production check via the coordinator, 4 Nov.
- **Status:** Live — verification pending · **Blocker:** — · **Completed:** —

### REL-03 — LEARNING-01 payment integration — PARALLEL, legacy release
- **Programme:** Release · **Priority:** P1 · **Owner:** Owner
- **Deliverable:** Payment test setup for LEARNING-01.
- **Current state:** Production has the `learning_*` tables (460-464 applied); the app switches `learning_app` and `learning_commerce` are OFF. Phase 2 merged (#113). **Deferred by the owner (4 Nov): revisit 18 Nov 2026.** The payment test setup will then need the owner: Flutterwave TEST keys (`FLW_SECRET_KEY`, `FLW_SECRET_HASH`) on staging, a reachable staging webhook, and 5 synthetic staging identities.
- **Dependency:** owner actions · **Environment:** staging, then production
- **Acceptance criteria:** per `docs/evidence/LEARNING-01/staging-acceptance-owner-actions.md`.
- **Evidence:** PR #113; `docs/evidence/LEARNING-01/`; production check via the coordinator, 4 Nov.
- **Status:** Blocked · **Blocker:** owner: revisit 18 Nov 2026 (then test keys, webhook, identities) · **Completed:** —

### REL-04 — Migration 430 / PR #86 — PARALLEL, on hold
- **Programme:** Release · **Priority:** P2 · **Owner:** Owner
- **Deliverable:** None until released from hold. **Keep migration 430 on hold** (directive §7).
- **Current state:** There is no migration 430 file on `main` and PR #86 is not among the merges on `main`. Nothing to build or apply.
- **Dependency:** owner · **Environment:** n/a
- **Acceptance criteria:** n/a while on hold. **Evidence:** repo search 4 Nov 2026.
- **Status:** Blocked · **Blocker:** on hold by owner directive · **Completed:** —

### OPS-01 — Preview-domain CNAME — PARALLEL
- **Programme:** Release · **Priority:** P1 · **Owner:** Owner (DNS)
- **Deliverable:** CNAME for the preview host; verify after.
- **Current state:** Scheduled 5 Nov per the directive. The Scholar preview feature (#238, mig 860) is on `main`; the DNS record is outside the repository.
- **Dependency:** owner adds the record · **Environment:** production
- **Acceptance criteria:** the preview host resolves and the preview gate works on it.
- **Evidence:** PR #238; migration 860.
- **Status:** Blocked · **Blocker:** DNS record scheduled 5 Nov · **Completed:** —

### CLOSE-01 — Register reconciliation and final closure
- **Programme:** Learning Engine · **Priority:** P0 · **Owner:** Coordinator + this session
- **Deliverable:** This tracker, the reconciled `SCHOLAR-CE-2026-REGISTER.md`, and the final closure report (§8).
- **Current state:** Tracker and CE register reconciliation delivered by this change (branch `docs/learning-close-tracker`). Final closure waits for every other row.
- **Dependency:** all rows · **Environment:** documentation
- **Acceptance criteria:** every row Complete or explicitly Blocked on an owner decision; production state reconciled; §8 items 1-7 delivered.
- **Evidence:** this file; the register; the AI-01 pack.
- **Status:** Implementing · **Blocker:** — · **Completed:** —

---

## Decision register (directive §7)

Items decided on 4 Nov 2026 are recorded as decided (they do not resurface). Migration 430 stays on hold. For audit scoring, the separately approved nursing audit scoring specification governs.

| # | Decision | Status | Outcome / what exists | Tracker row |
|---|---|---|---|---|
| D-1 | Who may access **identifiable learner names** in analytics | **Decided 4 Nov: executive level (six positions)** | Capability exists in production with no grants; owner grants it to six positions (five 940 executive positions plus the legacy chief_executive seat) in Organisation & Appointments, coordinator verifies | GOV-01 |
| D-2 | **AI metering** activation and initial limits | **Decided 4 Nov: stay OFF during the pilot; revisit on/after 20 Nov 2026** | Flag `ai_fair_use` dark; routing and eligibility apply regardless; initial limits still to be set at revisit | GOV-02 |
| D-3 | **CE-05 scenario policy** activation (learner-wide) | **Pending.** Owner asked for an explanation | Production `scholar_revision_formats` excludes scenario; scenarios were 59 % of Scholar AI cost on Opus; no clinician read recorded | CE-05 |
| D-4 | Whether an **approver may also publish** under DA-000001 | **Decided 4 Nov: keep current state** | The 940 guard allows it when the author differs; DA-000001 v1 published 4 Nov 06:26Z by competenelisha (approver), author elisha.okaisu | GOV-04 |
| D-5 | **Production package 550** release | **GO given; production already has 550** | Nothing to apply | REL-01 |
| D-6 | **Governance migration 610** release | **GO given; production already has 610** | Nothing to apply | REL-02 |
| D-7 | **LEARNING-01 payment** credentials and webhook setup | **Deferred by owner; revisit 18 Nov 2026** | 460-464 applied; switches off; needs Flutterwave TEST keys, staging webhook, 5 staging identities | REL-03 |

Decisions already taken in the directive (D01-D06) are not reopened here. Two points that may need the owner's attention when they arise: D04 says Opus stays for question generation, and the proposed package changes only flashcards (Sonnet for clinical flashcards, Haiku for standard-educational only); and D05 asks that simulation conversations are deleted with the attempt "subject to retention requirements", for which no retention rule is recorded (CE-04D).

## Appendix A — production facts needed (read-only, via the coordinator)

File: `LEARNING-CLOSE-2026-11-prod-readonly-queries.sql` in the coordinator folder (Q1-Q6; Q7 pending a table name). Results are recorded here as "Production facts" when received; until then every "production not read" cell above stands.

## Production facts (recorded as received)

Reported by the coordinator after read-only checks, 4 Nov 2026 (not the Q1-Q6 result rows; those are still to come):
- Capability `hq.scholar.analytics.identifiable.read` exists in production with no grants; none of the five 940 executive positions is held; only the legacy `chief_executive` (mullenokaisu) is.
- Production has 550 (four `individual_professional_progress_*` tables) and 610 (`hq_gov_body`, `hq_gov_seat`, `hq_gov_seat_exclusion`, `hq_gov_seat_appointment`).
- Production has the `learning_*` tables (460-464); `learning_app` and `learning_commerce` are OFF.
- Production `scholar_revision_formats` excludes "scenario".
- DA-000001 v1 published 4 Nov 06:26Z by competenelisha (approver); author elisha.okaisu.
- Still unread: migration 880 and the conversation switch (CE-04A/D), the flashcards AI package (AI-02), the `ai_fair_use` flag value.

## Change log

| Date | Change |
|---|---|
| 4 Nov 2026 | Created from directive §4 and the repository at `e19a363a`; rows added: CE-01-1..3, CE-02-1..2, CE-03, CE-06A-1, LE-05, AI-04, AI-05; no row Complete |
| 4 Nov 2026 | Coordinator inputs: GOV-01 decided executive level (Ready for release); GOV-02 stays off until 20 Nov (Blocked by date); GOV-04 added and Complete; REL-01 and REL-02 Live — verification pending (production already has 550 and 610); REL-03 owner actions; CE-05 activation pending; decision register updated; production facts recorded. GOV-04 is the only Complete row. Later 4 Nov: REL-03 deferred to 18 Nov; GOV-01 grant is to six positions (five 940 executive positions plus chief_executive), Ready for release until the coordinator verifies |
