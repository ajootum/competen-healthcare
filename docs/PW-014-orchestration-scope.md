# PW-014 — Cross-Workspace Orchestration Layer: Implementation Scope

**Status:** scoping draft · **Owner:** platform · **Basis:** PW-014 v1.0 spec, audited against this repo
**Stack reality:** Next.js 16 (App Router, RSC) + Supabase (Postgres + RLS) monolith — **no Kafka, no service mesh, no separate microservices.** This scope adapts PW-014's enterprise architecture to that stack rather than transcribing it literally.

---

## 0. How to read this

PW-014 describes a two-layer platform: **Layer 1 (Personal Workspace)** as the mandatory universal landing + orchestration shell, and **Layer 2 (functional workspaces)** as focused execution apps. The Personal Workspace *experience* (PW-001…013) is built and real. This document scopes the **orchestration layer underneath it** — the plumbing that makes the spec's acceptance criteria (PW-AC-01…10) true platform-wide.

The headline finding from the code audit: **we are further along than the spec assumes**, because the WCE (Workspace Configuration Engine) already implements the composition-precedence runtime, the widget-manifest contract, the workspace registry, and override/versioning/governance. The genuinely greenfield work is **(a) the event/synchronisation layer** and **(b) a formal entitlement service + universal landing**. Everything else is largely *wiring existing engines to the personal dashboard.*

---

## 1. Current-state asset inventory (what we build ON, not from scratch)

| PW-014 requirement | Spec ref | Already exists in repo | Gap |
|---|---|---|---|
| Composition precedence (platform→tenant→hospital→unit→role→user) | §6.1, §13 | `src/lib/config/workspace-config.ts` `SCOPE_ORDER`, `resolveRuntime`/`composeRuntime` (`runtime.ts`, `composer.ts`) | Not wired to the personal dashboard |
| Widget manifest / SDK contract | §11, App. B | `src/lib/config/widget-catalog.ts` (WCE-005): `key, safety, dataSource, layout{w,h,minW,maxW}, filters, thresholds, displayModes, actions` | Manifests describe widgets but personal dashboard renders **hard-coded JSX**, not manifest-driven |
| Workspace Registry (routes, icons, versions) | §12 | `plat_workspaces` (053), `WORKSPACE_CATALOGUE` (`roles.ts`) | Two sources of truth to reconcile; no deep-link contract |
| Config runtime + draft/validate/simulate/publish | §11.1 | WCE: `workspace_config_overrides/versions/audit` (076), `registry.ts`, `simulate.ts`, `versioning.ts`, `governance.ts`, registry (092) | Governs workspace config generally; personal-dashboard templates not modelled |
| Entitlement / scope resolution | §10, §12 | `scopeHospitalIds()` (`api-auth.ts`), `orgRolesOf`/`workspacesFor`/`WORKSPACE_CATALOGUE` (`roles.ts`) | Logic exists but scattered; no single Entitlement Service; roles≠positions≠entitlements only partly separated |
| Universal action aggregation (no duplication) | §7 | `src/lib/task-centre.ts` `loadTaskCentre` — normalises op_tasks/learning/competency/quality **reading source live** | Ad-hoc normalisation per loader; no versioned `universal_action` schema; no direct-execute contract |
| Notification / Calendar / Activity aggregation | §7, §12 | `notification-centre.ts`, `calendar-centre.ts`, `activity-analytics.ts` | Same live-read pattern; fine, but no event freshness |
| AI orchestration + gateway | §16 | `plat_ai_requests` (055), `generate()`/`aiStatus()`, `/api/copilot` | No source-grounding/citations contract; brief is rule-based |
| Audit substrate | §19 | `audit_log` (040, ~40 write sites) | Coverage incomplete for PW-sensitive ops |
| Event bus / real-time sync | §8 | **Nothing** — no outbox, no domain_events, no Supabase Realtime channels | **Greenfield** |
| Break-glass / step-up auth / acting roles w/ expiry | §4, §9, §15 | Nothing | Greenfield |
| Contract / idempotency / cross-tenant tests | §20 | Nothing systematic | Greenfield |
| Universal landing (all roles → Personal Workspace) | §1, PW-AC-01 | `login/page.tsx` routes each role to a **different** portal | Greenfield (small change, big semantic) |

---

## 2. Target architecture (adapted to Supabase/Next)

PW-014 assumes an event bus, projection stores and a fleet of services. On a Supabase monolith the pragmatic, senior equivalents are:

