# SALE-2026-11 — Scholar Adaptive Learning Experience: the one programme tracker (SALE-00)

**Authority:** owner directive SALE-2026-11, 4 Nov 2026 (§11 tracker, §12 sequencing, §13 governance, §15 final acceptance). **Created:** 4 Nov 2026 by SALE-00 from `origin/main` @ `661caf17` (production: app `09d9da09`, DB through 960).
**Product rule (§1, §3, §16):** SALE is the coordinated learner experience built by connecting capabilities that already exist in Scholar. No new learning engine, question engine, competency framework or learner profile. New tables or services only where a verified gap cannot be met by what exists.

## What this tracker is, and is not

- It is the **programme-level** tracker: one row per SALE deliverable (SALE-00..19), the release map R0-R5, the governance gates and the §15 acceptance map. It **duplicates no tickets**. Each row links to the record that owns the detail:
  - **LEARNING-CLOSE tracker** — `docs/programme/LEARNING-CLOSE-2026-11-TRACKER.md` (on `main`): Learning Engine, CYU, CE, AI, Governance and Release rows (CYU-, LE-, CE-, AI-, GOV-, REL-, OPS-, CLOSE-IDs).
  - **SQIE-CLOSE tracker** — expected at `docs/programme/SQIE-CLOSE-2026-11-TRACKER.md`, being written in session `local_47d101bd` on branch `docs/sqie-close-tracker`; it lands later. Until it lands, SQIE status here is "closure pending" and the SQIE-nn IDs are the owner's baseline (SQIE-01..11, directive SQIE-CLOSE-2026-11 §10). **The path is the expected one and must be confirmed when that tracker lands.**
  - **SCHOLAR-CE-2026 register** — `docs/programme/SCHOLAR-CE-2026-REGISTER.md` (reconciled 4 Nov): the per-workstream narrative for CE-01..CE-07.
- It is **not** a claim of verified repository status for the new adaptive rows. Directive §11: "These are planning baselines." For SALE-04..19, "Current state" lists only what a targeted read of `main` found to exist and be reusable. Where something was not looked for, the cell says **not assessed**.
- **Merged is not Complete** (carried from the LEARNING-CLOSE directive and §14 rule 9). **No row is Complete at creation.**

