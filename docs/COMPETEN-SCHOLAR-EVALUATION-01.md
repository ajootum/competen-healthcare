# COMPETEN-SCHOLAR-EVALUATION-01: Evaluate, Stage 7 of 8 (build record)

Owner GO 2026-10-25, "COMPETEN-SCHOLAR-EVALUATION-01, STAGE 6 — INTELLIGENT LEARNING EVALUATION". The owner text is the
controlling contract (coordination notes, `OWNER-GO-STAGE6-EVALUATION-01.md`). In the owner's eight-stage product
architecture (Join, Upload, Classify, Learn, Revise, Apply, Evaluate, Progress) this is **Stage 7, Evaluate**. The
workstream identifier, the migration and the records keep their names.

## Migration 426

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `426-individual-scholar-evaluation.sql` | `84d0e12d1c018879ee1ca2fe0ededb9684b27af2b253a1eb907a309522a505a4` | Medium (one table, one trigger function; APPLY WHOLE) | **Applied ×2 on staging**, rolled back and re-applied. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-EVALUATION-01/ROLLBACK-426.sql` | `1ee0250a12babe3dd794e6c60d083b09963f6d99f2fbe6860efae9c82c2fe891` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-EVALUATION-01/VERIFY-426.sql` | `c2261af70114c98891a4bc439e1358528cb0a24af05fb9fa5bb97466e10e3932` | read-only | — |

**Staging run record** (coordinating session, 2026-10-25, guarded runner, file whole, target `ezhvpgtcqcdsgylrxgdb`):

| Step | Fingerprint (`individual_scholar%`) |
|---|---|
| PRE | `386b3546223b` (33 tables) |
| 426, run 1 (F1) | `24b9364c77d6` (34 tables) |
| 426, run 2 | `24b9364c77d6` (idempotent) |
| ROLLBACK-426 | `386b3546223b` = PRE |
| Re-apply | `24b9364c77d6` = F1 |

VERIFY-426 after both runs:
- 17 columns;
- the check, `fresh_fk`, `supersedes_fk`, `user_id_fkey` and the primary key;
- RLS on, with one own-row SELECT policy;
- the trigger is BEFORE UPDATE only;
- 0 rows.

The bytes applied are the files above.

- **Application order:** after 417 (it names a revision session). Independent of 425.
- **Fail-closed without it:** nothing is kept. The workspace still evaluates live and says evaluations are not kept here.

**Status:**
- Development and staging only. **Production activation not authorised.**
- Scholar stays behind `individual_app` (server-enforced, default OFF).
- Evaluation is formative, educational self-evaluation. It never establishes verified clinical competence.

**Migrations:** 426, from the coordinator's range 425–429.

## 1. What already existed, and is reused

| Capability | Existing | Where |
|---|---|---|
| Measure states | measured, insufficient (have and need) or not_measured (with a reason); coverage means "touched", never "achieved" | `src/lib/competency/progress-model.ts` (Holdings) |
| Evidence | Teach Me checks (414 `clarify` verdicts); revision answers with their marking, score and session (372, 416, 417); spaced review (391); clinical-case decisions with dimensions and safety (435) | the store |
| CFCA | Section → competency links and outcomes (388, Stage 2); domain › practice › CPU › competency › outcome, expected level | `sectionLinks`, `catalogue.ts`, `competency-view.ts` |
| Fresh knowledge check | Mock Practice on 417 sessions, feedback held to the end, short answers held for self-grading (425) | Revision |
| Configuration | The WCE Individual policy: versioned, audited, HQ-edited | `policy.ts` |
| AI | The Holdings gateway, Fair-Use Engine, model eligibility and risk tiers | Answers keep the marking they got when answered |
| History and audit | `audit_log`, through Scholar's `audit()` | `http.ts` |

**Not reused, on purpose:** `src/lib/engines/assessment.ts`. It is the enterprise clinical-assessment scorer: it maps averages
to `CompetencyLevel`, so it would present formative practice as a competence level. Stage 6 uses the Holdings measure
shape and the configuration engine instead. No new assessment engine is built.

## 2. E1–E5 as built

