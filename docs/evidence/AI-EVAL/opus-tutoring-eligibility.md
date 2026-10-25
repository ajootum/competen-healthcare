# Opus 4.8: tutoring eligibility (recorded on staging), and the routing prepared for the high-risk three (25 October 2026)

**Authority:** owner, "COMPETEN — APPLICATION DEPLOYMENT AND PILOT PREPARATION", §5:

> "Use Opus for clinical educational tutoring within its evaluated eligibility. For questions, case steps and short-answer evaluation, perform only the targeted checks needed to establish eligibility before enabling those high-risk activities. Do not initiate another broad model comparison."

**Evidence:** D5-v1, run `eval-run:4b92dda5-bc86-4412-b57c-17bd2868df3f`.
- It was corrected for one rubric false positive under the owner's own criterion (`d5-evaluation-2026-10-24.md`, "Correction").
- On the corrected record, Opus passes 14 of 14.

**No model was called for this record.**

## 1. Tutoring eligibility: RECORDED ON STAGING

| Product | Activity | Provider | Model | Eligible | Highest tier | Staging row |
|---|---|---|---|---|---|---|
| scholar | `teach` | anthropic | `claude-opus-4-8` | yes | `clinical_educational` | `b559d75d-9fc4-4c8e-8882-7043ec806adb` |
| scholar | `ask` | anthropic | `claude-opus-4-8` | yes | `clinical_educational` | `1935ddf6-6409-4f77-b364-69557e970038` |

**How it was recorded**
- `scripts/staging-record-model-eligibility.ts --apply`, through the existing mechanism (`fair-use-admin.ts` `changeRate("eligibility")`). These are the same checks the HQ page runs: evidence is required, and a highest tier must be named.
- **Guard:** the script refuses any target not judged non-production. It is idempotent: a re-run reports "already in force, kept".
- `evidence_ref` cites the run and the correction, and `note` cites the owner's decision. `decided_by` is empty, because the decision is the owner's and was recorded by IND-007.
- **Nothing else was written:** no policy, flag, price or other model.

**What it covers:**
- **Tutoring only:** Scholar Teach Me and Ask, up to clinical educational.
- **Not high-risk clinical.** A tutoring request whose subject the risk rules classify as high-risk stays refused.
- **Not** questions, case steps or evaluation (section 3).

## 2. Tutoring eligibility in PRODUCTION: owner-run, under its GO

**It is a database row, not configuration:** `ai_model_eligibility` (migrations 411 and 412). It is in production since the 25 October catch-up, and holds no rows today.

**Steps (owner, or an appointed Platform Director, `hq.platform.ai.manage`):**
1. Open `/super-admin/ai/fair-use`, then **Clinical model eligibility**.
2. Add one decision for each row of the section 1 table, with the same values:
   - product `scholar`; activity `teach`, then `ask`;
   - provider `anthropic`, model `claude-opus-4-8`, eligible;
   - highest tier `clinical_educational`;
   - evidence `eval-run:4b92dda5-bc86-4412-b57c-17bd2868df3f (D5-v1, corrected 2026-10-25)`.
3. **Post-check (read-only):**
   ```sql
   select product, activity, provider, model_prefix, eligible, max_risk_tier, evidence_ref, effective_from
     from ai_model_eligibility where effective_to is null and model_prefix = 'claude-opus-4-8' order by activity;
   ```

**Production effect today: none.**
- Metering is OFF and Individual is inactive.
- With metering OFF, Scholar AI is not metered, so `ai_reserve` (which reads this row) is not called.
- The row matters only once `ai_fair_use` is switched on, under its own GO, together with the policy, prices, CAU basis and rate (pilot package §4b).

## 3. Questions, case steps and evaluation

### Is D5-v2 the targeted check? **Yes. No further model run is needed.**

D5-v2 (run `6c2c8067-9b30-4ec7-b3f1-84c18cfdfd0d`, `d5v2-activities-2026-10-25.md`) is the minimum targeted check, and it was run for exactly these three activities.
- It ran the **production Scholar generators**, with their grounding checks, blind verification and retry, on Opus 4.8, the owner's model.
- It is not a comparison. The same three Anthropic tiers as D5-v1 were run, at US$0.43 in total.

