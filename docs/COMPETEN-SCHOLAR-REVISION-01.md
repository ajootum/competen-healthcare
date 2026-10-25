# COMPETEN-SCHOLAR-REVISION-01: Stage 4 Intelligent Revision (build record)

Owner GO 2026-10-24, "COMPETEN-SCHOLAR-REVISION-01, Stage 4: Intelligent Revision & Knowledge Retention".

**Status:**
- Development, integration and staging only. **Production activation not authorised.**
- Scholar stays behind `individual_app` (server-enforced, default OFF).
- AI stays behind consent, the published legal documents and the allowance. Metering stays OFF in production.

**Migrations:** 416 and 417 from the coordinator's range (416–418, 425–429). 418 is unused.

This record grows with the build. The capability map is in the coordination notes (`IND-004-stage4-capability-map.md`).

## 1. What the migrations add (reuse, not duplication)

Stage 4 revises from what Scholar already stores. It does not add a second question bank, scheduler or review history:
- **Questions:** 372, plus 388 for competency and case.
- **Attempts:** 372, append-only study, never copied to `quiz_attempts` or `knowledge_attempts`.
- **Spaced-review cards:** 372, scheduled by the shared SM-2 in `src/lib/delivery/reinforcement.ts`.
- **Review log:** 391.

| Migration | Adds |
|---|---|
| **416** revision formats | **Question kinds.** `mrq`, `short`, `flashcard`, `match` and `sequence` beside `mcq` and `case`, each with its key in `answer` (CHECKed per kind). `mcq` and `case` keep the exact 372 shape.<br>**Question fields.** `difficulty` (1–3). `review_status`, which can only be `private_formative`: an AI-written question can never be stored as clinically approved.<br>**Attempts.** An attempt stores either `chosen_index` or `response`, never both. `marking` is `deterministic`, `self_graded` or `ai_evaluation`, and AI evaluation records the evaluator model and prompt version. `score` is the share correct (0–1). |
| **417** revision sessions | **Saved sets.** A saved revision set and its questions in order. Replaying it uses stored questions and keys, with no AI.<br>**Sessions.** A revision session with a snapshot of its questions, the position reached and its status, so a student can leave for Teach Me and come back.<br>**Attempt link.** `attempt.revision_session_id` (ON DELETE SET NULL of that column only). The answers in a session are its attempts, not a copy of them.<br>**Rules.** Composite (id, user_id) keys throughout; RLS on, own-row read. |

A short answer stores what the student wrote, in their own private, erasable record, bounded to 8000 bytes. It is screened for patient identifiers before it is written. Learn stores nothing a student types; revision keeps the answer because recall history needs it.

