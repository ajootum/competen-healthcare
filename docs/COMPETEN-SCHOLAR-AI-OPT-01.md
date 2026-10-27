# COMPETEN-SCHOLAR-AI-OPT-01: build record (Waves 1-2 built, Wave 3 prepared)

Authority: the owner directive of 27 Oct 2026, filed verbatim at `RELEASE-2026-10-25/ACTIVATE-INDIVIDUAL/SCHOLAR-AI-OPT-01-DIRECTIVE.md`.
Baseline: `AI-PILOT-ACTIVATION-RECORD.md`, section ACCEPTANCE RUN. It recorded 11 calls costing an estimated US$0.2165, of which about US$0.14 went on 4 rejected step-by-step and blueprint attempts.

## Completed

### Wave 1: measurement

Telemetry was reconciled before adding anything:
- `plat_ai_requests` (migrations 055 and 371) already records operation, tier, provider, model, tokens, latency, status, cost and attribution for every call.
- The Scholar `audit_log` row already records the outcome (kept, dropped, withheld), the dropped reasons, the model, the prompt version and the attempts.
- What was missing was any link between the calls of one learner action and what that action produced. Without it, cost per accepted output could not be computed.

Migration 600 (`600-ai-outcomes-and-feedback.sql`) adds only what was missing:
- `plat_ai_requests.action_id`: the learner action a call belonged to.
- `plat_ai_outcomes`: one row per action. It records:
  - output kind;
  - accepted, partial, rejected, redirected or error;
  - counts kept and dropped;
  - rejection reason codes;
  - source-sufficiency outcome;
  - generation and verification attempts;
  - prompt and config versions;
  - a one-way material key.
- `plat_ai_feedback`: learner feedback. It holds a rating and reason codes, under a one-way key of the learner and the output.

The new tables store no text and no user id. RLS is on with no policies, so they are service-role only, like `plat_ai_requests`.

Writers (`src/lib/ai/outcomes.ts`, `src/lib/individual/scholar/outcome.ts`):
- `scholarAiRunner` tags every call of one action with one `action_id` and counts the calls by part.
- The routes record one outcome each: explain, learn/act, questions, revision sessions, step-by-step case, Apply case.
- Before 600 is applied, everything is fail-soft:
  - usage rows land without `action_id` (the PGRST204 fallback, as for 371);
  - outcome writes are skipped;
  - the feedback widget is not shown.

HQ view: a quality-and-cost panel on the existing Intelligence Analytics page (`/super-admin/ai/analytics`, `QualityCostPanel.tsx`). The sidebar and routes are unchanged. It shows:
- total spend;
- spend by product and by activity;
- cost per accepted explanation, question and case;
- rejection rates;
- what unsuccessful generation cost;
- redirects;
- rejection, sufficiency and feedback reasons;
- a 14-day daily trend.

Before 600 is applied, the outcome figures read "Not measured" and spend is live. The panel reads only `plat_ai_*` tables, and the plane-boundary harness is green.

### Wave 2: generation efficiency

1. **Source sufficiency** (`sufficiency.ts`).
   - Applies to the step-by-step case and the Apply case, before any model call.
   - It reads whether the notes describe a presentation, its meaning, an action and a reassessment, and in what order. It is not a length gate: the tests show that a long glossary is "insufficient" and a 3-sentence note is "sufficient".
   - Outcomes:
     - **Sufficient:** proceed.
     - **Simpler:** offer a case question first, and let the learner choose "Try the case anyway" (a governed attempt, recorded as such).
     - **Insufficient:** say what is missing and offer Teach me or other material.
     - **Uncertain:** proceed.
   - Every redirect is recorded with no cost.
2. **No identical retry.**
   - A case is not sent again when exactly the same sections, under the same prompt, config and published model-routing fingerprint, were rejected within 14 days.
   - Any change re-enables it: the material, prompt, config or routing.
   - Redirects and errors never block, and an unreadable record never blocks.
