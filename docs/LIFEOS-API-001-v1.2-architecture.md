# LIFEOS-API-001 — LifeOS V1.2 API and data contract design

**Status:** Design for delivery steps 1 to 4. Written 2026-11-05.
**Placement:** [ADR-018](adr/ADR-018-lifeos-sealed-product.md).
**Build state:** [LIFEOS-API-001 build record](LIFEOS-API-001-BUILD-RECORD.md).

## 1. What was inspected

### 1.1 The prototype

`C:\Users\elish\Downloads\Competen_LifeOS_V1_1_Prototype.html` is the owner's approved functional and HFE baseline (owner GO, 5 Nov 2026), not production code. It is one HTML file, it keeps everything in browser `localStorage` under `lifeos11`, and it makes no network calls. Its "Chief of Staff" is a set of fixed rules.

The rules below come from the prototype and are kept as engine rules.

| Prototype behaviour | Engine rule |
|---|---|
| Quadrants are "calculated, not assigned" | `quadrant` is a generated column. No writer can set it. |
| "Capture is not automatically a commitment" | `inbox` is its own status. World, importance and urgency may be absent only there. |
| "Every commitment belongs to one role/world" | A check refuses `planned`, `in_progress` and `delegated` without a world. |
| "Delegation retains ownership and follow-through" | A delegation never changes `owner_individual_id`. A follow-up date is required. |
| Replan is a "Proposal, not yet applied" | Suggestions are separate rows. Generating one changes nothing else. |
| A replan never moves a protected block | The replan rule excludes commitments with an active protected block. |
| Role-scoped privacy notice | Records default to `private`. See section 5. |

The prototype's 8 seeded roles and 11 sample commitments are the owner's sample data. They are not seeded into the product.

### 1.2 What is reused from Holdings

| Need | Reused | How |
|---|---|---|
| Sign-in | Supabase Auth session cookies, `createClient` | Through the adapter only |
| Service-role access | `createAdminClientOrNull` (no client means off) | Through the adapter only |
| Trace ids | `currentTraceId`, stamped by `src/proxy.ts` | Through the adapter only |
| Release gate posture | `individualAppEnabled`: absent or failed read is off, never throws | Same semantics, own table |
| Guard order | `resolveIndividualShell`: gate before authentication | Same order |
| DB-clock rule | `individual_live_entitlement` view | `lifeos_live_grant` view |
| Atomic rate limit on the DB clock | Migration 383 | `lifeos_rate_take` |
| Append-only trail with cascade allowance | `pg_trigger_depth() > 1` | Same pattern |
| Route boundary check | `scripts/auth-boundary-harness.ts` | `requireLifeosPrincipal` registered |
| Migration rules | `scripts/migration-house-rules.ts` | Unchanged |
| Validation | `zod` (already a dependency) | Also generates OpenAPI |

