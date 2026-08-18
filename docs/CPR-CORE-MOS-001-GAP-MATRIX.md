# CPR-CORE-MOS-001 — Phase 0 gap matrix

**Status:** produced 18 August 2026 against the live schema and the live database. §16 of
CPR-CORE-MOS-001 requires this matrix to exist *before* implementation and to be **maintained**, so it
lives in the repo rather than in a document nobody edits. `scripts/mos-gap-matrix-harness.ts` holds it
to the schema: every table named here must exist, and every Practice-aware claim is re-derived from the
migrations rather than trusted.

**Method.** Row counts were read from the live database with a service-role client. "Practice-aware"
means the table carries `practice_id` or `workspace_id` — not `hospital_id`, not `tenant_id`. Where a
column list is quoted it came from the `create table` statement, not from memory.

⚠ **Two claims in this matrix were wrong the first time they were written**, and both are noted in place.
The pattern in each case was the same: a table's existence was read as evidence that it holds data.

---

## 1. The finding in one line

Competen Practice already has a **stable canonical identifier** — `practice_workspace.id` — and five
Practice-scoped tables already use it. What does not exist is any **management-plane** record that
references it. The gap is not identity; it is that the management plane was built for a different
subject and has no column pointing at this one.

| | |
|---|---|
| Practice-scoped tables that exist today | **5** — sync transactions, messages, configuration, activation events, entitlements |
| Management-plane tables that can name a Practice | **0** |
| Management-plane tables scoped to `hospital_id` | 5 (`op_incidents`, `gov_risks`, `gov_controls`, `gov_obligations`, `workspace_config_overrides`) |
| Management-plane tables scoped to `tenant_id` | 5 (`plat_ai_requests`, `plat_platform_events`, `plat_support_tickets`, `plat_subscriptions`, `plat_billing_accounts`) |

That is §1's "materially estate/hospital-scoped" claim, measured.

---

## 2. The matrix

Columns are §16's seven, in its order.

### Product Health — CPR-PD-008

| Requirement | Existing service/table | Practice-aware? | Gap | Required schema/service/event | Build action | Acceptance evidence |
|---|---|---|---|---|---|---|
| §8B availability | *none* | — | No uptime probe, health-check record or request log exists anywhere | Practice health probe + `practice.access.*` events | Build a probe against a known Practice route on a schedule | An availability figure with a stated observation count and window |
| §8B P95/P99 performance | `plat_ai_requests.latency_ms` (146 rows, `tenant_id`) | no | Measures a provider call, not a practitioner request | Route timing on Practice requests; §5 `duration_ms` | Instrument the request path | P50/P95/P99 over Practice requests, denominator shown |
| §8C error rate | AI/job/event logs (146 / 1,826 / 669 rows) | no | ⚠ **The numerator exists and the denominator does not.** Nothing counts operations *attempted* | §5 `outcome` on every event | Emit attempt + outcome per operation | A rate whose denominator is an attempt count |
| §8D workflow health (8 journeys) | `mos_journey_event` | **YES** | ⚠ **Closed, partly.** Six of the eight now emit an attempt and exactly one outcome — booking, start encounter, save encounter, follow-up, document, invoice. Two remain: sign in (client-side auth) and open planner (a server render, not a route) | The remaining two, per §18 phase 3 | Sign in needs a server login route or a pre-auth beacon (an owner decision); open planner needs a definition of a render's outcome | Success over attempts, per journey — **already met for six** |
| §8E data & sync | `practice_sync_transaction` (**0 rows**, `workspace_id`) | **YES** | ⚠ **Corrected:** first written as "the product writes them daily". The sync engine does write this table — and it holds **zero rows**, because no device has synced here. The plane refusal is real; it is currently refusing an empty table | Allowlist entry **or** `practice.sync.*` events | Prefer events (§6) — keeps the plane boundary where it is | Outbox depth and age of oldest, with a stated read basis |
| §8G communications | `practice_message` (4 rows, `workspace_id` + `patient_id`) | **YES** | Readable rows exist but carry `patient_id`; §5 requires privacy-minimised telemetry | `practice.communication.*` events, non-PHI | Emit delivery events rather than widen the read | Delivery state by channel with no patient reference |
| §8H AI health | `plat_ai_requests` (146 rows) | no | **Measured today.** Scoped to the platform, not to Practice | §5 `practice_id` on AI events | Attribute AI calls to the calling Practice | AI latency and error share per Practice |
| §8I security signals | *none* | — | No Practice-scoped security series | `practice.access.failed`, lockout events | Emit from the sign-in path | Authentication-failure trend, Practice-attributed |
| §8J history | *none* | — | No health state has ever been computed or stored | Health-state transition store | Persist state transitions | A degradation with start, end and linked change |
| §4 objectives | *none* | — | ⚠ **No objective is declared anywhere in the product** — so nothing can be Healthy under §4, however well measured | Objective per domain, versioned | Declare targets with an owner | A domain resolving to Healthy against a stated threshold |

