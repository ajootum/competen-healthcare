# COMPETEN v1.0 — Implementation Traceability Register

**Status: FROZEN BASELINE** (per CIRCGR §25.4) · Frozen: 2026-07-09 · Live: https://competenhealthcare.com
Changes to items below require: business justification → impact assessment → approval → version bump.

Maps every specification artefact to its implementation. Status: ✅ implemented · 🟨 partial · ⬜ not built (registered gap).

## 1. Enterprise & Product Architecture (CPAS, CEOS, Master Index)

| Artefact | Status | Implementation |
|---|---|---|
| Multi-hospital organisational hierarchy | ✅ | `organisations`, `hospitals`, `departments`, `units` (migrations 006, 008) |
| Role & permission model (13 org roles → 5 portals) | ✅ | `src/lib/roles.ts`, role editor `super-admin/users` |
| Identity/auth | ✅ | Supabase Auth + `src/proxy.ts` session refresh |
| Multi-tenant landlord/subscription model | ⬜ | v2 gap (Master Schema `tenancy.*`) — needed at 2nd customer org |
| Standards inheritance (global→hospital) | 🟨 | Framework libraries + adopt API; country-level inheritance not modelled |

## 2. CKCM — Clinical Knowledge & Competency Model

| Artefact | Status | Implementation |
|---|---|---|
| Framework → Domain → Practice → CPU → Competency → Skill | ✅ | Migrations 003, 007, 011; Content Builder |
| Assessment Blueprints (methods, weights, consensus) | ✅ | `assessment_blueprints`, `blueprint_methods` (011); CPU config panel |
| Evidence Matrix + critical-failure rules | ✅ | `evidence_matrix`, `critical_failure_rules` (011) |
| Competency Decision Engine (7 outcomes, Benner maturity, expiry) | ✅ | `src/lib/engines/decisions.ts` |
| Competency Passport (+ printable export) | ✅ | `dashboard/passport` + `/print` |
| Clinical authorizations & 5-level entrustment | ✅ | `clinical_authorizations` (015, 021); entrustment API |
| Credentials, recognitions, curricula | ✅ | Migrations 016, 018 |
| Learning pathways from decision gaps | ✅ | `src/lib/engines/pathways.ts` (014) |
| Knowledge graph + semantic edges | ✅ | `knowledge_edges` (012), `engines/graph.ts`; pgvector ready (017) |
| Versioning, change requests, impact analysis | ✅ | Migration 012; `engines/impact.ts`; framework lifecycle |
| Governance committees (5 levels) | ✅ | `governance_committees` (012); Committees page |

## 3. Studio (authoring environment)

| Builder | Status | Implementation |
|---|---|---|
| Competency / CPU / Assessment / Evidence Builders | ✅ | Content Builder + CPU config |
| Skill Builder (reusable library, 7 types) | ✅ | `skill_library` (020); `studio/skills` |
| Checklist Builder (sections, 6 scoring methods, critical-fail) | ✅ | 007 + 020; `studio/checklists` |
| Learning Builder | ✅ | Admin resources + curricula |
| Policy Builder | ✅ | Policy manager |
| Version Manager / Approval Queue / Published Library | ✅ | Lifecycle, approvals, competency library |
| Question Builder (MCQ banks) | 🟨 | Practice quiz existed; governed banks added in v1.1 (migration 022) |
| Simulation Builder | ⬜ | Registered gap (v1.5) |
| Studio Home Dashboard ("what needs my attention"), global search, Quick Create (UX spec §6-8) | ✅ | Studio hub v1.1 |
| Practice/CPU library screens + CPU clone service ("Clinical Practice and CPUs" spec) | ✅ | `studio/cpus`; clone copies blueprint, evidence matrix, critical failures |
| Drag-and-drop canvas, mind-map/kanban widgets, collaborative editing (Notion/Miro-style) | ⬜ | Registered gap — large front-end platform work (v1.5+) |
| Review Mode w/ inline comments, side-by-side version compare, Publication/Tenant Adoption Centres, live validation panel, People workspace (UX spec §14-23) | ⬜ | Registered gaps — approvals/version history/adopt API cover the basics |

