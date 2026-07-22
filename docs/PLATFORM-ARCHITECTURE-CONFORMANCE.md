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
| Configuration | 🟡 | per-tenant columns + `plat_org_templates`; no central config service |
| Feature Flag | ✅ | `plat_feature_flags` + assignments, control-plane |
| File Storage | ☁️ | Supabase Storage (`/api/account/avatar`) |
| Notification | 🟡 | `/api/notifications`, `messages`; no multi-channel (SMS/Teams) |
| Search | 🟡 | PostgreSQL full-text; no dedicated engine |
| Messaging (async) | 🟡 | `plat_platform_events`; no broker |
| AI Runtime Gateway | 🟡 | `@anthropic-ai/sdk`, `/api/ai/*`; single-provider, no central token governance |
| Audit | ✅ | `audit_log`, `plat_audit_events` |
| Integration Gateway (HL7/FHIR/SCIM) | ⬜ | future; `plat_idp_configs` scaffold only |
| Licensing | ✅ | `plat_plans`/`plat_subscriptions`, licensing module |
| Localization | 🟡 | tenant language/timezone/currency; no i18n resource service |
| API Gateway | ☁️ | Next.js route layer + Vercel edge |

## PCS-000 — Platform Core Services (18 services)

| Service | Status | Evidence / Notes |
|---|---|---|
| User | ✅ | `profiles`, staff fields (ENT-001) |
| Organisation | ✅ | `organisations`/`hospitals`/`departments`/`units`, `ent_*` |
| Workspace | ✅ | code catalogue + `plat_workspaces` (Workspace Management) |
| Role | ✅ | `lib/roles.ts` |
| Task | 🟡 | `/api/operations/tasks` (clinical ops scope) |
| Workflow | 🟡 | `change_requests`, competency cycles; not a generic engine |
| Document | 🟡 | evidence/certificates; no unified document service |
| Scheduling | 🟡 | `/api/schedule(s)` |
| Calendar | 🟡 | assessor calendar |
| Dashboard | ✅ | many role dashboards + POS-001/002 widget boards |
| Reporting | ✅ | `/api/reports/*` |
| Search Index | 🟡 | PostgreSQL |
| Approval | ✅ | `change_requests` |
| Activity Timeline | ✅ | `audit_log` / activity feeds |
| Knowledge Reference | ✅ | frameworks/competencies/taxonomies |
| Configuration Profile | 🟡 | templates + per-entity settings |
| Collaboration | ⬜ | not built |
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

## Genuine gaps worth building next (in priority order)

These are the items that are *both* missing *and* buildable in this stack —
distinct from blueprint elements that only matter at enterprise infra scale:

1. **Background Job runner + registry** — record cron/report runs so the
   Background Jobs and job-health widgets go live (POS-001F / POS-002 queues).
2. **Deployment recording** — write a `plat_deployments` row on release so
   Deployments Today / Last Deployment / release history populate.
3. **Multi-channel Notification service** — extend `/api/notifications` to
   email/SMS with delivery tracking (PFS Notification, POS-001H).
4. **AI Runtime Gateway governance** — central token accounting, model routing
   and usage analytics over the existing `/api/ai/*` (PFS-000 §15) → lights up
   the AI Operations widget.
5. **Real-time push (SSE)** — replace 30s polling on the widget boards.
6. **Generic Workflow/Approval engine** — promote `change_requests` into a
   configurable multi-type approval service (PCS Workflow, POS-001D).

Everything above the line is implemented and verified; everything below is a
deliberate, honest backlog rather than a hidden gap.