| | Built |
|---|---|
| **E1 Workspace** (`/study/evaluate`, the "Evaluate" tab) | **Evaluate my understanding:** the continuous evaluation of all evidence, recomputed on each visit, with no exam and no AI; "Keep this evaluation" saves it.<br>**Review existing evidence:** counts by type, with links.<br>**Start a new evaluation:** scope (all my learning, a topic, one material, chosen materials, a competency, a learning outcome, a clinical context) and method (existing evidence, a fresh knowledge check, combined).<br>**Previous evaluations**, and **Strengths and learning gaps** inside each evaluation.<br>No catalogue needed. One column below `md`; touch targets grow on coarse pointers. |
| **E2 Aggregation** (`evaluation.ts`, `evaluation-data.ts`, `store.ts evaluationEvidence`) | **Read in place, never copied:** a record names evidence by id.<br>**One question, or one decision of one case, is one piece of evidence,** judged on its latest marked answer; answering it again is repeated exposure, counted as such.<br>**What counts:** only answers marked by their key. AI-evaluated answers and self-graded answers are kept apart and shown. Teach Me explanations are never read; Teach Me checks are shown as informal.<br>**What is kept:** type, source, marking, difficulty, competency links, conditions (a fresh check's answers are marked as such), recency and provenance. |
| **E3 Rules** | Nine Individual policy keys (§5), recorded in each record with the configuration version (the Individual partition's latest published WCE version). The interpretation is deterministic. There is no pass mark: the bands describe. |
| **E4 Feedback** | Demonstrated strengths, learning gaps and too-little-evidence areas, at the most specific level the evidence supports (outcome, then competency, else section). Also retention difficulties (recalls that did not hold), reasoning weaknesses (by dimension) and safety points missed.<br>**Next steps,** each from a finding, open Teach Me, Revision, Spaced Review, a clinical case or the material.<br>**Limitations** are always listed. |
| **E5 History** (426) | One immutable record per evaluation: scope, educational context, kind and method, the rules and configuration version, results, confidence, limitations, evidence references, CFCA, AI provenance, and the fresh-check session.<br>A correction or a later evaluation is a new record that supersedes the earlier one, which is kept. The student may remove one; erase-all removes all. Stage 7 reads these records. |

## 3. Continuous and student-initiated evaluation

- **Continuous (A):** computed on every visit to Evaluate from all evidence. No AI call, no exam. It is kept only when the student keeps it (kind `continuous`).
- **Student-initiated (B):** `POST /api/individual/scholar/evaluations` with a scope and a method:
  - **existing:** the evidence as it is;
  - **fresh:** only the answers of a finished Mock knowledge check over the scope (policy size, feedback at the end);
  - **combined:** everything, with the fresh check's answers counted as given under evaluation conditions.

  An outcome checks its competency, and a clinical context reads the cases of that context and the sections they were written from.

## 4. CFCA integration

- **Where a programme catalogue applies and sections are linked:** results are grouped domain › practice unit › competency › learning outcome. Each area shows the framework's expected level beside the observed result.
- **Kept distinct:** expected educational level (the catalogue), observed educational performance (the evaluation), and verified clinical competence (never assessed here).
- **No catalogue, or no links:** results are by section of the student's own notes, and the evaluation says so.
- **Not hard-coded:** no profession and no nursing rule. Professions and specialties come from the catalogue.

## 5. No-code configuration (the existing engine, HQ Individual policy page)

`scholar_evaluation_methods`, `scholar_evaluation_evidence`, `scholar_evaluation_min_evidence`, `scholar_evaluation_min_sources`,
`scholar_evaluation_recency_days`, `scholar_evaluation_band_strong`, `scholar_evaluation_band_developing`,
`scholar_evaluation_fresh_quantity`, `scholar_evaluation_recommendations`. Model eligibility stays where it is governed
(the Holdings eligibility register). Short-answer marking is the existing `scholar_short_answer_marking`.

**Not settings, by design:** what counts as independent evidence; AI and self-grades kept apart; never verified
competence; records kept as made.

## 6. AI and non-AI evaluation

- **The interpretation uses no AI.** It is fixed rules over marked evidence (scholar-learning K39 pins it: no AI runner in the evaluation code).
- **Structured questions** are marked by code.
- **Written answers** keep the marking they were given when answered: an eligible AI model through the gateway (with its model recorded in the evaluation's AI provenance), or the student's own grading (held to the end in Mock, 425).
- **With AI unavailable or the allowance used up:** existing evaluations open, and a new one from existing evidence is still made. A short answer no model can evaluate is held, not guessed.

## 7. Evidence confidence

- **Classes:** strong, moderate, limited or insufficient.
- **Inputs:** the count of independent evidence, its breadth across sections, its recency, and the share marked by code.
- **Reasons** are always shown.
- **Thresholds:** policy (minimum evidence and breadth). Strong needs three times the minimum, twice the breadth, mostly recent evidence and mostly code marking. Moderate needs twice the minimum and the breadth.

## 8. Focused staging acceptance

`scripts/scholar-evaluation01-harness.ts`, the owner's journey steps 1–15, plus isolation and erase-all. It ran alone over
HTTP against staging `ezhvpgtcqcdsgylrxgdb` on 2026-10-25, with 426 applied, metering OFF and real AI. **ALL GREEN, 19
passed, 0 failed; 0 fixtures left.**

| Owner step | Result |
|---|---|
| 1 Learning (Teach Me and a check), revision and a clinical case on the respiratory materials | PASS |
| 2 Existing evidence retrieved (questions, case decisions, Teach Me checks counted on Evaluate) | PASS |
| 3 Continuous evaluation interprets it: six dimensions, no exam, no AI call | PASS |
| 4 A Respiratory Assessment evaluation, kept as a record | PASS |
| 5 Coverage, knowledge, retention and reasoning, each its own measure state | PASS |
| 6 A fresh knowledge check (Mock, feedback at the end) | PASS |
| 7 Structured questions marked by their key, no AI call | PASS |
| 8 Free text: AI evaluation where available, else held for self-grading | PASS. **Run 4: `ai_evaluation` by `claude-sonnet-4-6`.** See §9(a). |
| 9 Evidence confidence (class and reasons) and limitations shown | PASS |
| 10 CFCA learning outcomes: nursing-ug-diploma, 9 linked outcomes, 8 worked on; the domain › unit › competency › outcome tree; confidence moderate | PASS |
| 11 Recommendations open Teach Me, Revision and Clinical Reasoning | PASS |
| 12 History preserved: a later evaluation supersedes; the earlier one is unchanged, and a direct UPDATE is refused by 426 | PASS |
| 13 With the allowance used up (synthetic rows, fixture only): existing evaluations open, a new one is made, no AI | PASS |
| 14 No catalogue: by section of the notes, saying so | PASS |
| 15 Never verified competence: every record says not assessed, and the page says so | PASS |
| I Another student can neither read, remove nor open an evaluation | PASS |
| E Erase-all removes them | PASS |

**How it got there:**
- **Run 1 (15/4):** the Evaluate pages returned 500 once a student had evaluations, because a server page called a helper defined in the `"use client"` module. Fixed by moving `evaluationHref` to `question-view.ts`. K39 now pins it.
- **Run 2 (18/1):** step 15's scan for words such as "competent" also read the catalogue's own outcome wording. It was narrowed to what the evaluation asserts (its results, minus catalogue labels).
- **Runs 3 and 4:** 19/0. Run 4 prints the step 8 and step 10 paths.

**Tests:**
- Unit: `evaluation.test.ts` (13); policy defaults pinned.
- `scholar-learning-harness` 152/152: K39 with plant P57 (six ways red).
- `individual-config-harness` 41/41; `next build` exit 0.

## 9. Genuine remaining gaps

- **(a) Clinical-safety, found by this run.** With metering OFF, a Revision short answer was AI-evaluated by `claude-sonnet-4-6`. The owner ruled Sonnet out for clinical activities, and `evaluate` has no eligible model (D5-v2).
  - **Cause:** eligibility does not gate unmetered calls. IND-007's `holdings/eligibility-unmetered` closes that, and is not yet merged.
  - **Fix offered:** `scholar_short_answer_marking` defaulting to "self", as was done for case reasoning. Raised with the coordinator.
  - **Effect on Stage 7:** none on its code. Answers keep the marking they were given, and the AI model is recorded in the evaluation's AI provenance.
- **(b) Evidence weighting** (E3) is not configurable. Every independent piece of evidence weighs the same. Weighting by difficulty or conditions is a bounded follow-up.
- **(c) Retention:** records are kept until the student removes them or erases everything. A time-based retention setting would need a scheduled job.
- **(d) A clinical-context scope** reads the cases of that context and the sections they came from. Revision answers carry no clinical context.
- **(e) Library-case decisions** are not read, because the library is OFF for the pilot. Reading them would be one more evidence source.
- **(f) AI synthesis or explanation of gaps** is not used. The deterministic findings were sufficient, and the contract allows AI only where justified.

## 10. Production dependencies (none authorised by this build)

- **Migration 426** in production, with a separate owner GO and the OPS-001 safeguards. Application order: after 417.
- **Flags:** `individual_app` and `ai_fair_use` stay OFF.
- **D5 eligibility:** an eligible model for `evaluate` before written answers are AI-evaluated with metering on. Until then they are held for the student's own grading.