## 2. Migrations

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `416-individual-scholar-revision-formats.sql` | `321daa18b3bc802c84344ec6c2931a2a78f6e6a7be9380e0a4ffc21cbc3fd88b` | Medium | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-REVISION-01/ROLLBACK-416.sql` | `5f40708acfedf164d6d7d462ff8937749c0ccc97fb532ecec2731232a2853a94` | — | — |
| `417-individual-scholar-revision-sessions.sql` | `ab5c6bbdf9d65ce998abe6d232eada2fd9652974ca5fa1295c7895878b3f8c8b` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-REVISION-01/ROLLBACK-417.sql` | `01225df99aba2092f7c730d4007da677f1a8c5622e42950b6eb2a28c256f0bff` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-REVISION-01/VERIFY-416-417.sql` | `e6e2f9ddd14a1d1e7dd022a12045100c66c66fa61886ab56ddbf03deb26ab82a` | read-only | — |

**Staging run record** (coordinating session, 2026-10-24, under the owner GO):
- The target was `ezhvpgtcqcdsgylrxgdb` at every step; the guard passed and every run reported "ok".
- The bytes on disk matched the shas above before and after the runs.
- The house rules were ALL CLEAR: 416 at 131 lines and 25 statements, 417 at 198 lines and 39 statements.

| Pre-check (read-only) | Expected | Result |
|---|---|---|
| question kinds other than mcq or case | 0 | 0 |
| questions not in the 372 shape | 0 | 0 |
| attempts with null `chosen_index` | 0 | 0 |
| the 3 constraints 416 replaces | 3 | 3 |
| server version | 15 or later | 17.6 |
| `individual_scholar_revision_set` | absent | absent |

| Step | Tables (`individual_scholar%`) | Fingerprint |
|---|---|---|
| PRE (with 413–415) | 24 | `4c18b288697a` |
| 416 ×2, then 417 ×2 (F1) | 28 | `631f024b1ab1` |
| ROLLBACK-417, then ROLLBACK-416, each committed (F2) | 24 | `4c18b288697a` = PRE |
| Re-apply 416 ×2, 417 ×2 (F3) | 28 | `631f024b1ab1` = F1 |

Triggers were unchanged throughout (`118a7170`).

**VERIFY-416-417 at F1:**
- 5 and 6 column rows;
- 7 constraints;
- 4 tables with RLS on;
- 0 questions and 0 attempts not in the 372 shape;
- `review_status` = `private_formative` on all 3 existing question rows.

- **Application order:** 416 → 417. Rollback is the reverse: ROLLBACK-417, then ROLLBACK-416.
- **Dependencies:** 416 depends on 372 and 388. 417 depends on 372, 416 and profiles, and needs PostgreSQL 15 or later for `ON DELETE SET NULL (column)` (373 already uses it).
- **Fail-closed without them:**
  - without 416, the new kinds cannot be stored and Scholar offers mcq and case only, as today;
  - without 417, saved sets and resumable sessions are not offered.
- **Production:** none applied. Production needs a separate owner GO with the OPS-001 safeguards.

### 425: a short answer held until the end (owner decision, 2026-10-25)

The owner's "STAGE 4 REVISION DECISION: hold self-grading until the end" needs one place to keep an unmarked answer: an attempt cannot hold one (`correct` is NOT NULL, `marking` is constrained, and attempts are never rewritten), and the 417 session has no slot for it.

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `425-individual-scholar-revision-held-answer.sql` | `6890358fa63a369020d3841d4bc6f2f1db03cac77d4862c96a8d143eeda5624d` | Low | **Applied ×2 on staging**, rolled back and re-applied. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-REVISION-01/ROLLBACK-425.sql` | `444561d254327446a3744828371d44231f451caa5b750767488af5a013add982` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-REVISION-01/VERIFY-425.sql` | `efddbee0516c97d0b542d3d4c875ec4a2b7e9d118b44029176066863c020ffe2` | read-only | — |

- **What it adds:** one nullable column, `individual_scholar_revision_session_item.held_response` (jsonb, an object of at most 8000 bytes, checked). No function, no trigger, no existing row changed. RLS is unchanged.
- **Staging run record** (coordinating session, 2026-10-25, guarded runner, target `ezhvpgtcqcdsgylrxgdb`):

| Step | Fingerprint (`individual_scholar%`, 33 tables) |
|---|---|
| PRE | `e87579ca0163` (columns `8176afc5`, constraints `d3fdd4b7`) |
| 425, run 1 (F1) | `386b3546223b` (columns `dba5fc60`, constraints `d8649312`) |
| 425, run 2 | `386b3546223b` (idempotent) |
| ROLLBACK-425 | `e87579ca0163` = PRE |
| Re-apply | `386b3546223b` = F1 |

  Tables, indexes, policies and triggers were unchanged throughout. VERIFY-425 after both runs: `held_response` jsonb nullable; the check present; RLS on; 0 rows outside the check. The bytes applied are the files above.
- **Application order:** after 417. **Dependencies:** 417. Production follows 416 → 417 → 425, each with its own owner GO.
- **Fail-closed without it:** nothing can be held, so an unmarkable short answer asks for the self-grade at once (the earlier behaviour).

## 3. Completed functionality (R1–R5)

| Area | Built |
|---|---|
| **R1 Workspace** (`/study/revise`) | **Start Today's Revision.** It offers what is due, then what was hard, then something new.<br>**Modes:** Quick Practice, Spaced Revision, Weak Areas, Mock Practice and Flashcards.<br>**"Choose what and how to revise":** all notes, chosen materials, a topic or a competency; formats, quantity, difficulty, and feedback (immediate or at the end).<br>**Saved Revision Sets:** replay or remove.<br>**Carry on where you left off.** The review cards due are unchanged.<br>**Layout:** one column below `md`; touch targets grow on coarse pointers. |
| **R2 Questions** | **Kinds:** mcq, mrq, short, flashcard, match and sequence (416), plus the existing cases. Each question keeps its source quote, key, rationale, competency (the section's leading link), difficulty, model, prompt version and `review_status = private_formative`; nothing else is storable.<br>**Reuse first** (`pickQuestions`). The shortfall only is written, in up to two rounds and eight calls, never a section and format already written at this prompt version (`planGeneration`).<br>**Checks:** each item must be well formed, quote the passage, add nothing ungrounded and identify nobody. mcq keeps its blind verification.<br>**Marking:** by code where the kind allows. |
| **R3 Spaced repetition** | **The shared SM-2.** The 372 card is reused, with the 391 append-only log (`reviewCard`). Policy bounds, whose defaults are exactly the earlier rule: mastery reviews, mastery interval, the longest interval, and a shorter interval for harder questions.<br>**Answers review cards.** A revision answer to a question whose card is due reviews it: right counts as 4, wrong as 1, a flashcard as its own grade. A missed one makes or resets its card. |
| **R4 Feedback and Teach Me** | **When:** immediately by default, or at the end. Mock practice always gives it at the end.<br>**How it was marked:** feedback says so (`MARKING_LABEL`): by code, by the student, or by AI evaluation. AI evaluation sits in its own dashed amber box.<br>**After a wrong answer:** Explain the answer (Learn, `?action=explain`), Show the source, Teach me this (Learn on the section) and Try another question.<br>**Coming back:** Learn shows **Back to your revision** (`?revision=`), and the session resumes at the same question (417). |
| **R5 Revision intelligence** | Tracked separately, each measured, insufficient or not measured with its reason:<br>- due and upcoming;<br>- reviews and recall;<br>- recall over six weeks;<br>- what keeps being missed (with Teach me);<br>- materials revised;<br>- revision activity per competency ("practised, not achieved", and not measured without a catalogue);<br>- how answers were marked.<br>**Recommendations** come from those figures, each with its reason. Nothing is shown as competence, and nothing reaches the Passport as competence. |

## 4. Reused Holdings and Scholar engines

- **Questions, attempts, cards and the review log:** 372, 388 and 391, extended by 416. There is no second bank, scheduler or history.
- **The shared SM-2:** `src/lib/delivery/reinforcement.ts`.
- **Stage 2:** retrieval, scope resolution (`resolveScope`; `parseScope` is now shared with Learn), competency links (`leadingCompetency`) and topics.
- **Stage 3:** Teach Me and Explain, through the Learn workspace, and the round trip back to the session.
- **The Holdings AI gateway and Fair-Use Engine:**
  - generation is metered as activity `questions` with its D1 risk subject, and each call has its own request id (`:g1`, `:g2` ...);
  - short-answer evaluation is metered as `evaluate`;
  - consent, quota and the standing are checked first.
- **The Holdings grounding verifier and the patient-identifier screen**, on every generated item and every answer typed.
- **The WCE Individual policy:** twelve revision keys, versioned, audited and governed by HQ.

## 5. Learning Continuity

When new chargeable AI is not available, whether the Individual quota is used up, the standing refuses, or metering refuses (`not_eligible`, `allowance_exhausted`):
- **What stays available:** Today's Revision and every other mode run from saved questions, and the session says so.
- **Marking:** stored questions are marked by code.
- **Short answers:** fall back to the student's own judgement, labelled.
- **Saved sets** replay with no AI.
- **Records:** cards, history, progress, saved learning and the materials all stay open.
- **What is restricted:** only new generation and AI evaluation.
- **Evidence:** R13 in the staging journey (PASS). The metering-ON variant R13m ran on 2026-10-25 (§7): with no eligible model recorded, every new question was refused `not_eligible`, nothing was sent, and the pages stayed open. A student with nothing saved yet is told so plainly, not "this session uses your saved questions" (fixed, bb7e0418).

## 6. No-code configuration (the existing engine, HQ Individual policy page)

`scholar_revision_formats`, `scholar_revision_modes`, `scholar_revision_quantity`, `scholar_revision_difficulty`,
`scholar_revision_feedback`, `scholar_revision_generation` (or saved questions only), `scholar_short_answer_marking`,
`scholar_revision_recommendations`, `scholar_srs_mastery_reps`, `scholar_srs_mastery_days`,
`scholar_srs_max_interval_days`, `scholar_srs_harder_interval_percent`.

Not settings, by design:
- grounding and the identifier screen;
- `private_formative` only;
- code marking first;
- AI evaluation always labelled;
- never assessment or competence.

## 7. End-to-end staging evidence

Run `scripts/scholar-revision01-harness.ts`:
- **Where:** a dev server on this branch, against staging `ezhvpgtcqcdsgylrxgdb`.
- **Conditions:** metering OFF, real AI, the Stage 2 respiratory materials (anatomy PDF, pneumonia PowerPoint, oxygen Word notes).
- **Result:** **ALL GREEN, 24 passed, 0 failed**, with R13-metered pending.

| Step | Result |
|---|---|
| R1 Open Revision | PASS |
| R2/R3 Start a session on the respiratory materials | PASS |
| R4 Ten questions in several formats, written for the shortfall, private formative, competency-linked (10 of 10 linked) | PASS |
| R4b No key, rationale or quote reaches the browser | PASS |
| R5 Answers with feedback saying how they were marked; the two wrong answers become cards | PASS |
| R6 Every quote is found word for word in the student's own section | PASS |
| R7 Weak areas offers exactly what was missed; what was missed twice is listed with Teach me | PASS |
| R8 Teach Me on the missed section, with the way back to the same session | PASS |
| R9 The session resumes the same: same questions and order, answers kept, the same position | PASS |
| R10 Flashcards: reveal, self-grade, card rescheduled by SM-2, 391 log grows; spaced revision writes nothing | PASS |
| R11 Recall history and progress | PASS |
| R12 A saved set replays with no generation and no AI call; the same request again writes nothing identical | PASS |
| M1 Mock practice holds its feedback to the end | PASS |
| S1 A short answer that matches nothing: AI evaluation (labelled) or self-graded, never wrong by default | PASS |
| R13 With the allowance used up (synthetic quota rows for the fixture only): revision carries on | PASS |
| R13m The same with metering ON | **NOT DEMONSTRABLE on staging** (2026-10-25, see below) |
| R14 No competency catalogue: revision end to end; competency activity said not measured | PASS |
| I1 Isolation: another student reaches no session, question, set or session page | PASS |
| E1 Erase-all leaves no revision set, session or question | PASS |

**How it got there.** The first full runs were 23/1. R4 came back with 8, then 7, of 10 questions:
- **matching:** malformed, because the short passages rarely state three pairs and 416 requires at least three;
- **multiple-response and short answer:** "ungrounded", because the rationale added words not in the notes.
- **Fix:** prompt v2 (answers and rationale in the passage's own words; `[]` when a kind does not fit; matching only with three pairs), up to three items asked per call (extras saved for reuse), and a second round within eight calls.
- **Final run:** four calls kept 10. The drop reasons are now counted in the generation audit, as counts only and never text.

**R13m, metering ON (2026-10-25).** The owner switched metering on; the harness ran alone with `METERED=1` on main 5a9962b plus the #77 branch. **RED, 9 passed, 15 failed; 0 fixtures left.**
- **Why:** staging's `ai_model_eligibility` holds no eligible row for any Scholar activity (every row is `gpt-` or `gemini-`, `eligible = false`; no Anthropic row). Under metering, every clinical-tier call is therefore `not_eligible` from the first question, so the fresh fixture never stores a question. R3, R4 and R14 are refused with the continuity message, and the rest follow from having nothing stored.
- **What held:** nothing was sent to a provider; the pages opened (200 ×4); the refusal named the reason.
- **What it cannot show until a model is eligible:** "carries on from what is stored" under metering. The same continuity path with stored questions is R13 (PASS, allowance used up). The D5 eligibility decision is a production dependency (§9).
- **Found by it:** the AI standing reported `questions` and `evaluate` as available ("via included") while every call was refused `not_eligible`. That is the Holdings standing (`src/lib/ai`), reported to the coordinator.

**Tests:**
- Unit: `revision.test.ts` (16); Individual suite 356/356.
- `scholar-learning-harness` 137/137:
  - **K30:** answers stay server-side;
  - **K31:** marking says what it was;
  - **K32:** reuse first;
  - **C2 and K26:** cover the revision routes;
  - **planted controls:** P48–P50, which go red when the rule is broken.
- `individual-config-harness` 41/41.
- `next build`: exit 0.

## 8. Genuine remaining gaps

- **R13 with metering ON:** run 2026-10-25, not demonstrable without an eligible model (§7). It re-runs, unchanged, once D5 records one.
- **End-of-session feedback and short answers: decided and done** (owner decision 2026-10-25, "hold self-grading until the end"). In end-of-session feedback and in Mock Practice, a short answer the code cannot mark and no AI evaluation judged is kept unmarked (425) and reveals nothing until the end. At the end the student grades the answer they wrote, beside the accepted answers, the explanation and the source; it is recorded as self-graded, apart from code and AI marking. It survives leaving and resuming. Immediate feedback keeps the self-grade at once. Evidence: `scholar-revision-hold-harness` (H1–H7, E), `scholar-learning` K38 with plant P56.
- **Revision sessions and sets after a single material is deleted:** done (bb7e0418). They keep their remaining items, and one left with none is removed with the material, as Learn does. Nothing is pruned on a failed read (`prune.test.ts`, planted red twice).
- **Matching items** are written only where a passage states three or more pairs. On short notes there may be none; that is correct, not a fault.
- **Passport.** It stays as it is: the existing `revision_reviews` achievement is a count only. Revision scores never reach it.

## 9. Production activation dependencies (none authorised by this build)

- **Migrations:** 416 and 417 in production, each with a separate owner GO and the OPS-001 safeguards. Their order and dependencies are in §2.
- **Individual and Scholar activation:** `individual_app` stays off.
- **The legal documents:** published, for AI consent.
- **Production AI metering:** `ai_fair_use` stays off.
- **D5 eligibility:** a reviewer decision before `questions` and `evaluate` can run with metering on.

## 10. Final acceptance report (2026-10-25)

In the owner's REVISION-01 §13 format. It uses the existing evidence above plus today's R13m run. No completed test was repeated.

| §13 item | Status | Evidence |
|---|---|---|
| **Completed R1–R5 functionality** | **Complete** | §3. All five areas built and exercised end to end (§7: R1–R12, M1, S1, R14 PASS). |
| **Reused Holdings engines** | **Complete** | §4. No second bank, scheduler or review history: 372/388/391 extended by 416/417, the shared SM-2, the gateway and Fair-Use Engine, the grounding verifier and identifier screen, the WCE policy. |
| **End-to-end staging evidence** | **Accepted, metering OFF: 24/0.** Metering ON: not demonstrable | §7. The metering-OFF journey is ALL GREEN. R13m ran (RED 9/15) because no model is eligible on staging, not because of a revision defect. |
| **Learning Continuity behaviour** | **Complete** | §5. R13 PASS: with the allowance used up, saved questions, code marking, self-graded short answers, saved sets, history, progress and materials all stay open. Under metering, a refused generation sends nothing and says why. |
| **No-code configuration** | **Complete** | §6. Twelve revision keys on the existing HQ Individual policy page, versioned and audited. |
| **Genuine remaining gaps** | None open | §8. The end-of-session short-answer self-grade is decided (hold until the end) and built (425). Matching items only where notes state three pairs is by design, not a gap. |
| **Production activation dependencies** | None authorised | §9. 416→417 with OPS-001 safeguards; `individual_app` and `ai_fair_use` OFF; legal documents; **the D5 eligibility decision**, without which metered revision writes no new questions. |

**Fixed since §7, pilot path (bb7e0418):** emptied revision sets and sessions are pruned with their material; a latent "failed read deletes every Learn session" path is closed; the no-saved-questions continuity message is honest.

**Verdict:** Stage 4 is complete for development and staging. Its one open live check (R13m) waits only on a recorded model eligibility, and re-runs unchanged once there is one.