1. **"Services" = lib modules + API routes + Postgres functions.** `Entitlement Service`, `Action Aggregation Service`, etc. become `src/lib/orchestration/*.ts` + `/api/me/*` route handlers. No new deployables.

2. **Event bus = Postgres transactional outbox + Supabase Realtime.** Domain writes append to a `domain_events` table (the outbox) in the same transaction; a lightweight dispatcher (DB trigger → `pg_notify`, or Supabase Realtime `postgres_changes` on `domain_events`) pushes invalidations to the client. **At-least-once + idempotent consumers** (§8.1) come free from an append-only log keyed by `(aggregate, version)`.

3. **Keep live-read as the correctness model; use events only for freshness + audit.** *This is the key cost-saving decision.* Our loaders already read source-of-truth tables directly, so **there is no stale projection to reconcile** — PW-AC-03 ("no action shown as open after source completion") is satisfied on every request today. We therefore **do not build CQRS projection stores** for actions/notifications. Events are used to (a) push "something changed, refetch" to open clients, and (b) feed the activity timeline + reconciliation checks. Full projections are reserved only for cross-tenant executive rollups where live fan-out is too expensive (out of scope here).

4. **Entitlement = one resolver, enforced server-side twice.** A single `resolveEntitlements(userId)` returns `{ workspaces[], scopes{}, positions[], actingRoles[] }`. *Visibility is not authorization* (§10): every `/api/me/*` read and every action execute **re-authorizes against the resolver** — the deep-link target does its own check too (defence in depth).

5. **Dashboard composition = WCE runtime, extended to a `personal_dashboard` object type.** Register personal widgets (already contracted in `widget-catalog.ts`) as WCE objects; add a `dashboard_template`/`widget_instance` object type; `resolveRuntime` already merges override layers by `SCOPE_ORDER`. The personal dashboard becomes a manifest resolved at request time instead of hard JSX.

---

## 3. Workstreams

Seven workstreams. Effort is rough (dev-weeks, one engineer) and complexity is S/M/L. "Reuse %" ≈ how much rides on existing code.

### WS1 — Universal landing + Entitlement Service `M · reuse 60%`
*PW-014 §4, §9, §10; PW-AC-01, PW-AC-02, PW-AC-05.*
- Change `login/page.tsx` + add a server landing resolver so **all roles land on `/dashboard`**; functional portals are reached via the launcher/RoleSwitcher (which already exist). Guard against regressions for admin/assessor deep-flows.
- Consolidate `scopeHospitalIds` + `orgRolesOf` + `WORKSPACE_CATALOGUE` into `src/lib/orchestration/entitlements.ts` → `resolveEntitlements(userId)`; reconcile `WORKSPACE_CATALOGUE` (code) with `plat_workspaces` (table) into one **Workspace Registry** read model.
- Add **acting roles** (`context_assignment` with `valid_from/valid_to`) + a visible active-role/context banner (extend `RoleSwitcher`).
- **Exit:** PW-AC-01 ✅, PW-AC-02 ✅; multi-role users see active-role banner + per-action source labels (PW-AC-05 ✅, partly delivered already in task-centre).

### WS2 — Config-driven dashboard composition `L · reuse 70%`
*PW-014 §5, §6, §11, §13, App. B; PW-AC-06, PW-AC-07.*
- Register the personal widgets (already in `widget-catalog.ts`) into the WCE registry; add object types `dashboard_template` + `widget_instance` to the config object model (094/095).
- Build `src/lib/orchestration/dashboard-manifest.ts` that calls the existing `resolveRuntime` to produce a **resolved widget manifest** (which widgets, order, size, visibility) for `(user, tenant, role, context)`.
- Refactor `dashboard/page.tsx` to render from the manifest via a **widget registry** (`Record<widgetKey, ServerComponent>`), each widget wrapped in a **per-widget error boundary + Suspense** (PW-AC-07: a failing widget degrades to its empty/error state, siblings still render).
- Tenant admins compose via the existing WCE Designer (draft→simulate→publish→rollback already built).
- **Exit:** PW-AC-06 ✅ (compose without code deploy), PW-AC-07 ✅. Role-aware composition (§6) becomes data, not JSX.