3. **The model's own "not enough" is honoured.**
   - The case prompts already tell the model to reply `{"steps": []}`, `{"stages": []}` or `[]` when the passage cannot support a case.
   - The code used to treat that reply as malformed and retry it. The retry told the model the case "needs two to four stages", which pressed it to invent.
   - That reply now stops after one call.
   - Multiple-choice questions keep their retry, because `[]` has no defined meaning there.
4. **Reuse before regeneration.** The learner can always ask for new content (`fresh`).
   - Unanswered saved questions on a section are offered first.
   - An existing step-by-step case from the section is offered first.
   - An existing private case from exactly the same sections and context is offered first ("Play it again").
   - Learn's saved explanations and Revise's reuse-first pool already existed and are unchanged.
5. **Learner feedback** (`ai-feedback.tsx`, `POST /api/individual/scholar/feedback`).
   - One optional tap: Helpful / Not helpful, Clear / Needs improvement, or Useful / Needs improvement.
   - Optional reason codes: inaccurate, unclear, difficulty, relevance, evidence.
   - Where it appears:
     - Learn replies;
     - Explain on the material page;
     - Revise question feedback (during and at the end of a session);
     - the end of a private case in Apply.
   - It is not shown on library cases, which are clinically reviewed.
   - The output must be the caller's own. Free text is not accepted.

Unchanged, by constraint:
- grounding, quality and blind verification;
- the patient-identifier screens;
- model eligibility, routing, prices, allowances and published policy;
- metering (`ai_fair_use`), which stays OFF;
- CAU top-ups, which stay off.

No model was substituted.

## Measured

- **Baseline (acceptance run):** US$0.2165 over 11 calls, of which about US$0.14 went on 4 rejected case and blueprint calls. This is one small sample and is not representative.
- **Observed improvement:** none is claimed. There is no comparable post-change evidence yet.
  - The acceptance note would pass the sufficiency check: it has signs, meaning, action and reassessment. So the check would not have prevented those rejections.
  - Its rejections were grounding failures. Their detail is in the production audit rows (`problems`), which were not read here.
  - The identical-retry guard would stop a repeat of the same section, but the run's two attempts were different activities.
- **What becomes measurable once 600 is applied:**
  - cost per accepted output per kind;
  - the rejected share and its cost;
  - redirect counts;
  - feedback rates.

## Verification

- `tsc --noEmit`: clean.
- eslint: clean, apart from 1 warning on a line this change did not touch.
- Full vitest suite: passing. New tests:
  - `outcomes.test.ts`;
  - `sufficiency.test.ts`;
  - `ai-opt.test.ts`;
  - 3 tests in `gateway.test.ts`.
- `ci-harnesses.ts`: 66/66.
  - `scholar-learning-harness` is 158/158 with its planted controls.
  - The K35 regex was widened only to allow two trailing return fields. The invariant (a blueprint is returned only when nothing is found) is unchanged.
- `plane-boundary-harness`: PASS.
- Not browser-verified. The widget and the outcome figures need 600, which is not on any database yet.

## Migration 600

- **State:** 1, authored. It is not committed. The package is in the coordinator notes folder: `SCHOLAR-AI-OPT-600/` (migration, ROLLBACK-600, VERIFY-600, SHA256SUMS).
- **Next state:** the coordinator applies it to staging twice, records the sha256 and verification, then commits it to this PR.
- **Production:** separate owner GO only.
- **Dependencies:** 055 (`plat_ai_requests`) only. It is independent of 371. It may be applied in any order relative to other pending files.
- **Risk:** LOW. One nullable column and two new tables, with no trigger and no function. The house rules are ALL CLEAR.
- **Code without 600:** fail-soft, as described above. No server gate is needed: nothing user-facing depends on 600 except the feedback widget, and the widget is hidden by a server check (GET `/feedback`, `available:false`).

## Next

