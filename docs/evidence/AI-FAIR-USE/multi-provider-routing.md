# Multi-provider AI: what existed, and the gaps closed (25 October 2026)

**Authority:** owner, "COMPETEN — MULTI-PROVIDER AI DIRECTION", which "supersedes any Anthropic-only interpretation of previous instructions".
- Anthropic, OpenAI and Google Gemini are first-class providers of one Holdings AI Gateway.
- Provider management is no-code.
- Credentials stay outside configuration.
- One fair-use engine serves every provider.
- A clinically sensitive activity is never silently downgraded, and never falls back to a model that is not eligible.

## Gap list, against what already existed

| Requirement | Before | Now |
|---|---|---|
| One gateway, three adapters, no product-specific engines | **Present**: `client.ts` adapters; `allowance.ts` and `personal-assistant.ts` shared | unchanged |
| Credentials outside config and DB | **Present**: `config.ts` `KEY_ENV`, `providerKey()` | unchanged. The routing document cannot hold a key (`resolveModelRouting` keeps only known fields). |
| Available providers and models | **Partial**: one provider per deployment (`AI_PRIMARY_PROVIDER`), models per tier from env | **Closed**: providers enabled, and each provider's model per tier, in `ai.model_routing` on `/super-admin/ai/fair-use` |
| Primary and alternative models by activity | **Missing** | **Closed**: an ordered provider list per tier, and per-activity candidate lists |
| Provider availability | **Partial** (env only) | **Closed**: enable or disable per provider. Availability still also needs a key in the deployment. |
| Model eligibility and minimum clinical-risk tier | **Present** (411/412, HQ page) | Selection now honours it: only an eligible candidate is ever chosen above standard educational. With `holdings/eligibility-unmetered`, this holds whether or not metering is on. |
| Usage and expenditure limits | **Present** (fair-use policy, budgets 421) | unchanged |
| Provider-specific pricing | **Present** (`ai_price` per provider and model) | unchanged. The metered reservation prices the routed provider's model. |
| Routing and fallback policies | **Missing** (`FALLBACK_ENABLED = false`) | **Closed for selection**: a disabled or keyless provider is skipped for the next configured, eligible candidate. Runtime failover on an outage stays OFF (see below). |
| Accounting across providers | **Present**: `ai_usage_ledger` has provider, model, tokens, `price_id`, `fx_rate_id`, `cau_basis_id`, settled CAU, all against one allowance account per person and product | unchanged. Switching provider creates no second allowance and rewrites no history. |
| The D5 framework for all providers | **Partial**: the runners called the Anthropic SDK directly | **Closed**: both runners call the gateway with a pinned route (`scripts/ai-eval-candidates.ts`). A provider without a key is reported "not evaluated", never replaced. |

## How it works

**The routing document.** `ai.model_routing`, in CONFIG-002 scope platform / ai_fair_use, drafted on the HQ page under `hq.platform.ai.manage` and published with the other AI policies. It holds:
- `providers`: enabled, and the model per tier;
- `tiers`: providers in order, primary first;
- `activities`: `product.activity` → its own ordered candidates.

**Unpublished, nothing changes.** Every request runs on `AI_PRIMARY_PROVIDER` and its models, exactly as before.

**Selection** (`model-routing.ts`):
- the candidates are the activity's own list, or else the tier's providers;
- providers that are disabled, or have no key, are dropped;
- above standard educational, only a candidate covered by an `ai_model_eligibility` row for that activity, provider, model and tier can be chosen;
- the first one that passes runs.

**The engine** (`allowance.ts`):
- **Metered path:** the reservation (`ai_reserve`) and `generate()` both use the same chosen route. `ai_reserve` still checks eligibility for the request's classified risk.
- **Unmetered path:** `unmeteredGate` chooses the route the same way.
- **Standing:** `getAiStanding` offers a clinical activity only when an eligible candidate exists.

**`generate()`** (`client.ts`) runs the routed provider's adapter with the routed model and that provider's key from the environment. With no route, it behaves as before.

## Not done, by design or as follow-up

- **Runtime failover** (retrying on another provider after an outage) stays OFF.
  - On the metered path it needs one reservation per attempt.
  - A refusal is never failed over (`ai-provider-harness` §4).
- **`src/app/api/copilot/route.ts`** (Enterprise) still calls the Anthropic SDK directly, outside the gateway. `ai-provider-harness` 6h names it and refuses any new direct use.
- **OpenAI and Gemini are unexercised.** No keys are held, so no real call has been made to either. They are not pilot blockers.
- **Evaluating them** uses the same D5 sets through the gateway once the owner supplies keys. Eligibility is then recorded per model by a person.

## Checks

- `model-routing.test.ts` (8), `routed-engine.test.ts` (5) and `client-route.test.ts` (3).
- `ai-provider-harness` §6 (8 checks, 3 plants, each red).
- `ai-fair-use-harness` 58/58 (A6 and A18 follow the routed branch).
- vitest 1087/1087; tsc and eslint clean.