### Support & Incidents — CPR-PD-009

| Requirement | Existing service/table | Practice-aware? | Gap | Required schema/service/event | Build action | Acceptance evidence |
|---|---|---|---|---|---|---|
| §2 incident estate | `op_incidents` (8 rows) | no | `hospital_id`, `shift_id`, **`patient_id`** — wrong subject, and carries clinical data a product surface must not show | §8's incident model: `subject_type`/`subject_id`, severity, lifecycle, scope, impact | ⚠ **Do not generalise `op_incidents`.** Its semantics are clinical-incident, not product-incident | A product-wide and a Practice-specific incident, both addressable |
| §2 support cases | `plat_support_tickets` (**0 rows**, `tenant_id`) | no | Closest existing shape; a Practice cannot be a tenant | Practice-scoped case record, or typed subject on this one | Generalise **only** if ticket semantics stay correct | A case raised against a named Practice |
| §2 escalation / problem / postmortem | *none* | — | No record of any kind | Incident-derived records with owner and due date | Follow the incident model | A corrective action with an owner and a due date |
| §9 impact quantification | *none* | — | Nothing records which Practices a failure touched | §5 `correlation_id` + `practice_id` | Comes free with the event envelope | Affected sessions/Practices per incident |

### Governance & Risk — CPR-PD-010

| Requirement | Existing service/table | Practice-aware? | Gap | Required schema/service/event | Build action | Acceptance evidence |
|---|---|---|---|---|---|---|
| §2 product risk register | `gov_risks` (**0 rows**, `hospital_id`) | no | ⚠ **Corrected:** first written as "built and populated for hospitals". It is **empty**. Wrong subject *and* no data | Product/Practice governance subject on risk records | §9: reuse `gov_*` only if semantics generalise; the schema is a good model to copy | A risk owned at Competen Practice product scope |
| §2 controls & assurance | `gov_controls` (**0 rows**) | no | Same | Subject-scoped control records | As above | A control tested against product scope |
| §2 obligations | `gov_obligations` (**0 rows**) | no | Same | Subject-scoped obligation records | As above | An obligation with a due date at product scope |
| §2 decisions & approvals | `plat_approval_requests` (0 rows) | no | No subject scope at all | Typed subject on approvals | Extend with `subject_type`/`subject_id` | An approval routed by subject and capability |
| §25 segregation of duties | `hq_capability` + migration 311 | n/a | **Already correct.** `change.approve` is withheld from the Director by design | — | none | Maker and checker are different positions |

### Product Configuration — CPR-PD-011

| Requirement | Existing service/table | Practice-aware? | Gap | Required schema/service/event | Build action | Acceptance evidence |
|---|---|---|---|---|---|---|
| §3 hierarchy, six levels | `workspace_config_overrides` (0 rows, `hospital_id`) | no | Scope vocabulary is `('platform','tenant','hospital','unit','role','user')` — **no practice, no market, no plan** | Practice and practitioner as valid scopes | §10: add scopes; do not represent Practice through tenancy fields | A value resolving at Practice scope |
| §5 effective-value resolution | `applies()` in `workspace-config.ts` | no | Six branches, none can match a Practice | A branch keyed on `practice_id` | Extend the resolver with the scope | Effective value + winning scope + contributing chain |
| §4 definitions | `configuration_registry_objects` (**80 rows**) | no | Registry is real and seeded from the estate workspace catalogue; **names Practice nowhere** | Practice settings registered as definitions | Register them, with owner and safety class | A Practice setting with allowed scopes and an override policy |
| §6 overview | `practice_configuration` (2 rows, `workspace_id`) | **YES** | Practice settings DO exist — they are simply not registry objects, so the engine cannot govern them | Bridge the two | Register the existing rows as definitions | The registry's count of Practice definitions > 0 |
| §4 owners | registry | no | 8 definitions carry no owner, so no approval route resolves | Owner on every definition | Backfill | Zero definitions without an owner |

### Product Intelligence & Adoption — CPR-PD-005 / 006