| Activity | Opus 4.8 (on reading) | Proposed |
|---|---|---|
| `questions` | 3/3, every key correct | eligible up to `clinical_educational` |
| `case_steps` | 3/3, both generators | eligible up to `high_risk_clinical` |
| `evaluate`, short-answer marking | 5/5, no unsafe answer marked correct | eligible up to `clinical_educational` |
| `evaluate`, case-reasoning feedback | 0/2 shown (both withheld by Scholar's guard) | **stays DISABLED** (owner) |

**What remains is a human acceptance, not a check:**
1. **The `questions` screen.** It scored 2/3. The 3/3 rests on reading four key-rule "safety" flags as false positives in the rules: in each one, the keyed option is the passage's correct answer. This needs the same kind of determination the owner made for the mg-per-5-mL rule. That is a reading of answers already recorded in 419, not a new run.
2. **Recording the decisions.** Once accepted, the owner or a reviewer records each activity on the HQ page, as in section 2, citing `eval-run:6c2c8067-…`.

### ⚠ Case-reasoning AI feedback is ON today wherever metering is OFF. Switch it off now.

Case-reasoning AI feedback runs under the **same activity code**, `evaluate`, as short-answer marking. Both the private-case and library-case paths in `api/individual/scholar/clinical/sessions/[kind]/[id]/answer/route.ts` use it, and both run it only while the Individual policy `scholar_case_reasoning_feedback` is `ai_then_self`, which is its default.

**With metering OFF, the pilot's state, model eligibility does not gate it.** `getAiStanding` returns every activity as available when `ai_fair_use` is off. So today the feedback runs wherever the policy is at its default.
- **Staging (read-only, 25 October 2026):** no published value for `scholar_case_reasoning_feedback`, so the default applies and the feedback is **ON**.
- **Production:** the same once Individual is activated, unless it is set first.
- **With metering ON:** it would also switch on the moment `evaluate` is made eligible.

The owner has decided it stays disabled for the pilot (D5-v2: 0/2 shown on Opus).

**So, now (owner-run, configuration, staging then production, before activation):**
1. Open `/super-admin/individual/configuration` and find the case reasoning feedback setting.
2. Choose **"The student's own review only"** (`self`). Save the draft, then publish.

With `self`, both paths return the student's own review and call no model. Splitting the activity code instead would be a Scholar code change (IND-004's), and is not needed for the pilot.

### The routing: PREPARED, NOT PUBLISHED

**The change** (`scripts/ai-provisional-policy.ts`, the provisional pilot policy):
- the risk floor: `clinical_educational` and `high_risk_clinical` move to **heavy** (Opus 4.8), from `reasoning` (Sonnet 4.6, which the owner has ruled out for clinical activities);
- `questions`, `case_steps` and `evaluate`: tier and floor **heavy**.

**What the change does**
- **A teach or ask request on a clinical subject now routes to Opus.** That is the model whose tutoring eligibility section 1 records.
  - ⚠ Without this change, a clinical tutoring request routes to Sonnet and is refused `not_eligible`, so the section 1 rows would have no effect once metering is on.
- **The three stay OFF until their eligibility is recorded.** `ai_reserve` (412) refuses any model with no eligibility row for the activity and tier, whatever the routing says. The engine's standing (`withEligibility`, #82) does not offer them either.
- **Pinned by `ai-fair-use-harness` A17.** Clinical work routes to heavy and never falls back to reasoning, a standard request stays where it was, and the three are not offered on tutoring eligibility alone. Two plants each go red: clinical subjects left on reasoning, and case steps without their clinical floor.

**Where it becomes live:** this is configuration, the published Scholar policy (`ai.fair_use.scholar`). It is **not published** on staging or production.
- **To publish on staging:** at `/super-admin/ai/fair-use`, in the Scholar policy, set the risk floors (`clinical_educational` and `high_risk_clinical` to heavy) and the three activities' tier and floor (heavy), then publish.
  - Do not re-run the staging seed for this: it would also publish `case_author`, which is still a proposal.
- **Production:** the same values, under the metering-activation GO (pilot package §4b).

### Cost effect (from the stored runs, no new calls)

| | Opus ÷ Sonnet, same items |
|---|---|
| D5-v1, tutoring (teach, ask) | **2.12×** (US$0.2526 vs 0.1191) |
| D5-v2, `questions` | 1.43× |
| D5-v2, `case_steps` | 1.28× (Sonnet needed retries, Opus did not) |
| D5-v2, `evaluate` | 2.13× |
| D5-v2, all three | 1.41× |
| List price per token | 1.67× (US$5/25 vs 3/15 per million) |

**Allowance effect:** the same 4,000 CAU monthly allowance (owner D3) buys about half as many clinical tutoring calls on Opus as it would on Sonnet. Standard-educational requests are unaffected. Sonnet was never usable for clinical work, so no request becomes cheaper or dearer than something that actually ran before.