**Not reused, deliberately:** `getCaller` (estate plane), `requireIndividualContext` (gate 3, requires an Individual membership), `tenants` and `organisations` (Competen tenancy), `audit_log` (a Competen table that would break the carve-out), `emitEvent` (Mission Control's operational envelope, not an integration contract).

**Individual compatibility.** Competen Individual and LifeOS share Supabase Auth, so one person is already one auth subject. Step 6 adds an adapter that reads `individual_live_entitlement` and writes a `lifeos_entitlement` row with source `competen_individual`. Scholar's calendar and My Plan are not LifeOS and are not read.

## 2. Architecture

```
HTTP  /api/lifeos/v1/[...path]  ->  one route file, one door
         |
      api/router.ts       gate -> auth -> rate limit -> validate -> service -> envelope
         |
      core/service.ts     authorisation, state machines, business rules
         |
      core/store.ts       a port, with one method that writes
         |
      adapters/supabase-store.ts   -> lifeos_mutate()  (one transaction)
      adapters/competen/guard.ts   session, trace, admin client (the only link to Competen)
```

**One door.** A single catch-all route serves every endpoint from one route table. A new endpoint cannot miss the gate, authentication, rate limit or error envelope, because those live in the dispatcher. It also makes the carve-out one folder.

**No microservices.** It is one module in one deployment, one database and one route table.

**One writer.** Every write goes through `lifeos_mutate`, a single SQL function that runs a batch of inserts and updates in one transaction, together with the idempotency record. Row triggers stamp versions and timestamps, write the audit event and log quadrant changes. A second writer who has never heard of these rules still gets the audit trail.

## 3. Data contracts (schema version 1)

Every record carries the following, unless the table says otherwise.

| Field | Meaning |
|---|---|
| `id` | Stable UUID. Never reused. |
| `schemaVersion` | Contract version of the record. |
| `workspaceId` | Owning workspace. Immutable. |
| `ownerIndividualId` | The accountable person. Immutable. |
| `accessScope` | `private` (default: owner and explicit grants) or `workspace` (all members). |
| `status` | Lifecycle state. Changed only by a transition. |
| `provenanceSource` | `user`, `ai_suggestion`, `integration`, `import` or `system`. Required with no default. |
| `provenanceRef` | Optional pointer, such as the suggestion id. |
| `version` | Optimistic-concurrency counter, set by the database. |
| `createdAt`, `updatedAt`, `archivedAt` | Set by the database clock. |
| `createdBy`, `updatedBy` | LifeOS individual ids. |

| Entity | Table | Key fields | Status values |
|---|---|---|---|
| Individual | `lifeos_individual`, `lifeos_identity_link` | displayName, timezone, locale, accessSource. Link: issuer, subject | active, suspended, closed |
| Entitlement | `lifeos_entitlement`, view `lifeos_live_entitlement` | individualId, source (direct, competen_individual, organisation, platform_grant), tenantId, planCode, startsAt, endsAt, revokedAt | active, revoked |
| Organisation / Tenant | `lifeos_tenant` | slug, name, kind (organisation, partner_platform), branding | pending, active, suspended, closed |
| Workspace | `lifeos_workspace` | kind (personal, organisation), tenantId, name | active, suspended, closed |
| Membership | `lifeos_membership` | individualId, role (owner, admin, member) | invited, active, suspended, left |
| World / Role | `lifeos_world` | title, context, purpose, position | active, paused, retired |
| Goal | `lifeos_goal` | worldId, title, description, targetOn | active, paused, achieved, dropped |
| Project | `lifeos_project` | worldId, goalId, title, description, dueOn | active, on_hold, completed, dropped |
| Commitment | `lifeos_commitment` | worldId, goalId, projectId, title, notes, important, urgent, quadrant (generated), dueOn, scheduledOn, scheduledTime, estimatedMinutes, completedAt | inbox, planned, in_progress, delegated, done, dropped |
| Delegation | `lifeos_delegation` | commitmentId, delegateeIndividualId or delegateeLabel, followUpOn, expectations, closedAt | active, completed, cancelled |
| Calendar Event | `lifeos_calendar_event` | worldId, commitmentId, title, startsAt, endsAt, timeZone, connectionId, externalRef | scheduled, completed, cancelled |
| Protected Time Block | `lifeos_protected_block` | worldId, commitmentId, label, startsAt, endsAt, timeZone | active, released |
| Weekly Plan | `lifeos_weekly_plan` | weekStart (a Monday), intention | draft, active, closed |
| Big Rock | `lifeos_big_rock` | weeklyPlanId, commitmentId, position | selected, removed |
| Quadrant Classification | `lifeos_quadrant_classification` | commitmentId, important, urgent, quadrant. Append-only, written by trigger | recorded |
| Weekly Review | `lifeos_weekly_review` | weekStart, weeklyPlanId, reflection, nextWeekFocus, snapshot, finalisedAt | draft, final |
| Integration Connection | `lifeos_integration_connection` | provider, grantedScopes, externalAccountRef, credentialRef, lastSyncedAt | pending, active, suspended, revoked |
| Permission Grant | `lifeos_permission_grant` | granteeIndividualId, resourceType, resourceId, capability (read, write), expiresAt, revokedAt | active, revoked |
| Audit Event | `lifeos_audit_event` | seq, eventType, eventVersion, entityType, entityId, changedFields, fromStatus, toStatus, actorKind, traceId, occurredAt. Append-only | recorded |

**Supporting tables, not public contracts:** `lifeos_flag`, `lifeos_idempotency`, `lifeos_rate_window`. `lifeos_suggestion` is covered in section 8.

### 3.1 Rules the schema itself enforces

- **Composite foreign keys hold every reference inside one workspace.** `(workspace_id, world_id)` references `lifeos_world (workspace_id, id)`, and so on. A commitment in one organisation cannot point at a world, goal, project or delegation in another. This is the main control against data crossing organisations.
- **The owner of a record must be a member of its workspace** (composite key to `lifeos_membership`). The same applies to a delegatee and a grantee.
- **A personal workspace has exactly one member, its owner** (trigger), so nothing personal can be shared across it by a membership row.
- **A workspace is either personal, with an owner and no tenant, or organisation, with a tenant.** A check enforces it.
- **One active delegation per commitment.** A generated column is true while active and null afterwards, with a full unique index. It is not a partial index (house rule).
- **Audit rows hold no content.** They hold field names, status values and ids, never titles, notes or reflections.

## 4. Commitment Engine

| Stage | Operation |
|---|---|
| Capture | Create a commitment in `inbox`. Only a title is required. |
| Prioritisation | Set important and urgent. The quadrant follows. Each change is logged by trigger. |
| Planning | Move to `planned` with a date. Add Big Rocks to a weekly plan. Protect time. |
| Execution | `in_progress`, then `done`. |
| Delegation | Create a delegation. The commitment moves to `delegated`. The owner does not change. |
| Follow-through | The follow-up date stays on the delegation. Closing it returns the commitment to its owner. |
| Review | A weekly review holds a reflection. Finalising it stores a snapshot of the week's counts. |

Commitment transitions:

| From | To |
|---|---|
| inbox | planned, in_progress, done, dropped |
| planned | in_progress, done, dropped, inbox |
| in_progress | planned, done, dropped |
| delegated | done, dropped (both close the delegation) |
| done | reopened to planned, in_progress or inbox |
| dropped | inbox |

`delegated` is reached only by creating a delegation, never by a transition. `planned`, `in_progress` and `delegated` require world, important and urgent to be set.

## 5. Access model

**Default private, explicit otherwise.** This is the model that lets one person use LifeOS across a family, a hospital and a board without any of them seeing the others.

| Who | Can read | Can write |
|---|---|---|
| Record owner | Yes | Yes |
| Workspace member, record scope `workspace` | Yes | Only with a grant |
| Holder of a live grant | Yes | If the grant says `write` |
| Workspace owner or admin | **Not private records.** Workspace-scope records, members and grants on their own records | Workspace-scope records |
| Anyone else | No. The answer is 404, so existence does not leak. | No |

- **An organisation admin cannot read a member's private commitments.** Oversight requires an explicit grant from the record's owner.
- **Grants are judged by the database clock**, through the `lifeos_live_grant` view.
- **A delegation to a LifeOS member creates a read grant on that one commitment**, in the same transaction, and closing the delegation revokes it. Delegatee access is therefore an ordinary grant, not a special case.
- **Leaving an organisation** ends access to that workspace. The personal workspace is a separate workspace and is untouched, which provides personal continuity.
- **A suspended or closed tenant or workspace** refuses access to its members. Personal workspaces do not depend on any tenant.

**Row-level security.** RLS is on for every `lifeos_*` table with zero policies, and `anon` and `authenticated` hold no privileges, so a browser cannot reach any table or the writer. The per-person rules above run in the service, behind the service role, and the schema's composite keys hold the workspace boundary. Per-person RLS policies are not used: nothing would exercise them through the service role, and they would open a second path to the tables.

Principals have a `kind` (`session` today, `delegated_token` at step 9) and `scopes`. A session holds all scopes. Each route declares the scope it needs, so user-delegated third-party access later narrows what a token can do without new authorisation code. **There is no master API key, in a browser or anywhere else.**

## 6. API

Base path `/api/lifeos/v1`. The major version is in the path. The OpenAPI document is generated from the route table and served at `/api/lifeos/v1/openapi.json`, behind the same gate.

| Method | Path | Purpose |
|---|---|---|
| GET | `/me` | The caller's individual record and workspaces |
| GET | `/workspaces` | Workspaces the caller is an active member of |
| GET | `/workspaces/{ws}` | One workspace |
| GET, POST | `/workspaces/{ws}/{resource}` | List with filters and cursor, or create |
| GET, PATCH | `/workspaces/{ws}/{resource}/{id}` | Read, or edit fields |
| POST | `/workspaces/{ws}/{resource}/{id}/transition` | Lifecycle change |
| POST | `/workspaces/{ws}/{resource}/{id}/archive`, `/restore` | Soft removal. Nothing is ever hard-deleted. |
| POST | `/workspaces/{ws}/suggestions/generate` | Run the rules. Writes only suggestion rows. |
| POST | `/workspaces/{ws}/suggestions/{id}/accept`, `/dismiss` | The user's decision |
| GET | `/workspaces/{ws}/audit-events` | The caller's own audit trail |
| GET | `/workspaces/{ws}/members` | Members, for workspace owners and admins |

`{resource}` is one of `worlds`, `goals`, `projects`, `commitments`, `delegations`, `calendar-events`, `protected-blocks`, `weekly-plans`, `big-rocks`, `weekly-reviews`, `permission-grants`. `quadrant-classifications`, `integration-connections` and `suggestions` are read-only at this stage.

**Conventions**

- **Success:** `{ "data": ..., "meta": { "traceId", "nextCursor"?, "replayed"? } }`.
- **Errors:** `{ "error": { "code", "message", "details"?, "traceId" } }`. Codes: `unauthenticated` 401, `forbidden` 403, `not_found` 404, `version_conflict` 409, `idempotency_key_reused` 409, `conflict` 409, `validation_failed` 422, `invalid_transition` 422, `rate_limited` 429, `unavailable` 503.
- **Idempotency:** the `Idempotency-Key` header is required on every write. A retry with the same key and body returns the first result with `replayed: true`. The same key with a different body is 409. The key and the write commit in one transaction, so a crash cannot leave one without the other, and two concurrent retries serialise on the unique index.
- **Concurrency:** PATCH and transition take `expectedVersion`. A stale value is 409.
- **Pagination:** opaque cursor, `limit` from 1 to 200, default 50, ordered by creation time and id.
- **Filtering:** `status`, `worldId`, `goalId`, `projectId`, `commitmentId`, `weekStart` and `quadrant` where the resource has them. Archived records are excluded unless `includeArchived=true`.
- **Rate limits:** per person, on the database clock. 600 reads, 120 writes and 10 suggestion runs per minute. Exceeding one returns 429 with `Retry-After`.
- **CSRF:** writes require `Content-Type: application/json`. Supabase cookies are `SameSite=Lax`.

## 7. Events and integrations

**Events.** `lifeos_audit_event` is an append-only log with a monotonic `seq`. Event names are versioned (`commitment.updated`, `eventVersion: 1`). A future consumer holds a cursor on `seq` and needs no mutable delivery state. Because rows carry no content, a consumer must then read the record through the API under its own authority, so an event cannot leak what its reader may not see.

**Adapters.** `core/integration.ts` defines the adapter interface. No provider is implemented at this stage. `lifeos_integration_connection.credential_ref` is a pointer to a secret store and never holds a token.

**Public API boundary.** Each route has a `visibility` of `internal` or `public`. Only the routes on the `PUBLIC_ROUTES` list are public, and the seal check holds that list. A delegated token reaches nothing else, whatever scopes it holds. The public OpenAPI document includes only those routes.

**Tenants and branding.** `lifeos_tenant.branding` is configuration, validated by a schema. Custom domains are step 7 and need no change to any record in this design. They add one table, `lifeos_tenant_domain`, and host resolution. No tenant ever gets a copy of the code or a separate table.

## 8. AI Chief of Staff

**Boundary.** The Chief of Staff reads through the same service and writes only `lifeos_suggestion` rows. A suggestion stores what it proposes in `proposedChange` and has its own lifecycle (`proposed`, `accepted`, `dismissed`, `expired`).

- **Suggestion or executed change is visible in the data.** Nothing changes until `accept`, which applies the change through the normal service in one transaction and marks the resulting record's provenance `ai_suggestion`, with the suggestion id as its `provenanceRef`.
- **Materiality.** Scheduling, delegation and external-communication changes are `material`. They are only ever applied by an explicit accept from the person.
- **One workspace at a time.** Generation is called per workspace and reads only what the caller can read in that workspace. Nothing from one workspace can reach a suggestion in another.

**At this stage the generator is rules only**, generator `rules-v1`, matching the prototype. **No AI model is called.** Connecting a model later means a second generator behind the same boundary, through `runMeteredAi` via the adapter, with its own owner decision on data sent to a model provider.

| Rule | Materiality | Proposed change |
|---|---|---|
| Scheduled Q2 commitment with no protected block | material | Create a protected block at its scheduled time |
| Commitments awaiting clarification | informational | None |
| Delegation follow-up due | informational | None. Sending anything to the delegatee would need authorisation. |
| Active weekly plan with no Big Rock, and Q1 or Q2 commitments this week | material | Add a Big Rock |
| Interruption (on request) | material | Move one of today's flexible commitments to tomorrow. Never a protected one. |

## 9. Gate and rollout

`lifeos_flag` row `lifeos_core`. Absent, disabled, unreadable, or migration not applied: every path answers 404 before authentication, so LifeOS cannot be told apart from an absent route. Turning it on is an owner act. New people need an explicit provisioning step and a live entitlement. There is no self-registration.

## 10. Delivery steps

| Step | State |
|---|---|
| 1 Inspect | Done (section 1) |
| 2 Reuse | Done (section 1.2) |
| 3 Design | This document |
| 4 Commitment Engine and API | This PR, gate off |
| 5 Connect the interface | Done on its own branch: nine screens at `/lifeos`, reading and writing only through the API, gate off. See the build record. |
| 6 Individual access | Done on its own branch: a person's own opt-in, behind two flags and published terms. See the build record. |
| 7 Custom domains | Done on its own branch: verified domains, branding and own sign-in, inert until `LIFEOS_TENANT_HOSTS=1`. See the build record. |
| 8 External pilot | Ready on its own branch: invitations, member picker, Organisation screen, runbook. Choosing a real organisation is the owner's. |
| 9 Public API | Done on its own branch: OAuth 2.1 with PKCE, an approved route list, off by default. See the build record. |
| 10 Commercial distribution | Assessment written ([LIFEOS-COMMERCIAL-READINESS-001](LIFEOS-COMMERCIAL-READINESS-001.md)), export built. **The decisions in it are the owner's.** |

## 10a. V1.1 preview

`lifeos/preview-v1.1/` hosts the prototype itself for review, in its own Vercel project, with a shared reviewer password and no database or API. It is separate from the engine in this document until step 5 connects them.

## 11. Risks to decide later

- **Possible third-party trademarks.** The prototype's language ("Habit 2 → Habit 3", "Put first things first", "Big Rocks", "Quadrant 2") draws on a published, commercially protected method. Contracts keep only the product terms the owner's instruction names (`Big Rock`, `Q2`). The "Habit" wording is not carried over. A legal check belongs before step 10.
- **Clinical content in free text.** The prototype's own samples include hospital work. LifeOS is not a clinical record, and titles are free text, so someone could type patient details. Terms of use and an input notice belong in step 5.
- **Suggestion expiry and key purge.** `lifeos_idempotency` holds no content but grows until a purge job exists, and suggestions do not yet expire automatically. Both are minor and belong in step 5.
- **Migration numbering.** `scripts/apply-migrations.ts` sorts file names as text, so any four-digit number would run out of order on a fresh rebuild. This design uses 901, which is free. The main sequence has reached 999, so the next session to add a migration needs that tooling fixed.