### WS3 — Universal Action schema + execute contract `M · reuse 50%`
*PW-014 §7, §7.1, §14.1; PW-AC-03, PW-AC-08.*
- Define the versioned `universal_action` normalized shape (`action_id, source_workspace, source_object_type/id, action_type, priority, due_at, deep_link, status, clinical_sensitivity, version`) as a TS contract; refactor `task-centre.ts` (and notification derivations) to emit it.
- Add a **source-capability declaration** per workspace: `{ directExecutable: bool, confirm: bool, bulk: bool }` (§7.1, §17.1). Add `POST /api/me/actions/{id}/execute` that **re-authorizes + re-validates the source record's current version** before acting; high-risk/clinical → deep-link only + confirmation (PW-AC-08).
- Keep aggregation live-read (no projection copy) — preserves the "no duplication rule".
- **Exit:** PW-AC-03 ✅ (already true via live-read; now contractual), PW-AC-08 ✅.

### WS4 — Event & synchronisation layer `L · reuse 15%` (greenfield)
*PW-014 §8, §8.1, §14.2; PW-AC-03 freshness.*
- Migration: `domain_events` outbox (`event_id, event_type, occurred_at, tenant_id, actor, subject_type, subject_id, version, sensitivity, payload, trace_id`) — append-only, indexed by subject + created_at.
- **Producers:** wrap the highest-value writes (assessment.completed, learning.course.completed, staffing.approval.decided, shift.assignment.changed, policy.acknowledgement.required, credential.expiry.updated, workspace.entitlement.revoked) to append an event in-transaction. Start with the §21.1 order (Healthcare Worker + Shift Supervisor first).
- **Consumer/push:** Supabase Realtime `postgres_changes` on `domain_events` (tenant-filtered) → client invalidates the affected loaders and refetches. No client polling.
- **Reconciliation:** a scheduled job compares open universal-actions to source truth and flags drift (cheap because source is authoritative); a **stale-data indicator** on widgets when Realtime is disconnected (§8.1, §5.2).
- **Exit:** open clients update without manual refresh; `workspace.entitlement.revoked` invalidates access within the SLA (PW-AC-02 hardening).

### WS5 — AI orchestration hardening `M · reuse 60%`
*PW-014 §16; PW-AC (safety).*
- `POST /api/ai/personal-brief`: compose the daily brief from **authorized loaders only** (task-centre, calendar, notifications), pass as grounded context to `generate()`, and **attach source attribution + timestamps** to each claim (§16 cross-workspace summary).
- Priority ranking = existing rule-based engine + optional explainable AI layer; **preserve mandatory priority overrides** from source.
- Enforce PHI minimization + prohibited-prompt filters at the gateway; log to `plat_ai_requests` (already there). Drafting stays draft-only.
- **Exit:** briefs cite sources + freshness; no ungrounded clinical conclusions.

### WS6 — Security, privacy & clinical safety `M · reuse 40%`
*PW-014 §10, §15; PW-AC-04, PW-AC-08, PW-AC-10.*
- **Close the cross-tenant RLS gap** flagged in the prior integration audit (the `using(true)`/role-only policies) so PW-AC-04 holds at the DB layer, not just via server `scope()`.
- **Break-glass** flow: reason capture + expiry + audit; **step-up auth** for high-risk actions; configurable inactivity/absolute session timeout.
- **Device-aware redaction** of patient identifiers in notifications/summaries (§15); disable sensitive browser caching; shared-device mode (§18).
- Expand `audit_log` writes to every PW-sensitive op (login, context switch, sensitive widget view, action execute, config change) → PW-AC-10.
- **Exit:** PW-AC-04 ✅, PW-AC-10 ✅; break-glass + step-up present.

### WS7 — Observability & test harness `M · reuse 20%`
*PW-014 §19, §20; PW-AC-07, PW-AC-09.*
- **Contract tests** per workspace integration (summary endpoint + event shape + deep-link auth) — the `§17.1` obligations become a test suite.
- **Event idempotency/ordering/replay** tests against `domain_events`.
- **Cross-tenant isolation** + **multi-role/acting-role** tests (turn the mirror-script pattern into CI).
- Product/operational/security/AI telemetry dashboards (landing latency, event lag, failed-authz, AI grounding); accessibility + performance budgets → PW-AC-09.
- **Exit:** PW-AC-07/09 measured, not asserted.

---

## 4. Data-model additions (new tables)