## 4. Assessor Operating Layer ("The Assessor Role")

| Artefact | Status | Implementation |
|---|---|---|
| Role-to-CPU Requirement Matrix | ✅ | `role_requirements` (021) |
| Readiness + task-generation engine | ✅ | `src/lib/engines/tasks.ts` |
| Smart prioritized queue w/ progressive disclosure | ✅ | Assessor dashboard `SmartQueue` |
| Entrustment decision (5 levels) | ✅ | `api/assessor/entrustment` |
| Multi-assessor consensus | ✅ | Cycle consensus rules (recomputeAll) |
| Assessor calibration analytics | ✅ | `engines/quality.ts` assessor consistency |
| Assessor scope matrix (per-CPU authorization, independence levels, expiry) | ✅ | `assessor_authorizations` (023); queue + entrustment scope-filtered; Admin → Authorizations panel |
| Content responsibility assignments (product owners, review due dates) | ✅ | `content_responsibilities` (023); Studio → Ownership & Responsibilities |
| Separation of duties (submitter ≠ approver) | ✅ | Enforced in `api/content/review` |
| Workload balancing, delegation, access reviews, landlord/tenant workspaces | ⬜ | User Account Architecture v2 items (full identity/membership/role-assignment model at 2nd customer org) |
| Mobile opportunistic observation | ⬜ | Registered gap (v1.5) |

## 5. Quality & Accreditation (EQOS)

| Artefact | Status | Implementation |
|---|---|---|
| Quality Objects + 12 domains + framework adapters (JCI/SafeCare/MOH) | ✅ | Migration 019; Admin → Quality |
| Indicators + measurements + escalation logic | ✅ | 019; `indicatorStatus()` |
| Improvement Objects (9 methodologies, lifecycle) | ✅ | 019 |
| Accreditation readiness (8 checks) | ✅ | `engines/quality.ts`; Admin → Accreditation |
| Incident management, CAPA | ⬜ | Registered gap (v1.5) |
| Accreditation/Quality Digital Twin | ⬜ | v2+ vision item |

## 6. Frontends (Frontend User Structures, FCLUXS)

| Workspace | Status | Implementation |
|---|---|---|
| Healthcare Worker (10-section nav incl. CPUs, Logbook, Career) | ✅ | `dashboard/*` |
| Assessor | ✅ | `assessor/*` + Smart Queue |
| Educator | ✅ | `educator/*` (deep redesign deferred) |
| Admin (role-filtered: supervisor→director functions) | ✅ | `admin/*` (20+ pages) |
| Executive Command Center (Nursing Capability Index) | ✅ | `admin/executive` |
| Super Admin / governance | ✅ | `super-admin/*` |
| C-suite & council mission workspaces (28) | ⬜ | Deferred — need operational data feeds |
| Formal design-system component library | 🟨 | Consistent Tailwind idiom; not extracted as library |

## 7. AI (Book IV)

| Artefact | Status | Implementation |
|---|---|---|
| Grounded assistant w/ citations (FTS retrieval) | ✅ | `api/ai/assistant`; `search_ckcm()` (018/019) |
| AI coach (gap-based) | ✅ | `api/ai/coach` |
| Governance committee briefings | ✅ | `api/ai/governance` |
| Guardrails: no clinical decisions, audit-logged | ✅ | System prompts + audit_log |
| Embeddings/semantic search | ⬜ | pgvector installed; needs embedding key (v1.5) |

## 8. v2 Product Gaps (registered, not started)

COMPETEN Workforce (recruitment, CV parsing, interviews, skills lab — Master Schema `recruitment.*` 51 tables) · Transition/orientation/probation workflows (`transition.*`) · Rostering/deployment (`workforce.*`) · Notification & workflow engines (`orchestration.*`) · Ministry/national dashboards.

---
*Update this register with every increment; it is the change-management baseline required by CIRCGR §25.5.*