**Status values (the owner's, exact):** Not started · Implementing · Ready for review · Blocked · Ready for release · Live — verification pending · Complete.
**Status rule:** a row's status is its overall status. Where its parts differ, the parts are named in Current state with their own tracker IDs and statuses. A row whose required work has not begun is "Not started" even when related building blocks are live; those blocks are listed so they are reused, not rebuilt.

## Release map (§12)

The mapping of rows to releases is **proposed** where the directive lists contents only by theme (marked †). Dates are not set by the directive and none is invented here.

| Release | Contents (directive §12) | Rows | Exit condition (directive) | Status now |
|---|---|---|---|---|
| **R0 — Foundation** | Existing engine completion, CYU and register reconciliation | SALE-00, 01, 02, 03; SALE-17 (CE-07C part)†; SALE-16 (flashcards activation, cost queries)† | Stable integrated foundations | **In progress.** Live, not yet verified at learner level: CYU-01..04, LE-01..05, CE-07C (DB through 960, app `09d9da09`). Open: flashcards AI activation (blocked on the AI-01 clinician), AI cost comparison queries (AI-03, after AI-02), SQIE gaps (reconciliation pending), CE-04/CE-05 (Wave 2, own session starting), CE-06A-1, CE-07A/B (Wave 3) |
| **R1 — Adaptive Core** | Learning-state view, misconception identification, targeted reteaching | SALE-04, 05, 06, 07 | Demonstrable adaptive teaching loop | **Built, in review.** PR #276 (head 45605bd2, no migration; claim **970-979** unused so far). SALE-04..07 Ready for review. Staging walk at 390 px passed: a wrong answer led to "Explain my mistake" with its reason; then a different question answered right led to "Challenge me", and Progress went from 14 to 15. Not in R1: SALE-08, SALE-09, SALE-10 |
| **R2 — Retention** | Retrieval scheduling, prerequisite pathways, transfer checks | SALE-08, 09, 10 | Personalised review and progression | Not started |
| **R3 — Learning Workspace** | My Plan recommendations and active Notebook | SALE-11, 12 | Connected daily learning experience | Not started |
| **R4 — Application** | Clinical cases, simulation and competency evidence integration | SALE-13, 14 | Traceable application evidence | CE-04/CE-05 Wave 2 built in PR #275 (open, no migration, keys default off; claim **980-989** unused so far), tracked under SALE-13 |
| **R5 — Optimisation** | Evaluation, analytics, efficiency and final improvements | SALE-15, 16, 17†, 18, 19 | Measured outcomes and closure evidence | Not started |

**Sequencing rules (§12, §14):** independent workstreams proceed in parallel. **R1 is not held for the optional CE voice and simulation enhancements** (CE-04, CE-05, CE-06, CE-07 remaining work). Migration numbers: 970-979 R1 Adaptive Core; 980-989 CE-04/CE-05; any other claim goes through the coordinator.

## Summary

| ID | Deliverable | Priority | Release | Owner | Status | Dependencies | Blocker | Completed |
|---|---|---|---|---|---|---|---|---|
| SALE-00 | Reconcile existing registers | P0 | R0 | Coordinator + tracker session | Implementing | Current production evidence; SQIE-CLOSE tracker | SQIE reconciliation pending (session local_47d101bd) | — |
| SALE-01 | Complete Learning Engine gaps | P0 | R0 | Coordinator (LEARNING-CLOSE) | Implementing | Existing LE tickets | Flashcards AI activation awaits the AI-01 clinician; learner-level walks not done | — |
| SALE-02 | Complete SQIE gaps | P0 | R0 | SQIE session (local_47d101bd) | Implementing | Existing SQIE tickets | SQIE PRs #269-#273 open; scoring workstreams (WS-B/C/A) still building | — |
| SALE-03 | Complete CYU integration | P0 | R0 | CYU session | Live — verification pending | SALE-01, SALE-02 | Learner-level production walk; CYU-02 scope (other question kinds not yet inside a lesson) | — |
| SALE-04 | Unified learning-state view | P0 | R1 | R1 session (PR #276) | Ready for review | Activity records | — (awaits PR #276 review) | — |
| SALE-05 | Misconception identification | P0 | R1 | R1 session (PR #276) | Ready for review | SALE-04 | — (awaits PR #276 review) | — |
| SALE-06 | Adaptive teaching selection | P0 | R1 | R1 session (PR #276) | Ready for review | SALE-05 | — (awaits PR #276 review) | — |
| SALE-07 | Corrective teaching loop | P0 | R1 | R1 session (PR #276) | Ready for review | SALE-06, SQIE | — (awaits PR #276 review) | — |
| SALE-08 | Retrieval scheduling | P1 | R2 | Not assigned | Not started | SALE-04 | SALE-04 | — |
| SALE-09 | Prerequisite mapping | P1 | R2 | Not assigned | Not started | Competency frameworks | — | — |
| SALE-10 | Transfer-of-learning assessment | P1 | R2 | Not assigned | Not started | SQIE, SALE-04 | SALE-04 | — |
| SALE-11 | Next-best-action recommendations | P1 | R3 | Not assigned | Not started | SALE-04, My Plan | SALE-04 | — |
| SALE-12 | Active Notebook integration | P1 | R3 | Not assigned | Not started | Existing Library work (CE-02) | — | — |
| SALE-13 | Clinical application integration | P1 | R4 | CE-04/05 session (PR #275) | Implementing | CE-04/05, SQIE | PR #275 review; clinical review and approval; owner decisions (CE-05 policy D-3, D05 retention, CE-04 switch) | — |
| SALE-14 | Competency evidence integration | P1 | R4 | Not assigned | Not started | Framework mappings | — | — |
| SALE-15 | Learning-effectiveness analytics | P1 | R5 | Not assigned | Not started | Learning event data | SALE-04 and pilot data | — |
| SALE-16 | Cost and latency optimisation | P1 | R0 part, R5 | Coordinator (AI) | Blocked | AI monitoring | AI-01 clinician, then AI-02, then AI-03 (LEARNING-CLOSE) | — |
| SALE-17 | Accessibility and low-bandwidth work | P1 | R0 part, R5 | CE-07 / CE-06 sessions | Not started | CE-06, CE-07 | Wave 3 not started | — |
| SALE-18 | Pilot evaluation | P1 | R5 | Scholar Product Lead | Not started | Core adaptive experience | R1-R3 live | — |
| SALE-19 | Final acceptance and closure | P0 | R5 | Scholar Product Lead + Coordinator | Not started | All required acceptance criteria | All other rows | — |

## Rows (detail)

Per row: Current state (what exists on `main` / in production, read 4 Nov 2026), Acceptance criteria, PR / migration, Environment, Evidence. Owner, Status, Dependencies, Blocker and Completed date are in the summary table above and are repeated here only where more detail is needed.

### SALE-00 — Reconcile existing registers (P0, R0)
- **Current state:** Learning Engine and CE reconciled and merged (PR #264, `661caf17`): `LEARNING-CLOSE-2026-11-TRACKER.md` (all rows with owner's status values, decision register, production facts) and `SCHOLAR-CE-2026-REGISTER.md` (CE-01..CE-07 reconciled with PR refs, live versus switch, gaps as IDs). SQIE reconciliation is in progress in session `local_47d101bd`, branch `docs/sqie-close-tracker` (SQIE-01 "production implementation reconciliation", baseline "Pending verification"); not yet on `main`. This tracker is the programme-level index over all three.
- **Acceptance criteria:** the three records reconcile to production; every open item has one owner row in exactly one tracker; this tracker links and duplicates nothing.
- **PR / migration:** #264 (merged 661caf17); this PR (SALE-00). No migration.
- **Environment:** documentation. **Evidence:** the two trackers above; the SQIE-CLOSE tracker when it lands.

### SALE-01 — Complete Learning Engine gaps (P0, R0)
- **Current state (detail in the LEARNING-CLOSE tracker):** CYU-01..04 (PR #265, migration 950) and LE-01..05 (PR #266, migration 955) deployed 4 Nov and **Live — verification pending**; CE-07C (PR #267, migration 960) Live — verification pending; learner-level production walks not done. Open from directive §4.1: **flashcard AI settings** (AI-01 clinical review pack delivered, Ready for review, reviewer not yet named; AI-02 Blocked on AI-01; the package is **not applied** in production); **AI cost comparison queries** (AI-03 Blocked on AI-02; baseline measured; queries in `docs/evidence/SCHOLAR-INDEPENDENT/p3-monitoring-queries.md`). Three-round Go Deeper retained and now an HQ policy (`scholar_learn_deeper_rounds_max`, default 3; LE-04).
- **Acceptance criteria (§4.1):** all §4.1 bullets complete and verified; LEARNING-CLOSE rows CYU-01..04, LE-01..05, AI-01..03 each at Complete.
- **PR / migration:** #265 (950), #266 (955), #267 (960); flashcards package is configuration, no code.
- **Environment:** production (deployed), verification pending. **Evidence:** LEARNING-CLOSE tracker "Production facts"; `docs/evidence/LEARNING-CLOSE-WS03/`, `SCHOLAR-CYU/`, `SCHOLAR-CE07/`.

### SALE-02 — Complete SQIE gaps (P0, R0)
- **Current state (4 Nov update):** SQIE PRs are open: **#269** the SQIE-CLOSE tracker (the source of truth for SQIE status, linked from here once merged), **#270** pilot batch, **#271** WS-H/J, **#272** HQ library (migrations **995/996**), **#273** records (migrations **990/991**). The scoring workstreams (WS-B/C/A) are still building. SQIE migration numbers 990/991 and 995/996 are claimed by SQIE and are separate from the SALE claims 970-979 and 980-989. Earlier: SQIE-CLOSE reconciliation was pending in session `local_47d101bd`. Directive baseline for SQIE-01..11 is in `SQIE-CLOSE-2026-11-owner-directive.md` (coordinator folder), several rows "Verify gaps" / "Partially complete". Known repository evidence reused rather than re-audited: format registry and marking (#236), rubric snapshots (migration 791), question-library migrations 800-802, SQIE acceptance records `docs/evidence/SCHOLAR-SQIE/acceptance-2026-10-30.md` and `acceptance-2026-11-01.md`, `docs/evidence/SQIE-LIBRARY/800-802-build-record.md`, adaptive selection from missed misconceptions (`scholar/misconception.ts`, 30-day, no model). Not assessed here: structured/multi-part gaps, HQ question management, question quality analytics.
- **Acceptance criteria (§4.2):** structured and multi-part questions; format-specific scoring; persistent rubric snapshots; Question Library governance and reuse; HQ question management; competency mapping; adaptive question selection; learner attempt history; question quality analytics; source grounding and clinical safety. CYU consumes the shared question infrastructure and SQIE does not duplicate CYU.
- **PR / migration:** to be recorded by the SQIE-CLOSE tracker. **Environment:** production (existing), gaps to be verified. **Evidence:** SQIE-CLOSE tracker (pending).

### SALE-03 — Complete CYU integration (P0, R0)
- **Current state:** CYU-01..04 live (see LEARNING-CLOSE tracker): checks distributed through lessons (policy `scholar_learn_check_placement`, default distributed), answers and judgement kept on the existing 416 attempts (migration 950, learner-owned), history and Try again, Saved learning list, self-review path with no AI. **Scope limit:** other question kinds are not yet offered inside a lesson (CYU-02 partial). **Not verified:** My Plan, competency evidence views and Personal AI context beyond Saved learning (CYU-04).
- **Acceptance criteria (§4.1, §6.1):** CYU reuses SQIE formats and marking with no second question engine; results appear in session context, My Plan, Notebook, competency evidence views and Personal AI context within permissions; repeated attempts distinguishable.
- **PR / migration:** #265, migration 950. **Environment:** production, verification pending. **Evidence:** `docs/evidence/SCHOLAR-CYU/950-build-record.md`; staging walk in the coordinator folder `LEARNING-CLOSE-WS01-CYU/`.

### SALE-04 — Unified learning-state view (P0, R1)
- **Current state (4 Nov update): The unified learning-state view per topic is built from existing evidence, with starting rules and uncertainty shown; keys `scholar_learning_state`, `scholar_learning_state_min_evidence`, `scholar_learning_state_distinct_questions`, `scholar_learning_state_delay_days`, `scholar_learning_state_stale_days`. Built in PR #276 (branch `scholar/sale-r1-adaptive-core`, head 45605bd2, open), reported by the coordinator 4 Nov. **No migration.** Evidence: `docs/evidence/SALE-R1/` on that branch (`build-record.md`, `path-map.md`, walk script and screenshots).** Earlier state: Not built as a unified view. Reusable evidence sources already exist and must be read, not copied: learning events and sessions (migration 414, `individual_scholar_learning_*`, event read action 920), check attempts with outcome and marking (950 on 416 attempts), revision/question attempts with rubric snapshots (416, 791), flashcard review history on the shared SM-2 (`delivery/reinforcement.ts`, migration 391 log), case and OSCE attempts (810, 880), competency mappings (accepted versus proposed, `competency-sources.ts`), and the existing `intelligence.ts` which already keeps coverage, engagement, knowledge and reasoning **separate and unblended**, with insights and recommendations. Dimensions in §5.1 not yet derived anywhere: delayed recall, transfer, confidence, evidence quality and recency as a combined view.
- **Acceptance criteria (§5, Phase 1):** an explainable learning-state summary for a topic from existing evidence; transparent configurable rules; uncertainty shown when evidence is insufficient; no invented mastery score; learner can view the evidence and challenge a topic mapping; never declares verified competence.
- **PR / migration:** #276 (open), no migration.

### SALE-05 — Misconception identification (P0, R1)
- **Current state (4 Nov update): Misconception identification is built on need rules N1-N6. Built in PR #276 (branch `scholar/sale-r1-adaptive-core`, head 45605bd2, open), reported by the coordinator 4 Nov. **No migration.** Evidence: `docs/evidence/SALE-R1/` on that branch (`build-record.md`, `path-map.md`, walk script and screenshots).** Earlier state: Building blocks: every generated item's rubric records its misconceptions (`question-intel.ts Rubric.misconceptions`); `misconception.ts` prefers the next item whose rubric names a misconception the learner just missed (last 30 days, no model, formative); CYU kept judgements carry outcome and feedback parts; the study-session context block already includes rubric misconceptions and "not yet" checks (`study-context.ts`). Not built: a learner-visible, evidence-linked list of likely misconceptions, with repeated-error rules and a way to resolve or challenge one.
- **Acceptance criteria (§5.2, §6.1 step 4):** repeated errors suggest a possible misconception or missing prerequisite on stated rules; one wrong answer is not a diagnosis; the learner sees the evidence.
- **PR / migration:** #276 (open), no migration.

### SALE-06 — Adaptive teaching selection (P0, R1)
- **Current state (4 Nov update): Adaptive teaching selection is built as a teaching rule table T1-T6; keys `scholar_adaptive_teaching`, `scholar_adaptive_reteach_max`, `scholar_adaptive_prerequisite_misses`. Built in PR #276 (branch `scholar/sale-r1-adaptive-core`, head 45605bd2, open), reported by the coordinator 4 Nov. **No migration.** Evidence: `docs/evidence/SALE-R1/` on that branch (`build-record.md`, `path-map.md`, walk script and screenshots).** Earlier state: The teaching strategies exist (Teach me, Explain, Simplify, Go deeper, Guide me, Examples, Challenge me, Summarise) with cumulative context (#257) and a Go deeper round limit (LE-04). **No selection by learning need** is built; the learner or the page chooses. Reuse of saved teaching rather than regeneration exists (Learn served-from-saved, p3-cost).
- **Acceptance criteria (§6.2, §6.3):** the approach is selected from the diagnosed need (factual error to simpler explanation; reasoning error to guided questioning; prerequisite gap to foundations; demonstrated understanding to a harder application); expensive regeneration avoided; reteaching loops limited; clinical model eligibility, sources and risk controls preserved; no new model routing without evidence and approval (§14.8).
- **PR / migration:** #276 (open), no migration.

### SALE-07 — Corrective teaching loop (P0, R1)
- **Current state (4 Nov update): The corrective loop is built: a wrong answer leads to "Explain my mistake" with its reason, then a different question. Built in PR #276 (branch `scholar/sale-r1-adaptive-core`, head 45605bd2, open), reported by the coordinator 4 Nov. **No migration.** Evidence: `docs/evidence/SALE-R1/` on that branch (`build-record.md`, `path-map.md`, walk script and screenshots).** Earlier state: Not built as a loop. Parts exist: a check judged `not_yet` can be retried (CYU Try again), Challenge me and Guide me exist, SQIE can offer a different question on the same misconception (`misconception.ts`). The missing step is the connection: judge, identify the likely error, select the strategy (SALE-06), present a different question, record the result and recommend continue, review or support.
- **Acceptance criteria (§6.1, Phase 2):** a learner's response changes the next teaching action and the system can explain why; the corrective question is a different question; the result is recorded with attempt identifiers; learner remains in control.
- **PR / migration:** #276 (open), no migration.

### SALE-08 — Retrieval scheduling (P1, R2)
- **Current state:** Flashcards and revision review already use a shared SM-2 (`delivery/reinforcement.ts`, `revision.ts scheduleReview`), policy bounds for interval share, longest interval and mastery (REVISION-01 R3), monthly review and the study calendar (#222). Not built: retrieval scheduling for concepts assessed through lessons, questions and cases (not only flashcards), using time since practice, prior recall, repeated misconceptions, difficulty, exam priority and learner availability.
- **Acceptance criteria (§7.1):** timely retrieval recommended without forcing all learning into flashcards; evidence-based defaults calibrated with pilot data.
- **PR / migration:** none. **Environment:** development. **Evidence:** none yet.

### SALE-09 — Prerequisite mapping (P1, R2)
- **Current state:** Competency prerequisite relations exist at Holdings scope (`competency_dependencies` read in `competency/foundation.ts`: prerequisite / extends / shared-with links per competency). A targeted search found no learner-facing prerequisite recommendation; **not assessed further**. Source-to-competency mappings exist with accepted versus proposed (`competency-sources.ts`).
- **Acceptance criteria (§7.2):** defensible prerequisite gaps identified from approved frameworks, objectives and source mappings; focused prerequisite review recommended only where justified; not every difficulty assumed to be a foundation gap.
- **PR / migration:** none. **Environment:** development. **Evidence:** none yet.

### SALE-10 — Transfer-of-learning assessment (P1, R2)
- **Current state:** Building blocks: evolving scenario format (CE-05, #236, off in production policy), case play and OSCE practice, question formats and rubric snapshots. Not built: a transfer check that selects a new question or scenario on the same concept and records it as transfer evidence.
- **Acceptance criteria (§7.3, Phase 3):** a new question or scenario on an already-taught concept assesses application outside the original lesson, through the existing generation and marking infrastructure, with no duplicate question bank.
- **PR / migration:** none. **Environment:** development. **Evidence:** none yet.

### SALE-11 — Next-best-action recommendations (P1, R3)
- **Current state:** My Plan is live (#225, mig 840) with Today, Calendar, Insights, proposals as learning units (#256), a started-signal (#254), carry-overs, weekly reflection and monthly review; Today shows the next activity (`plan-today-view.ts`). Existing `intelligence.ts` recommendations are separate. Not built: action-typed recommendations from the learning state (review this misconception, an eight-minute retrieval exercise, apply this concept, continue the lesson, revisit a prerequisite). Related open items in the LEARNING-CLOSE tracker: CE-01-1 (Ask about this from Today), CE-01-3 (next step missing from the context block), CE-03 (production walk).
- **Acceptance criteria (§8.1, §8.2):** recommendations name an action, are explainable, and never overwrite learner plans; calendar-first, learner-controlled design preserved.
- **PR / migration:** none. **Environment:** development. **Evidence:** none yet.

### SALE-12 — Active Notebook integration (P1, R3)
- **Current state:** Personal Learning Library live (#218, #228; migration 820): saved lessons with versions, search over saved teaching, notes, bookmarks, highlights, PDF export; one search across materials, lessons, questions and notes; filters by material, topic, session, competency; actions to revise, practise and ask; standalone notes on a material or section; editable notes. Open in the LEARNING-CLOSE tracker: CE-02-1 (notes on a topic need a schema decision), CE-02-2 (acceptance walk). §8.3 items not yet assessed against the code: annotate saved explanations, personal summaries, find related materials, revisit previous misconceptions, generate practice from selected notes, keep context moving between Notebook, lessons and questions.
- **Acceptance criteria (§8.3):** the above, preserving source citations and learner ownership.
- **PR / migration:** none yet. **Environment:** production (Library live), delta not assessed. **Evidence:** LEARNING-CLOSE tracker CE-02, `docs/programme/SCHOLAR-CE-2026-REGISTER.md`.

### SALE-13 — Clinical application integration (P1, R4)
- **Current state (detail in the LEARNING-CLOSE tracker; 4 Nov update):** **Partly delivered by PR #275** (`scholar/ce04-05-wave2`, head 7f661319, open, no migration, every new behaviour behind keys that default to off): conversation verified end to end on staging (blocked on an approved case with a patient voice and the owner switching it on); handover verified on staging; deterioration timeline built (key `scholar_case_deterioration`, staging walk 25/25); delete-attempt built (key `scholar_case_attempt_delete`; D05 retention rule is the owner's); learner debrief review built (key `scholar_case_debrief_review`); CE-05 verified on staging with no code change (D-3 pending). Earlier state: CE-04A multi-turn patient simulation and CE-04D attempt-linked storage are built (#237, migration 880 applied in production, conversation switch default off and unused, 0 rows); CE-04B SBAR handover task live; **CE-04C deterioration clock not built**; CE-05 evolving scenarios built (#236) but the format is excluded from the production policy and needs a clinician read and the owner's policy decision (D-3). A Wave 2 session is starting (migration claim **980-989**). OSCE practice, cases and SQIE marking exist.
- **Acceptance criteria (§9, Phase 5):** reasoning, prioritisation, interpretation of findings, evolving scenarios, simulated-patient conversation, structured handover, recognition of deterioration, feedback and debrief on programme-appropriate, clinically governed content; no leakage of future scenario information; correct answer not exposed early.
- **PR / migration:** #236, #237, mig 880 (applied); #275 (open, no migration). **Environment:** production (switches off). **Evidence:** `docs/evidence/CASE-CONVERSATION/880-build-record.md`; LEARNING-CLOSE tracker CE-04A..D, CE-05.

### SALE-14 — Competency evidence integration (P1, R4)
- **Current state:** Building blocks: accepted source-to-competency mappings, My Competencies Explorer (#249; "Material linked" never "Practised"), Scholar self-assessment through checklist instruments (#243), competency learning-intelligence coverage, the approved nursing staging rules and profession-neutral framework layer, and the checklist/audit scoring work (a separate governed workstream, GOV-03). **Not built or not assessed:** learning activities contributing traceable, labelled evidence to competencies with the three views kept apart (self-assessment, learning evidence, verified competence).
- **Acceptance criteria (§9):** traceable evidence from learning activities to relevant competencies; no automatic award of competency stages from formative scores; profession-specific frameworks stay independent; nothing misrepresents formative performance as independent verification.
- **PR / migration:** none. **Environment:** development. **Evidence:** none yet.

### SALE-15 — Learning-effectiveness analytics (P1, R5)
- **Current state:** HQ Learner Engagement dashboard live (#248, migration 910): engagement, not learning effectiveness. The measures in §10.1 (immediate understanding, misconception resolution, delayed recall, transfer, independent reasoning, study efficiency, AI cost efficiency, learner experience) are not computed; most need SALE-04 evidence and pilot data. Identifiable-name access is decided (executive level, six positions; GOV-01).
- **Acceptance criteria (§10.1, §10.2):** baselines established from the first pilot (no invented targets); standard versus adaptive comparison where feasible; seven-day retention where feasible; small samples interpreted cautiously; engagement is not presented as proof of learning.
- **PR / migration:** none. **Environment:** development. **Evidence:** none yet.

### SALE-16 — Cost and latency optimisation (P1, R0 part and R5)
- **Current state (detail in the LEARNING-CLOSE tracker):** AI cost measured on staging and production (p3-cost: scenarios 59 %); flashcards as their own activity with fallback and the tier from the published policy per activity are in code (#259); monitoring queries exist (`p3-monitoring-queries.md`, baseline about USD 1.37 over 30 days). The flashcards configuration package is **not applied** in production and is **Blocked on AI-01** (clinician not yet named). AI-03 (comparison), AI-04 (report) and AI-05 (recommendations) follow. Metering stays off during the pilot (revisit on or after 20 Nov 2026; GOV-02). Mapping stays on Sonnet and questions on Opus (no model cleared the bar).
- **Acceptance criteria (§10.3):** reuse of approved artifacts first, non-AI retrieval and scheduling where sufficient, efficient context, approved lower-cost models only where quality is demonstrated, monitoring of expensive activities; no compromise of clinical safety or privacy; no new routing without evidence and approval (§14.8).
- **PR / migration:** #259, #262 (code, evidence); configuration only. **Environment:** production (configuration pending). **Evidence:** `docs/evidence/SCHOLAR-INDEPENDENT/p3-*.md`, `AI-01-flashcard-clinical-review.md`.

### SALE-17 — Accessibility and low-bandwidth work (P1, R0 part and R5)
- **Current state (detail in the LEARNING-CLOSE tracker and the CE register):** CE-06A read-aloud live on most surfaces (#234, #239, #241); **CE-06A-1** (Listen on the lesson reader and OSCE; persisted resume) and **CE-06B** (spoken conversation; HQ voice controls) not started. CE-07C slow-network uploads live (#267, migration 960; real-device test outstanding). **CE-07A** (smaller downloads) and **CE-07B** (data-saver) not started; scope notes for them are in the #267 body. These Wave 3 items are tracked independently and do not hold R1.
- **Acceptance criteria:** LEARNING-CLOSE directive §6.5 and §6.6 and the CE-06/CE-07 rows; accessible text alternatives kept; testing under representative constrained networks, repeated on a real device in Wave 4.
- **PR / migration:** #234, #239, #241, #267 (960). **Environment:** production (partial). **Evidence:** `docs/evidence/SCHOLAR-CE07/`; CE register.

### SALE-18 — Pilot evaluation (P1, R5)
- **Current state:** Not started. Depends on a working adaptive core (R1-R3) and learning-event data. There is a controlled invite-only pilot context (owner pilot directive 25 Oct); no evaluation design exists in the repository.
- **Acceptance criteria (§10.2):** baselines from the first pilot; comparison design with equivalent objectives and comparable items; retention at practical intervals including about seven days; stated limitations.
- **PR / migration:** none. **Environment:** production pilot. **Evidence:** none yet.

### SALE-19 — Final acceptance and closure (P0, R5)
- **Current state:** Not started. Closure is the §15 acceptance map below, plus governance, data protection, reliability, accessibility and measured operational cost; every required row at Complete; remaining gates resolved or explicitly left open by the owner.
- **Acceptance criteria:** §15 items 1-10 each demonstrated, with evidence; final milestone report (§16).
- **PR / migration:** none. **Environment:** production. **Evidence:** none yet.

## Governance gates (§13): explicit, not inferred

Inclusion in this roadmap is not approval (§13). These remain gates; details are in the LEARNING-CLOSE tracker.

| Gate | Owner | State (4 Nov 2026) | Affects |
|---|---|---|---|
| Independent clinical review of flashcard outputs (AI-01); reviewer not yet named | Owner names clinician | Pack delivered, Ready for review | SALE-01, SALE-16 |
| **Owner decision (R1): eight new HQ policy keys DEFAULT ON** (`scholar_learning_state` and its four thresholds, `scholar_adaptive_teaching`, `scholar_adaptive_reteach_max`, `scholar_adaptive_prerequisite_misses`), unlike the CE-04/05 keys which default off. Once PR #276 is merged and deployed the adaptive behaviour is on for learners unless HQ publishes the policies off. Thresholds are uncalibrated starting rules, to be recalibrated against SALE-15/18 | Owner | Open, flagged by the coordinator | SALE-04..07 |
| Owner GO for any production migration (970-979, 980-989 when they exist; SQIE 990/991, 995/996) | Owner | Not requested | SALE-04..07, SALE-13 |
| CE-05 scenario policy activation (D-3) and a clinician read of scenarios | Owner + clinician | Pending (owner asked for an explanation) | SALE-10, SALE-13 |
| CE-04 conversation switch, a clinically approved case with a patient voice, retention rule (D05) | Owner + clinical governance | Switch off, unused; 880 applied | SALE-13 |
| AI metering | Owner | Off during the pilot; revisit on or after 20 Nov 2026 | SALE-16 |
| Nursing audit scoring (GOV-03, separate governance workstream) | Clinical governance | Blocked on approvals | SALE-14 (dependency only) |
| LEARNING-01 payments | Owner | Deferred; revisit 18 Nov 2026 | none (parallel commitment) |
| No unapproved clinical model substitution; no automatic publication of learner-generated questions; no private learner conversations used as unrelated AI memory; no unsupported claims of clinical competence | Standing | In force | all rows |

## Final acceptance map (§15)

| # | A learner can | Rows |
|---|---|---|
| 1 | Begin or resume a learning session | SALE-01, SALE-03 (live; verification pending) |
| 2 | Receive appropriate teaching grounded in their materials | SALE-01, SALE-06 |
| 3 | Demonstrate understanding through relevant questions | SALE-02, SALE-03 |
| 4 | Receive targeted correction after a misconception | SALE-05, SALE-07 |
| 5 | Demonstrate improved understanding on a different question | SALE-07, SALE-10 |
| 6 | Receive appropriate retrieval recommendations over time | SALE-08, SALE-09 |
| 7 | Apply knowledge in a suitable new scenario | SALE-10, SALE-13 |
| 8 | View meaningful learning evidence and progress | SALE-04, SALE-14, SALE-15 |
| 9 | Receive a useful recommendation for what to do next | SALE-11, SALE-12 |
| 10 | Retain learning history across sessions and supported devices | SALE-03, SALE-12, SALE-17 |
| + | Governance, data protection, reliability, accessibility, measured operational cost | SALE-16, SALE-17, SALE-19, the gates above |

## Change log

| Date | Change |
|---|---|
| 4 Nov 2026 | R1 Adaptive Core built: PR #276 (head 45605bd2, open, no migration). SALE-04..07 Ready for review; 390 px staging walk passed (wrong answer to "Explain my mistake" with reason; a different question right to "Challenge me"; Progress 14 to 15). Eight new HQ policy keys default ON (owner decision recorded as a gate); thresholds uncalibrated starting rules to be recalibrated against SALE-15/18. SALE-08/09/10 not in R1 |
| 4 Nov 2026 | Wave 2 and SQIE update: SALE-13 partly delivered by PR #275 (open, no migration, keys default off); SALE-02 notes SQIE PRs #269 (tracker), #270, #271, #272 (995/996), #273 (990/991), scoring still building. SQIE-CLOSE path confirmed `docs/programme/SQIE-CLOSE-2026-11-TRACKER.md`. LEARNING-CLOSE tracker updates now ride on this branch, so one PR carries both trackers |
| 4 Nov 2026 | Created (SALE-00): rows SALE-00..19 from directive §11, release map R0-R5 from §12, gates from §13, acceptance map from §15. Current facts from the coordinator: LE Wave 1 live (CYU-01..04, LE-01..05, CE-07C; DB through 960; app `09d9da09`), not yet verified at learner level; open in R0: flashcards AI activation (AI-01 clinician), AI cost queries, SQIE gaps pending, CE-04/CE-05 Wave 2 starting, CE-06A-1, CE-07A/B; R1 (SALE-04..07) starting in a separate session, migration claim 970-979; CE-04/05 claim 980-989. No row Complete |
