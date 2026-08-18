# COMP-SEC-002 §15 steps 1-2 — Inventory, divergence report, schema impact

**Read-only. Nothing was mutated** (§18: *"First inventory both state systems and present the
divergence/backfill report"*). Performed 2026-08-19 against the live project — the only project this
repo has.

## The headline: the defect is real in the code and empty in the data

| Measure | Value |
|---|---|
| `profiles` rows | 47 |
| auth users | 47 |
| `account_status = 'active'` | **47 (all of them)** |
| GoTrue-banned users | **0** |
| App says usable, provider BANNED | **0** |
| App says restricted, provider allows | **0** |

**Divergence today: zero.** Not because the two systems are synchronised — they are not — but because
**neither has ever been used.** Nobody has been suspended by either mechanism, so they have had no
opportunity to disagree.

That makes this the cheapest possible moment to do the work. §13 asks for *"a reconciliation report
identifying users where application state and provider state disagree"*; the answer is nobody, so §15
step 8's staging migration has nothing ambiguous to map and §18's "escalate ambiguous historical
accounts" queue is empty. **The task is to build the model before the first suspension, not to repair a
divergent estate.**

## The two write paths, named

The spec's problem statement is exact, and here are the call sites:

| Mechanism | Written at | Plane |
|---|---|---|
| `profiles.account_status` | `src/app/api/enterprise/people/route.ts:37` | Enterprise people admin |
| GoTrue ban (`ban_duration: "876000h"`) | `src/app/api/super-admin/users/actions/route.ts:53` | Super-admin user actions |

**Two routes, two planes, neither aware of the other.** Suspending someone through one leaves the other
untouched. There is no code path that writes both.

⚠ And a third contradiction: `src/lib/super-admin/sys-identity.ts:4` states *"auth is the source of
truth, nothing stored"*. §6 rules the opposite — Competen's lifecycle state is authoritative and the
provider is downstream enforcement. That comment describes today's behaviour accurately and must change
with the implementation, not be left to mislead the next reader.

## Schema impact

`profiles.account_status` (migration 052, line 117):

```sql
add column if not exists account_status text default 'active'
```

**A bare text column.** No CHECK constraint, no `status_changed_at`, no `status_changed_by`, no reason,
no suspension or disablement timestamps. §5's entire required data model is absent, and the column
cannot represent an auditable transition — only a current guess.

### ⚠ Five application values against three specified states

`ACCOUNT_STATUSES` (`src/lib/enterprise/people.ts:10`) permits:

```
"active" | "invited" | "suspended" | "deactivated" | "left"
```

The spec defines **three**: `ACTIVE`, `SUSPENDED`, `DISABLED`. The mapping is not one-to-one, and two
values are the problem §10 warns about directly:

| Current value | Reading | Proposed disposition |
|---|---|---|
| `active` | matches ACTIVE | map to `ACTIVE` |
| `suspended` | matches SUSPENDED | map to `SUSPENDED` |
| `deactivated` | matches DISABLED | map to `DISABLED` |
| `invited` | **not an identity-lifecycle state.** A person who has been asked to join and has not yet accepted — that is a *membership* fact | do NOT fold into identity lifecycle; belongs with org membership |
| `left` | **an organisation-membership fact, not an identity one.** A person who left a facility still has an identity, and may hold membership elsewhere | do NOT fold into identity lifecycle |

⚠ **`invited` and `left` on the global identity row are the exact conflation §10 prohibits**: product-
and org-scoped membership decisions collapsed into global account lifecycle. Both are unused today
(all 47 rows are `active`), so separating them costs nothing now and would cost a migration later.

**No CHECK constraint exists**, so nothing prevents a sixth value appearing. Adding one is part of the
schema work, and — per this repo's standing preference — a wrong state should be made *unrepresentable*
rather than merely rejected in a service layer.

### Existing audit structures — do not duplicate

`audit_log` exists and is the estate's general audit trail (alongside domain-specific tables:
`gov_audit_finding`, `configuration_governance_audit`, and others). §5 says not to duplicate governed
audit structures blindly; §12's five event types (`account.suspended`, `account.reactivated`,
`account.disabled`, `enforcement.failed`, `reconciliation.repaired`) should be evaluated against
`audit_log` before a new table is proposed.

## What §15 step 2 concludes

1. **No account needs reconciling.** The backfill is empty; every one of the 47 maps to `ACTIVE`.
2. **Schema work is additive**, not corrective — lifecycle timestamps, actor, reason, a CHECK
   constraint, and an immutable transition trail. §13's "preserve unknown historical actor/time
   explicitly" applies to nothing, because no transition has ever occurred.
3. **Two decisions are needed before implementation**, and both are the owner's:
   - Where do `invited` and `left` go, given §10? (Recommendation: out of identity lifecycle entirely,
     onto membership — they are unused, so this is free today.)
   - Does the transition trail extend `audit_log` or get its own table? **Checked, and the answer is a
     dedicated table** — see below.

## The transition trail: `audit_log` cannot carry §12

`audit_log` (migration 040) is:

```
id, actor_id, actor_name, action, entity_type, entity_id, entity_name,
hospital_id, old_value jsonb, new_value jsonb, created_at
```

Mapped against §12's required minimum payload — *subject, actor, time, reason, previous state, new
state, correlation ID*:

| §12 field | `audit_log` | |
|---|---|---|
| actor | `actor_id` | ✓ |
| time | `created_at` | ✓ |
| subject | `entity_id` + `entity_type` | ⚠ polymorphic — a bare uuid with a type string, the shape this repo has deliberately moved away from in favour of typed-parent CHECKs |
| previous state | `old_value` jsonb | untyped |
| new state | `new_value` jsonb | untyped |
| **reason** | — | **no column** |
| **correlation ID** | — | **no column** |

**Three of seven have no home**, and two more are untyped JSON. §5's instruction not to duplicate
governed audit structures is satisfied by *checking* — the check says this structure cannot express the
requirement.

Decisive point: §3 calls for an **immutable transition audit**, and §7 requires that a transition never
report success while authoritative state and enforcement diverge. Neither is expressible in a generic
row. A dedicated table can carry a `CHECK` that previous and new state are both present, an append-only
trigger with the `pg_trigger_depth() > 1` cascade allowance this repo already uses, and typed columns
for `reason` and `correlation_id`. That is the "make a wrong state unrepresentable rather than merely
forbidden" preference in `CLAUDE.md`, applied to audit.

`audit_log` also carries `hospital_id references hospitals(id)` — an estate-shaped column that means
nothing for an identity-level lifecycle event.

**Recommendation: dedicated table.** `audit_log` continues to serve general estate auditing.

**Nothing has been implemented.** Per §18 this report is the gate, and steps 3-10 wait on the two
decisions above and on the staging environment COMP-ENG-002 has yet to produce.
