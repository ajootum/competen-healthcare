# COMPETEN-SCHOLAR-CLINICAL-REASONING-01: Stage 5A Student Clinical Reasoning (build record)

Owner GO 2026-10-25, "COMPETEN-SCHOLAR-CLINICAL-REASONING-01, Stage 5: Clinical Reasoning & Case Intelligence". IND-004 owns 5A (CR1–CR5) and the Scholar side of 5B. IND-007 owns the shared case library, governance, the educator studio, platform screening and budgets.

**Status:**
- Development and staging integration only. **Production activation not authorised.**
- Scholar stays behind `individual_app` (server-enforced, default OFF).
- The library-facing parts sit behind `case_library` (default OFF).

**Migrations:** 435 from the coordinator's range 435–439. 436–439 are unused.

**The shared contract.** Every case is one structure, `case-blueprint/1` (`src/lib/cases/blueprint.ts`). IND-004 reviewed it (B1–B11, then R1 and R2) and AGREED it at `holdings/case-intelligence` ab79af52 (PR #72).

This record grows with the build.

## 1. Migration 435: what it adds

| Table | Holds |
|---|---|
| `individual_scholar_case` | **A student's PRIVATE case.** Its blueprint (private profile) is CHECKed as `case-blueprint/1` and at most 200 KB, with a generated `blueprint_hash` (md5). `review_status` can only be `private_formative`: an AI-written case is never stored as approved. It goes with the material it was written from. |
| `individual_scholar_case_source` | The student's sections it was written from, in order. Each goes with its chunk. |
| `individual_scholar_case_competency` | The CFCA competencies it serves, as typed foreign keys. |
| `individual_scholar_case_session` | **One playing of a case.** It plays either a private case or one exact `case_library_version` (422). The library link is ON DELETE RESTRICT, so a version is never deleted from under a student.<br>It holds ids only: stages reached, facts revealed, the current stage. It never copies a governed fact.<br>It also holds the server-only `view_salt` for the blueprint tokens, the mode (guided or independent), the debrief and the resume state. |
| `individual_scholar_case_answer` | **Every decision made, APPEND-ONLY** (one per decision point per session). It holds the options chosen OR the reasoning written (at most 4000 characters), how it was marked (`deterministic`, `self_graded` or `ai_evaluation` with its evaluator), the safety criteria broken, and any AI feedback.<br>UPDATE and DELETE are refused except in a cascade (`pg_trigger_depth() > 1`, the 388 pattern), so a session, a material or a person can still be erased. |

Composite (id, user_id) foreign keys throughout. RLS on, own-row read only. A student's reasoning text is screened for patient identifiers before it is written, and stays in their own erasable record. Nothing here is assessment, competence or Passport evidence.

## 2. Migrations

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `435-individual-scholar-clinical-reasoning.sql` | `2e3cd7e3e24690a77cdd2ebe979c2836754b0c56ed3ae6763e44859790b4826e` | Medium (trigger function) | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/ROLLBACK-435.sql` | `2a86601bc1efcab73be6eadc4c35b11467b0907acbfffeb52fcb9f1dcff0aae4` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/VERIFY-435.sql` | `5fb238fdf1629a795c79e900172abdb17dd3de8d590ce86698bbd52cc140efe9` | read-only | — |

**Staging run record** (coordinating session, 2026-10-25, under the owner GO, applied after 422):
- The target was `ezhvpgtcqcdsgylrxgdb` at every step; the guard passed and every run reported "ok".
- The bytes on disk matched the shas above before and after the runs.
- House rules: ALL CLEAR at 256 lines, 49 statements and 4 constraints; the 3 notices are the expected APPLY-WHOLE ones.
- Pre-checks: `case_library_version` present; `individual_scholar_case` absent.

| Step | Tables (`individual_scholar%`) | Fingerprint | Triggers |
|---|---|---|---|
| PRE (with 416/417) | 28 | `631f024b1ab1` | `118a7170` |
| Apply ×2 (F1) | 33 | `0552fa3a8d28` | `0ee43365` |
| ROLLBACK-435, committed (F2) | 28 | `631f024b1ab1` = PRE | `118a7170` |
| Re-apply ×2 (F3) | 33 | `0552fa3a8d28` = F1 | `0ee43365` |

**VERIFY-435 at F1:**
- 5 tables with RLS on;
- 3 CHECK constraints;
- the trigger `individual_scholar_case_answer_append_only`;
- `blueprint_hash` generated ALWAYS;
- the library foreign key with `confdeltype` `r`;
- 0 cases and 0 sessions.

- **Application order:** after 422 (and after 416/417 on main).
- **Dependencies:** 372 (material and chunk, with their (id, user_id) indexes), 384 (`framework_competencies`), 422 (`case_library_version`) and profiles. Uses generated columns (PostgreSQL 12 or later).
- **Fail-closed without it:** clinical reasoning is not offered, and the existing practice cases (388) work as today.
- **Production:** none applied. Production needs a separate owner GO with the OPS-001 safeguards, after 422.

### 436: a Scholar case session plays a private case only (fix-forward of 435)

**Why.** A library-case play was storable in two places: 423's `case_library_session` (IND-007, with its delivery guard) and 435's session (private case XOR library version). The coordinator decided, under the owner's case interface approval §2 ("Do not create incompatible case structures"):
- library plays go through the shared delivery (`src/lib/cases/library.ts`) only;
- private plays use 435;
- both run on one engine (`blueprint.ts` and `library.ts`'s `applyAnswer`).

436 makes anything else unrepresentable. On `individual_scholar_case_session` it:
- drops `library_version_id`, with its foreign key and index;
- makes `private_case_id` NOT NULL;
- re-adds the CHECK without the either-or (every other clause unchanged).

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `436-individual-scholar-case-session-private-only.sql` | `0bd76878dc7ed70c281e8b1164ce774a43c43a3d790ae7aab0d532274ab7a016` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/ROLLBACK-436.sql` | `3a73000cd2562bd57f5ab5bc7adcec27a6243230fee605d14cd3f0a4acb431d4` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-CLINICAL-REASONING-01/VERIFY-436.sql` | `b38c1f0b6d6f9edaccb4d1be31255a6a66b5ab4517f6680b2a5f86df00a12c9d` | read-only | — |

**Staging run record** (coordinating session, 2026-10-25, after 435):
- The target was `ezhvpgtcqcdsgylrxgdb` at every step; the guard passed and every run reported "ok".
- The bytes matched the shas before and after.
- House rules: ALL CLEAR (51 lines, 7 statements, 1 constraint, 0 warnings).
- Pre-check: 0 sessions with a library version.

| Step | Fingerprint (`individual_scholar%`) | VERIFY |
|---|---|---|
| PRE (435 applied) | `0552fa3a8d28` | — |
| Apply ×2 (F1) | `e87579ca0163` | `library_version_id`: 0 rows; `private_case_id` NOT NULL; 0 library FKs; 1 CHECK |
| ROLLBACK-436, committed (F2) | `0552fa3a8d28` = PRE (the 435 shape exactly) | — |
| Re-apply ×2 (F3) | `e87579ca0163` = F1 | as F1 |

- **Application order:** 435, then 436. **In the production release they ship together, in that order.**
- **Production:** none applied.

## 3. Student Clinical Reasoning (5A) as built

| | Built |
|---|---|
| **CR1 Case entry** | **Entries** on Apply, policy-governed: Generate a case from my notes; Practise a competency; Choose an existing case (the governed library, behind `case_library`); Surprise me (one of the student's materials, a different one each day). Also **Practise this in a clinical case** from Teach Me and from a Revision answer, on that section.<br>**Context and mode:** clinical contexts (General, Medical, Surgical, Paediatric, Maternal health, Emergency, Critical care) and guided or independent play.<br>**Library first (CI6):** where `case_library` is on and the case policy says reuse first, suitable approved cases are offered BEFORE anything is written, with no AI and no charge. The student can still ask for one from their notes.<br>**No catalogue needed:** a case works without an assigned competency catalogue. |
| **CR2 Interactive case** | A progressive scenario on the shared case engine (`blueprint.ts`):<br>- **only what was reached:** the stages reached and their decisions, and the findings revealed so far, nothing ahead or off the path (`learnerView`, tokens, never ids, the salt server-only);<br>- **asking:** the student asks for the findings the current decision permits;<br>- **deciding:** single and multiple choice, plus written reasoning;<br>- **leaving:** the student leaves and resumes at the same place. |
| **CR3 Governed progression** | **One structure:** a private case is a `case-blueprint/1` in the private profile.<br>**Built by code:** the model writes a small draft from the student's sections only; code (`clinical.ts blueprintFromDraft`) assigns every id, keeps the case LINEAR (no branch, which would need a consequence the notes do not give), takes competencies and sources only from their tags, and turns a stated safety point into a machine-checkable criterion.<br>**Checked before storing:** a case is stored only if it passes `checkPrivateCase`: a valid private blueprint, nothing ungrounded (Holdings grounding verifier), nothing identifying (Scholar's screen and Holdings' `screenBlueprint`).<br>**Library cases** are governed facts approved on their exact version (422), played as stored. |
| **CR4 Reasoning feedback** | **Choices:** marked by their key, with safety criteria checked by code (`safetyEvents`). After each decision: the key, each option's rationale, any safety point broken, and how it was marked.<br>**Written reasoning:** AI feedback (activity `evaluate`, metered with its risk, checked like any evaluation, labelled AI evaluation in its own box), or the student's own review against "what a good answer contains". Library cases record theirs through the shared delivery (§4).<br>**Debrief, from the record:** per reasoning dimension, the safety points missed, safety-critical findings that could have been asked for and never were, the objectives, and "Teach me what I missed" on the section. Labelled formative simulation, not an assessment, not competence.<br>**Next steps:** Teach me this, Revise related knowledge, Try another case. |
| **CR5 History and continuation** | 435 keeps:<br>- the case (version by its hash, its source sections and its CFCA competencies);<br>- each session (stages reached, findings revealed, mode, position, debrief);<br>- every decision as made, append-only.<br>"Your cases" lists private and library plays, and stored cases replay with no AI. |

## 4. Clinical Case Intelligence (5B), the Scholar side

- **Offer this case (CI1).** The student's explicit, per-case action. It needs their separate, revocable candidacy permission, on the current attestation text.
  - **The snapshot is Scholar's** (`privateCaseSnapshot`). It strips the student's source references (B8), carries the attestation, and is checked word for word against the student's own sections (`verbatimCheck`, 12-word runs, C-b).
  - **Holdings decides** eligibility and the identifier screen (`candidates.ts`). It costs no AI, and the student is never named to an educator.
  - **Withdrawal:** withdraw and revoke are never gated. Deleting a material, or erase-all, withdraws the cases written from it first (C-e).
- **Existing S4 practice cases** are offered through the same path, converted to the minimal blueprint (`s4CaseBlueprint`).
- **Library plays** go only through `library.ts` (`startCaseSession`, `revealInSession`, `answerInSession`). Scholar writes no library session (coordinator decision; K33).
- **Live AI feedback on a library case's written decision** (`clinical-library-feedback.ts`, server only). It is given where policy is `ai_then_self`, the student's AI allows `evaluate` and the AI preflight passes.
  - **What it reads:** only the narrow context `library.ts` gives for one answered written decision (`sessionFeedbackContext`, #76): its prompt, expected answer and rubric, the student's text, the findings they had seen, the competencies. Never the full blueprint (case-intelligence K7). Only this server file names it (K12, K37).
  - **Who pays:** the owner is resolved by rule for `case.live_with_stored`, the student's Individual budget, never the browser. The call is `runOwnedAi` via `scholarOwnedRunner` (activity `evaluate`), with its risk (prompt, answer, competencies), counted against `caseSessionRecord(sessionId)`.
  - **How it is checked:** like every evaluation, through `runCaseReasoning` and `parseEvaluation`. Feedback that fails its check is withheld, not recorded.
  - **Where it is kept:** recorded through `recordSessionFeedback` (424), and labelled AI evaluation wherever it is shown. Every attempt is audited with its outcome.
  - **Where it is not given:** the student sees the deterministic answered view and reviews their answer themselves.
- **Off by default:** everything library-facing sits behind `case_library` (default OFF).

## 5. Reused Holdings engines

- **Case blueprint and its pure engine:** `blueprint.ts` (`learnerView`, `answeredView`, `resolveToken`, `resolveOptions`, `safetyEvents`, `validateBlueprint`) and `library.ts` (`applyAnswer`), one engine for private and library cases.
- **Library delivery, candidates and the case policy:** `library.ts`, `candidates.ts`, `policy.ts` (`reuseFirst`, the attestation text), and `screen.ts`.
- **AI:**
  - the gateway and the Fair-Use Engine: `case_steps` for drafting and `evaluate` for feedback, each metered with its D1 risk subject;
  - consumption ownership: `resolveOwner` and `runOwnedAi`.
- **Holdings grounding verifier, the patient-identifier screens, CFCA links** (Stage 2 mapping) **and the WCE Individual policy.**

## 6. No-code configuration

**Individual policy (existing engine):**
- `scholar_case_contexts`, `scholar_case_entries`, `scholar_case_dimensions`;
- `scholar_case_generation` (generate, or stored and library only);
- `scholar_case_mode` (guided or independent);
- `scholar_case_reasoning_feedback` (AI where available, otherwise self-review).

**Holdings case policy (IND-007):** reuse first, the offer limit, variations and the attestation version.

**Not settings:** private formative only, grounding, the identifier screens, linear private cases, key marking, machine-checked safety, labelled AI feedback, and delivery only when published and approved.

## 7. AI cost attribution

| Activity | Budget | How |
|---|---|---|
| Drafting a private case (`case_steps`) | Individual | `runMeteredAi` via `scholarAiRunner`, with its risk |
| AI feedback on written reasoning, private case (`evaluate`) | Individual | `runMeteredAi`, with its risk |
| AI feedback on written reasoning, library case (`evaluate`, `case.live_with_stored`) | Individual, by rule | `sessionFeedbackContext` → `resolveOwner` → `runOwnedAi`, with its risk, `record = caseSessionRecord(sessionId)` → `recordSessionFeedback` |
| Replaying a stored or library case (`case.replay_stored`) | none | no AI |
| Offering a case | none | no AI (`candidates.ts`) |
| Platform screening and shared case development | Platform | IND-007 (not Scholar) |

## 8. End-to-end staging evidence

Run `scripts/scholar-clinical01-harness.ts`:
- **Where:** a dev server on this branch, against staging `ezhvpgtcqcdsgylrxgdb`.
- **Conditions:** metering OFF, `case_library` OFF, real AI, the respiratory materials.
- **Result:** **ALL GREEN, 14 passed, 0 failed**, with C14, C15 and C9 pending.

| Owner's step | Check | Result |
|---|---|---|
| 1 A private respiratory case from notes | C1: written, checked, private formative, linear; its session starts | PASS |
| 2 Mapped to CFCA outcomes | C2: objectives name the linked competencies (typed links: 4), sources named | PASS |
| 3 A progressive scenario | C3: first stage only; no key, rationale, expected answer, safety flag, source reference or salt | PASS |
| 4 Findings revealed appropriately | C4: a permitted finding shown when asked for, anything else refused | PASS |
| 5 Interprets and decides | C5: every decision recorded, the case moves on by its own progression to the end | PASS |
| 6 Structured reasoning feedback | C6: key and rationale per decision, how it was marked; the debrief by dimension | PASS |
| 7 Saved and resumable | C7: leave and come back to the same place; decisions append-only (a rewrite is refused) | PASS |
| 8 Back to Teach Me or Revision | C8: links on the case page; Teach Me opens on the section; Teach Me starts a case | PASS |
| 9 Candidate enters the review queue (Scholar side) | C9: explicit offer, source-free snapshot | **Not run for the pilot** (library OFF, owner directive 2026-10-25) |
| 14 Another student reuses without generation | C14 | **Not run for the pilot** (library OFF; the kept case was retired) |
| 15 Live AI on the Individual budget | C15 | **Not demonstrable on staging**: no eligible model (see REVISION-01 §7, R13m) |
| 17 Privacy | C17: another student reaches no session, answer, case or page | PASS |
| 18 Stored cases after allowance exhaustion | C18: replayable and key-marked; only a NEW case is refused, saying so | PASS |
| 19 No mandatory catalogue | C19: a case written and played for a student with no programme | PASS |
| — Erase-all | E1: no case, session or decision left (the append-only trail yields to the cascade) | PASS |

**How it got there:**
- **Run 1:** every draft was refused. The reasons were "malformed" (a reply cut off at the output limit) and ungrounded numbering ("Stage 1").
- **Fix 1:** numbering is stripped by code, the output limit raised, the reply kept short, and JSON and shape refusals told apart.
- **Run 2 (13/1):** student B's single note was refused for state words ("reduced", "worsening") and counting.
- **Fix 2:** prompt v2 (no counting, no state or change words the notes do not use).
- **Run 3:** 14/0.
- **The checks are never relaxed:** a draft that fails is not stored, and the refusal reasons are audited as rule and token only, never case text.

**Tests:**
- Unit: `clinical.test.ts` (9); Individual and cases suite 408/408.
- `scholar-learning-harness` 146/146:
  - **K33:** library plays are the shared delivery's;
  - **K34:** the learner view only reaches the browser;
  - **K35:** a private case is stored only after its checks, private formative and linear;
  - **K36:** feedback is labelled honestly;
  - **K37** (follow-up PR, 148/148): live AI feedback on a library case comes from `library.ts`'s narrow context, is charged by rule against the session, is checked, and is recorded only by the shared delivery. Plant P55 goes red when any of those breaks, or when a route names the context;
  - **S1 narrowed and S1b added** for the one governed contribution path;
  - **planted controls:** P51–P54, which go red when the rule is broken.
- `case-intelligence-harness` (IND-007's): K7, K11 and K12 pass, with their plants. Scholar never loads the full blueprint, never writes a library session, and the feedback context never reaches a browser.
- `individual-config-harness` 41/41.
- `next build`: exit 0.

## 9. Genuine remaining gaps

- **AI feedback on a library case's written decision:** built (#77, on `sessionFeedbackContext`). Not run live: the library is OFF for the pilot.
- **Steps 9, 14 and 15:** the harness is ready (C14 takes `CASE_VERSION_ID` and plays to a written decision; C15 checks the ledger owner, record and the kept feedback). They run when the library is switched on with a deliverable case, metering is ON and a model is eligible.
- **Contribution is not separately switchable.** One platform flag, `case_library`, gates library play, library-first offers, the candidacy grant and offering a case alike. Turning on library play alone, with student contribution still off, needs a second switch: server-side in `candidates.ts` (IND-007's), with Scholar's offer panel following it. Not needed for the pilot, where both are OFF.
- **Clinical context and the library:** the context shapes a private case. Matching library cases by context needs the library's specialty taxonomy terms, which the context codes do not yet map to. Library search by competency and topic works.
- **A library case's end-of-case AI debrief** (`recordSessionDebrief`) is not called: a library session's debrief is its deterministic answered views. Calling it is a small follow-up if the owner wants an AI summary on the student's budget.
- **Private cases are linear by design.** A branching consequence would need a fact the notes do not state; branching cases come from the governed library.
- **A failed library withdrawal on deletion.** If the library tables are unreachable when a material is deleted, the deletion still happens and the failed count is audited. A retry would need a queue.

## 10. Production activation dependencies (none authorised by this build)

- **Migrations:** 422, 423 and 424 (IND-007), then 435 and 436, each with a separate owner GO and the OPS-001 safeguards.
- **Flags:** `individual_app`, `case_library` and `ai_fair_use` all stay off in production.
- **Legal:** the case attestation text (`case-attest/1`, a staging draft pending legal review) and the published legal documents for AI consent.
- **D5 eligibility:** a reviewer decision before `case_steps` and `evaluate` can run with metering on.

## 11. Final acceptance report, 5A and Scholar 5B (2026-10-25)

Existing evidence above, plus today's live check. No completed test was repeated.

**Pilot posture (owner directive, 2026-10-25):** private formative clinical reasoning goes ahead; the case library and student case contribution stay OFF.

| Switchable, and its state for the pilot | Gates |
|---|---|
| `case_library` platform flag (owner-held; unwritten or unreadable = OFF) — **OFF** | "Choose an existing case", library-first offers, playing a library case, the candidacy grant, "Offer this case". Revoking, withdrawing and seeing one's own offers are never gated. |
| `scholar_case_entries` (Individual policy) | Which entries Apply offers. With the flag OFF, "library" is never offered even if listed. |
| `scholar_case_generation`, `scholar_case_reasoning_feedback`, `scholar_case_mode`, `scholar_case_contexts` (Individual policy) | New private cases, AI feedback or self-review, guided or independent play, contexts. |

With `case_library` OFF, no library control or promise shows. The Apply page keeps the governed "Clinically approved cases — not available yet" state (B3), and the AI notes and case-start errors no longer mention library cases (ab310232).

| Item | Status | Evidence |
|---|---|---|
| **5A CR1–CR5** | **Complete** | §3. 14/0 on staging (§8), metering OFF, real AI. |
| **5B, Scholar side** | **Built, OFF for the pilot** | §4: offer this case, library first, library plays through `library.ts`, library written-answer feedback (#77). Not run live (library OFF). |
| **Reused Holdings engines** | **Complete** | §5. One case engine for private and library cases. |
| **No-code configuration** | **Complete** | §6 and the switch table above. |
| **AI cost attribution** | **Built** | §7. Live metered attribution (C15) waits on a recorded model eligibility, as R13m does. |
| **End-to-end staging evidence** | **Accepted for the pilot path** | §8: C1–C8, C17–C19 and E1 PASS. C9 and C14 not run (library OFF); C15 not demonstrable (no eligible model). |
| **Genuine remaining gaps** | §9 | Contribution has no switch of its own (IND-007's side, not pilot-critical); library context matching; library AI debrief not called. |
| **Production activation dependencies** | None authorised | §10, plus: the D5 eligibility decision before `case_steps` and `evaluate` run metered. |

**Verdict:** Stage 5A is complete for development and staging, and is the pilot's clinical reasoning. The Scholar side of 5B is built and stays switched OFF.