1. Coordinator: stage 600 ×2 with sha256, add it to the PR, merge on green, and deploy with the owner's GO.
2. Owner: apply 600 to production when convenient. Measurement starts then.
3. Read the production audit `problems` of the 4 rejected acceptance attempts (read-only). Then decide, with evidence, on one prompt refinement for `caseSteps` and `caseBlueprint`.
   - The likely suspect is a qualitative note with no values, where the model invents values.
   - Do not change the prompt without that evidence.
4. After about 2 weeks of pilot data, compare cost per accepted case before and after on equivalent activities, then report.

## Wave 3 (prepared, not built): governed knowledge reuse

Cases already have the full governed lifecycle, kept OFF by the `case_library` flag (`src/lib/cases/policy.ts:93`). Questions and explanations have no contribution path.

| Stage | Case | Question | Explanation |
|---|---|---|---|
| Private | `individual_scholar_case` (435), rights `student_private` | `individual_scholar_question` (372). No status column. | `individual_scholar_artefact` (415). CHECK `private_formative` only. |
| Contributed | `case_candidacy` plus append-only events (423). Explicit per-case offer with attestation (`own_notes` / `licensed_to_share`). De-identification is checked by the app and by the DB backstop. | **Gap.** Standalone MCQs cannot be offered. Only a step-by-step case can be offered, via `s4CaseBlueprint`. | **Gap.** |
| Reviewed | Educator studio, then `promoteCandidate`, then `case_library_submit`, then the 395/422 review. Reviewers are independent, appointed and scoped, and hash staleness applies. | 442 `ckri_knowledge_version` kind `revision_question`, but educator or AI-draft only. **Gap** for learner-sourced items. | 442 kind `explanation`. Same gap. |
| Approved | `case_library_approved(version)`: exact hash, required approvals. | Same engine (442). | Same. |
| Published | `case_library_publish` (`hq.quality.case.publish`). The DB guard blocks plays of non-deliverable versions. | 442 publish exists. Learner delivery is **not built**. | Same. |
| Retired | `case_library_retire` | 442 retire | 442 retire |

Controls:

| Control | Status |
|---|---|
| Consent | Cases only. |
| De-identification | Cases only. It checks identifier patterns, not free-text identifiability. |
| Copyright | A self-attested `rights` field only. The attestation text is a staging draft "pending legal review". There is no licence, citation or takedown record. |
| Provenance and versioning | Strong. |
| Clinical review authority | In place. |
| Learner withdrawal | Works before promotion. **A promoted case cannot be withdrawn by the learner.** |
| Funding | AI spend is attributed (`consumption.ts`). Nothing on a library version records whether private or platform funding created it. |

Smallest steps, reusing what exists (each needs an owner GO; nothing private is ever transferred automatically):
1. **Gate (owner and legal).** Approve the attestation text. Apply 422/423 to production. Write `case_library` ON.
2. **Contribution of questions and explanations.** Add a `content_candidate` sibling of `case_candidate`. It reuses the candidacy consent and events, the identifier backstop, purge-on-withdraw, and the educator queue that never names the student.
3. **Landing.** Promote into 442 `ckri_knowledge_version` (`explanation`, `revision_question`) with origin `learner_candidate`. Review, approval, publish and retire then come from 395/442/461 unchanged.
4. **Copyright.** Add rights holder, licence, source citation and takedown fields, enforced at submit.
5. **Withdrawal after publication.** Add a governed promoted→withdrawn path with retire, a reason and an event. Show learners the status of their contributions.
6. **Funding provenance.** Record the creating owner type and budget on library and knowledge versions.

Reuse in serving: once a version is published, the library-first offer that already exists (`findLibraryCases`, "reuse first, no AI, no charge") serves it with no generation. Extend it to approved questions and explanations after step 3.

## Blockers

None for Waves 1 and 2. Wave 3 step 1 is an owner and legal decision (the attestation text and the `case_library` flag).