| Table | Purpose | Notes |
|---|---|---|
| `domain_events` | Transactional outbox / event log (§14.2) | Append-only; drives Realtime + reconciliation |
| `workspace_entitlement` | user/position/role → workspace + scope + validity + status (§13) | May start as a view over profiles/org_roles + `context_assignment` |
| `context_assignment` | acting roles / shift / temporary deployment w/ expiry (§10) | Powers the active-role banner + WS1 |
| `dashboard_template` + `widget_instance` | manifest-driven composition (§13) | Model as WCE config object types, reuse override/version tables |
| `notification_projection` *(optional)* | only if read-state needs to outlive source | Prefer live-read; add only if required |
| `break_glass_grant` | emergency access w/ reason/expiry/audit (§4, §15) | Feeds audit_log |

Preferences already exist as the `pw_prefs` cookie (PW-012); promoting to `personal_workspace_profile` (§13) is a small migration when cross-device sync is wanted.

---

## 5. Phased roadmap (mapped to PW-014 §22, adapted)

| Phase | Deliverable | Workstreams | Exit criterion → AC |
|---|---|---|---|
| **P0 Foundation** | Reconcile Workspace Registry; `resolveEntitlements`; `universal_action` contract; `domain_events` schema + event naming | WS1 (part), WS3 (contract), WS4 (schema) | Contracts approved; entitlement resolver green |
| **P1 Universal shell** | All roles land on Personal Workspace; entitlement-filtered launcher; acting-role banner | WS1 | **PW-AC-01, PW-AC-02, PW-AC-05** |
| **P2 Action + event layer** | Universal actions + execute contract; outbox producers for top workspaces; Realtime invalidation; stale indicators | WS3, WS4 | **PW-AC-03** (contractual), freshness |
| **P3 Role-aware dashboard** | Manifest-driven composition via WCE; widget registry + per-widget error boundaries; responsive | WS2 | **PW-AC-06, PW-AC-07** |
| **P4 AI + search** | Grounded daily brief w/ citations; permission-filtered universal search; NL navigation | WS5 | Safety/grounding thresholds met |
| **P5 Enterprise rollout** | RLS gap closed; break-glass/step-up; contract+isolation test harness; telemetry; per-tenant default-landing rollout | WS6, WS7 | **PW-AC-04, PW-AC-08, PW-AC-09, PW-AC-10** |

Rollout follows §21.1 integration order (Healthcare Worker + Shift Supervisor → Unit Manager → Assessor/Educator → Competency → Quality → HR/Finance → Executive → Org Admin/Governance), behind feature flags, Personal-Workspace-default enabled per tenant.

---

## 6. Effort, sequencing & the critical path

- **Rough total:** ~**14–20 dev-weeks** (one engineer) to reach all ten acceptance criteria; the WCE reuse removes an estimated 6–8 weeks that PW-014 would otherwise imply for the config/composition/registry core.
- **Critical path:** WS1 (landing+entitlement) → WS3 (action contract) → WS4 (events). WS2 can proceed in parallel once WS1's entitlement resolver exists. WS6/WS7 harden throughout.
- **Biggest genuine build:** WS4 (event layer) — everything else leans on existing engines.
- **Cheapest highest-signal slice:** P1 universal landing — flips the spec's core decision (PW-AC-01) and is a day, not a phase.

## 7. Risks & explicit trade-offs

- **We deliberately do NOT build CQRS projection stores** for actions/notifications. Live-read from source is simpler and *stronger* on staleness, at the cost of read fan-out on hot dashboards. If executive cross-tenant rollups later need it, add projections there only.
- **Registry duality** (`WORKSPACE_CATALOGUE` code vs `plat_workspaces` table) must be reconciled early or drift will bite (WS1).
- **RLS cross-tenant gap** (prior audit) is a correctness prerequisite for PW-AC-04 — it should not wait for P5 if real tenants are onboarded sooner.
- **Realtime** is a soft dependency: if a tenant disables it, the system degrades to live-read-on-navigation (still correct, just not push-fresh) — the stale indicator makes that honest.

## 8. Recommended first move

Ship **P1 (WS1) universal landing** now — small change to `login/page.tsx` + a landing resolver + active-role banner — to make PW-AC-01/02/05 true, then stand up `domain_events` + the `universal_action` contract (P0/P2) as the backbone everything else attaches to.

---

*Every reuse claim above is grounded in a file/table in this repo (§1). Effort figures are rough planning estimates, not commitments. This scope adapts the PW-014 enterprise spec to the actual Supabase/Next monolith — where PW-014 says "service" read "lib module + route + Postgres function", and where it says "event bus" read "Postgres outbox + Supabase Realtime".*
