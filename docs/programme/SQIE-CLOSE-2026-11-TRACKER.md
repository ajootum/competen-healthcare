# SQIE-CLOSE-2026-11 — the authoritative SQIE tracker (SQIE-01)

**Authority:** owner directive SQIE-CLOSE-2026-11, 4 Nov 2026 (§10: "create or update the authoritative tracker"). No SQIE development register existed in the repository before this file (searched `docs/**` for "SQIE": only the acceptance and build records below), so this file is that register.
**Created:** 4 Nov 2026 by SQIE-01, against `main` @ `661caf17`. **Production at creation:** app `09d9da09` (every code commit on `main`; `661caf17` adds only the docs PR #264), DB head 960. Every SQIE migration (416, 417, 442, 710, 791, 800, 801, 802, 950) is applied in production (Q0 below).
**Scope:** docs and evidence only. No code or migration was changed. Unchanged, already-proven functionality was not re-tested (directive §2).

**Status values (directive §2):** Complete · Partially Complete · Not Started · Blocked.
**Rule:** a row is **Complete** only when it is live in production, has recorded acceptance evidence, and has no buildable gap in its own scope. **Merged is not Complete.** Priority is the directive's; a priority this tracker adds is marked *(proposed)*.
**Environment:** where a row's code runs today. Because production app = `main`, "production" below means live code; whether it has been *used* in production is stated separately from the production facts.

**Builds that made SQIE (all merged and live):** #181 (paper-parser-v2, rubrics, five-part feedback; live 47c41763, 30 Oct) · #184 (request-scoped risk, supportive refusal, recovery fixes; live 19f818df) · #190 (structured questions, mcq/case rubrics, library reuse over 710; live b96b506d) · #192 (adaptive, flashcards, OSCE) · #206 (HQ question catalogue, duplicates, source rights, item performance, SQIE monitoring, legacy-checked audit) · #207 (true/false, extended, rubric snapshot, misconception next) · #208 (791 attempt snapshots) · #210 (800-802 library formats, retirement, learner offers) · #236 (format registry `question-formats.ts`, evolving scenario) · #265 (CYU Wave 1, 950).
**Acceptance evidence:** `docs/evidence/SCHOLAR-SQIE/acceptance-2026-10-30.md` (runs 5-7), `acceptance-2026-11-01.md` (run 8, staging, main 86a04381: 43 passed, 2 harness-wording failures, $0.1544); `docs/evidence/SCHOLAR-QUESTIONS/710-build-record.md`; `docs/evidence/SQIE-LIBRARY/800-802-build-record.md`.

## Summary — §10 baseline

| ID | Deliverable | Priority | Directive said | Status | Main gap (workstream, below) |
|---|---|---|---|---|---|
| SQIE-01 | Production implementation reconciliation | P0 | Pending verification | Partially Complete | Q0-Q15 recorded; PR #269 open (Complete when merged) |
| SQIE-02 | Structured question formats | P0 | Verify gaps | Partially Complete | No calculation format (WS-A); justification/interpretation not scored formats (WS-C) |
| SQIE-03 | Multi-part question rendering and scoring | P0 | Verify gaps | Partially Complete | No unsafe-response handling in written formats; case criteria weight/safety unused (WS-B) |
| SQIE-04 | Rubric snapshots and attempt history | P0 | Implemented — verify | Partially Complete | CYU checks keep no 791 snapshot; no framework version; scenario feedback not five-part (WS-D) |
| SQIE-05 | Question Library governance | P0 | Partially complete | Partially Complete | Built and governed; **0 library questions in production**; no programme/level/difficulty (WS-E) |
| SQIE-06 | HQ Question Management | P1 | Verify | Partially Complete | No bulk actions, competency picker, programme/level filters (WS-E) |
| SQIE-07 | Competency framework mapping | P0 | Verify | Partially Complete | No framework version on attempts; no stage guard test (WS-D, WS-H); 0 mapped in production |
| SQIE-08 | Check Your Understanding integration | P0 | Coordinate with CYU | Partially Complete | Reuses SQIE storage; no snapshot (WS-D). Format scope = CYU-02 (LEARNING-CLOSE), not duplicated |
| SQIE-09 | Adaptive question selection | P1 | Verify | Partially Complete | Library reuse MCQ-only (WS-F); no acceptance run recorded (WS-J) |
| SQIE-10 | Learner analytics and misconception tracking | P1 | Verify | Partially Complete | Learner side present; by-type only mcq/case; HQ per-format, discrimination, cost per answer (WS-G) |
| SQIE-11 | Question quality and safety checks | — *(row truncated)* | — *(row truncated)* | Partially Complete | No deterministic stem-leak check for mcq/short; no identifier screen on generated mcq/case (WS-H) |
| SQIE-12 | AI cost and question reuse optimisation | P1 | *(restored by owner, 4 Nov)* | Partially Complete | Reuse is measured (30-day monitoring); **production metering was off at the checkpoint, so no production cost data exists** (Q12); WS-G |
| SQIE-13 | Legacy question-paper requirements | P2 | *(restored by owner, 4 Nov)* | Complete | Legacy rechecking complete (C-15); no work remains |
| SQIE-14 | End-to-end acceptance and register closure | P0 | *(restored by owner, 4 Nov)* | Not Started | Needs production acceptance evidence for every completed workstream; open clinical and governance dependencies listed in its row |

## Summary — §2 components

| ID | Component | Status | Environment |
|---|---|---|---|
| C-01 | AI question generation | Complete | Production |
| C-02 | Source grounding and citations | Complete | Production |
| C-03 | Clinical safety and model eligibility | Complete | Production |
| C-04 | Answer evaluation and feedback | Partially Complete | Production |
| C-05 | Check My Attempt | Complete | Production |
| C-06 | Adaptive question generation | Partially Complete | Production |
| C-07 | Adaptive examinations | Partially Complete | Production |
| C-08 | Multi-part and structured questions | Partially Complete | Production |
| C-09 | Rubric snapshots and attempt history | Partially Complete | Production |
| C-10 | Question Library | Partially Complete | Production (empty) |
| C-11 | HQ Question Management | Partially Complete | Production |
| C-12 | Competency mapping | Partially Complete | Production |
| C-13 | Learner question history | Partially Complete | Production |
| C-14 | Question analytics | Partially Complete | Production (no cost data: metering off) |
| C-15 | Legacy question-paper rechecking | Complete | Production |

## §2 component rows

Paths: `S/` = `src/lib/individual/scholar/`, `R/` = `src/app/api/individual/scholar/`, `K/` = `src/lib/knowledge/`, `A/` = `src/lib/ai/`. `RC` = `src/app/individual/(app)/[experience]/(scholar)/study/_components/revision-client.tsx`.

| ID | Deliverable | Current state (verified) | Status | Gap (concrete, buildable) | Priority | Dependency | Environment |
|---|---|---|---|---|---|---|---|
| C-01 | AI question generation | Activity `questions` (`S/ai-standing.ts:20`); `scenarios`/`flashcards` fall back to it (`:36`). Every call via `runMeteredAi` (`S/http.ts:118-137`). Level and programme in the prompt (`S/question-context.ts:32-60`, `S/question-intel.ts` "MY LEVEL"); competency/outcome in the prompt (`S/question-intel.ts:82-95`). Run 8 A2a-d PASS. Production: 24 learner questions across 8 kinds (Q4). Routing lists Sonnet first, but eligibility filters the route above standard educational (`A/model-routing.ts:104` `clinicalGate`, `:99` `selectRoute`; `A/allowance.ts:262`, `:356`). Only Opus is eligible for `questions` (Q9), so questions run on Opus. | Complete | None. Q14 (4 Nov): the published `questions` floor is `clinical_educational`, so eligibility always applies and questions run on Opus only. | P0 | — | Production |
| C-02 | Source grounding and citations | Quote must be in the passage (`quote_not_in_passage`, `S/generation.ts` `checkQuestions`). Options and key must be supported (`S/question-quality.ts:52-97`). Withhold on no evidence (`R/questions/route.ts`, `withheld`). Explanations cite `[S n]`, withheld on bad citation (`S/generation.ts:111-134`). Run 8 B1-B3 and C1-C2 PASS. | Complete | — (question items cite notes only, never research references: by design, `S/generation.ts:314`) | P0 | — | Production |
| C-03 | Clinical safety and model eligibility | Three risk tiers (`A/clinical-risk.ts:24`, `classifyRisk` `:213`). Subject classified per request (`S/http.ts:91-107`). Real-patient decision support refused with reason-specific text (`A/allowance.ts`, `REFUSAL` `A/operating-mode.ts`). Eligibility gate fails closed (`A/allowance.ts:285-300`, `:340-358`). Run 8 D1-D3 PASS (D1 harness wording only). | Complete | — | P0 | Q14 | Production |
| C-04 | Answer evaluation and feedback | Five-part feedback right/missing/misconceptions/why/next (`S/question-intel.ts:261-278`). `runEvaluate` (`S/generation.ts:1199`) on activity `evaluate` (Sonnet 4.6, eligible per D5-v4, Q9), self-mark fallback (`R/revision/answer/route.ts:140-199`). Run 8 A3 PASS. Production: 0 `ai_evaluation` attempts yet (Q6). | Partially Complete | (1) Scenario feedback stored as summary only, `parts: null` (`R/revision/scenario/route.ts:113`); keep the five parts (WS-D). (2) No unsafe-response flag in evaluator output (WS-B). | P0 | — | Production |
| C-05 | Check My Attempt | Paper "Check my attempt" on `deeper` (Opus, Q9), `exam-answer-v2` (`S/exam-answer.ts:28`, `:95-106`). Feedback checked separately against the evidence, else withheld (`:184-196`). Identifier screen (`S/exam-service.ts:292`). Run 8 A6 PASS. | Complete | — | P0 | — | Production |
| C-06 | Adaptive question generation | Rule-based difficulty: 3 correct up, 2 of last 3 missed down (`S/question-intel.ts:323-331`, `S/config.ts:249`). Generates on `questions` (`S/adaptive-service.ts`). Unit-tested (`S/adaptive.test.ts`). | Partially Complete | No acceptance scenario recorded for adaptive in the SQIE harness (WS-J). Difficulty is model-declared (1-3), not calibrated: see C-14. | P1 | — | Production |
| C-07 | Adaptive examinations | Selection (`S/adaptive.ts:228-258`): library first, then own, then generated. Misconception-led pick (`:241`). Formats mcq, mrq, short, match, sequence, structured (`S/question-formats.ts` `adaptive`). Blueprint in the set `scope`; the engine writes only `calls`/`served`/`pending` (`S/adaptive.ts:269-278`). No scoring standard; report labelled a practice estimate (`S/config.ts:251`, test `S/adaptive.test.ts:269-277`). §8 "must not silently change blueprints": met. | Partially Complete | Library copies are MCQ only (`S/adaptive-service.ts:93-109`); copy the other adaptive formats the library holds (WS-F). | P1 | C-10 content | Production |
| C-08 | Multi-part and structured questions | Structured: 2-4 parts, marks 1-5 (710; `S/revision.ts:220-237`; RC:618). Evolving scenario: 2-4 stages, server-revealed under HMAC (`S/scenario.ts:13-16`, `:148-182`; RC:458). Multi-part patient case: 2-4 stages (`src/lib/cases/blueprint.ts`, `case-client.tsx`). | Partially Complete | See §3 table: calculation absent (WS-A); justification not scored, interpretation only a case dimension (WS-C); scenario has no library form (`library: null`). | P0 | — | Production |
| C-09 | Rubric snapshots and attempt history | 791 snapshot: presented, response, key, rubric, rubric_hash, score, outcome, marking, feedback, competency_ids, assessed_at (791:55-72). Immutable; corrections append-only (791:97-157). `rubricHash` (`S/rubric-snapshot.ts:35-45`); `questionChanged`/`rubricChanged` keep old attempts interpretable (`S/attempt-snapshot.ts:132-153`). 950 adds `content_version` and `unmarked`. Production: 9 attempts, 9 snapshots, all with rubric and hash, 0 without (Q6, Q7). | Partially Complete | (1) CYU check attempts write no snapshot (`recordCheckAttempt`, `S/store.ts`); 791's marking CHECK has no `unmarked` (WS-D, migration). (2) No framework version or competency content hash on the snapshot (WS-D). (3) Rubric detail capped at 1500 bytes, can drop to `{v, hash}` (`S/rubric-snapshot.ts:27`, `:81-85`). (4) Production: `content_version` null on all 9 attempts (Q6), so they predate 950's writer. | P0 | — | Production |
| C-10 | Question Library | Ten formats (800, `S/library-format.ts`), governed draft, submit, clinical approval and publish (442), single-version retire (801), learner offers (802). Learner copies only of a published, approved version, byte-identical (710 guard). Production: **0 revision_question resources** (Q1-Q3), 1 educator position and 1 publisher position (Q13). | Partially Complete | Code: no programme, level or difficulty on items (`S/library-questions.ts:17-18`) (WS-E). Content: no question has been authored or published (owner/educator action, not engineering). | P0 | Educator appointment and content | Production (empty) |
| C-11 | HQ Question Management | `/super-admin/research/questions` (catalogue, filters, duplicates, performance, retire), `/research/educator` (author, edit draft, version, offers inbox), `/research/knowledge-review` (format-aware `QuestionView`), `/research/knowledge-publication` (publish, retire). | Partially Complete | No bulk actions; competencies typed as CFCA ids (`research/educator/page.tsx:130`); no programme/level/difficulty filter; no per-format correctness (WS-E, WS-G). | P1 | — | Production |
| C-12 | Competency mapping | Question `competency_id` from the leading accepted section link (388; `R/questions/route.ts:102`). Results feed practice views only, as "not verified competence" (`S/competency-progress.ts:9-16`, `S/mastery.ts:17-24`, `S/evaluation.ts:20-24`). No Scholar file imports `src/lib/competency/stage-mapping.ts` or `src/lib/benner.ts`. Production: 0 learner questions mapped, 0 library versions mapped (Q3, Q5). | Partially Complete | (1) No framework version on question or attempt; `framework_competencies` rows are edited in place (751), so an id does not pin a version (WS-D). (2) No test pins "a question score never sets a stage" (WS-H). | P0 | — | Production |
| C-13 | Learner question history | Check history (`listCheckAttempts`, `R/learn/checks`), revision session attempts (`S/store.ts:1029`), mistake notebook (`S/mistakes.ts`), Saved learning. | Partially Complete | No per-question history across revision, adaptive and CYU (WS-I). | P1 | — | Production |
| C-14 | Question analytics | HQ SQIE monitoring per format: accepted/rejected, verification failures, latency, cost per accepted, library reuse, legacy checks (`A/sqie-monitoring.ts:44-104`, `SqieMonitoringPanel.tsx`). Library item percent-correct with a 20-attempt flag (`K/question-performance.ts:21-33`). Learner: mastery, misconceptions (`S/misconception.ts`), change across attempts (`S/progress-history.ts`). | Partially Complete | See §8 table (WS-G). Production has no cost data: metering off, 0 ledger rows (Q12). | P1 | — | Production |
| C-15 | Legacy question-paper rechecking | Papers parsed before `paper-parser-v2` are re-judged read-only when opened (`judgeOpenedPaper`, `S/exam-service.ts`). Codes-only `legacy_checked`/`legacy_redirected` audit. Answer guard returns 409/503 (`legacyStatementRefusal`, tests `legacy-answer-guard.test.ts`, `legacy-paper.test.ts`). Coverage on the monitoring panel. | Complete | No work remains. An unopened legacy paper cannot be answered wrongly: the guard refuses a stored statement. Optional: a read-only count of never-opened legacy papers. | P1 *(proposed)* | — | Production |

## §10 baseline rows

| ID | Deliverable | Current state (verified) | Status | Gap | Priority | Dependency | Environment |
|---|---|---|---|---|---|---|---|
| SQIE-01 | Production implementation reconciliation | This file. Production facts Q0-Q15 recorded below (Q14/Q15 read 4 Nov). PR #269. | Partially Complete | Merge PR #269 | P0 | Owner GO to merge | Docs |
| SQIE-02 | Structured question formats | 12 formats in one registry (`S/question-formats.ts:63-115`); see §3 table | Partially Complete | WS-A calculation; WS-C justification and interpretation | P0 | Clinical tolerance policy (WS-A) | Production |
| SQIE-03 | Multi-part question rendering and scoring | Structured, scenario and case render (RC:618, RC:458, `case-client.tsx`) and score with weights (`S/revision.ts:233`, `S/scenario.ts:182`) | Partially Complete | WS-B: no unsafe/critical handling in structured, extended, scenario or short; case `weight` and `safetyCritical` stored but not scored (`src/lib/cases/blueprint.ts:50`, `src/lib/cases/library.ts:249`) | P0 | — | Production |
| SQIE-04 | Rubric snapshots and attempt history | As C-09; production 9/9 attempts snapshotted with rubric and hash | Partially Complete | WS-D | P0 | — | Production |
| SQIE-05 | Question Library governance | As C-10. Separation of duties is enforced in the database: the reviewer is never the author, editor or submitter (442:463-493, 640 `clinical_review_decision_sod_guard`); the publisher is never the author, submitter or reviewing educator (640 `hq_sod_publication_guard`, trigger `ckri_knowledge_version_sod_publication`, 640:443-482); educator and publish are exclusive per position (500:112, 640:159). An offer never confers authority: a taken offer becomes an educator-authored draft (802:408-415), and submission needs educator review (442:559). Learner offering is off by default (`src/lib/individual/policy.ts:1715-1722`); production has 0 offers (Q8). Migration 940's two-person rule covers assessment versions, not CKRI; CKRI keeps its own stricter rule. | Partially Complete | WS-E metadata. Content: none published. | P0 | Educator content | Production |
| SQIE-06 | HQ Question Management | As C-11 | Partially Complete | WS-E | P1 | — | Production |
| SQIE-07 | Competency framework mapping | As C-12 | Partially Complete | WS-D framework version; WS-H stage guard test | P0 | Learners accepting section mappings (production 0) | Production |
| SQIE-08 | Check Your Understanding integration | CYU-01..04 Live — verification pending (`LEARNING-CLOSE-2026-11-TRACKER.md`, rows CYU-01..04). Reuses SQIE: a check is an `individual_scholar_question` (short/extended), its answer an `individual_scholar_attempt` with five-part formative feedback; lesson, step and session via the 950 learning-event link (`S/learn-check-record.ts:5-10`). No second engine. | Partially Complete | WS-D: check attempts keep no 791 snapshot. The "formats beyond MCQ inside a lesson" gap is CYU-02's and stays in the LEARNING-CLOSE tracker. Checks do not reuse library items: by design, the key is the lesson's own key points. | P0 | CYU-02 (LEARNING-CLOSE) | Production |
| SQIE-09 | Adaptive question selection | As C-06 and C-07 | Partially Complete | WS-F; WS-J acceptance | P1 | C-10 content | Production |
| SQIE-10 | Learner analytics and misconception tracking | Learner: mastery per topic and competency (`S/mastery.ts`), misconceptions over 30 days (`S/misconception.ts:1-12`), first-try versus repeat (`S/progress-history.ts`). Misconception-led next item (#207, `S/adaptive.ts:241`). | Partially Complete | Learner performance by type covers mcq and case only (`S/intelligence.ts:28`) (WS-G) | P1 | — | Production |
| SQIE-11 | Question quality and safety checks | Deterministic checks (`S/question-quality.ts:23-97`); duplicates and objective repeats (`S/question-intel.ts:234-257`); blind verification for mcq/case and six other formats (`S/blind-verify.ts`, policy `scholar_verify_formats`); scenario leak check (`S/revision.ts:296`); HQ duplicate block at submit (`K/educator.ts:157-170`) | Partially Complete | WS-H: no deterministic stem-reveals-answer check for mcq, mrq or short; no identifier screen on generated mcq/case text (`S/generation.ts` `checkQuestions`) | P0 *(proposed)* | — | Production |
| SQIE-12 | AI cost and question reuse optimisation | Reuse versus generation counted for revision and adaptive paths over 30 days (`A/sqie-monitoring.ts`, `SqieMonitoringPanel.tsx`); cost per accepted item per format from the gateway log (`A/sqie-monitoring.ts:60-100`). Routing kept as approved: questions on Opus only (Q9, Q10, Q14). **Production AI metering was disabled at the tracker checkpoint (4 Nov 2026: `ai_fair_use` flag absent, 0 ledger or gateway rows for SQIE operations since 25 Oct, Q12). No production cost figure exists and none is estimated here.** Staging measurements only: run 8 total $0.1544; run 7 about $0.10 per completed revision session (`acceptance-2026-10-30.md`, `acceptance-2026-11-01.md`). | Partially Complete | WS-G (cost per evaluated answer and per completed assessment; reuse counts including CYU); WS-F (library reuse beyond MCQ) | P1 | Owner decision on metering; starter library published | Production (no cost data) |
| SQIE-13 | Legacy question-paper requirements | As C-15: papers kept by an older parser are re-judged read-only on open (`judgeOpenedPaper`, `S/exam-service.ts`), codes-only `legacy_checked` / `legacy_redirected` audit, answer guard 409/503 (`legacy-answer-guard.test.ts`, `legacy-paper.test.ts`), coverage on the SQIE monitoring panel. **Legacy rechecking is complete**: an unopened legacy paper cannot be answered wrongly because the guard refuses a stored statement. | Complete | — (optional read-only count of never-opened legacy papers) | P2 | — | Production |
| SQIE-14 | End-to-end acceptance and register closure | Not started. Closes the register: every row Complete on production acceptance evidence, not on merge. Required evidence per workstream: the change live in production; its acceptance check run once against production or the agreed staging equivalent; a production learner walk where the workstream is learner-facing. **Outstanding clinical and governance dependencies at 4 Nov:** (1) an approved clinical calculation-tolerance policy before any non-zero clinical tolerance (WS-A, decision 1); (2) independent clinical review and authorised publication of the 60-question pilot batch, never auto-published (decision 2); (3) a published nursing framework version with mappings available, and pilot questions mapped to it (decision 3); (4) owner decision on AI metering (SQIE-12, WS-G); (5) owner GO for each production migration (990-994 records, 995-999 HQ) and each deploy; (6) learner question contributions stay off until their policy is approved; (7) the Go deeper routing fact in §9 (owner-visible, routing is the owner's). | Not Started | All SQIE rows Complete | P0 | All rows above | — |

## §3 formats: schema, renderer, scoring

Registry: `S/question-formats.ts` (every format list derives from it). Stored kinds come from 416/710; library content from 800 `ckri_question_format_ok`.

| Format | Schema support | Renderer | Scoring method |
|---|---|---|---|
| Single best answer | kind `mcq` (416); rubric-only `answer` (710:70-75); library `mcq` (800:74-76) | RC:602 | Exact key, 0/1, deterministic (`S/revision.ts:248` `markResponse`) |
| Multiple response | kind `mrq`, 4-6 options (710:75); library (800:77-82) | RC:602 | Partial credit max(0,(hits-wrong)/key) (`S/revision.ts:249-253`) |
| Short answer | kind `short`, `answer.accepted` 1-8 (710:79) | RC:661 | Normalised match (`S/revision.ts:44`), then AI formative `runEvaluate`, else self-mark (`R/revision/answer/route.ts:140-199`) |
| Structured written | kind `structured`, `answer.parts` 2-4, marks 1-5 (710:60-62); library (800:118-122) | RC:618 | Weighted per part: code, then AI per part (full/half/zero), then self (`S/revision.ts:220-237`) |
| Extended response | `short` + `answer.format='extended'` (`S/formats.ts`); library `rubric_ai_formative` (800:96-102). Default off | RC:648 | Share of numbered key points, AI formative, else self (`S/formats.ts:93`, `S/generation.ts:1156-1172`) |
| Clinical reasoning | Private case blueprint (435): decisions single/multiple/free_text/handover; six dimensions (`src/lib/cases/blueprint.ts:39-62`) | `case-client.tsx:308-335` | Choices by code (`S/clinical.ts:147`); SBAR by code (`:159`); free text AI formative verdict (`S/generation.ts:1303`). No per-criterion marks |
| Multi-part patient case | Case 2-4 stages (`S/generation.ts:1234`) | `case-client.tsx` | Debrief counts per dimension (`S/clinical.ts:185`); no weighted total |
| Sequential / evolving scenario | `short` + `answer.format='scenario'`, 2-4 stages (`S/scenario.ts:7-10`); no library form | RC:458 | Per-stage code, then AI, then self; weighted sum (`S/scenario.ts:148-182`) |
| Prioritisation / sequencing | kind `sequence`, 3-6 steps (710:87); library (800:111-117); case dimension "prioritisation" | RC:680 | Position-by-position fractional credit (`S/revision.ts:266-269`) |
| Calculation with units and tolerance | **None** (searched the scholar, cases and knowledge libraries and 416/710/800) | — | — (a number can only be a short-answer string match) |
| Interpretation of findings | No format; case dimension "interpretation" and fact kinds result/investigation only (`src/lib/cases/blueprint.ts:39-43`) | `case-client.tsx` | As for clinical reasoning |
| Justification of decisions | `askReason` on a case decision; reasons kept in 810 `individual_scholar_case_reason` | `case-client.tsx:335` | **Not scored** ("marking is on the choice"); only a free_text decision scores written reasoning |
| Also: true/false, cloze, match, flashcard | `short`+format / `short`+format / kind `match` / kind `flashcard` (416, 800) | RC:637 / 630 / 667 / 528 | Exact key / normalised match / fractional / self-grade quality/5 |

## §5 scoring items

| Item | State | Evidence |
|---|---|---|
| Correct/incorrect | Present | `S/revision.ts:245-278` |
| Partial credit for structured | Present | `S/revision.ts:229-237`; scenario `S/scenario.ts:160` |
| Weighted multi-component | Present (revision); **unused in cases** | `S/revision.ts:233`, `S/scenario.ts:182`; case criterion `weight` never scored (`src/lib/cases/library.ts:249`) |
| Rubric-based clinical reasoning | Partial | Criteria sent to the AI; single verdict back, no per-criterion marks (`src/lib/cases/library.ts:239-252`) |
| Safe calculation tolerance | **Absent** | WS-A |
| Feedback on strengths, errors, omissions | Present (except scenario) | `S/question-intel.ts:261-278`; scenario `parts: null` |
| Clinically unsafe responses | Cases and OSCE only | `safetyCriteria`/`brokenSafety` (`src/lib/cases/blueprint.ts:69`, `S/clinical.ts:210`); OSCE `critical` (`S/osce.ts:57`, `:457-484`). **Absent in revision formats** (WS-B) |
| Versioned scoring rules | Present | `rubricHash`, `evaluator_prompt_version` (416), `question_version lib:<id>` (`S/attempt-snapshot.ts:103`) |
| Exact rubric, response, score, feedback and timestamps per attempt | Present for revision and adaptive; **absent for CYU checks** | 791; production 9/9 (Q7). CYU: WS-D |
| Interpretable after edit | Present | 791 immutable; `questionChanged`/`rubricChanged` |
| AI formative is not verified competence | Present | `S/config.ts:200-359` labels (`MARKING_LABEL.ai_evaluation` "Not verified", `NOT_COMPETENCE_LABEL`); 416 CHECK ties `ai_evaluation` to a recorded model and prompt version |

## §4 library distinctions

| Class | How the code tells it apart |
|---|---|
| Personal AI practice question | `individual_scholar_question.review_status = 'private_formative'`; other values refused by the DB (710:104-105) |
| Learner-contributed draft | `question_contribution_offer` snapshot (802); becomes a CKRI draft of origin `learner_contribution` only when an educator takes it, authored by that educator (802:278-280, 408-415). Learner not named to HQ (`K/learner-offers.ts:12`) |
| Clinically reviewed | Clinical decision on the exact content hash (442:493), reviewer independent (640) |
| Published institutional | `ckri_knowledge_version.state = 'published'` and `ckri_knowledge_approved`; a learner copy is `library_approved` with `library_version_id` (710 guard) |

## §7 evidence boundary

- Self-assessment, learning evidence and verified competence are separate classes: Passport `EvidenceClass` (`src/lib/individual/passport.ts:57-70`), with separate stores for attempts and snapshots (372/416/791), evaluation (426, `verified` always `not_assessed`, `S/evaluation.ts:20-24`) and Checklist Studio assessments (893, which refuses purpose `verification`).
- **No path from a question score to a stage 0-6.** No Scholar file imports `src/lib/competency/stage-mapping.ts` or `src/lib/benner.ts` (searched benner, novice, proficient, stageFor and stage-mapping under `S/`, `R/` and the Scholar pages). It is not pinned by a test (WS-H).

## §8 analytics

| Measure | Learner (Individual) | HQ aggregate |
|---|---|---|
| Attempt frequency | `S/mastery.ts`, `S/progress-history.ts` | per library version (`K/question-performance.ts:25-50`); per competency (441) |
| Correct/incorrect patterns | `S/intelligence.ts` | per library version; 441 knowledge gap |
| By question type | mcq/case only (`S/intelligence.ts:28`) | generation only (`A/sqie-monitoring.ts:14-18`); **no per-format correctness** |
| By topic and competency | `S/mastery.ts`, `S/competency-progress.ts` | per competency (441, cohort-suppressed); **no per-topic** |
| Repeated misconceptions | `S/misconception.ts` | none (441 never reads rubric or stems, by design) |
| Change across attempts | `S/progress-history.ts` | 441 retention |
| Difficulty and quality | — | percent correct and a 20-attempt flag; **no discrimination index** |
| AI generation cost | — | cost per accepted item per format (`A/sqie-monitoring.ts:60-100`), quality-cost panel (`A/outcomes.ts:205-288`); **no cost per evaluated answer or per completed assessment**; production has no data (metering off, Q12) |
| Reuse versus new generation | — | 30-day library offered, picked, copied and reused (`A/sqie-monitoring.ts`), revision and adaptive paths only |
| Privacy | own records only | 441 needs `collective_analytics` consent, cohort ≥ 5 (default 10), complementary suppression. **Library item performance applies neither** (`K/question-performance.ts`, `src/lib/hq/library-item-performance.ts`); counts only, no identity read |

## §9 routing (production)

Questions on Opus 4.8 only (eligibility D5-v2); evaluate on Sonnet 4.6 (D5-v4); deeper on Opus (Q9). The published route order [sonnet, opus] for questions does not matter above standard educational, because `clinicalGate` drops the ineligible Sonnet (`A/model-routing.ts:99-105`). Q14 (4 Nov) confirms it: published floors are questions, evaluate and check `clinical_educational` (no `riskFloor` key for scenarios or flashcards, which fall back to questions). No routing change is proposed.

**Owner-visible fact (Q14, not a change):** the published `deeper` floor is `standard_educational`, and the deeper route lists [sonnet-4-6, opus-4-8] in that order (Q10). At standard educational `clinicalGate` applies no eligibility (`A/model-routing.ts:104`), so **Go deeper on a subject the per-request classifier reads as standard educational can be served by Sonnet 4.6, although Sonnet has no eligibility row for `deeper`** (Q9). A subject the classifier reads as clinical (`A/allowance.ts` subject classification, the higher of floor and subject) is still served by Opus only. Only the owner changes routing or floors.

## Production facts (read-only, run by the coordinator 4 Nov ~13:00 EAT; counts only)

| Q | Result |
|---|---|
| Q0 | All present: 791 snapshot table, 801 retirement table, 802 offers table, `ckri_question_format_ok`, 710 guard, 950 `content_version` |
| Q1-Q3 | No `revision_question` resources: 0 versions, 0 published, 0 approved, 0 mapped, 0 retirements |
| Q4 | Learner questions, all `private_formative`, none a library copy: case 1, flashcard 4, match 3, mcq 2, mrq 2, sequence 2, short 9, structured 1 |
| Q5 | 18 with rubric, 1 with parts, 0 with competency, 0 edited |
| Q6 | Attempts: deterministic 8 (8 in a revision session, 0 with content_version, 8 scored); self_graded 1 (1, 0, 1); no ai_evaluation, no unmarked |
| Q7 | Snapshots: deterministic correct 4, incorrect 2, partial 2; self_graded correct 1; all with rubric and rubric hash; 0 library; **0 attempts without a snapshot** |
| Q8 | No offers, no permissions |
| Q9 | Eligibility: questions = opus-4-8 only; evaluate = sonnet-4-6 only; check = opus + sonnet; deeper = opus; teach = opus + sonnet; ask = opus + sonnet; no exam or adaptive rows |
| Q10 | Routes for questions, evaluate and deeper = [sonnet-4-6, opus-4-8]; exam route null; updated 31 Oct 18:12Z |
| Q11 | Only `scholar_revision_formats` set: mcq, mrq, short, flashcard, match, sequence, structured, cloze, true_false, extended. Offering, verify formats, short-answer marking and check behaviour use code defaults (offering off) |
| Q12 | `ai_fair_use` flag absent (metering off); no ledger or gateway rows for these operations since 25 Oct, so no production cost data |
| Q13 | `hq.learning.ckri.educator`: 1 position; `hq.quality.knowledge.publish`: 1 position |
| Q14 | Published `riskFloor` (`clinicallySensitive` unset, tier `reasoning` for all four): check `clinical_educational`, deeper `standard_educational`, evaluate `clinical_educational`, questions `clinical_educational`. No rows for scenarios or flashcards |
| Q15 | Triggers on `ckri_knowledge_version`, all enabled `O`: `ckri_knowledge_version_guard`, `ckri_knowledge_version_offer_guard`, `ckri_knowledge_version_offer_promote`, `ckri_knowledge_version_sod_publication`. The 640 publication guard is in production |

## Ranked gap list — independently buildable workstreams

Only genuine gaps. Working components are not rebuilt. Sizes: S < 1 day, M 1-3 days, L > 3 days.

| Rank | WS | Gap | Files touched | Migration | Size | Rows |
|---|---|---|---|---|---|---|
| 1 | **WS-B** Unsafe responses in written formats | Add a safety-critical marker to key points and parts, and an `unsafe` field to the evaluator output. An unsafe answer caps the score and names the unsafe statement in the feedback, then snapshots it. Score case criteria `weight` and `safetyCritical` for written decisions. | `S/revision.ts`, `S/formats.ts`, `S/scenario.ts`, `S/question-intel.ts` (feedback parse), `S/generation.ts` (evaluate and case prompts), `S/clinical.ts`, `src/lib/cases/library.ts`, RC, tests | Learner side no (answer JSON). The library form needs 800 `ckri_question_format_ok` widened (yes) | M | SQIE-03, C-04 |
| 2 | **WS-H** Quality and safety guards | Deterministic stem-reveals-key check for mcq, mrq and short (scenario has one). Identifier screen on generated mcq/case text. A harness pin that no Scholar module imports stage mapping, and that a question score never yields a stage. | `S/question-quality.ts`, `S/generation.ts` `checkQuestions`, `scripts/scholar-learning-harness` (or a new test) | No | S | SQIE-11, SQIE-07 |
| 3 | **WS-D** Attempt-record completeness | Keep a 791 snapshot for CYU check attempts. Record framework version and competency content hash on the snapshot. Store scenario five-part feedback. Review the 1500-byte rubric cap. | `S/store.ts` `recordCheckAttempt`, `S/attempt-snapshot.ts`, `S/rubric-snapshot.ts`, `R/revision/scenario/route.ts`, `R/learn/checks/route.ts` | **Yes**: widen 791 marking CHECK for `unmarked`, and add a framework-version column (or carry it in `presented`) | M | SQIE-04, SQIE-08, SQIE-07 |
| 4 | **WS-A** Calculation format | A `calculation` registry row stored as `short` + `answer.format='calculation'`: numeric value, unit, unit conversions, absolute or relative tolerance. Code marking; wrong unit marked wrong. Generator must copy figures only from the passage. Renderer has a number field and unit select. | `S/question-formats.ts`, `S/formats.ts`, `S/generation.ts`, `S/blind-verify.ts`, `S/config.ts`, RC, `K/question-format.ts`, `S/library-format.ts` | Learner side no. Library yes (800 check) | M | SQIE-02 |
| 5 | **WS-G** Analytics completion | HQ per-format correctness. Discrimination index (point-biserial, aggregate) for library versions. Apply `collective_analytics` consent and the 441 minimum cohort to library item performance. Cost per evaluated answer and per completed adaptive session from `plat_ai_requests` action ids. Learner performance by every format. | `K/question-performance.ts`, `src/lib/hq/library-item-performance.ts`, `A/sqie-monitoring.ts`, `S/intelligence.ts`, `SqieMonitoringPanel.tsx`, `research/questions/page.tsx` | No | M | SQIE-10, C-14 |
| 6 | **WS-E** Library metadata and HQ management | Programme, qualification level and difficulty on library versions, with filters and Scholar selection by level. A competency picker from the published framework, replacing typed ids. Bulk retire and bulk submit. | `K/question-format.ts`, `S/library-format.ts`, `S/library-questions.ts`, `K/question-catalogue.ts`, `K/educator.ts`, `research/educator/page.tsx`, `research/questions/page.tsx`, `KnowledgeControls.tsx` | **Yes** (800 content check, and the 710 guard if copies carry level) | L | SQIE-05, SQIE-06 |
| 7 | **WS-C** Justification and interpretation scoring | Score `askReason` with a formative rubric when the case defines one. An "answer + justify" variant (choice plus a scored rationale part) via the structured kind. An interpretation-of-findings item type: findings table, then structured parts. | `src/lib/cases/blueprint.ts`, `S/clinical.ts`, clinical answer route, `S/question-formats.ts`, `S/revision.ts`, `case-client.tsx`, RC | No (810 already keeps reasons; structured parts reuse 710) | M | SQIE-02 |
| 8 | **WS-I** Unified question history | One per-question history (revision, adaptive, CYU; exam answers linked) from 416 attempts and 791 snapshots, with "marked against" per attempt. | new `S/question-history.ts`, a Saved or Progress page, a route under `R/` | No | M | C-13 |
| 9 | **WS-F** Adaptive library reuse beyond MCQ | Copy library mrq, short, match, sequence and structured into adaptive sessions (the copy path exists for revision). | `S/adaptive-service.ts`, `S/library-questions.ts` | No | S | SQIE-09 |
| 10 | **WS-J** Verification only (no build) | Q14 and Q15. One adaptive scenario added to the SQIE acceptance harness, run once. A production learner walk once a learner uses SQIE. | `scripts/scholar-sqie-acceptance-harness.ts` | No | S | SQIE-01, SQIE-09 |

**Owner and content actions (not engineering):** author, review and publish the first library questions (production has none); learners accepting section-competency mappings (production has 0 mapped questions); a clinical tolerance policy for calculation questions (before WS-A ships); whether to switch metering on (the only source of production cost data); `scholar_question_offering` stays off until a contribution policy is approved (§4).

**Parallelism:** WS-A, WS-B and WS-C all touch `S/revision.ts`, RC and `S/question-formats.ts`, so build them one after another or in one branch. WS-D, WS-G, WS-H, WS-I and WS-F touch disjoint files. WS-D and WS-E each need a migration number claim.

## SALE-2026-11 integration — workstream status

**Authority:** owner instruction "SALE-2026-11 — SQIE Tracker Integration", 4 Nov 2026. WS-A..WS-J are **approved for development** with its conditions (below). This tracker stays the SQIE source of truth; the SALE programme tracker (`docs/programme/SALE-2026-11-TRACKER.md`, PR #268) links here through **SALE-02** (Complete SQIE gaps) and SALE-00, and does not copy these rows. Status uses this tracker's four values; a merged PR is not Complete until its production acceptance is met.
**Migration numbers:** 990-994 records session (`SQIE-RECORDS-migration-number-claim.md`), 995-999 HQ library session (`SQIE-HQ-migration-number-claim.md`); the earlier SQIE-WAVE1 claim is withdrawn. R1 uses 970-979, CE-04/05 980-989. **Instruction text:** `SALE-2026-11-SQIE-tracker-integration.md` (coordinator folder), verbatim.

| WS | Wave | SALE link | Status | Owner session / branch | Changes implemented | Acceptance evidence | Production | Owner decisions / blockers | Remaining |
|---|---|---|---|---|---|---|---|---|---|
| WS-B | 1 | SALE-02 (gates SALE-13 clinical formats) | Partially Complete | **Scoring session** [local_a862b127](#local_a862b127-0779-4c3b-8f6b-4055ddd4fa9d). Prior build handed over for reuse: `scholar/sqie-ws-b-unsafe-responses` @ 6737c1f0 (pushed, no PR) | In the handed-over branch: evaluate v3 / case reasoning v3 require an `UNSAFE:` line quoting the answer (fail closed); only quotes found in the answer kept; an unsafe answer, part, stage or case decision is incorrect with score 0; shown first, kept in `response.formative` and the 791 snapshot | Handed-over branch: `unsafe-response.test.ts` 13/13, tsc clean | Not deployed | Owner GO to merge and deploy | Owning session decides reuse; case criterion `weight`/`safetyCritical` scoring; false-positive rate on real answers |
| WS-H | 1 | SALE-02 | Partially Complete | **Records session** [local_0db55b37](#local_0db55b37-53a8-47b7-97f3-71fb336125b3). Prior build handed over: `scholar/sqie-ws-h-quality-guards` @ 74753273 (pushed, no PR) | In the handed-over branch: `answer-leak.ts` (CE-05 rule, unchanged); `answer_in_stem` (mcq/case), `answer_leaked` (mrq, short, structured); identifier screen on generated mcq/case text; `stage-boundary.test.ts` with a planted-import control | Handed-over branch: 140 files / 2304 tests green, tsc clean | Not deployed | Owner GO to merge and deploy | Owning session decides reuse |
| WS-D | 1 | SALE-02; feeds SALE-04 and SALE-14 | Partially Complete | **Records session** [local_0db55b37](#local_0db55b37-53a8-47b7-97f3-71fb336125b3) (migrations 990-994). Prior build handed over: `sqie/ws-d-attempt-record-01` @ 07d4fd00 by the stopped session [local_0e0244d2](#local_0e0244d2-f1ac-4753-aec3-bacc52a1a405) | In the handed-over branch: CYU check snapshots, per-competency framework provenance (`competency_provenance`), scenario five parts, migration numbered 990 | Its PR body: 990 applied twice on staging, VERIFY passed (`SQIE-WS-D-PR-body.md`) | Not applied | **Staging holds that branch's 990**; the records session owns 990 and must reconcile staging before applying its own | Owning session |
| WS-I | 4 | SALE-02; feeds SALE-12 (Active Notebook) | Not Started | **Records session** [local_0db55b37](#local_0db55b37-53a8-47b7-97f3-71fb336125b3) | — | — | — | — | As in the gap list |
| WS-C | 2 | SALE-02; feeds SALE-13 | Not Started | **Scoring session** [local_a862b127](#local_a862b127-0779-4c3b-8f6b-4055ddd4fa9d) | — | — | — | — | As in the gap list |
| WS-A | 3 | SALE-02 | Not Started | **Scoring session** [local_a862b127](#local_a862b127-0779-4c3b-8f6b-4055ddd4fa9d) | — | — | — | **Decision 1 (4 Nov):** exact numeric match by default, validated unit equivalence, question-defined rounding; configurable absolute and percentage tolerances built but no non-zero clinical tolerance active without the approved clinical calculation policy; safety-critical errors handled independently of tolerance; tolerances never from AI output | As in the gap list |
| WS-E | 3 | SALE-02 | Not Started | **HQ library session** [local_ff333066](#local_ff333066-68c3-44d1-adce-5af8b8320f16) (migrations 995-999) | — | — | — | Independent clinical review and publication stay as they are; decision 3 (framework-version provenance on question versions) | As in the gap list |
| WS-F | 3 | SALE-02; feeds SALE-06 | Not Started | **HQ library session** [local_ff333066](#local_ff333066-68c3-44d1-adce-5af8b8320f16) | — | — | — | Needs the pilot batch published (decision 2) | As in the gap list |
| WS-J | 1 | SALE-02 | Partially Complete | **SQIE tracker session (this one)**: `scholar/sqie-ws-j-adaptive-acceptance` @ db46fce3 (pushed) | Q14 and Q15 run read-only and recorded (Production facts). Scenario F in `scripts/scholar-sqie-acceptance-harness.ts` (`SQIE_ONLY=F` runs setup, A0, F and Z only) | Staging run of scenario F: see the change log | — | — | Merge; production learner walk of an adaptive exam |
| WS-G | 5 | SALE-02; feeds SALE-15 (effectiveness analytics) and SALE-16 (cost) | Not Started | **HQ library session** [local_ff333066](#local_ff333066-68c3-44d1-adce-5af8b8320f16) | — | — | — | **No production cost figure while metering is off** (owner decision on metering; SQIE-12) | As in the gap list |

**Operational actions (owner and content, SALE-2026-11):** a small clinically reviewed starter library through the existing educator → reviewer → publisher workflow (production has 0 library questions); confirm the relevant framework is published and mapping is available, then validate mapping on real approved questions (production has 0 mapped learner questions); learner question contributions stay off until their policy is approved; owner decision on AI metering before any cost-effectiveness claim.

## Owner decisions, 4 Nov 2026 (`SQIE-CLOSE-2026-11-owner-decisions-4nov.md`, coordinator folder)

| # | Decision | Owning session | Rows |
|---|---|---|---|
| 1 | **Calculation scoring.** Exact numerical matching by default, with validated unit equivalence and question-defined rounding rules. Configurable absolute and percentage tolerances are built, but no non-zero tolerance is activated for clinical calculations without approval of the relevant clinical calculation policy. Safety-critical errors are identified and handled independently of numerical tolerance. | Scoring session [local_a862b127](#local_a862b127-0779-4c3b-8f6b-4055ddd4fa9d) (WS-A) | SQIE-02, SQIE-14 dependency 1 |
| 2 | **First Question Library.** A pilot batch of 60 nursing questions across respiratory assessment, cardiovascular assessment, ABCDE and deterioration, clinical reasoning and prioritisation, and medication safety, through the existing Question Library governance workflow. AI may assist drafting; every question needs source verification, independent clinical review and authorised publication. **Not published automatically.** | Pilot-batch session (branch `content/sqie-pilot-batch`) | SQIE-05, C-10, SQIE-14 dependency 2 |
| 3 | **Competency mapping.** Pilot questions mapped to the appropriate published nursing framework version, competency and learning objective. Framework-version provenance stored with question versions and learner attempts. Draft mappings allowed while publication is pending, never shown as validated competency evidence. Formative question performance never becomes verified competence or a Benner stage. | Records session [local_0db55b37](#local_0db55b37-53a8-47b7-97f3-71fb336125b3) (attempt provenance, WS-D) and HQ library session [local_ff333066](#local_ff333066-68c3-44d1-adce-5af8b8320f16) (question-version provenance, WS-E) | SQIE-07, C-12, SQIE-14 dependency 3 |
| 4 | **Complete this tracker.** SQIE-12, SQIE-13 and SQIE-14 restored. | SQIE tracker session (this one) | SQIE-12..14 |


## Change log

| Date | Change |
|---|---|
| 4 Nov 2026 | Created (SQIE-01). Production facts Q0-Q13 recorded; Q14/Q15 queued. SQIE-12+ awaiting owner text |
| 4 Nov 2026 | SALE-2026-11 integration (WS-A..J approved). Q14/Q15 recorded (questions floor clinical_educational: C-01/C-03 Complete; Go deeper routing fact added to §9; 640 publication guard confirmed). Owner decisions 1-4 recorded; SQIE-12 (Partially Complete, no production cost data), SQIE-13 (Complete), SQIE-14 (Not Started) restored in place of "awaiting owner text". Workstreams assigned to the owner's sessions: scoring local_a862b127 (B, C, A), records local_0db55b37 (D, H, I), HQ library local_ff333066 (E, G, F), pilot batch (decision 2), this session WS-J. Earlier WS-B/WS-H/WS-D builds handed over as branches |
