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

---

# Follow-up, 27 Oct 2026: initial pilot priorities (owner directive "COMPETEN SCHOLAR: INITIAL PILOT PRIORITIES")

State on entry:
- Waves 1 and 2 are live: PR #149 is merged as 54903b7b and deployed.
- Migration 600 has been applied in production.
- The panel showed US$0.2165 over 11 calls and 0 measured actions, because the acceptance calls predate `action_id`.

## Completed

### Priority 2: what the 4 rejected acceptance attempts actually were

This is from the production Scholar audit rows, read-only (`bin/q/AIOPT-01-rejected-cases.sql`).

**Apply case, blueprint: 2 calls, US$0.0889. It was refused for its structure, not for grounding.** The refusal reasons were:
- "stage s1: option ids repeat between its decision points";
- "stage s3: option ids repeat between its decision points";
- "decision d3: a free-text decision needs its expected response".

The first two came from a code defect. `blueprintFromDraft` gave every decision's options the ids `a`, `b` …, so any stage that held two decisions failed the validator, whatever the notes said.
- **Fix:** option ids now carry their decision (`d1a`).
- A regression test reproduces the acceptance shape.
- The validator is unchanged.

The third reason, a free-text decision with no `expectedResponse`, came from the prompt. Its reply example showed no such field.
- **Fix:** the example now shows a free-text decision with its `expectedResponse`, marks the field as required, and asks for exactly one decision per stage.
- The prompt version moves to `scholar-case-blueprint-v3`. That also ends any identical-retry block on the old version.
- The validator rule stays: a free-text decision without an expected response is still refused, and a test pins this.

When a draft is refused only for its shape, the learner no longer sees "without adding things they do not say".

**Step-by-step case: 2 calls, US$0.0540. 0 steps survived.** 8 drafts were dropped:
- `unsupported_term` ×5 (options using words the passage does not use);
- `correct_not_supported` ×1;
- `malformed` ×2 (this includes "only one step survived").

Across the whole run, the vocabulary rule caused 9 of the 12 question drops (mcq 2, case question 2, step case 5). The audit kept only the code, not the words, so there is no evidence for a targeted prompt change.
- **No case-steps prompt change was made.** The vocabulary rule is unchanged.
- **Added instead:** the step-case and questions audit rows now record `refused_terms`. These are at most 12 single words the model used that the passage does not contain. They never include the passage, the stem or an answer.
- The next pilot rejections will show which words to address.

**Sufficiency rules: unchanged, and the evidence supports leaving them.** The note was sufficient: a case question from the same section was kept. The failures were the defect, the missing field and the vocabulary rule. None of them was a lack of material.

### Priority 7: metering, prepared and not activated (no production flag or policy changed)

Production state (read-only, `AIOPT-02/03`):
- `ai_fair_use`: unwritten, so OFF.
- The published policies `ai.fair_use.scholar` and `ai.fair_use.professional` set UGX, 4,000 included CAU, a 500 reserve, renewal on the subscription anniversary, and a 10% FX buffer.
- 0 allowance accounts.

What ON still needs. `ai_reserve` refuses in this order, and each refusal reaches the learner as "allowance used":

| Needed | Production now | `ai_reserve` refusal |
|---|---|---|
| `ai_price` rows for the routed models (`claude-opus-4-8`, `claude-sonnet-4-6`, and Haiku 4.5 if it is ever routed) | 0 rows | `model_not_priced` |
| `ai_fx_rate` UGX per USD | 0 rows | `no_reference_rate` |
| `ai_cau_basis` UGX per CAU | 0 rows | `no_cau_basis` |

- `ai_cau_rate` (USD per CAU) also has 0 rows.
- The gateway's list prices could serve as a reference for the price rows: Opus 4.8 is US$5/25 per MTok and Sonnet 4.6 is US$3/15. The owner sets the values.
- **Until all three rows exist, turning metering ON would refuse every Scholar AI call.**

Entitlement, tested on STAGING (flag set ON, standings read, flag restored to `false`):
- Members with a live pilot entitlement had full standing. The pilot grant writes an open-ended `pilot` entitlement, which is enough. **Invite-only pilot users are not refused as `not_entitled`.** No plan or subscription is needed.
- Members without a live entitlement (revoked, or never granted that product) would be refused. Their standing text says "allowance used" rather than "needs access", which is a wording follow-up.
- Production: 1 member, with open-ended pilot entitlements for Scholar and Professional.
- The staging reads opened 4 `ai_allowance_account` rows on staging.

D1 subject-level risk, using the production rules and the real code (`classifyRisk`):

| Request | Classified as | Rule |
|---|---|---|
| Teach on chunk 1 of the acceptance note (sections 1-2) | `high_risk_clinical` | `high.emergency` ("cardiac arrest") |
| Teach on chunk 2 (sections 3-5) | `high_risk_clinical` | `high.emergency` ("sepsis") |
| Personal AI "sepsis vs SIRS" | `high_risk_clinical` | `high.emergency` ("sepsis") |
| Teach on chunk 3 (section 6) | `clinical_educational` | |
| A study-skills question | `standard_educational` | |

- Teach is eligible only up to `clinical_educational` (Opus 4.8).
- **So with metering ON, 2 of the 2 clinical Teach or Personal AI requests made so far in production would be refused (`not_eligible`).** The same would happen to most notes on deterioration, sepsis or emergencies.
- Personal AI question text is not stored, so for that request the subject was taken from the activation record.

### Priorities 8 and 10: learner-level measures (no migration)

The HQ AI Quality & Cost panel now also shows:
- active Scholar learners in the window;
- cost per learner and calls per learner;
- for each output kind, actions and accepted outputs per learner, and the feedback rate (ratings over outputs kept);
- people and cost per person by product;
- learners per day in the trend.

`actor_id` is counted in server memory only. No id or text reaches the page, and a test asserts that.

## Measured

- **Acceptance baseline, split by cause:**
  - US$0.0889 went on the blueprint (code defect and missing field, both now fixed);
  - US$0.0540 went on step cases (vocabulary rule, now instrumented);
  - the rest was kept output.
- **No savings are claimed.** The blueprint fix should stop the structural refusals, but there is no post-fix pilot evidence yet.

## Next

1. Merge and deploy. Then compare cost per accepted case on the next pilot cases, and read `refused_terms` after about 10 step-case attempts.
2. The metering prerequisites are owner data entry: price, FX and CAU basis rows. Keep metering OFF until they exist and the D1 decision below is taken.

## Blockers (genuine owner decisions)

- **D1 versus Teach eligibility.** If metering were ON, Teach and Personal AI on emergency or sepsis topics would be refused. The owner needs to choose one of:
  - (a) evaluate and approve a model for Teach at `high_risk_clinical`;
  - (b) narrow the `high.emergency` rule for educational Teach;
  - (c) accept that refusal.
- **Metering money rows.** The `ai_price`, `ai_fx_rate` (UGX) and `ai_cau_basis` (UGX) values before any ON.
