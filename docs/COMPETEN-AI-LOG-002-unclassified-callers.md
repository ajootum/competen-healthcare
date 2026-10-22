# COMPETEN-AI-LOG-002 — Unclassified AI usage callers (follow-up record)

| | |
|---|---|
| **Status** | **Follow-up recorded. Not authorised for implementation.** Needs a separate owner GO. |
| **Origin** | Residual from COMPETEN-AI-LOG-001 (closed: PRs #2 and #3, migration 371 on production). AI-LOG-001 is not reopened by this record. |

## The gap

AI-LOG-001 gave `generate()` a typed `attribution` (`tenant` | `workspace` | `person`) and added `plat_ai_requests.workspace_id` and `attribution_scope` (migration 371). Four callers on `main` @ `fb5ce41b` still pass no attribution. Their usage rows **are saved** and counted for quota and cost, but land with `attribution_scope` null and no tenant or workspace.

| Caller | Call site | Current `context` |
|---|---|---|
| AI assistant API | `src/app/api/ai/assistant/route.ts:133` | none |
| Configuration copilot (super-admin) | `src/app/api/config/copilot/route.ts:53` | `userId`, `operation: "config_copilot"` |
| Priority orchestrator | `src/app/api/priorities/copilot/route.ts:60` | `userId`, `operation: "priority_orchestration"` |
| Quality intelligence brief | `src/lib/operations/ai-quality-intelligence.ts:94` | `operation: "quality_intelligence"` |

## Effect

- Usage from these four cannot be reported per tenant, workspace or person.
- The AI assistant row has no `actor_id` either.
- Nothing is lost or refused; this is a reporting and accountability gap, not a data-loss defect.

## For a future GO (not decided here)

For each caller, decide the correct scope from its product and audience:
- The super-admin configuration copilot is landlord-plane, so it may legitimately have no tenant.
- The others probably have a tenant or a person scope.

Apply it through the existing `attribution` contract (defined in `src/lib/ai/gateway.ts`, passed via `generate()` in `src/lib/ai/client.ts`). Extend the AI-LOG-001 call-site scan test (`src/lib/ai/attribution.test.ts`) so that a caller without attribution fails CI. This needs no schema change: 371 already provides the columns.
