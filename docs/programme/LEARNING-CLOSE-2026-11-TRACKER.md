# LEARNING-CLOSE-2026-11 — the one authoritative tracker (CLOSE-01)

**Authority:** owner directive LEARNING-CLOSE-2026-11, 4 Nov 2026 (§4: "one authoritative tracker"). This file is it. The CE-01..CE-07 register (`SCHOLAR-CE-2026-REGISTER.md`) holds the narrative per workstream and points here for status. Nothing is duplicated in a second tracker.
**Created:** 4 Nov 2026 by CLOSE-01 against `main` @ `e19a363a` (PR #263). **Production state given by the coordinator at creation:** app `e19a363a`, DB head 942. **Since the 4 Nov releases:** app `09d9da09` (rollback `6d76cdda`), DB includes 950, 955 and 960.
**Refreshed 7 Nov 2026 against `main` @ `6264ec8f`** (live app `6264ec8f`, deployed 06:21 EAT, rollback `03929239`; the step 9 readiness table is `RELEASE-READINESS-2026-11-07.md`). Merged 6-7 Nov and live with every new switch off: #324 Go Deeper, #330 Guide Me, #332 My Notebook, #339 notes in teaching, #331 research-grounded teaching phase 1, #334 local time zones, #333/#336/#337/#338 slide rendering, #335 Challenge me / Ask me fix. Migrations 1000, 1001 and 1010 are **not applied in production**. #327 and #323 are not merged. Earlier refresh follows: **Refreshed 6 Nov 2026 against `main` @ `8a577bb3`** (production app `8a577bb3`, deployment `dpl_8vVcMJBDSQKdJSTF1iEtfWuE6crm`, rollback `dc10b205`; live commit equals `main`). Code facts were read from `main`, remote branches and `docs/evidence/*`. **Production switches (HQ policy keys, flags) and production migrations are BY RECORD (coordinator and memory records, 6 Nov), not read from production**, unless a line holds a read-only result and its date (the 4 Nov Q1-Q6 results below are kept as read). Read-only confirmation script: `PROD-CHECK-trackers-6nov.sql` (coordinator folder). Governing instruction since 6 Nov: "Coordinated Learning Experience Completion" (D-18). LifeOS (migrations 901-906 on `main`) is not part of this tracker: its code is off, its migrations are not applied in production, and it is kept out of the Scholar release. **No row is Complete: no signed-in production walk of the recent releases has been done.**
**Rule (directive §1 and §4):** a row is **Complete** only when it is implemented, integrated, available in its intended environment, governed, tested against its acceptance criteria and accurately recorded here. **Merged is not Complete.** At creation **no row is Complete**.

**Status values (exact):** Not started · Implementing · Ready for review · Blocked · Ready for release · Live — verification pending · Complete.
**Programme values:** Learning Engine · CE · AI · Governance · Release.
**Priority:** P0 / P1 / P2 as the directive set them; rows added by this tracker carry a proposed priority marked *(proposed)*.

## How this was filled, and what is not verified

- Current state, evidence and acceptance criteria come from the repository at the head above: `git log`, `docs/programme/*`, `docs/evidence/*`, `src/**` and `supabase/migrations/**`. Where a statement rests on code, the file is named. Where the repository cannot show production, the cell says what was read or **"not read"**; Q1-Q6 were read on 4 Nov and are recorded under "Production facts"; Q7 was not run (a read-only query is queued (appendix A, file `LEARNING-CLOSE-2026-11-prod-readonly-queries.sql` in the coordinator folder).
- Rows owned by parallel sessions (CYU-01..04 by session local_edea2037; LE-01..05 by local_0272e81f; CE-07 slow-network by a session starting 4 Nov) carry the status the coordinator reported at creation. This tracker does not verify their in-flight work. They are updated only when the coordinator sends a status change.
- **GOV-03, REL-01..04 and OPS-01 are parallel commitments, not Learning Engine features** (directive §4, closing paragraph). They stay visible here as dependencies and are marked **PARALLEL**. They must not count toward "unfinished Learning Engine".
- "Merged, not deployed" is not one of the owner's status values. A row whose code is merged to `main` but not yet deployed (and whose migration is not yet in production) is recorded as **Ready for release**, with the exact state in its Current state.
- The directive's initial statuses ("Gap confirmed", "Awaiting review", "Decision pending", "Partially delivered", "Awaiting owner GO") are not in its own status vocabulary. They are mapped below; every mapping that differs from the directive's wording is explained in the reconciliation table.

## Summary

| ID | Programme | Priority | Owner | Status | Blocker | Completed |
|---|---|---|---|---|---|---|
| CYU-01 | Learning Engine | P0 | CYU session (PR #265, merged) | Live — verification pending | Production walk by a learner not yet done | — |
| CYU-02 | Learning Engine | P0 | CYU session (PR #265, merged) | Live — verification pending | Production walk by a learner not yet done; CYU-02 scope: other question kinds not yet offered inside a lesson | — |
| CYU-03 | Learning Engine | P0 | CYU session (PR #265, merged) | Live — verification pending | Production walk by a learner not yet done | — |
| CYU-04 | Learning Engine | P1 | CYU session (PR #265, merged) | Live — verification pending | Production walk by a learner not yet done | — |
| CE-01 | CE | P1 | Engineering (CE) | Live — verification pending | Open children CE-01-1..3 | — |
| CE-01-1 | CE | P2 *(proposed)* | Engineering (CE) | Not started | — | — |
| CE-01-2 | CE | P1 *(proposed)* | Engineering (CE) | Not started | — | — |
| CE-01-3 | CE | P2 *(proposed)* | Engineering (CE) | Not started | — | — |
| CE-02 | CE | P1 | Engineering (CE) | Live — verification pending | Open children CE-02-1..2 | — |
| CE-02-1 | CE | P2 *(proposed)* | Engineering (CE) + My Notebook session | Ready for release | PR #332 merged 7 Nov 00:39 EAT and live in `6264ec8f`, key `scholar_personal_notebook` off. Migration 1001 adds the topic target; **1000 and 1001 are not applied in production**: the owner applies them, then a separate GO to switch on | — |
| CE-02-2 | CE | P1 *(proposed)* | Engineering (CE) + My Notebook session | Ready for release | Walked on staging (`docs/evidence/COMPETEN-NOTEBOOK-001/`, now on `main`) and in the 7 Nov integrated journey (notes, search, link, unlink, offline retry all pass). Production part still to do after 1000 and 1001 | — |
| CE-03 | CE | P1 *(proposed)* | Engineering (CE) | Live — verification pending | Production signed-in walk | — |
| CE-04A | CE | P0 | CE-04/05 session (PR #275) | Blocked | Patient voice stays off (D-11): a case author supplies the patient script and an independent clinician approves the complete case and permitted responses | — |
| CE-04B | CE | P1 | CE-04/05 session (PR #275, merged) | Live — verification pending | Production walk not done; no production case is known to define a handover (Q7 not run) | — |
| CE-04C | CE | P1 | CE-04/05 session (PR #275, merged) | Live — verification pending | Code live, key `scholar_case_deterioration` off (code default; no switch-on recorded); a clinically approved timeline is needed before use | — |
| CE-04D | CE | P0 | CE-04/05 session (PR #275, merged) | Live — verification pending | Code live, `scholar_case_attempt_delete` off; retention decided (D-13): learner deletion enabled once the implementation is verified. The 5 Nov attempt-deletion and retention note is with the owner | — |
| CE-05 | CE | P0 | CE-04/05 session (PR #275) + clinical reviewer | Ready for review | Scenarios stay off (D-3, D-14 decided): about ten generated scenarios need independent clinical review first. The pack (10 scenarios) is unreviewed and waits for the owner to name an independent clinician. #318 variety and #327 button do not reach learners until `scholar_revision_formats` includes scenario | — |
| CE-06A | CE | P1 | Engineering (CE) | Live — verification pending | — | — |
| CE-06A-1 | CE | P1 *(proposed)* | Engineering (CE) | Not started | — | — |
| CE-06B | CE | P1 | Engineering (CE) | Not started | — | — |
| CE-07A | CE | P1 | CE-07 session | Not started | — | — |
| CE-07B | CE | P1 | CE-07 session | Not started | — | — |
| CE-07C | CE | P0 | CE-07 session (PR #267, merged) | Live — verification pending | Wave 4 real-device test; learner-level production upload walk | — |
| LE-01 | Learning Engine | P1 | LE session (PR #266, merged) | Live — verification pending | Production walk by a learner not yet done | — |
| LE-02 | Learning Engine | P1 | LE session (PR #266, merged) | Live — verification pending | Production walk by a learner not yet done | — |
| LE-03 | Learning Engine | P1 | LE session (PR #266, merged) | Live — verification pending | Production walk by a learner not yet done | — |
| LE-04 | Learning Engine | P1 | LE session (PR #266, merged) | Live — verification pending | Production walk by a learner not yet done | — |
| LE-05 | Learning Engine | P1 *(proposed)* | LE session (PR #266, merged) | Live — verification pending | Production walk by a learner not yet done | — |
| AI-01 | AI | P0 | Independent clinical reviewer | Complete | Signed 4 Nov 2026: Okaisu Mullen, the clinical reviewer the owner confirmed on 4 Nov (HQ appointment clinical_content_reviewer), all cards Safe, package approved, Haiku not eligible for clinical-educational. The owner passed the sign-off to the coordinator and then applied AI-02. | 4 Nov 2026 |
| AI-02 | AI | P0 | Coordinator (config) | Live — verification pending | Applied by the owner 4 Nov ~20:35 (by record). 24 h check 5 Nov 20:30 unread by the owner; 7-day check 7 Nov 20:30 | — |
| AI-03 | AI | P1 | Coordinator (read-only runs) | Implementing | Monitoring window running since 4 Nov ~20:35; report after the 7-day check | — |
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
| OPS-01 **PARALLEL** | Release | P1 | Owner (DNS) | Blocked | Owner adds the preview CNAME; scheduled 5 Nov, still open on 6 Nov (by record) | — |
| CLOSE-01 | Learning Engine | P0 | Coordinator + this session | Implementing | Refreshed 6 Nov; final closure waits for learner-level walks | — |

## Reconciliation against directive §4

Where the verified repository state differs from the directive's initial table, the difference is listed so nothing is silently re-graded.

| Row | Directive said | Verified | Why |
|---|---|---|---|
| CE-04A | Gap confirmed | Built and merged (#237), switched off; Wave 2 verification in PR #275 | `scholar_case_conversation` default off; "Talk to the patient" server loop, caps, grounding and tests exist |
| CE-04B | Gap confirmed | Built and merged (#237) | SBAR handover task and SBAR OSCE template; no migration |
| CE-04C | Gap confirmed | **Confirmed gap** | No deterioration clock/timeline in `src/lib/cases/*` or `case-talk.ts` |
| CE-04D | Gap confirmed — verify | Built (mig 880, #237); **880 applied in production, 0 rows** (read 4 Nov) | Append-only table, cascade delete with the attempt, erase-all, copied into the 810 attempt snapshot |
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
- **Current state:** **MERGED to `main` as e367920 on 4 Nov (owner GO); **DEPLOYED 4 Nov 2026** (app `6d76cdda`, `dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`; rollback `e19a363a`; smoke: home 200, scholar 307, learn/checks 401 so the new route is present) and **migration 950 applied in production by the owner, strict VERIFY passed, coordinator read-only check confirms**. Built in PR #265 (branch `scholar/cyu-wave1-01`, head 02ec0efa; commits 2037ac45, 02ec0efa), reported by the coordinator 4 Nov. Staging walk evidence in the coordinator folder `LEARNING-CLOSE-WS01-CYU/` (`walk-run.log`, `shots/`): 0 console errors, 0 5xx, every check PASS.** Checks are distributed through the lesson (first check after the teaching and before the key points, a second after the lesson, the mid-lesson check labelled optional). New policy key `scholar_learn_check_placement` (default `distributed`). Earlier state: Increment 1 only: the Check my answer panel always answers beneath the learner's answer (7908ca24, merged in #252). Inline checks exist as policy-placed recall/quick checks (#221, `learn-inline.ts`, `scholar_learn_inline_*`); the engine writes at most two check questions per Teach me answer. Placement across a lesson's units is increment 3 of the series and is not on `main`. In build by the CYU session (coordinator report; no PR yet).
- **Dependency:** none · **Environment:** production (deployed 4 Nov)
- **Acceptance criteria:** A proportionate number of checks per lesson by length, objectives and complexity; never one per slide; optional; no excessive interruption; answers survive refresh (directive §6.1, §6.2).
- **Evidence:** `docs/programme/SCHOLAR-UNDERSTANDING-CHECKS-01.md`; PR #252; PR #221; `learn-check.test.ts`. Walk: CYU-01 order and optional-label checks PASS. PR #265.
- **Status:** Live — verification pending · **Blocker:** Production walk by a learner not yet done (learner-level acceptance walk in production) · **Completed:** —

### CYU-02 — Existing question types integrated
- **Programme:** Learning Engine · **Priority:** P0 · **Owner:** CYU session
- **Deliverable:** Checks reuse the governed question and assessment infrastructure, including formats beyond four-option MCQ, with format-specific scoring and feedback. No second question engine.
- **Current state:** **MERGED to `main` as e367920 on 4 Nov (owner GO); **DEPLOYED 4 Nov 2026** (app `6d76cdda`, `dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`; rollback `e19a363a`; smoke: home 200, scholar 307, learn/checks 401 so the new route is present) and **migration 950 applied in production by the owner, strict VERIFY passed, coordinator read-only check confirms**. Built in PR #265 (branch `scholar/cyu-wave1-01`, head 02ec0efa; commits 2037ac45, 02ec0efa), reported by the coordinator 4 Nov. Staging walk evidence in the coordinator folder `LEARNING-CLOSE-WS01-CYU/` (`walk-run.log`, `shots/`): 0 console errors, 0 5xx, every check PASS.** Checks reuse the existing marking path. **Scope note:** other question kinds are not yet offered inside a lesson, so the acceptance criterion "formats beyond MCQ" is only partly met in this PR. Earlier state: The format registry is a single source (`question-formats.ts`, #236); marking exists for mcq, mrq, match, sequence, true/false, cloze, short, structured, extended and scenario. Learn's check path today is free-text Check my answer plus MCQ practice (`learn-practice.tsx`). Not yet wired to the registry (CYU series increment 4). In build.
- **Dependency:** CYU-01 · **Environment:** production (deployed 4 Nov)
- **Acceptance criteria:** Short answer, explanation, application, clinical judgement and MCQ checks use existing marking, rubric snapshots and "marked against" provenance; no duplicated engine.
- **Evidence:** `question-formats.ts`; PR #236; `docs/programme/SCHOLAR-UNDERSTANDING-CHECKS-01.md` "Next increments" item 4. PR #265; scope note from the coordinator.
- **Status:** Live — verification pending · **Blocker:** Production walk by a learner not yet done (learner-level acceptance walk in production) · **Completed:** —

### CYU-03 — Responses and feedback persisted
- **Programme:** Learning Engine · **Priority:** P0 · **Owner:** CYU session
- **Deliverable:** Store question and version ids, the learner's response (free text included), feedback and explanation, outcome, lesson/section/session/competency references, attempt timestamps and history, AI model and generation metadata (decision D01). Learner-owned record with access control, deletion, retention and interrupted-session recovery. Formative only; never establishes verified competence.
- **Current state:** **MERGED to `main` as e367920 on 4 Nov (owner GO); **DEPLOYED 4 Nov 2026** (app `6d76cdda`, `dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`; rollback `e19a363a`; smoke: home 200, scholar 307, learn/checks 401 so the new route is present) and **migration 950 applied in production by the owner, strict VERIFY passed, coordinator read-only check confirms**. Built in PR #265 (branch `scholar/cyu-wave1-01`, head 02ec0efa; commits 2037ac45, 02ec0efa), reported by the coordinator 4 Nov. Staging walk evidence in the coordinator folder `LEARNING-CLOSE-WS01-CYU/` (`walk-run.log`, `shots/`): 0 console errors, 0 5xx, every check PASS.** Check answers (free text included) and their judgement are kept on the existing 416 attempts through migration 950 (applied and verified on staging; **production needs the owner's GO**); shown again after a reload as "Your previous checks" with outcome, how it was marked and the feedback parts; a self-review path keeps a self-graded answer with no AI. Earlier state: Learn today stores nothing the learner types (stated in the checks doc); the `clarify` learning event records only an informal verdict. The existing place for a written answer and its marking is the revision attempt table (416: `response`, `marking`, `evaluator_*`) plus the 791 attempt snapshots. D01 is approved; storage is not built on `main`.
- **Dependency:** D01 (approved). A new migration, if needed, follows the CLAUDE.md four-state path; production application needs a separate owner GO.
- **Environment:** production (deployed 4 Nov)
- **Acceptance criteria:** Answers and feedback survive refresh, logout and device change (§6.2); attempts remain distinguishable; deletion and retention work; erase-all covers them; no employer-controlled copy (D01).
- **Evidence:** `docs/programme/SCHOLAR-UNDERSTANDING-CHECKS-01.md`; migration 416, 791 files. Migration 950 (staging-verified). Walk: kept answer, outcome and feedback parts survive reload PASS.
- **Status:** Live — verification pending · **Blocker:** Production walk by a learner not yet done (learner-level acceptance walk in production) · **Completed:** —

### CYU-04 — Session, progress and competency integration
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** CYU session
- **Deliverable:** Results connect to the study session, My Plan and progress, the Library/Notebook, competency evidence views, and Personal AI session context within existing permissions; repeated attempts stay distinguishable.
- **Current state:** **MERGED to `main` as e367920 on 4 Nov (owner GO); **DEPLOYED 4 Nov 2026** (app `6d76cdda`, `dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`; rollback `e19a363a`; smoke: home 200, scholar 307, learn/checks 401 so the new route is present) and **migration 950 applied in production by the owner, strict VERIFY passed, coordinator read-only check confirms**. Built in PR #265 (branch `scholar/cyu-wave1-01`, head 02ec0efa; commits 2037ac45, 02ec0efa), reported by the coordinator 4 Nov. Staging walk evidence in the coordinator folder `LEARNING-CLOSE-WS01-CYU/` (`walk-run.log`, `shots/`): 0 console errors, 0 5xx, every check PASS.** Repeated attempts are listed and distinguishable; Try again from the history reopens the check with the answer; Saved learning lists the kept checks; the history fits a 309px viewport. Results are not yet verified against My Plan, competency evidence views or Personal AI context beyond Saved learning. Earlier state: The study-session context block already reads `not_yet` check verdicts (`study-context.ts`); My Plan treats a lesson read/opened/taught as started (#254, `scholar_plan_started_signal`). Nothing reads a stored check response yet because none is stored (CYU-03).
- **Dependency:** CYU-03 · **Environment:** production (deployed 4 Nov)
- **Acceptance criteria:** §6.1 a learner moves between activities without losing session context; results appear in My Plan, Library and the Personal AI context block; accepted mappings are evidence, never competence.
- **Evidence:** PR #254; `study-context.ts`. Walk: both attempts listed and distinguishable, Saved learning lists the kept checks, mobile fit PASS.
- **Status:** Live — verification pending · **Blocker:** Production walk by a learner not yet done (learner-level acceptance walk in production) · **Completed:** —

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
- **Evidence:** `docs/evidence/COMPETEN-NOTEBOOK-001/walk/` on the branch: search, material filter, library note create, edit and remove, item actions, no sideways scroll at desktop, tablet and phone width, fixture learner on staging. · **Status:** Walked on staging · **Blocker:** owner GO, then the production part · **Completed:** —

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
- **6 Nov refresh:** the schema decision is made: the owner's 6 Nov "Coordinated Learning Experience Completion" (D-18) permits topic-linked and free-standing notes. Branch `scholar/notebook-001` (head `12cdf0c5`, pushed, no PR) widens the 820 note table in migration 1000 (free-standing notes, long-form body, title, tags, pin, autosave key and revision, section label and anchor, competency and session hints, a note outlives its source, search). Migration 1000 applied twice on staging 6 Nov 12:02Z (sha256 `a5453ef6...e2b3`), not in production, not merged. Key `scholar_personal_notebook`, default off. The branch has no column that targets a topic by itself, so "a note can target a topic" is only partly met (section and competency hints, tags). The coordinator note says migration 1001 is reserved: the branch uses 1000.
- **Evidence:** register CE-02 decision (2); `supabase/migrations/820-*`; `docs/evidence/COMPETEN-NOTEBOOK-001/` on the branch. · **Status:** Built on branch · **Blocker:** PR, CI and owner GO; migrations 1000 then 1001 need their own production GO. A note can now target a topic through migration 1001, staging only. Create, edit, remove, filter and export are in the walk; erase-all removes it with the rest of the note table · **Completed:** —

### CE-02-2 — CE-02 acceptance walk (desktop and phone)
- **Programme:** CE · **Priority:** P1 *(proposed)* · **Owner:** Engineering (CE)
- **Deliverable:** A recorded walk of search, filters, notes create/edit/remove and item actions on desktop and a phone-width viewport.
- **Current state:** Walked on staging by COMPETEN-NOTEBOOK-001. It found one touch target under 44px, in library search, fixed on the branch. Production part not done.
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
- **Programme:** CE · **Priority:** P0 · **Owner:** CE-04/05 session (PR #275)
- **Deliverable:** Genuine multi-turn simulated-patient interaction; patient replies reflect clinical context; correct answer not exposed early.
- **Current state:** **Wave 2 update (4 Nov): conversation verified end to end on staging in PR #275 (branch `scholar/ce04-05-wave2`, head 7f661319, open), reported by the coordinator 4 Nov. **No migration; every new behaviour sits behind keys that default to off.** Includes a learner debrief review behind key `scholar_case_debrief_review` (off). The conversation switch stays off and unused in production (migration 880 applied, 0 rows).** Earlier state: Built and merged (#237, 2 Nov): "Talk to the patient" (text) with a server loop that answers only from what the case says the person knows at that stage, a grounding filter that keeps future findings out, a per-stage turn cap (`scholar_case_conversation_turns`, default 20), a labelled simulated conversation, unavailable/cap states as notices; authored through Case Studio (voice persona, style, knowledge, key questions) and approved with the blueprint hash. **Switched off by default** (`scholar_case_conversation` = off) and needs migration 880. Production (read 4 Nov): **migration 880 is applied**; no policy row exists for the switch or the turn cap, so the code default (OFF, 20 turns) applies; **0 turns and 0 sessions** exist, so the conversation has never been used in production. Voice is text only; there is no spoken exchange (see CE-06B).
- **Dependency:** a clinically approved case version that defines a patient voice; the HQ switch. · **Environment:** staging verified (PR #275 open); production: 880 applied, switches off, unused
- **Acceptance criteria:** directive §6.4 turn order preserved and no leakage of future scenario information; replies grounded in the stage; per-stage cap; works the same when off or AI unavailable; learner's AI allowance applies; clinical review and approval kept.
- **Evidence:** PR #237; `docs/evidence/CASE-CONVERSATION/880-build-record.md`; `case-talk.ts`, `src/lib/cases/{conversation,voice,handover}.ts`; tests `ce04.test.ts`, `case-talk.test.ts`, `case-conversation-scope.test.ts`; policy keys in `policy.ts`. PR #275.
- **Status:** Blocked · **Blocker:** case author's patient script and an independent clinician's approval of the complete case and permitted responses; then the owner switches `scholar_case_conversation` on · **Completed:** —

### CE-04B — Handover tasks
- **Programme:** CE · **Priority:** P1 · **Owner:** Engineering (CE)
- **Deliverable:** Structured handover (SBAR) tasks.
- **Current state:** **Wave 2 update (4 Nov): handover verified on staging in PR #275 (branch `scholar/ce04-05-wave2`, head 7f661319, open), reported by the coordinator 4 Nov. **No migration; every new behaviour sits behind keys that default to off.**** Earlier state: Built and merged (#237): SBAR handover boxes in case play, handover marking kept as a written answer (no migration), a handover rubric snapshot in the kept attempt, an SBAR OSCE template, Case Studio handover authoring and review display. Appears wherever a case version defines a handover; no HQ switch gates it. Whether any production case defines one: not read.
- **Dependency:** a published case with a handover spec · **Environment:** staging verified (PR #275 open)
- **Acceptance criteria:** learner completes and receives marked feedback; the answer is part of the attempt record; correct handover not shown beforehand.
- **Evidence:** PR #237; `src/lib/cases/handover.ts`; `ce04.test.ts`; build record 880 ("SBAR handover task needs no migration"). PR #275.
- **Status:** Live — verification pending (6 Nov: PR #275 merged 4 Nov 17:35 and deployed in `6e679c29`) · **Blocker:** Production walk not done · **Completed:** —

### CE-04C — Deterioration clock
- **Programme:** CE · **Priority:** P1 · **Owner:** Engineering (CE)
- **Deliverable:** A configurable deterioration timeline as a governed simulation mechanism, not an uncontrolled clinical decision system.
- **Current state:** **Wave 2 update (4 Nov): the deterioration timeline is built in PR #275 (branch `scholar/ce04-05-wave2`, head 7f661319, open), reported by the coordinator 4 Nov. **No migration; every new behaviour sits behind keys that default to off.** Key `scholar_case_deterioration` is off. Staging walk 25/25 (a late action at minute 44 is flagged LATE). Governed simulation mechanism, off by default.** Earlier state: **Confirmed gap.** Deterioration in cases is branching only (blueprint stages and branching progression); there is no clock, timeline or timed-event construct in `src/lib/cases/blueprint.ts`, `conversation.ts`, `voice.ts` or `case-talk.ts` (`conversation.ts` states it "has no clock").
- **Dependency:** CE-04A; clinical approval of timeline content through the existing case approval (422) · **Environment:** staging verified (PR #275 open); production off
- **Acceptance criteria:** timeline authored per case version in Case Studio and approved with the version; progression server-controlled; no premature reveal; clock labelled as simulation; works with the conversation cap and debrief.
- **Evidence:** repo search 4 Nov 2026; register CE-04 gaps. PR #275 (staging walk 25/25).
- **Status:** Live — verification pending (6 Nov: PR #275 merged and deployed; key off) · **Blocker:** the key stays off until a clinically approved timeline exists · **Completed:** —

### CE-04D — Attempt-linked conversation storage
- **Programme:** CE · **Priority:** P0 · **Owner:** Engineering (CE)
- **Deliverable:** Turns kept with the learner's individual simulation attempt; available for debrief; deleted with the attempt; not Personal AI memory (decision D05).
- **Current state:** **Wave 2 update (4 Nov): delete-attempt is built in PR #275 (branch `scholar/ce04-05-wave2`, head 7f661319, open), reported by the coordinator 4 Nov. **No migration; every new behaviour sits behind keys that default to off.** Key `scholar_case_attempt_delete` is off. The D05 retention rule is still the owner's decision.** Earlier state: Built (mig 880): one append-only table `individual_scholar_case_conversation` (turn / communication note / handover note), RLS read-own, update refused, delete only by cascade, bounded 400 turns per session; copied into the 810 attempt snapshot at completion; `…_erase(p_user)` so Settings "erase all my study material" removes library-play conversations; owner ruling ADR-016 "D10 exception" (turns are assessment evidence of one case attempt, not Personal AI memory), pinned by `case-conversation-scope.test.ts`. Retention period: not configured in the repository (D05 "subject to applicable retention requirements" is open). Production (read 4 Nov): table, erase function and guard function all present (880 applied); 0 rows.
- **Dependency:** CE-04A (turns appear only once the switch is on) · **Environment:** staging verified (PR #275 open); production off
- **Acceptance criteria:** turns survive refresh; deleted attempt removes its turns; erase-all removes library-play turns; no turn reaches Personal AI memory or unrelated answers; a retention rule is recorded.
- **Evidence:** PR #237; `supabase/migrations/880-individual-scholar-case-conversation.sql` (sha256 `df966c11…2450f` at staging); `docs/evidence/CASE-CONVERSATION/880-build-record.md`; `docs/adr/ADR-016-individual-product-gate.md`. PR #275.
- **Status:** Live — verification pending (6 Nov: PR #275 merged and deployed; key off) · **Blocker:** verification of the delete implementation, then the owner enables `scholar_case_attempt_delete` · **Completed:** —

### CE-05 — Clinical scenario quality and policy activation
- **Programme:** CE · **Priority:** P0 · **Owner:** Engineering (CE) with a clinical reviewer
- **Deliverable:** Existing scenarios meet clinical content requirements; no answer leakage; no "student notes" framing; unfolding information; server-controlled progression; scenario policy confirmed before learner-wide activation.
- **Current state:** **Wave 2 update (4 Nov): verified on staging with no code change, reported with PR #275 (branch `scholar/ce04-05-wave2`, head 7f661319, open), reported by the coordinator 4 Nov. **No migration; every new behaviour sits behind keys that default to off.** The D-3 activation decision is still pending.** Earlier state: Delivered in #236 (2 Nov) and tuned in later commits: one format registry; evolving scenario stored as `short` with `answer.format = 'scenario'` (no migration); stage-by-stage route where each later stage is sent only after a valid answer, with an HMAC progress token over learner, question, marking guide and results (`scenario.ts`); per-stage marking and snapshots; "marked against" line on every format; scenario-v3 prompt (a decision about this person at every stage, 2-4 stages, cited, nothing invented); validation refuses leakage of a later answer into an earlier stage, "notes/passage/learner/revising" framing, uncited or unsupported findings and figures (`scenario-quality.test.ts`); a stored scenario is re-held to today's rules before it is offered. **Not active for learners:** `scholar_revision_formats` code default excludes scenario ("OFF by default", owner cost decision 3 Nov), production excludes it (coordinator). The `scenarios` AI activity (Opus, falls back to `questions`) is in code (#259). No clinician read of generated scenarios is recorded in the repository. Production `scholar_revision_formats` (published 3 Nov 10:05Z) enables mcq, mrq, short, flashcard, match, sequence, structured, cloze, true_false and extended, and excludes "scenario" (coordinator read, 4 Nov). Note that extended response, off by code default, is enabled in production. The owner has asked for an explanation of the activation choice; the decision is still pending.
- **Dependency:** owner decision D-3; clinician read of a sample of generated scenarios · **Environment:** production (code, format off)
- **Acceptance criteria:** clinician confirms a sample has accurate clinical content, no leakage, patient-centred framing; progression cannot be skipped from the browser; the policy decision is recorded.
- **Evidence:** PR #236; `scenario.ts`, `scenario-service.ts`, `scenario-quality.test.ts`, `scenario-sessions-wiring.test.ts`; `docs/evidence/SCHOLAR-INDEPENDENT/p3-cost.md` (scenarios 59 % of Scholar AI cost); policy `scholar_revision_formats` in `policy.ts`. PR #275 staging verification.
- **6 Nov refresh:** scenario variety merged as #318 (6 Nov 17:27, deployed `a1eb16a7`): a decision focus that moves with how many scenarios the scope already holds, other scenarios passed as data, no model calls added, no key, no migration. Per its own evidence the live planner does not write a second scenario on the same section unprompted. A second scenario at the learner's request is permitted by the owner (6 Nov, D-18) and is open PR #327 (`scholar/another-scenario-01`, head `c354da03`, CI 8/8 reported). User-initiated extra scenarios are permitted (D-18) under the existing controls. **None of this reaches learners while `scholar_revision_formats` excludes scenario** (code default off via the format registry; production excluded it at the 3 Nov publication read on 4 Nov, not re-read). The ten-scenario pack and its pass rule (confirmed 5 Nov) wait for an independent clinician.
- **Status:** Ready for review · **Blocker:** independent clinical review of about ten representative generated scenarios (leakage, accuracy, scoring); then the owner enables the format · **Completed:** —

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
- **Scope notes for Wave 3 (from the #267 body):** range/streamed delivery of originals (signed download URLs already support `Range`); lazy-loaded Learn/Flashcards client bundles with a bundle budget; compressed slide images (the `slides`/`visuals` routes); `ETag`/`Cache-Control` on saved-lesson and reader JSON; a download progress line reusing the upload wording.
- **Dependency:** none · **Environment:** development
- **Acceptance criteria:** measured payload reduction on representative constrained network conditions; no repeated fetch of unchanged material.
- **Evidence:** repo search 4 Nov 2026; register CE-07. · **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-07B — Data-saver mode
- **Programme:** CE · **Priority:** P1 · **Owner:** CE-07 session
- **Deliverable:** A data-saver mode honoured across Scholar.
- **Current state:** **Confirmed gap.** No `saveData`, `navigator.connection`, `effectiveType` or data-saver handling in `src/` (the only `effectiveTypes` match is unrelated, Practice).
- **Scope notes for Wave 3 (from the #267 body):** a learner setting (policy-gated default) read from `navigator.connection.saveData` / `effectiveType` (which `chunkForConnection()` in the new upload code already reads); skip images and visuals, prefer text, defer prefetch, keep upload chunks at 1 MB; no migration expected unless the policy needs one.
- **Dependency:** CE-07A · **Environment:** development
- **Acceptance criteria:** learner-visible setting; defers images/visuals and heavy panels; text-first lessons keep working.
- **Evidence:** repo search 4 Nov 2026. · **Status:** Not started · **Blocker:** — · **Completed:** —

### CE-07C — Slow-network upload reliability
- **Programme:** CE · **Priority:** P0 · **Owner:** CE-07 session
- **Deliverable:** Reliable uploads on slow networks, interrupted-upload recovery, transparent upload progress.
- **Current state:** **MERGED to `main` as 09d9da09 on 4 Nov (owner GO) and DEPLOYED the same day (app `09d9da09`, `dpl_F1Pho3Kn5xZtXL9qpRRkFkYPsvYn`, rollback `6d76cdda`; smoke: home 200, scholar 307, uploads route 405 to a GET so it is present). Migration 960 applied in production by the owner, VERIFY-960 PASS, coordinator read-only check: table present, RLS on, 0 policies, 4 checks, 3 indexes, 0 rows. Built in PR #267 (branch `scholar/ce07-upload`, head ff25ce0d, later cafd5637 with CI 8/8 green), reported by the coordinator 4 Nov:** resumable uploads (TUS through the existing signed-upload token, path-bound), retry and offline-pause with backoff, one file/one upload identity (sha256, duplicate refused before any byte is sent, resume after a closed tab), idempotent finish with extraction once (this also fixes a defect where a retried or concurrent finish could delete the object a kept material points at), integrity check before extraction, cancel and clean-up, and an `UploadPanel` with per-file progress, phases and an unfinished-uploads banner. Migration 960 (`individual_scholar_upload`, applied and verified on staging twice, **not in production**) adds the concurrent-finish claim and an hourly sweep; without 960 production still gets resumable bytes, integrity, the idempotent finish and per-learner clean-up. Staging walk 40/40 under emulated slow 3G and offline (10.2 MB deck). **Not covered:** a real phone on a real mobile network (Wave 4 should repeat run A on a device); the no-960 path was not walked against a database; Professional evidence uploads were not changed. Earlier state: **Confirmed gap.** Upload is a single-shot `uploadToSignedUrl` to a one-time signed URL for a server-chosen path (`study/_components/client.tsx:242`; `store.ts` `createSignedUploadUrl`); no progress events, no chunking, no resume. Session starting 4 Nov per coordinator.
- **Dependency:** none · **Environment:** production (deployed 4 Nov, 960 applied)
- **Acceptance criteria:** §6.5 interrupted uploads recover safely with no duplicate or corrupted material; progress shown; tested on constrained conditions.
- **Evidence:** PR #267; `docs/evidence/SCHOLAR-CE07/` on that branch (`960-build-record.md`, sha256 `232c4e94…a917`, `ROLLBACK-960.sql`, staging walk A-G screenshots and scripts); 31 new Vitest tests; `scripts/ci-harnesses.ts` ALL GREEN (68/68); `client.tsx`, `store.ts`, `uploads/route.ts` as before.
- **Status:** Live — verification pending · **Blocker:** the Wave 4 real-device test on a real mobile network; a learner-level production upload walk · **Completed:** —

### LE-01 — Consistent AI-off wording
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** LE session (local_0272e81f)
- **Deliverable:** One AI-unavailable experience for Scholar and Professional (D06).
- **Current state:** **MERGED to `main` as 6d76cdda on 4 Nov (owner GO); **DEPLOYED 4 Nov 2026** (app `6d76cdda`, `dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`; rollback `e19a363a`; smoke: home 200, scholar 307, learn/checks 401 so the new route is present). Built in PR #266 (branch `scholar/learning-close-ws03`, head 05a8057e; commits be29d4fa LE-01+LE-04, 34203b51 LE-02, 05a8057e LE-03+LE-05), reported by the coordinator 4 Nov. Evidence: `docs/evidence/LEARNING-CLOSE-WS03/` on that branch.** Shared AI-off wording for Scholar and Professional. **Scope note:** HQ Copilot and the case studio keep their own AI wording. Earlier state: Scholar has the shared copy (`ai-availability.ts`, `AiAvailability.tsx`; P1 #253: refusal codes, `provider_unavailable`, no "environment" wording). Bespoke strings still exist on Apply and OSCE pages ("AI help is off, so …", `apply/page.tsx:63`, `apply/osce/page.tsx:71`). No use of the shared component found under the Professional routes in this pass. In build.
- **Dependency:** none · **Environment:** production (deployed 4 Nov)
- **Acceptance criteria:** same wording and next step across Scholar and Professional; supported non-AI functions stay usable; no internal detail exposed.
- **Evidence:** PR #253; `src/lib/individual/ai-availability.ts`. · **Status:** Live — verification pending (6 Nov: the detail line said Implementing while the summary and change log said Live; PR #266 deployed 4 Nov; `ai-refusal.tsx` under the Professional components uses the shared wording) · **Blocker:** Production walk by a learner not yet done · **Completed:** — PR #266.

### LE-02 — Rename learning units
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** LE session
- **Deliverable:** Learners rename learning units (D03) with stable identities and mappings to original materials.
- **Current state:** **MERGED to `main` as 6d76cdda on 4 Nov (owner GO); **DEPLOYED 4 Nov 2026** (app `6d76cdda`, `dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`; rollback `e19a363a`; smoke: home 200, scholar 307, learn/checks 401 so the new route is present). Built in PR #266 (branch `scholar/learning-close-ws03`, head 05a8057e; commits be29d4fa LE-01+LE-04, 34203b51 LE-02, 05a8057e LE-03+LE-05), reported by the coordinator 4 Nov. Evidence: `docs/evidence/LEARNING-CLOSE-WS03/` on that branch.** Learning units can be renamed, and the accepted units can be changed again, in My Plan. Earlier state: Learning units exist as My Plan proposals (#256) and Learn lessons planned by heading family (#257). No rename of a unit found in the repository. In build.
- **Dependency:** none · **Environment:** production (deployed 4 Nov)
- **Acceptance criteria:** rename persists; progress, annotations, saved explanations, questions, flashcards, attempts and citations keep working.
- **Evidence:** PRs #256, #257; `docs/programme/SCHOLAR-PLAN-UNITS-01.md`. · **Status:** Live — verification pending (6 Nov: aligned with the summary; PR #266 deployed 4 Nov) · **Blocker:** Production walk by a learner not yet done · **Completed:** — PR #266; screenshot `desktop-1280-units-card.png`.

### LE-03 — Re-cut lesson structure
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** LE session
- **Deliverable:** Reorganise lesson boundaries, split/combine sections, re-cut session lessons without losing completed work (D03); recalculate affected progress safely.
- **Current state:** **MERGED to `main` as 6d76cdda on 4 Nov (owner GO); **DEPLOYED 4 Nov 2026** (app `6d76cdda`, `dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`; rollback `e19a363a`; smoke: home 200, scholar 307, learn/checks 401 so the new route is present) and **migration 955 applied in production by the owner, strict VERIFY passed, coordinator read-only check confirms**. Built in PR #266 (branch `scholar/learning-close-ws03`, head 05a8057e; commits be29d4fa LE-01+LE-04, 34203b51 LE-02, 05a8057e LE-03+LE-05), reported by the coordinator 4 Nov. Evidence: `docs/evidence/LEARNING-CLOSE-WS03/` on that branch.** A recorded Learn session's lessons can be re-cut (split, merge, rename) without losing completed work, through migration 955 (one function, one transaction; events moved, copied or detached by containment; position, notes and artefact links follow). 955 is applied twice on staging with strict VERIFY passed; **production needs the owner's GO**; without 955 the route answers 409 and the session is unchanged. **Scope note:** re-cut works only for recorded sessions. Earlier state: Not on `main`. Plan-unit review (merge, split, leave out, put first) exists for My Plan proposals only. In build.
- **Dependency:** LE-02 identity rules · **Environment:** production (deployed 4 Nov)
- **Acceptance criteria:** §6.3 restructuring orphans no saved record; progress recalculated, not transferred indiscriminately.
- **Evidence:** PR #256. · **Status:** Live — verification pending (6 Nov: aligned with the summary; migration 955 file is on `main`, applied in production 4 Nov, read-only checked then) · **Blocker:** Production walk by a learner not yet done · **Completed:** — `docs/evidence/LEARNING-CLOSE-WS03/955-build-record.md` (sha256 `472cf84d…7caa`), `verify-955-strict.sql`, `ROLLBACK-955.sql`, desktop and phone screenshots.

### LE-04 — Configurable Go Deeper limit
- **Programme:** Learning Engine · **Priority:** P1 · **Owner:** LE session
- **Deliverable:** Three cumulative Go Deeper rounds by default; the maximum configurable in HQ (D02).
- **Current state:** **MERGED to `main` as 6d76cdda on 4 Nov (owner GO); **DEPLOYED 4 Nov 2026** (app `6d76cdda`, `dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`; rollback `e19a363a`; smoke: home 200, scholar 307, learn/checks 401 so the new route is present). Built in PR #266 (branch `scholar/learning-close-ws03`, head 05a8057e; commits be29d4fa LE-01+LE-04, 34203b51 LE-02, 05a8057e LE-03+LE-05), reported by the coordinator 4 Nov. Evidence: `docs/evidence/LEARNING-CLOSE-WS03/` on that branch.** The Go Deeper maximum is now an HQ policy, `scholar_learn_deeper_rounds_max` (1-10, default 3), replacing the code constant. Earlier state: **Verified gap.** Three cumulative rounds are delivered (#257, `learn-context.ts` `DEEPER_ROUNDS_MAX = 3`, enforced in `learn/act/route.ts`:404, "depth reached" beyond it). The maximum is a **code constant**; `policy.ts` has no Go Deeper key. Raising it needs an HQ policy.
- **Dependency:** none · **Environment:** production (deployed 4 Nov)
- **Acceptance criteria:** HQ policy with default 3, clamped by the policy engine; takes effect without redeploy; existing AI fair-use and cost controls unchanged.
- **Evidence:** `learn-context.ts:51`; `learn-context.test.ts`; PR #257. PR #266.
- **Status:** Live — verification pending · **Blocker:** Production walk by a learner not yet done (learner-level acceptance walk in production) · **Completed:** —

### LE-05 — Verify history, citations and progress after restructuring (§3, absent from §4; added)
- **Programme:** Learning Engine · **Priority:** P1 *(proposed)* · **Owner:** LE session
- **Deliverable:** Evidence that learning history, citations and progress remain intact after rename and re-cut.
- **Current state:** **MERGED to `main` as 6d76cdda on 4 Nov (owner GO); **DEPLOYED 4 Nov 2026** (app `6d76cdda`, `dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`; rollback `e19a363a`; smoke: home 200, scholar 307, learn/checks 401 so the new route is present) and **migration 955 applied in production by the owner, strict VERIFY passed, coordinator read-only check confirms**. Built in PR #266 (branch `scholar/learning-close-ws03`, head 05a8057e; commits be29d4fa LE-01+LE-04, 34203b51 LE-02, 05a8057e LE-03+LE-05), reported by the coordinator 4 Nov. Evidence: `docs/evidence/LEARNING-CLOSE-WS03/` on that branch.** Walk on the fixture learner (75-section material, 7 lessons) through two re-cuts: all invariants PASS (questions, attempts, flashcards, artefacts and section notes unchanged; no orphaned events, notes, artefact links or position; a read mark or teach event whose lesson grew beyond what it covered is detached as history only, never counted as completing the larger lesson). Earlier state: Not started; depends on LE-02/LE-03.
- **Dependency:** LE-02, LE-03 · **Environment:** production (deployed 4 Nov)
- **Acceptance criteria:** §6.3.
- **Evidence:** `le05-walk-2026-11-04.json` in the WS03 evidence folder (staging fixture walk). · **Status:** Live — verification pending (6 Nov: aligned with the summary; the walk was on staging, not production) · **Blocker:** Production walk by a learner not yet done · **Completed:** —

### AI-01 — Flashcard clinical review
- **Programme:** AI · **Priority:** P0 · **Owner:** Independent clinical reviewer (to be named by the owner)
- **Deliverable:** Independent clinical review of flashcard outputs.
- **Current state:** Review pack delivered: `docs/evidence/SCHOLAR-INDEPENDENT/AI-01-flashcard-clinical-review.md` — every recorded kept card from Haiku (6), Sonnet (7) and Opus (8), the dropped drafts with reasons, the Opus `q.postop` item, mark columns and a sign-off block. **Limit found:** the evaluation recorded at most two kept cards per section, so Haiku kept 7 and Opus kept 9 but only 6 and 8 are in the file; dropped drafts are recorded by reason only; the source section text is not in the file (a read-only staging query is in the pack).
- **Dependency:** D04 · **Environment:** staging evidence
- **Acceptance criteria:** a named independent clinician marks each card Safe/Unsafe/Inaccurate/Unclear, comments, and signs the pack with name, role and date; outcome recorded.
- **Evidence:** `p3-eval-2026-11-03.json`; `docs/evidence/AI-EVAL/run-d5v2-2026-11-03-cost-config.json`; run `55f56e85-87d5-4cab-b22a-f1dbbb20c89d`.
- **6 Nov refresh:** signed. The record is `REVIEW-PACKS-2026-11-04/SIGNOFF-Flashcard-AI-01.md` in the coordinator folder, not in this repository: reviewer Okaisu Mullen, role CEO (HQ appointment clinical_content_reviewer, the reviewer the owner confirmed on 4 Nov), all cards Safe, approve the package as proposed; Haiku Yes for standard-educational and No for clinical-educational, Sonnet and Opus Yes for both; "the reviewer did not build or run the evaluation". Received from the owner in chat on 4 Nov, and the owner then applied AI-02. For the record, the file holds no registration number.
- **Status:** Complete · **Blocker:** — · **Completed:** 4 Nov 2026

### AI-02 — Flashcard AI configuration
- **Programme:** AI · **Priority:** P0 · **Owner:** Coordinator (owner-run configuration)
- **Deliverable:** Apply the approved flashcard settings package: `flashcards` fair-use activity (cheap tier, risk floor standard educational), route `scholar.flashcards` = Haiku › Sonnet › Opus, three activity-scoped eligibility rows (Haiku standard-educational; Sonnet and Opus clinical-educational). Sonnet stays for mapping and Opus for question generation (D04); the clinical floor is untouched.
- **Current state:** Code on `main` (#259, #262): flashcards as their own activity with fallback to `questions`, tier from the published policy per activity. The production package is prepared (SQL §7 of `SCHOLAR-AI-COST-CONFIG-01.md` in the coordinator folder; staging counterpart `p3-staging-config.sql`). Production (read 4 Nov): **not applied** — no `flashcards` or `scenarios` activity in `ai.fair_use.scholar` (map tier = reasoning), no `scholar.flashcards` or `scholar.scenarios` route (`scholar.questions` and `scholar.map` = Sonnet 4.6 then Opus 4.8), and no eligibility rows for flashcards or scenarios (existing: map Sonnet 4.6 clinical_educational from 28 Oct; questions Opus 4.8 clinical_educational from 27 Oct).
- **Dependency:** AI-01 signed · **Environment:** production (configuration)
- **Acceptance criteria:** §6.7 routing follows published permissions and fair-use controls; post-activation queries show clinical notes on Sonnet and standard notes on Haiku; questions, scenarios and OSCE unchanged on Opus; rollback SQL recorded.
- **Evidence:** PRs #259, #262; `docs/evidence/SCHOLAR-INDEPENDENT/p3-staging-config.sql`, `p3-cost.md`.
- **6 Nov refresh:** by record the owner applied the package 4 Nov ~20:35 (verification PASS 8) and the coordinator read it back: flashcards activity cheap tier with standard-educational floor, route Haiku then Sonnet then Opus, three eligibility rows; map, questions and the clinical floor unchanged. The "not applied" production read above (4 Nov) is superseded. Not read from production on 6 Nov. Checks scheduled: 24 h on 5 Nov 20:30 (result unread by the owner) and 7-day on 7 Nov 20:30.
- **Status:** Live — verification pending · **Blocker:** the 24 h and 7-day cost checks · **Completed:** —

### AI-03 — Cost comparison and report
- **Programme:** AI · **Priority:** P1 · **Owner:** Coordinator (read-only runs)
- **Deliverable:** Before-and-after cost report from the existing monitoring queries.
- **Current state:** Queries M1.. ready (`p3-monitoring-queries.md`); baseline measured: 93 calls, about USD 1.37 over 30 days to 3 Nov, `map` 34 % on Sonnet, Learn 43/43 served from saved. After-window cannot start until AI-02.
- **Dependency:** AI-02 · **Environment:** production (read-only)
- **Acceptance criteria:** cost per relevant activity, quality outcomes, safety failures and latency reported for a stated window.
- **Evidence:** `docs/evidence/SCHOLAR-INDEPENDENT/p3-monitoring-queries.md`, `p3-cost.md`.
- **6 Nov refresh:** unblocked; the after-window started when AI-02 was applied. Baseline above is unchanged.
- **Status:** Implementing · **Blocker:** the 7-day check (7 Nov 20:30), then the comparison report · **Completed:** —

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
- **Current state:** **Decided 4 Nov 2026: stay OFF during the pilot; revisit on or after 20 Nov 2026.** Metering is dark until the platform flag `ai_fair_use` (`practice_platform_flags`) is switched on; with it off the policy's routing and model eligibility still apply, fail-closed for clinical risk (`allowance.ts`). Production confirmed 4 Nov: no `ai_fair_use` row in `practice_platform_flags`, so metering is off. Initial limits are not yet decided.
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
- **Status:** Blocked · **Blocker:** owner adds the CNAME (scheduled 5 Nov, still open 6 Nov by record) · **Completed:** —

### CLOSE-01 — Register reconciliation and final closure
- **Programme:** Learning Engine · **Priority:** P0 · **Owner:** Coordinator + this session
- **Deliverable:** This tracker, the reconciled `SCHOLAR-CE-2026-REGISTER.md`, and the final closure report (§8).
- **Current state:** Tracker and CE register reconciliation delivered by this change (branch `docs/learning-close-tracker`). Final closure waits for every other row.
- **Dependency:** all rows · **Environment:** documentation
- **Acceptance criteria:** every row Complete or explicitly Blocked on an owner decision; production state reconciled; §8 items 1-7 delivered.
- **Evidence:** this file; the register; the AI-01 pack.
- **Status:** Implementing · **Blocker:** — · **Completed:** —
- **Owner decision (4 Nov 2026):** **Patient voice stays disabled** until a case author supplies the required patient script and an independent clinician approves the complete case and the permitted responses (D-11). Nothing in the release waits on this.
- **Owner decision (4 Nov 2026):** **Retention (D05) decided:** learner-owned attempts are kept until the learner deletes them, under the published privacy and retention rules. **Learner deletion is to be enabled once the existing implementation is verified**, following the documented policy for primary records, backups and any mandatory retention exceptions (D-13). The key `scholar_case_attempt_delete` therefore stays off until that verification.
- **Owner decision (4 Nov 2026):** **D-3 decided: scenarios stay disabled** until about ten representative generated scenarios have had independent clinical review, covering answer leakage, clinical accuracy and scoring checks (D-14). `scholar_revision_formats` in production keeps excluding scenario.
- **Owner decision (4 Nov 2026):** **A reviewer is to be assigned** (independent clinician). The proposed AI settings are activated only after the review meets the established acceptance criteria (D-12). The existing clinical review workflow is used; no new committee.
- **Owner decision (4 Nov 2026):** Activate the proposed flashcard AI settings **only after** AI-01 meets its acceptance criteria (D-12). Not blocking the 4 Nov release.

---

## Live 5-6 Nov and in flight (added 6 Nov; no new row IDs until the owner asks)

These are not directive rows. They are recorded here so nothing is held only in memory. All statuses use the owner's vocabulary. Key and migration facts about production are by record.

**Merged and live in app `8a577bb3`, verification pending (no signed-in production walk):**

| Item | PR (merge) | Key or switch | Migration |
|---|---|---|---|
| Learn lesson redesign, Scholar Learning Design System v1 | #281 (4 Nov) | none | none |
| Search History (default on after a one-time notice); Ask sources | #287, #289, #292-#294; #300 (5 Nov) | `scholar_search_history`: on for learners by record 5 Nov (publication row not re-read); code default off | 992, 993, 994, 999 applied by record |
| Revise engine, Revise workspace, Apply connected, Evaluate and My Progress, Study Home | #297, #299, #298, #301, #304 (5 Nov) | none | none |
| Universal Search stage 1, match fix, stage 2 (Scholar) | #305, #306, #308 (5-6 Nov) | `scholar_global_search`: ON by record since 6 Nov (cb9c546e) | none |
| Speed work | #307, #309 (6 Nov) | none | none |
| Learn landing (resume, study next, recent lessons, library) and the Library link | #310 (6 Nov) | none | none |
| Platform search re-gate | #311 (6 Nov) | none | none |
| Slide classification and inline pictures (SCHOLAR-VISUAL-001 phase 1) | #314 (6 Nov) | `scholar_lesson_visuals` and `scholar_visual_classify`: code fallback on | none |
| Scenario variety | #318 (6 Nov) | none; reaches learners only if `scholar_revision_formats` includes scenario | none |
| HQ record search | #319 (6 Nov) | flag `hq_record_search` in `practice_platform_flags`: absent means off | none |
| Professional search | #322 (6 Nov) | `professional_global_search`: code default off, policy off by record | none |
| Ask guard (typed text never leaves Competen) | #325 (6 Nov) | closed in code, not a setting | none |

**Merged 6-7 Nov and live in app `6264ec8f` (deployed 7 Nov 06:21 EAT), every new switch off, verification pending:**

| Item | PR (merge, EAT) | Key or switch | Migration |
|---|---|---|---|
| SCHOLAR-GO-DEEPER-001 | #324 (6 Nov 23:59) | `scholar_go_deeper_structured`, off | none |
| SCHOLAR-GUIDE-ME-001 | #330 (7 Nov 00:08) | `scholar_guide_me_adaptive`, off | none |
| COMPETEN-NOTEBOOK-001 (My Notebook) | #332 (7 Nov 00:39) | `scholar_personal_notebook`, off | 1000, 1001: **not applied in production** |
| Challenge me and Ask me fix | #335 (7 Nov 00:59), live in `03929239` | none | none |
| Notes inside teaching | #339 (7 Nov 05:50) | follows the Notebook and teaching switches | none |
| SCHOLAR-RESEARCH-TEACH-001 phase 1 | #331 (7 Nov 05:52) | `scholar_teach_research`, no production row (off). Owner: automatic research off in production | none |
| Local time zones | #334 (7 Nov 05:53) | `scholar_reader_time_zone`, off. Never run signed in on a real session | none |
| Whole-slide rendering A to D | #333, #336, #337, #338 (7 Nov 05:55 to 06:20) | whole-slide switch off. Keep off (reliability, see the readiness table) | 1010: **not applied in production** |

**Not merged:**

| Item | State | Branch | Notes |
|---|---|---|---|
| SCHOLAR-ANOTHER-SCENARIO-01 (#327) | Ready for review | `scholar/another-scenario-01` | no migration; inert while scenario is excluded from the formats policy |
| SCHOLAR-ASK-WEB-SOURCES design (#323) | Ready for review | `scholar/ask-web-sources-design` | docs only; paid search, credentials and learner activation stay off |
| Research privacy alignment | Implementing, no PR | `scholar/research-privacy-alignment` | MeSH is an open owner question |
| Whole-slide reliability (watchdog and limits) | Implementing | `scholar/slide-render-reliability` | owner GO: keep 2 GB and build the watchdog |
| Journey should-fix: restored reading place lost when saved teaching arrives late | Implementing | not confirmed | journey report, items 5d and 5e |
| #86 / migration 430 | Blocked (REL-04) | old branch | on hold by owner |

---

## Decision register (directive §7)

Items decided on 4 Nov 2026 are recorded as decided (they do not resurface). Migration 430 stays on hold. For audit scoring, the separately approved nursing audit scoring specification governs.

| # | Decision | Status | Outcome / what exists | Tracker row |
|---|---|---|---|---|
| D-1 | Who may access **identifiable learner names** in analytics | **Decided 4 Nov: executive level (six positions)** | Capability exists in production with no grants; owner grants it to six positions (five 940 executive positions plus the legacy chief_executive seat) in Organisation & Appointments, coordinator verifies | GOV-01 |
| D-2 | **AI metering** activation and initial limits | **Decided 4 Nov: stay OFF during the pilot; revisit on/after 20 Nov 2026** | Flag `ai_fair_use` dark; routing and eligibility apply regardless; initial limits still to be set at revisit | GOV-02 |
| D-3 | **CE-05 scenario policy** activation (learner-wide) | **Decided 4 Nov: keep disabled** until about ten representative generated scenarios have had independent clinical review (answer leakage, clinical accuracy, scoring checks) | Production `scholar_revision_formats` excludes scenario; scenarios were 59 % of Scholar AI cost on Opus; no clinician read recorded. See D-14 | CE-05 |
| D-4 | Whether an **approver may also publish** under DA-000001 | **Decided 4 Nov: keep current state** | The 940 guard allows it when the author differs; DA-000001 v1 published 4 Nov 06:26Z by competenelisha (approver), author elisha.okaisu | GOV-04 |
| D-5 | **Production package 550** release | **GO given; production already has 550** | Nothing to apply | REL-01 |
| D-6 | **Governance migration 610** release | **GO given; production already has 610** | Nothing to apply | REL-02 |
| D-7 | **LEARNING-01 payment** credentials and webhook setup | **Deferred by owner; revisit 18 Nov 2026** | 460-464 applied; switches off; needs Flutterwave TEST keys, staging webhook, 5 staging identities | REL-03 |
| D-8 | **R1 default configuration** (SALE) | **Decided 4 Nov:** learning-state view and next-step suggestions ON by default; automatic My Plan changes OFF; automatic competency staging OFF; existing learning evidence and deterministic recommendations by default; no new persistent Personal AI memory and no unapproved AI routing. Recommendations are explainable, optional and dismissible; insufficient evidence is never presented as demonstrated mastery | PR #276 merged to main; resolves the open question on the eight default-on keys | SALE-04..07 |
| D-9 | **Calculation tolerance** | **Decided 4 Nov: default tolerance stays at zero** (equivalent numerical representations, validated equivalent units, explicitly specified rounding). Non-zero clinical tolerances need a separately approved policy | SQIE scoring v3 (PR #277 merged) | SQIE tracker |
| D-10 | **Clinical scoring caps** | **Decided 4 Nov:** unsafe response at most 50 % of the applicable score; safety-critical failure 0 %; applied at the scope of the approved rubric, never failing unrelated components. Caps apply **only to clinically reviewed, approved library questions**, and the independent reviewer explicitly approves the safety-critical and unsafe-response markers and their scope. AI markers on personal practice questions stay formative | Gated until clinical approval. Calculation format approved for learners once scoring, library and safety checks pass and the production migrations are applied | SQIE tracker |
| D-11 | **Patient-voice simulation** | **Decided 4 Nov: stays disabled** until a case author supplies the patient script and an independent clinician approves the complete case and permitted responses | Production 880 applied, 0 rows | CE-04A |
| D-12 | **Flashcards AI settings** | **Decided 4 Nov:** assign an independent clinician to review the existing sample; activate the proposed settings only after the review meets the established acceptance criteria | Closed: reviewer signed 4 Nov, settings applied 4 Nov by record | AI-01, AI-02 |
| D-13 | **Simulation retention** (D05) | **Decided 4 Nov:** learner-owned attempts are kept until the learner deletes them, under the published privacy and retention rules; learner deletion is enabled once the existing implementation is verified, following the documented policy for primary records, backups and mandatory retention exceptions | Key `scholar_case_attempt_delete` stays off until then | CE-04D |
| D-14 | **Evolving scenarios** | **Decided 4 Nov:** see D-3 (disabled until about ten reviewed) | | CE-05 |
| D-15 | **Pilot Question Library** | **Decided 4 Nov:** the 60 pilot questions are authorised for production import **as unpublished drafts** with unverified-source status preserved. Not published or shown to learners until independent clinical review, source verification, Ugandan-practice review and authorised publication are complete | SQIE pilot batch (PR #270 merged) **Appointments made 4 Nov** (author Competen Elisha, reviewer Okaisu Mullen, publisher Elisha Okaisu; clinical leads Elisha Okaisu and Okaisu Mullen); the author blocker for the production import is cleared; the same person may not approve and publish | SQIE tracker |
| D-16 | **Production GO for SQIE migrations** | **Decided 4 Nov: conditional GO for 990, 991, 995, 996 and 997**; merge #277 before #272; update #272 with the latest scoring code; no deploy with unresolved relevant CI failures | 990 and 991 APPLIED in production and verified read-only (coordinator, 4 Nov); #272 (995-997) in CI | SQIE tracker |
| D-17 | **Governance process** | **Decided 4 Nov:** keep the existing clinical review and publication workflows; no new committees and no duplicate approval processes. None of the deferred activations blocks the 4 Nov release | | all |

| D-18 | **Coordinated Learning Experience Completion** (owner, 6 Nov evening) | **Decided 6 Nov:** sequence 1-10 as one integrated Growth and Development journey. Topic-linked and free-standing notes allowed; user-initiated additional scenarios allowed under existing AI and safety controls; faithful original-slide rendering in phases; readiness table (completed, failed, blocked, requires owner decision); no new approval gates for decided items; LifeOS decisions kept out; production GO asked only when PRs pass, each deploy still needs a direct GO | See "Live 5-6 Nov and in flight" | CE-02-1, CE-05, SALE-12 |
| D-19 | **Learn redesign, Library link, search, scenario variety, Ask web sources** (owner, 6 Nov) | **Decided 6 Nov:** "Open your Library" goes to the right Library; Learn landing redesign; platform search retained and re-gated; HQ search defaults (flag may be activated by a Holdings platform administrator and grants no extra access); scenario variety from existing material with no added model calls by default; Ask web sources design only | #310, #311, #319, #318, #323 | CE-05 |
| D-20 | **Research in Teach Me** (SCHOLAR-RESEARCH-TEACH-001, owner 6 Nov) | **Decided 6 Nov:** development and testing only; production activation NOT authorised and needs a separate GO; automatic search when on (no per-lesson opt-in), subject terms only, free sources only (PubMed, Crossref, PubMed Central; OpenAlex excluded), citations shared across learners but abstract text per learner, abstracts only | Branch local, unpushed | none |
| D-21 | **Ten-scenario pass rule** (owner, 5 Nov) | **Decided 5 Nov:** all seven checks Yes and Pass with no wording change; Change counts only after re-read; Unsafe stops the review; passing does not enable the format | Pack unreviewed | CE-05 |

Decisions already taken in the directive (D01-D06) are not reopened here. Two points that may need the owner's attention when they arise: D04 says Opus stays for question generation, and the proposed package changes only flashcards (Sonnet for clinical flashcards, Haiku for standard-educational only); and D05 asks that simulation conversations are deleted with the attempt "subject to retention requirements"; the retention rule is now decided (D-13, 4 Nov).

## Appendix A — production facts needed (read-only, via the coordinator)

File: `LEARNING-CLOSE-2026-11-prod-readonly-queries.sql` in the coordinator folder (Q1-Q6; Q7 not run). Results are recorded under "Production facts" below (Q1-Q6 received 4 Nov; Q7 not run).

## Production facts (recorded as received)

**Read from production by the owner, 6 Nov 2026** (read-only checks `PROD-CHECK-trackers-6nov.sql` and `PROD-CHECK-2-research-6nov.sql`, seen as screenshots). These replace "by record" wherever a row below or in the SALE tracker names one of these keys or migrations.

- **Published on:** `scholar_active_notebook`, `scholar_application_evidence`, `scholar_competency_evidence_views`, `scholar_global_search`, `scholar_next_best_action`, `scholar_prerequisite_suggestions`, `scholar_retrieval_schedule`, `scholar_search_history`, `scholar_transfer_checks`. `scholar_material_image_slides` is `ai_transcription`.
- **No row, code default on:** `scholar_learning_state`, `scholar_adaptive_teaching`, `scholar_lesson_visuals`, `scholar_visual_classify`.
- **No row, so off or not on `main` yet:** `professional_global_search`, the `scholar_case_*` keys, `scholar_go_deeper_structured`, `scholar_guide_me_adaptive`, `scholar_personal_notebook`, `scholar_teach_research`, `scholar_exam_web_provider`.
- **Flags:** `ckri_research` true; `ai_fair_use` and `hq_record_search` no row.
- **Migrations, by their objects:** 950, 955, 975, 985, 986, 990, 992, 998, 999 present, and the expected tables present. LifeOS (901) and My Notebook (1000) absent, as intended.
- **Flashcard settings (AI-02):** two published AI settings mention flashcards.
- **Not settled:** `scholar_revision_formats` was cut off on screen after "structu...", so whether it includes `scenario` has not been read.

**Finding, 6 Nov: Learn's Research & Explain is live in production.** `scholar_learn_source_modes` is `notes, library, research`, the Basic workflow is active, and the active sources are PubMed, OpenAlex, Crossref, PMC and the Google Scholar link. This is the learner-chosen mode, not the automatic research of SCHOLAR-RESEARCH-TEACH-001, which is not on `main`. Its search terms come from the lesson's title, objective, concepts and topics, refused only if the patient-identifier check matches, which is weaker than the owner's 6 Nov rule that only sanitised subject terms may leave. Recorded calls since 28 Oct, last on 3 Nov, recorded cost USD 0:

| Source | Rows | Requests |
|---|---|---|
| PubMed | 7 | 15 |
| OpenAlex | 7 | 7 |
| Crossref | 30 | 30 |
| PMC | 4 | 15 |
| Cache | 2 | 0 |

All of these came before the Ask guard (#325, deployed 6 Nov), so a typed question could have been part of a search. Competen keeps only the length of a search, not its words, so what was sent cannot be shown. OpenAlex is metered since 2026 while the registry cost stays 0, so its recorded cost cannot be relied on. **Owner decision, 6 Nov 2026: keep it on.** Closed, not to be raised again. The search-term and OpenAlex facts above stand as the record.

Reported by the coordinator after read-only checks, 4 Nov 2026 (not the Q1-Q6 result rows; those are still to come):
- Capability `hq.scholar.analytics.identifiable.read` exists in production with no grants; none of the five 940 executive positions is held; only the legacy `chief_executive` (mullenokaisu) is.
- Production has 550 (four `individual_professional_progress_*` tables) and 610 (`hq_gov_body`, `hq_gov_seat`, `hq_gov_seat_exclusion`, `hq_gov_seat_appointment`).
- Production has the `learning_*` tables (460-464); `learning_app` and `learning_commerce` are OFF.
- Production `scholar_revision_formats` excludes "scenario".
- DA-000001 v1 published 4 Nov 06:26Z by competenelisha (approver); author elisha.okaisu.

Results of the read-only queries (Q1-Q6), coordinator, 4 Nov 2026:
- Q1: migration 880 is applied (`individual_scholar_case_conversation` exists; erase function 1; guard function 1). Q2: 0 turns, 0 sessions.
- Q3: one Individual policy row among those queried: `individual.policy.scholar_revision_formats` = enabled [mcq, mrq, short, flashcard, match, sequence, structured, cloze, true_false, extended], updated 3 Nov 10:05Z, no scenario. No rows for `scholar_case_conversation`, `_turns`, `scholar_verify_formats`, `scholar_explanation_depth`, `scholar_check_behaviour`, `scholar_plan_started_signal`, so code defaults apply (conversation OFF, plan started signal = learning).
- Q4: the flashcards AI package is NOT applied (details in AI-02).
- Q5: no `ai_fair_use` row, so metering is OFF.
- Q6: `hq.scholar.analytics.view` is held by `individual_product_administrator` and `individual_product_reviewer`; `hq.scholar.analytics.identifiable.read` is held by no position.
- Release 4 Nov 2026 (coordinator): backup `competen-production-20261104-1126` with restore test PASS (979 tables, 0 mismatches); owner applied migrations 950 and 955 in production, strict VERIFY passed for both; read-only check confirms the new columns, marking 'unmarked', the attempt foreign key (on delete set null), the recut function executable by service_role only, and 0 detached events; app deployed `6d76cdda` (`dpl_7QaBQjko6p2pFryVkSoQZG3Fd3NR`, rollback `e19a363a`); smoke: home 200, scholar 307, learn/checks 401. Production DB now includes 950 and 955; 960 is not applied.
- Release 4 Nov ~12:25 EAT (coordinator): owner applied migration 960 in production, VERIFY-960 PASS (table present, RLS on, 0 policies, 4 checks, 3 indexes, 0 rows); app deployed `09d9da09` (`dpl_F1Pho3Kn5xZtXL9qpRRkFkYPsvYn`, rollback `6d76cdda`); smoke: home 200, scholar 307, uploads route 405 to a GET. Production DB now includes 950, 955 and 960.
- Backups (owner rule 4 Nov): no backup before each apply; backup plus restore test run every 4 hours (Windows task, from 16:00). The latest backup before 960 is `competen-production-20261104-1212` (taken 12:12); it has no restore test yet, and the 16:00 run tests it.
- PR #274 (config resetOverride fix: a failed override delete is reported, not silently successful) merged to main as bec417b5 on 4 Nov, not deployed.
- 4 Nov (coordinator): merged to main: #276 (R1), #271 (WS-H/J), #273 (990/991), #270 (pilot), #277 (scoring v3). **Migrations 990 and 991 are APPLIED in production and verified read-only.** #272 (995-997) is in CI. #275 has owner GO and is merging main in.
- Q7 (do any approved case versions define a patient voice or handover) was not run.

**Added 6 Nov 2026 (BY RECORD, coordinator and memory records of 4-6 Nov; not read from production on 6 Nov):**
- (6 Nov entry; superseded 7 Nov by `6264ec8f`, see the head of this file) Application: app `8a577bb3` live (`dpl_8vVcMJBDSQKdJSTF1iEtfWuE6crm`, rollback `dc10b205`) equals `main`. Releases since the 4 Nov entries above: `6e679c29` (4 Nov 18:20: R1 #276, SQIE, #275 Wave 2), `bd89d317` (R3), `4f548907` (4 Nov 23:45: R2, R4, R5), then the 5-6 Nov releases listed under "Live 5-6 Nov".
- Migrations applied in production by the owner, by record: 990, 991 (4 Nov), 995, 996, 997, 998 (4 Nov), 975 (4 Nov ~21:10), 970, 985, 986 (4 Nov ~23:58), 992, 993, 994 (5 Nov), 999 (5 Nov 17:15). Head 999 plus the 5 Nov data loads. **Migration 1000 (My Notebook) is not applied (still true 7 Nov, with 1001 and 1010). Migrations 901-906 (LifeOS) are on `main` and not applied.**
- Policy keys: published ON by the owner 5 Nov 00:13-00:45 (read-only verified then): `scholar_retrieval_schedule`, `scholar_prerequisite_suggestions`, `scholar_transfer_checks`, `scholar_next_best_action`, `scholar_active_notebook`, `scholar_application_evidence`, `scholar_competency_evidence_views`. AI marking published ON (`ai_then_self`) 5 Nov. `scholar_global_search` ON from the 6 Nov 12:25 release. `scholar_search_history` on for learners by record (5 Nov). `scholar_revision_formats`: last read 4 Nov, excludes scenario. Flag `ckri_research` ON 5 Nov 00:30. Flag `ai_fair_use` absent (metering off), last read 4 Nov. The CE-04/05 keys and `scholar_go_deeper_structured`, `scholar_guide_me_adaptive`, `scholar_personal_notebook`, `scholar_teach_research`: not published (code default off).
- Flashcards AI package (AI-02) applied 4 Nov ~20:35; 60 pilot questions loaded as drafts 4 Nov (0 approved at 5 Nov 00:30).
- All of these are what `PROD-CHECK-trackers-6nov.sql` is for.

## Change log

| Date | Change |
|---|---|
| 7 Nov 2026 | **Refresh against `main` 6264ec8f** (step 9). CE-02-1 and CE-02-2 Built on branch / Walked on staging to Ready for release (PR #332 merged, 1000/1001 not in production). The 6-7 Nov items moved from "Not merged" to "Merged and live, switches off": #324, #330, #332, #335, #339, #331, #334, #333/#336/#337/#338. Still not merged: #327, #323, research privacy alignment. Integrated Growth and Development journey: no blockers, one should-fix (lost reading place), three things not run (real phone, Ask panel at 390, sign-out with the whole connection lost). No row Complete |
| 6 Nov 2026 | **Refresh against `main` 8a577bb3** (production switches and migrations by record, not read from production). **Status changes (old to new):** AI-01 Ready for review to Complete (signed 4 Nov, closed; the row was behind); CE-02-1 Not started to Implementing; CE-04B, CE-04C, CE-04D Ready for review to Live — verification pending (PR #275 merged 4 Nov, deployed, keys off); AI-02 Blocked to Live — verification pending (applied 4 Nov by record); AI-03 Blocked to Implementing; LE-01, LE-02, LE-03 detail lines Implementing to Live — verification pending and LE-05 Not started to Live — verification pending (aligned with the summary table, which already said Live). **Text only, status unchanged:** CE-05 (variety #318, #327 and the format gate), OPS-01 (CNAME still open), CLOSE-01. **Checked on `main` and unchanged:** CE-01-1 (no Ask entry in My Plan), CE-01-3 (no next step in the context block), CE-06A-1 (no Listen in the lesson reader or OSCE), CE-07A and CE-07B (no lazy loading or data-saver code; only the upload code reads `navigator.connection`), CE-04A (Blocked, D-11), GOV-01 (no grant recorded), GOV-02, GOV-04 Complete, REL-01..04, CE-03, CYU-01..04, CE-07C. Decisions D-18 to D-21 added; section "Live 5-6 Nov and in flight" added; production facts (by record) added |
| 6 Nov 2026 | **Stale statements noticed, not edited here.** SQIE tracker: SQIE-01 summary says PR #269 open; the WS table and the release state say #270, #271, #272, #273, #277 are open or Ready for review (all merged 4 Nov); the last change-log row says none is merged; C-10 and SQIE-05 say 0 library questions in production (60 drafts loaded 4 Nov); "Production at creation: DB head 960"; C-14 and SQIE-12 metering-off statement is still true. CE register: header table and CE-04 line say CE-04A Ready for release, CE-04C Not started, CE-04D Live (this tracker holds the current values); P0 to P3 paragraphs and the cumulative-teaching paragraph still say "not merged, not deployed" for work merged 3-4 Nov; "Acceptance still to do" for CE-01 and CE-02 is unchanged and still true. SALE and this tracker previously disagreed on LE-01..05 detail lines (fixed above) |
| 6 Nov 2026 | **Left before targeted real-learner testing.** *In progress:* Guide Me (local, unpushed), My Notebook (pushed, no PR, migration 1000), SCHOLAR-RESEARCH-TEACH-001 (local, unpushed, dev and test only), whole-slide rendering (no commits), the integrated Growth and Development staging acceptance, the readiness table, the 7-day flashcard cost check (7 Nov 20:30), and a signed-in production walk of the live releases, which is what moves any row toward Complete. *Needs an owner decision:* a clinician for the ten-scenario pack (scenarios stay off until then); approve and publish the 60 pilot questions; GO for #324 and #327; GO for migration 1000 once My Notebook has a PR; research activation (separate GO after staging results); GOV-01 grants. *Does not hold up targeted testing:* patient voice (CE-04A, D-11), paid web search for Ask (design only), AI metering (revisit from 20 Nov), LEARNING-01 payments (revisit 18 Nov), GOV-03 nursing audit scoring, OPS-01 preview CNAME |
| 4 Nov 2026 | Created from directive §4 and the repository at `e19a363a`; rows added: CE-01-1..3, CE-02-1..2, CE-03, CE-06A-1, LE-05, AI-04, AI-05; no row Complete |
| 4 Nov 2026 | Library appointments recorded under D-15 (see SALE tracker, Appointments); no status changed |
| 4 Nov 2026 | Owner decisions recorded: R1 defaults (D-8), calculation tolerance, scoring caps, patient voice (D-11), flashcards reviewer (D-12), retention (D-13), scenarios (D-3/D-14), pilot import (D-15), conditional GO 990/991/995/996/997 (D-16), no new committees (D-17). CE-04A, CE-04D, CE-05, AI-01, AI-02 blockers reworded; no status value changed. Merges #276, #271, #273, #270, #277; 990/991 applied in production |
| 4 Nov 2026 | Wave 2: CE-04A..D and CE-05 recorded against PR #275 (head 7f661319, open, no migration, keys default off). CE-04A Blocked (approved case with a patient voice; owner switch), CE-04B/C/D Ready for review (04C staging walk 25/25, keys `scholar_case_deterioration`, `scholar_case_attempt_delete`, `scholar_case_debrief_review` off; D05 retention rule still the owner's), CE-05 verified on staging, D-3 pending. PR #274 (config resetOverride fix) merged bec417b5, not deployed. This branch (`docs/sale-tracker`) now carries both trackers |
| 4 Nov 2026 | Release 2: owner applied 960 in production (VERIFY-960 PASS), app 09d9da09 deployed (rollback 6d76cdda). CE-07C Live — verification pending (real-device test and a learner upload walk outstanding). Backup rule changed: every 4 hours with restore test from 16:00; latest backup before 960 is competen-production-20261104-1212 (no restore test yet) |
| 4 Nov 2026 | PR #267 merged to main as 09d9da09: CE-07C Ready for release (not deployed; owner applies 960 after a backup, package PENDING-45, then deploy; real-device test in Wave 4) |
| 4 Nov 2026 | Release: backup + restore PASS, owner applied 950 and 955 in production (VERIFY passed), app 6d76cdda deployed (rollback e19a363a). CYU-01..04 and LE-01..05 Live — verification pending (learner walks in production not done). PR #267 (CE-07C) now at cafd5637, CI 8/8 green, awaiting owner GO; 960 not applied |
| 4 Nov 2026 | PR #266 merged to main as 6d76cdda: LE-01..05 Ready for release (merged, not deployed; owner applies 955 in production before the deploy for LE-03/LE-05). Tracker branch merged with origin/main; CE register kept both sides |
| 4 Nov 2026 | PR #265 merged to main as e367920: CYU-01..04 Ready for release (merged, not deployed; owner applies 950 before the deploy). CE-07C Ready for review: PR #267 (head ff25ce0d), migration 960 staging-verified, staging walk 40/40; CE-07A/B scope notes added |
| 4 Nov 2026 | LE-01..05 Ready for review: PR #266 (head 05a8057e), migration 955 staging-verified, production needs owner GO; LE-03 scope: recorded sessions only; LE-01 scope: HQ Copilot and case studio keep their own wording; PR #266 also edits the CE register (merge conflict expected with #264, coordinator to say when to rebase) |
| 4 Nov 2026 | CYU-01..04 Ready for review: PR #265 (head 02ec0efa), migration 950 staging-verified, production needs owner GO; CYU-02 partial format scope noted |
| 4 Nov 2026 | Coordinator inputs: GOV-01 decided executive level (Ready for release); GOV-02 stays off until 20 Nov (Blocked by date); GOV-04 added and Complete; REL-01 and REL-02 Live — verification pending (production already has 550 and 610); REL-03 owner actions; CE-05 activation pending; decision register updated; production facts recorded. GOV-04 is the only Complete row. Later 4 Nov: Q1-Q6 results recorded (880 applied with 0 rows, so CE-04D moves to Live — verification pending; flashcards AI package confirmed not applied; metering off; identifiable right ungranted); REL-03 deferred to 18 Nov; GOV-01 grant is to six positions (five 940 executive positions plus chief_executive), Ready for release until the coordinator verifies |