| Requirement | Existing service/table | Practice-aware? | Gap | Required schema/service/event | Build action | Acceptance evidence |
|---|---|---|---|---|---|---|
| §2 usage, engagement, retention | `practice_activation_event` (**6 rows**, `workspace_id`) | **YES** | ⚠ **The only Practice-scoped product event stream that exists** — and it is a milestone log, not an operational one. It carries `workspace_id`, `event_key`, `occurred_at`, `actor_id`, `metadata` and **zero of §5's ten envelope fields** | §5 envelope + §6 catalogue | New event store to §5; activation events become one **producer** into it, not its starting schema | An event with `correlation_id`, `outcome` and `duration_ms` |
| §5I funnel | as above | — | 6 milestone rows cannot support a funnel with stages | §6's catalogue across the journeys | Phase 2–3 | Registration-to-activation with counts at each stage |
| PD-006 interventions | *none* | — | Every intervention must carry a measured outcome; nothing measures one | §12 lifecycle/cohort dimensions | Phase 8 | An intervention with a measured before/after |

### Commercial — CPR-PD-007

| Requirement | Existing service/table | Practice-aware? | Gap | Required schema/service/event | Build action | Acceptance evidence |
|---|---|---|---|---|---|---|
| §2 subscriptions | `plat_subscriptions` (6 rows, `tenant_id`) | no | Keys on `tenants(id)`; `practice_workspace` has no `tenant_id`, so a Practice **cannot be the subject of a row** | §11 canonical `practice_id` ↔ commercial account | Add the mapping | A Practice resolving its subscription |
| §2 entitlements | `practice_entitlement` (**2 rows**, `workspace_id`) | **YES** | ⚠ **Narrower gap than "unrepresentable".** Entitlements already name a Practice; subscription, plan, price and currency do not | Link entitlement to a commercial source of truth | Phase 7 | Entitlement traceable to a plan |
| §7A plans & pricing | `practice_plans` (2 rows, no scope) | no | A catalogue with **no price and no currency**; UGX appears nowhere in the schema | Price book with currency and effective dates | Follows `PCS-BILLING-SURVEY-001` | A plan with a price in a stated currency |
| §7E revenue | *none* | — | No ledger names a Practice | Commercial attribution per §11 | Phase 7 | Recurring revenue with its basis stated |

### Cross-cutting

| Requirement | Existing service/table | Practice-aware? | Gap | Required schema/service/event | Build action | Acceptance evidence |
|---|---|---|---|---|---|---|
| §3 canonical subject model | `practice_workspace.id` (2 rows) | **YES** | ⚠ **The identifier already exists and is stable.** No management-plane table references it | `subject_type` + `subject_id` on management records | Phase 1 | A management record naming a Practice |
| §4 identity contract | `practice_workspace` | partial | Has id, name, status, country, timezone, owner. **No** `market_id`, `commercial_account_id`, `subscription_id`, `current_plan_id` | The four missing references | Phase 1 | A Practice resolving its market and plan |
| §13 release attribution | `plat_deployments` (**0 rows**) | no | Table exists, nothing recorded; no telemetry carries `release_version` | §5 `release_version` | Phase 9 | A degradation correlated with a named release |
| §14 correlation | *none* | — | No `correlation_id` anywhere | §5 field, threaded through | Phase 2 | One journey reconstructed end to end |
| §17 standard refusal pattern | 3 copies — `config-ui`, `health-ui`, `release-ui` | n/a | ⚠ §17 asks for **one** standard missing-evidence pattern and there are **three**. Five more modules would have made eight | One shared component | Consolidate before any further module | One import path for every refusal |

---

## 3. What this changes about the build order

§18's phases 1–3 — canonical subject, event envelope, journey instrumentation — are **one track that
resolves the largest number of rows above**: every Health gap except objectives, both Intelligence and
Adoption entirely, the impact quantification Support needs, and the correlation Governance needs for
evidence. Nothing else has that reach.

The two cheapest rows are not in that track and are worth taking early because they are corrections
rather than builds:

1. **Register the existing Practice settings as configuration definitions.** `practice_configuration`
   already holds 2 rows scoped to a workspace; the registry simply does not know about them. This is the
   one place where Practice data exists *and* the engine that should govern it exists, with nothing
   joining them.
2. **Consolidate the three refusal patterns into one** (§17), before anything else is built on top of
   the duplication.

## 4. What this matrix does not settle

- **Sequencing within phases 1–3** — the spec gives an order, not a size. None of these rows is
  estimated, and this document should not pretend otherwise.
- **Whether `op_incidents` and `gov_*` are generalised or replaced.** §8 and §9 both say "only if the
  semantics generalise safely". `op_incidents` carries `patient_id` and `shift_id`, which is a strong
  argument for Practice-native. `gov_*` is empty, which makes replacement cheap. Both are decisions, not
  findings.
- **Whether the sync and message refusals are still worth an allowlist decision.** With `practice_sync_transaction`
  at zero rows, widening the allowlist today would reveal an empty table — so §6's event route is
  probably better on its own merits rather than only on boundary grounds.
