# SCHOLAR-INDEPENDENT-LEARNING-01 P3 — AI cost: measured before, changed, measured after (staging, 3 Nov 2026)

Staging project ezhvpgtcqcdsgylrxgdb, read-only through `plat_ai_requests` and `audit_log`; the fixture learner; this branch's own dev server (port 3173). Costs are the gateway's estimates from list pricing (`cost_usd`), USD.

## 1. Where Scholar's AI spend went (staging, 14 days to 3 Nov, 2 actors)

| Operation | Calls | Actions | Model | Cost | Avg in / out tokens |
|---|---|---|---|---|---|
| revision scenario (evolving scenario format) | 107 | 69 | claude-opus-4-8 | 3.199 | 634 / 1069 |
| learn (Teach me, Go deeper, Guide, Challenge, clarify) | 61 | 61 | sonnet 39 · opus 22 | 1.080 | 1855 / 524 |
| revision flashcard | 13 | 13 | claude-opus-4-8 | 0.259 | 677 / 660 |
| case blueprint | 4 | 4 | opus | 0.164 | 523 / 1539 |
| OSCE station | 4 | 4 | opus | 0.122 | 1126 / 994 |
| mcq (Learn practise / quick check) | 9 | 4 | opus | 0.119 | 478 / 531 |
| revision mrq / short / match / sequence / true-false, their blind verifies | 26 | — | opus | 0.357 | — |
| map (classification) | 7 | 7 | sonnet | 0.051 | 877 / 305 |
| exam transcribe, explain (material page), case, case verify | 11 | — | — | 0.080 | — |

Total Scholar: about USD 5.4 in 14 days; **scenarios were 59 % of it**, and every `questions`-activity call (scenario, flashcard, mcq, mrq, short, OSCE station) ran on Opus because the eligibility rows make Opus the only model eligible for `questions` at clinical educational, while the routing lists Sonnet first for it.

**How often a saved output could have answered:** Learn served 59 opens in 14 days, **54 of them cached** (no AI); revision sessions reused 32 saved questions and generated 61 across 29 sessions (59 AI calls). OSCE stations had no reuse at all: every "write a station from my notes" was a new Opus call, even for the same section.

## 2. What changed (this branch)

1. `flashcards` is its own AI activity (code: `SCHOLAR_AI_ACTIVITIES`, the revision session route and the Flashcards page); where the published policy does not define it, `questions` is used exactly as before (`activityOrFallback`).
2. The tier a Scholar call asks for is the published fair-use policy's tier for its activity (`scholarAiRunner` → `policyTierFor`), not a constant in code. The engine's per-risk-tier floor and eligibility gate are unchanged, so a clinical subject is still floored (staging: clinical educational → reasoning) and never reaches a model that is not eligible.
3. An AI OSCE station already written from the same material and section at the same prompt version is offered again (`findOwnAiStation`) unless the learner asks for a new one (`fresh: true`).
4. Staging configuration for the measurement (`p3-staging-config.sql`): fair-use activity `flashcards` (tier cheap, floor standard educational, 1800 tokens), routing `scholar.flashcards` → haiku › sonnet › opus, eligibility rows for `flashcards` (haiku at standard educational; sonnet and opus at clinical educational; evidence_ref says staging only). **Production rows are the owner's decision** (PR body).

## 3. After (this branch, 19:40–19:43 UTC, bed-bath sections 11–13 of "Essential Nursing Care of the Critically Ill")

| Action | Calls | Model | Tier recorded | Cost | Before (30-day staging average on the same operation) |
|---|---|---|---|---|---|
| Flashcards session, 4 cards written (3 calls: 2 + 1 + 1 kept) | 3 | claude-sonnet-4-6 | reasoning (cheap, floored by the clinical subject) | 0.0257 total, **0.0086 a call** | 0.0199 a call on Opus (13 calls) → **−57 % a call** |
| OSCE station from the bed-bath section, first request | 1 | claude-opus-4-8 | reasoning | 0.0329 | 0.0221 a call on Opus (6 calls) |
| OSCE station, the same section again | 0 | — | — | **0** (reused, audit `outcome: reused, cached: true`) | 0.0221 (a new station each time) |
| Quick revision on the same sections (unchanged path) | 2 | claude-opus-4-8 | reasoning | 0.0498, **0 questions kept** (all six mcq drafts failed the checks: unsupported term ×5, ungrounded ×1), session answered "no questions for this yet" | unchanged |

Cumulative teaching A–D on Bed bath: **unchanged by construction** — no teaching prompt, context block, orchestration or routing override was touched; `teach`, `deeper`, `check`, `clarify` and `ask` keep their published activity routes (Sonnet › Opus) and the policy tiers equal the code's. The reference cost stays USD 0.236 for the final A–D run (`docs/evidence/SCHOLAR-CUMULATIVE-TEACHING-01/comparison.md`); re-running it would spend about the same again and prove nothing new.

## 4. Findings for the owner (not changed here)

- **Scenarios** are the cost centre (59 %). "Evolving scenario" is ticked by default in custom revision (`scholar_revision_formats`), and each shortfall writes one on Opus (~USD 0.03 a call, 1.5 calls an action). A policy choice, not code: take it out of the default formats, or keep it.
- **`questions` on Opus only.** The eligibility rows allow only Opus for `questions` at clinical educational, so mcq, mrq, short and the blind verifies all run on Opus, including the quick session above that spent USD 0.05 to keep nothing. Making Sonnet eligible for `questions` (as it already is for teach, explain, summary, examples, check, ask) would halve that; it needs a model-evaluation decision, not code.
- **Two click-less AI calls** remain: guided auto-teach of the first lesson of a new scope, and the first-open analysis of a material (both consent-gated, metered, cache-first). Recommendation: keep guided auto-teach (it is the learner's chosen mode and serves saved teaching first) and keep the first-open analysis (My Plan and topics depend on it, once per material); make the analysis a button only if the owner wants zero click-less spend.
