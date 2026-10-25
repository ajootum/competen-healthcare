# Scholar model routing published on STAGING: questions and case steps may use the next eligible model (25 October 2026)

**Owner, relayed by the coordinator:**
- "I think allow the questions to go to the next model".
- Then: "stick with the old rule.. keep this configureable not code".

Sonnet stays **not approved** for clinical activities.

**What changed:** configuration only, on staging only. This was one CONFIG-002 publish of `ai.model_routing` (scope `platform/ai_fair_use`), through the HQ page's own server functions, `saveModelRoutingDraft` and `publishPolicies`. It was run by `scripts/staging-publish-model-routing.ts`, which refuses any target the production guard does not judge non-production.
- No code was changed.
- No production write was made.

## Published

| | |
|---|---|
| Target | staging `ezhvpgtcqcdsgylrxgdb` |
| **Published version** | **`6776306d-f021-478b-b7f8-7dc805eb539a`** (AI scope, 5 modules) |
| Rollback point | `6541b481-f6d1-448b-af22-86425a53853c` (2026-10-24 18:33 UTC), via `rollbackVersion` on the HQ page |
| Pending drafts before the publish | none. The publish took the routing document only. |
| Routing before | none published: legacy, the deployment primary with its per-tier models |

**The document** restates today's routing for every activity: Anthropic is the primary, enabled with the same per-tier models as today, and alone in every tier. Two activity lists are added:

```json
{"providers":{"anthropic":{"enabled":true,"models":{"cheap":"claude-haiku-4-5-20251001","reasoning":"claude-sonnet-4-6","heavy":"claude-opus-4-8"}},
              "openai":{"enabled":false,"models":{}},"gemini":{"enabled":false,"models":{}}},
 "tiers":{"cheap":["anthropic"],"reasoning":["anthropic"],"heavy":["anthropic"]},
 "activities":{"scholar.questions":[{"provider":"anthropic","model":"claude-sonnet-4-6"},{"provider":"anthropic","model":"claude-opus-4-8"}],
               "scholar.case_steps":[{"provider":"anthropic","model":"claude-sonnet-4-6"},{"provider":"anthropic","model":"claude-opus-4-8"}]}}
```

**Why only two activity lists:**
- **Only clinical activities get a list.** In the published staging Scholar policy:
  - `questions` is `clinical_educational`;
  - `case_steps` is `high_risk_clinical`;
  - `teach` and `ask` are `standard_educational`.
- **`teach` and `ask` are unchanged.** A standard activity has no eligibility gate, so they already run on Sonnet today. A list for them would only pin their tier, so they are left exactly as they are.
- **`evaluate` and case-reasoning feedback are left alone,** with "self" as the default.

**Models "as today":**
- The per-tier models are config.ts's defaults; no `AI_MODEL_*` override is set where the script ran.
- Staging's recorded calls (`ai_assistant_query` audit rows, 23–25 October) all ran on `claude-sonnet-4-6`, which matches the reasoning tier.
- No cheap- or heavy-tier call is recorded on staging, so those two rest on the defaults.

## Eligibility in force on staging (unchanged by this)

| Activity | Opus 4.8 row | Up to | Sonnet 4.6 |
|---|---|---|---|
| questions | `96ac06bd` | clinical_educational | not eligible |
| case_steps | `da99c423` | high_risk_clinical | not eligible |
| teach | `b559d75d` | clinical_educational | not eligible (not needed: standard floor) |
| ask | `1935ddf6` | clinical_educational | not eligible (not needed: standard floor) |

## Proof (once, on staging, through the production runner)

- **Gate decisions** (`unmeteredGate`, the path staging and the production activation use with metering off):

  | Activity | Decision |
  |---|---|
  | `questions` | `anthropic/claude-opus-4-8` |
  | `case_steps` | `anthropic/claude-opus-4-8` |
  | `teach` | `anthropic/claude-sonnet-4-6` (unchanged) |
  | `ask` | `anthropic/claude-sonnet-4-6` (unchanged) |
  | **`evaluate`** | **REFUSED `not_eligible`** (the non-eligible activity is still refused) |

- **One Revision question generation:**
  - It ran through `runRevisionQuestions` and the production runner, `runMeteredAi`, for activity `questions`.
  - It returned **ok**, with 1 item kept, provider `anthropic` and model **`claude-opus-4-8`** in the provenance.
  - It ran as IND-004's synthetic fixture member (`…@example.test`). With metering off nothing was written to that member's records.

## Cost effect

From the stored D5-v2 runs (`opus-tutoring-eligibility.md`):

| Activity | Opus ÷ Sonnet |
|---|---|
| `questions` | about **1.43×** |
| `case_steps` | **1.28×** (Sonnet needed retries, Opus did not) |
| List price per token | 1.67× |

- **Against today on staging:** both activities were **refused** (Sonnet not eligible). No request becomes dearer than something that actually ran before. What was refused now runs, at Opus cost.
- **`teach` and `ask`:** unchanged on staging, Sonnet with no change. The 2.1× tutoring figure applies only where a tutoring request is clinical, on the metered path, which routes by tier to heavy (Opus) without this document.

## Production equivalent (owner-run, for when Individual is activated; NOT done)

1. **Opus eligibility rows in production.** Record them on the HQ page `/super-admin/ai/fair-use` (Rates → eligibility), exactly as `opus-tutoring-eligibility.md` §2 lists:
   - `scholar/questions`, anthropic, `claude-opus-4-8`, up to `clinical_educational`, evidence D5-v2 run `6c2c8067…`;
   - `scholar/case_steps`, anthropic, `claude-opus-4-8`, up to `high_risk_clinical`, evidence D5-v2 run `6c2c8067…`;
   - `teach` and `ask` per §2, if tutoring eligibility is wanted in production.
2. **Routing.** On the same page, Model routing:
   - Anthropic enabled with **production's** per-tier models. Check production's `AI_MODEL_*` first; the defaults are haiku-4-5 / sonnet-4-6 / opus-4-8.
   - Anthropic alone in every tier.
   - Activity lists `scholar.questions` and `scholar.case_steps` = [the reasoning model, `claude-opus-4-8`].
   - Before publishing, check production's published Scholar policy. If it makes `teach` or `ask` clinical, add the same list for them.
   - Publish. Check that there are no other pending AI drafts, because publish takes them all.
3. **Verify** on the HQ page:
   - The published routing shows the two lists.
   - A non-eligible activity (`evaluate`) is still refused.
