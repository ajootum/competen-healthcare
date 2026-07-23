# Platform Architecture — Conformance & Gap Map

Maps the seven platform architecture specifications onto what actually exists in
this codebase. Six are distinct (the "Superadmin Dashboard Widgets Developer
Tool" file is a byte-identical duplicate of POS-001).

Two are **concrete build specs** (dashboard widgets + APIs) — implemented this
cycle. Four are **architecture blueprints** describing an enterprise SaaS target
(Kubernetes, Redis, event bus, multi-region, HL7/FHIR); much of that is provided
by the runtime stack (Supabase + Vercel) or already shipped, and the genuine
gaps are called out below rather than pretended-built.

**Legend:** ✅ implemented · 🟡 partial · ☁️ provided by stack (Supabase/Vercel)
· ⬜ not built (blueprint/future)

---

## POS-000 — Platform Operations & Infrastructure Architecture

The umbrella tying POS-001 + POS-002 to Mission Control. Realized this cycle: the
super-admin Platform Operations section is the operational console; POS-001 feeds
its Mission Control widgets and POS-002 its Infrastructure Status Bar, both from
standardized APIs.

| POS-000 element | Status | Evidence |
|---|---|---|
| POS-001 + POS-002 as distinct, integrated layers | ✅ | `lib/platform/operations.ts`, `lib/platform/runtime.ts` |
| Mission Control consumes standardized service APIs | ✅ | `/api/platform/operations`, `/api/runtime/*` |
| Tenant isolation, RBAC, auditability | ✅ | admin-client + `isSuper` gate on every route; `audit_log` / `plat_audit_events` |
| Event bus (all events published) | 🟡 | `plat_platform_events` + `emitPlatformEvent`; no streaming bus |
| Real-time push (WebSocket/SSE) | 🟡 | widgets poll every 30s; no socket layer |
| HA / multi-region / zero-downtime / DR | ☁️ | Vercel + Supabase managed |

## POS-001 — Platform Operations Services ✅

8 Mission Control widgets from one aggregation service; 6 live, 2 honest "na".

| Widget → Service | Status | Source |
|---|---|---|
| Platform Health → Monitoring | ✅ | `loadMonitoring` subsystem probes |
| Critical Alerts → Alert Engine | ✅ | `op_escalations` + `op_safety_alerts` |
| Enterprise Tenants → Analytics | ✅ | `tenants` |
| Active Users → Analytics | ✅ | `profiles` |
| Pending Approvals → Workflow | ✅ | `change_requests` (open) |
| Deployments Today → Deployment Mgmt | ✅ | `plat_deployments` |
| AI Operations → Monitoring | 🟡 | not metered → honest "na" |
| Background Jobs → Job Scheduler | ⬜ | no job runner → honest "na" |

## POS-002 — Platform Infrastructure & Runtime Services ✅

10 Infrastructure Status Bar widgets via `/api/runtime/*`; live where the stack
provides it, honest where it doesn't self-manage the infra.

| Widget | Status | Source |
|---|---|---|
| Operations Region / Platform Version / Release Channel | ✅ | `plat_regions`, `package.json`, `plat_deployments` |
| Last Deployment | ✅ | `plat_deployments` |
| Database Health | ✅ | live timed probe |
| Last Backup | ☁️ | Supabase-managed, history not surfaced |
| Redis / Queue / Search Health | ⬜ | not self-managed in this deployment |
| Uptime | ⬜ | not monitored |

---

## PFS-000 — Platform Foundation Services (16 services)

| Service | Status | Evidence / Notes |
|---|---|---|
| Identity | ✅ | `profiles`, `lib/roles.ts` |
| Authentication | ☁️/✅ | Supabase Auth; `/api/auth/*` |
| Authorization (RBAC/ABAC) | ✅ | `AppRole`/`OrgRole`/`PlatformRole`, `api-auth.ts`, RLS |
| Tenant | ✅ | `tenants`, `lib/platform/tenants.ts`, provisioning |
| Configuration | 🟡 | per-tenant columns + `plat_org_templates` + WCE-001 workspace config engine (hierarchical resolver, Designer, versioning); no universal service-config store yet |
| Feature Flag | ✅ | `plat_feature_flags` + assignments, control-plane |
| File Storage | ☁️ | Supabase Storage (`/api/account/avatar`) |
| Notification | ✅ | multi-channel dispatch + delivery tracking (`lib/notifications/dispatch.ts`, `notif_deliveries`); in-app/email/webhook real, SMS/Teams/Slack honest-skipped without provider env |
| Search | ✅ | Platform Search Service (`lib/platform/search.ts`, `/api/platform/search`) — unified cross-entity Postgres ILIKE; dedicated engine still an honest infra gap |
| Messaging (async) | 🟡 | `plat_platform_events`; no broker (infra-scale — not pretended-built) |
| AI Runtime Gateway | ✅ | governance built (`lib/ai/gateway.ts`, `plat_ai_requests`) — central token/cost accounting + analytics; single-provider (Anthropic) by design |
| Audit | ✅ | `audit_log`, `plat_audit_events` |
| Integration Gateway (HL7/FHIR/SCIM) | ⬜ | future; `plat_idp_configs` scaffold only (external/infra-scale) |
| Licensing | ✅ | `plat_plans`/`plat_subscriptions`, licensing module |
| Localization | ✅ | Localization Resource Service (`lib/platform/localization.ts`, `/api/platform/localization`) — locale catalogue, bundles, resolver w/ fallback + interpolation + coverage, RTL |
| API Gateway | ☁️ | Next.js route layer + Vercel edge |

## PCS-000 — Platform Core Services (18 services)

| Service | Status | Evidence / Notes |
|---|---|---|
| User | ✅ | `profiles`, staff fields (ENT-001) |
| Organisation | ✅ | `organisations`/`hospitals`/`departments`/`units`, `ent_*` |
| Workspace | ✅ | code catalogue + `plat_workspaces` (Workspace Management) |
| Role | ✅ | `lib/roles.ts` |
| Task | 🟡 | `/api/operations/tasks` (clinical ops scope) |
| Workflow | ✅ | generic workflow/approval engine (`lib/platform/approvals.ts`, `plat_approval_requests`/`_decisions`) — code-defined defs + ordered steps; unifies with `change_requests` |
| Document | ✅ | Unified Document Service (`lib/platform/documents.ts`, `/api/platform/documents`) — normalised index across `evidence`/`assessment_evidence`; write-path/versioning next-phase |
| Scheduling | 🟡 | `/api/schedule(s)` (clinical-ops scope, intentional) |
| Calendar | 🟡 | assessor calendar (clinical-ops scope, intentional) |
| Dashboard | ✅ | many role dashboards + POS-001/002 widget boards |
| Reporting | ✅ | `/api/reports/*` |
| Search Index | ✅ | Platform Search Service (`lib/platform/search.ts`) |
| Approval | ✅ | `change_requests` + generic workflow engine |
| Activity Timeline | ✅ | `audit_log` / activity feeds |
| Knowledge Reference | ✅ | frameworks/competencies/taxonomies |
| Configuration Profile | 🟡 | templates + per-entity settings + WCE-001 workspace config engine (resolver/Designer/versioning); no universal config service |
| Collaboration | ⬜ | not built (buildable — next: `plat_comments` threaded comments/mentions, needs a migration) |
| Audit Timeline | ✅ | audit feeds |

## PDS-000 — Platform Data Services (data architecture)

| Element | Status | Evidence / Notes |
|---|---|---|
| Multi-tenant data model (tenant→org→site→dept→unit→user) | ✅ | tenant hierarchy + `tenant_id` scoping |
| Master data (people, orgs, frameworks, dictionaries) | ✅ | core tables + `ent_*` |
| Operational data (admissions, assessments, tasks, scheduling) | ✅ | `op_*`, assessment/learning tables |
| Immutable audit / versioning | ✅ | `audit_log`, `plat_audit_events`, `change_requests` history |
| Platform domain (audit, config, flags, licensing, billing) | ✅ | `plat_*` tables |
| PostgreSQL primary store | ☁️ | Supabase Postgres |
| Redis / Data Warehouse / Vector store / Event store / TSDB | ⬜ | not provisioned; single Postgres store |
| Event-driven pipeline / analytics warehouse | 🟡 | `plat_platform_events`; no warehouse/ETL |
| Integration (EMR/HRIS/LMS/registries) | ⬜ | future |

---

## Built since the first conformance pass

The original backlog is now shipped and verified: Background Job runner + registry
(POS-001F), Deployment recording (`plat_deployments`), multi-channel Notification
service (PFS §12 / POS-001H), AI Runtime Gateway governance (PFS §15), real-time SSE
push (POS-001J), the generic Workflow/Approval engine (PCS §10 / POS-001D), and this
cycle's **Platform Search Service** (PFS Search / PCS Search Index), **Unified Document
Service** (PCS Document) and **Localization Resource Service** (PFS Localization).

## Genuine gaps worth building next (in priority order)

Both missing *and* buildable in this stack (Supabase + Next) — distinct from the
infra-scale blueprint elements below:

1. **Collaboration primitive** — `plat_comments` threaded comments / @-mentions on any
   entity (PCS Collaboration). The one remaining buildable gap that needs a migration.
2. **Write-path Document service** — upload, versioning and retention policies over the
   read-only document index (PCS Document write-side).
3. **Universal service-config store** — generalise WCE-001 beyond workspace config into
   a platform-wide configuration service (PFS Configuration / PCS Configuration Profile).
4. **Translation-management workflow** — import/export and per-tenant overrides over the
   Localization Resource Service seed bundles.

## Honest infra-scale gaps (deliberately not built)

Faking these in a single-Postgres + Vercel deployment would be dishonest, so they stay
⬜/🟡 with rationale: async **Messaging broker**, **Integration Gateway** (HL7/FHIR/SCIM),
dedicated **search engine** (Elasticsearch/OpenSearch), and **Redis / queue / TSDB /
data-warehouse / vector / event store**. Generic **Task/Scheduling/Calendar** stay
clinical-ops-scoped by intent. Everything here is a deliberate, honest backlog rather
than a hidden gap.
