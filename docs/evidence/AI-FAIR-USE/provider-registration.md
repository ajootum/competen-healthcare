# No-code AI provider registration: capability and limitations (25 October 2026)

**Authority:** owner, "COMPETEN HOLDINGS — NO-CODE AI PROVIDER EXTENSIBILITY". It is built on the multi-provider routing (`multi-provider-routing.md`, `holdings/ai-model-routing`) and the eligibility gate (#99).

**Not activated anywhere.** No provider is registered or activated in any environment. Activating one in production is subject to separate authorisation.

## Assessment: what the gateway already supported

- **Adapters:** three fixed adapters (`client.ts`: Anthropic SDK, OpenAI chat-completions at a fixed URL, Gemini at a fixed URL). There was no configurable endpoint, and no fourth provider.
- **The OpenAI adapter's request and response shape** (chat completions, `usage.prompt_tokens` and `completion_tokens`) is the de facto compatible protocol many providers serve. That makes it the one protocol that can be reused safely for no-code registration.
- **The provider-name CHECK.** Pricing, eligibility and evaluation evidence named only the three built-ins in a CHECK (410, 411, 419). A registered provider could not be priced, which fails closed on the metered path, nor evaluated, nor made eligible. This is why one narrow migration, 431, is needed.

## What is now implemented

| Requirement (owner) | How |
|---|---|
| 1. Reuse the gateway, registry, routing, evaluation, pricing, allowance and audit | **No new engine.** A registered provider is one more route through `generate()`, chosen by the same model routing, gated by the same `ai_model_eligibility`, priced by the same `ai_price`, metered by the same `ai_reserve` and settlement, evaluated by the same D5 runners, and every HQ act lands in `audit_log`. |
| 2. Registration through HQ, without code or SQL | It is the CONFIG-002 document `ai.provider_registry` (scope platform/ai_fair_use), on the existing `/super-admin/ai/fair-use` page ("Registered providers"), under `hq.platform.ai.manage`, published with the other AI policies. There is no separate studio. |
| 3. A generic OpenAI-compatible adapter | `compatibleAdapter`: the OpenAI request and response, at the provider's approved endpoint (`{endpoint}/chat/completions`). It shares one response reader with OpenAI. |
| 4. Identity, endpoint, protocol, models, capabilities, limits, pricing, routing eligibility | **Registry fields:** id, name, endpoint, protocol, a model per tier, and the largest answer. **Other places:** pricing goes on the existing price rows (431), routing in tier and activity lists (`ai.model_routing`), eligibility in `ai_model_eligibility` (431). |
| 5. Credentials outside configuration | **The key is the environment variable `AI_PROVIDER_KEY_<ID>`.** Its name is **derived from the id**, never typed, so configuration cannot point at another secret such as the service key. **The value** is never stored, never returned (HQ sees only "present" or "not set", and the variable's name), and is redacted from every error and usage log. A key pasted into the registry is dropped by the resolver. |
| 6. Inactive and clinically unapproved by default | A new registration is `inactive`. A browser draft can never set status or checks: the server keeps them, and a change to the endpoint, protocol or models clears them. An inactive provider is never routed. Clinical requests also need an eligibility row (the #99 gate), which a new provider does not have. |
| 7. Connectivity, capability, privacy and security checks before activation | **Connectivity and capability are run by the server**, with a fixed synthetic prompt and never user content. Capability also requires token usage to be reported, because the fair-use engine cannot meter a provider that reports none. **Privacy** (data-processing terms, region, no training) and **security** (what the review covered) are recorded by the administrator. **Activation is a separate, audited act**: it is refused until all four are recorded, the key is present and the host is permitted, and it takes effect only when published. |
| 8. Activity-specific evaluation before clinical eligibility | The D5 runners include active registered providers through the same gateway (`ai-eval-candidates.ts`, `registeredCandidates`). A person records eligibility per activity, provider and model. Nothing is assumed from another provider. |
| 9. Existing fair-use accounting across all providers | **No change.** The ledger records the routed provider and model, the pricing row, the exchange rate and the CAU. One allowance account per person and product. |
| 10. No unapproved endpoints, no credential disclosure, no unauthorised transmission | **Endpoint rules:** https only, default port, no user-info, no query, a host name (not an IP), and not loopback, private, link-local, metadata or `.internal`-style names. **The host must be on the deployment's `AI_PROVIDER_ALLOWED_HOSTS`**, so HQ configuration alone can never send user content to a new host. **At call time**, after DNS resolution, every address must be public. **Redirects** are refused. **Only active, published, keyed and permitted** providers are routed. |
| 11. No regression for Anthropic, OpenAI and Gemini | The built-in adapters and keys are unchanged. The registry cannot take a built-in name. `ai-provider-harness` §1 to §6 are unchanged and green. |
| 12. An unsupported protocol says so | Registering any protocol other than OpenAI chat completions is refused with "needs an adapter written in the gateway (src/lib/ai/client.ts)". A stored entry with an unsupported protocol can never be active. |

## Genuine remaining limitations

- **One protocol.** The Anthropic Messages protocol, Gemini's `generateContent`, AWS Bedrock (SigV4 signing), Azure OpenAI (`api-key` header and deployment URLs) and others each need a small adapter in code. They are reported, not faked.
- **DNS time-of-check to time-of-use.** The address is resolved and checked immediately before the call, but `fetch` resolves again. Rebinding inside that window is mitigated, not eliminated, by the deployment host allowlist. A pinned-address dispatcher would close it, and would mean a custom HTTP agent.
- **No streaming, tools, vision or embeddings** for registered providers: text generation only. These would be capability flags plus code.
- **No runtime failover** (owner: deferred until reservation and settlement per attempt are designed).
- **Privacy and security are attestations.** Competen cannot verify a provider's terms. The record says who attested what, and when.
- **Migration 431 is not applied anywhere** (below). Until it is, a registered provider cannot be priced (metered requests refuse, failing closed), evaluated or made eligible. Standard-educational requests can route to it only with metering OFF, and only once it is active.

## Migration 431 (drafted, locally proven, for staging ×2 by the main session)

**What it changes:** it widens one clause in four CHECKs (`ai_price`, `ai_model_eligibility`, `ai_model_evaluation_result`, `ai_model_evaluation_proposal`), from the fixed three names to the provider-id shape `^[a-z][a-z0-9]{1,30}$`. Every other clause is restated byte for byte. Each table is one atomic `alter table` statement (drop and add), so a refusal or a statement-splitting runner never leaves a table without its constraint.

| | |
|---|---|
| File | `431-ai-registered-provider-names.sql`, sha256 `146b808e1b8a1a7cdae9b89692a12361ec3bb9fd2540758ec95b15070edd596c` |
| Rollback | `ROLLBACK-431.sql`, sha256 `90e7aa0d9ff9bcb29995e70fced53a736c371fe84f67dbdc1a953dc182cecc51` |
| House rules | ALL CLEAR (both files) |
| Local proof (Postgres 17, stubs plus 410, 411, 412, 419) | Before 431, a registered price is refused (T0). PRE `31251439…`. F1 and F2 both `2d5eff49…` (idempotent). After 431: a registered provider is priced and decided (T1), built-in rows are untouched (T2), malformed names are still refused (T3), and eligibility still needs evidence (T4). Rollback with no registered rows gives RB = PRE exactly. Rollback with registered rows present refuses for those tables, and all 4 constraints remain. |
| ⚠ Rollback after use | `ai_price` and `ai_model_eligibility` rows are history and cannot be deleted (the 411 guard). Once a registered provider is priced or decided, the rollback cannot run, so fix forward. |
| Where | The two files are in the shared notes folder, outside the repository. They are committed with their staging record once applied ×2, as the migration lifecycle requires. |
| Production | Not authorised. It needs its own GO. |

## Checks

- **Unit tests:**
  - `provider-registry.test.ts` (12): endpoint rules, IP ranges, call-time rebinding, derived credentials, inactive by default.
  - `registered-provider.test.ts` (9): approved endpoint, no redirects, no key without the variable, the key never in a result or log, built-ins unchanged; inactive never routed, clinical refused without eligibility, routed when eligible.
  - `provider-admin.test.ts` (5): a browser cannot set status or checks, unsupported protocols are reported, activation needs every check, a failed check is recorded without the key, and the HQ view never contains the key.
- **Plants:** five behaviour plants each go red: no call-time DNS check, redirects followed, a draft sets status, inactive routed, no redaction.
- **`ai-provider-harness`:** 41/41, with §7 adding 5 checks and 4 plants, each red.
- **Also green:** `ai-fair-use` 61/61, `src/lib/ai` vitest 111/111, tsc and eslint clean.
