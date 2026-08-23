# CPR-DEL-001 / INVENTORY-001 — Practice deletion: measured inventory and retention classification

**Spec:** `CPR-DEL-001 Practice Deletion Lifecycle & Cascade-Safe Immutability`
**Covers:** §3 mandatory pre-migration inventory, §4 retention classification
**Status:** **STOPPED AT §4 CLASS D.** Migration 351 is *not* written. Two tables need a governance
decision before any schema change, and §4 says *"STOP for that table and escalate; do not guess."*
**Measured:** 2026-08-23, staging catalog, read-only (`scripts/cpr-del-001-inventory.mjs`)

---

## 0. The correction this inventory exists to make

The spec quotes a figure I gave: *"Eleven of twelve practice_\* immutable triggers reportedly refuse all
DELETE; ten of those eleven are behind cascading FKs."* It also says **"Re-measure before migration."**

Re-measured from `pg_catalog` rather than from migration files:

| | Reported | Measured |
|---|---|---|
| practice_* triggers firing on DELETE or UPDATE | 12 | **22** |
| …that can block a delete at all | 11 | **3** |
| …behind a CASCADE FK | 10 | **1** |

**Eighteen of the twenty-two guard `UPDATE` only.** They never see a DELETE and cannot abort a cascade.
The original figure came from grepping `.sql` for a trigger name pattern and assuming every match blocked
deletes — the same class of error as the `pg_trigger_depth` grep that missed
`practice_access_log`'s parent-gone check.

**The problem is two tables, not eleven.** The privacy finding stands; the scale in the spec does not.

---

## 1. §3 Inventory — the four triggers that fire on DELETE

| Table | Trigger fires | Parent FK → | ON DELETE | Trigger behaviour |
|---|---|---|---|---|
| `practice_access_log` | DELETE + UPDATE | `practice_workspace` | CASCADE | **allows cascade** (parent-gone check) |
| `practice_audit_event` | DELETE + UPDATE | *none* | — | refuses unconditionally |
| `practice_invoice_item` | DELETE + UPDATE | `practice_workspace` | CASCADE | refuses **conditionally** |
| `practice_lifecycle_transition` | DELETE + UPDATE | `practice_workspace` | **NO ACTION** | refuses unconditionally |

The other eighteen (`practice_appointment`, `practice_encounter`, `practice_patient`, `practice_receipt`,
`practice_thread_message`, `practice_invoice`, `practice_payment`, `practice_settlement`,
`practice_settlement_item`, `practice_task_event`, `practice_procedure_outcome`,
`practice_membership_event`, `practice_contact_log`, `practice_follow_up_event`,
`practice_encounter_note_version`, `practice_clinical_document`, `practice_membership`,
`practice_access_log`/UPDATE) are **UPDATE guards**. §4 Class C — *continue refusing direct DELETE and
UPDATE*. **No change proposed to any of them.**

### Canonical comparator (§3, last row)

`practice_access_log_immutable` — already in the practice plane, already cascade-safe. It uses a
**parent-gone check** (`not exists (select 1 from practice_workspace …)`) rather than
`pg_trigger_depth()`. Both appear in this repository; `gov_*`, `mos_*` and `pd_*` use the latter.
§2 says reuse the proven pattern — **there are two proven patterns, and the practice-plane one is the
closer comparator.**

---

## 2. §4 Retention classification

### `practice_access_log` — **Class A**, already correct
Practice-scoped, cascade FK, allows the authorized parent cascade, refuses direct DELETE. **No action.**
It is the working example the other two would be modelled on.

### `practice_audit_event` — **Class B**, and it does not block anything
No foreign key to any parent, so a workspace cascade never reaches it. It neither blocks deletion nor is
removed by it: **82,111 rows, and every workspace ever deleted has left its trail behind.** Pruning six
harness workspaces today added roughly 195 more.

That is defensible for an audit trail and may be exactly the governed retention §4 Class B describes —
but it means *"delete my practice"* will not be complete even after 351. **Requires an explicit retention
decision, not a code change.**

### `practice_invoice_item` — **Class D. STOP.**
The guard is **not** an unconditional refusal:

```
if (select status from practice_invoice where id = …) <> 'DRAFT' then
  raise exception 'the line items of an issued invoice are frozen';
end if;
if tg_op = 'DELETE' then return old; end if;
```

It permits DELETE freely while the invoice is a draft, and refuses once the invoice is **issued**. So a
workspace cascade succeeds for a practice that never issued an invoice and aborts for one that did.

**The question is not technical.** Deleting a practice would destroy issued financial records.
Whether that is permitted turns on statutory financial retention in the operating jurisdiction, which
§13 reserves for approved legal/privacy interpretation. **Escalated.**

### `practice_lifecycle_transition` — **Class D. STOP.**
`NO ACTION` here is **deliberate and documented**. Migration 247's own header:

> *"workspace_id has NO on-delete clause. NO ACTION refuses a direct workspace delete while transitions
> exist — deliberately, because it is another brake — while still permitting a full cascade if one is ever
> built to run in the right order."*

Two readings, and they lead to different migrations:

1. **The brake should stay.** A governed deletion service removes transitions explicitly, in order, before
   the workspace. Then the FK stays `NO ACTION` and only the *trigger* needs an allowance — but an
   allowance keyed to a cascade would never fire, so it would need to recognise the governed service
   instead.
2. **The brake was provisional.** "A full cascade if one is ever built" is that cascade; the FK becomes
   `CASCADE` and the trigger takes the canonical allowance.

§2 forbids inventing a Practice-only mechanism, and §4 forbids guessing. **The author left a stated
intent that does not resolve to one migration. Escalated.**

---

## 3. What is NOT yet measured

Named rather than implied, because §3 asks for demonstrated behaviour and this is static analysis:

- **Direct and cascade DELETE are not demonstrated.** §3 requires it; §11 forbids doing it against
  production. It belongs in the staging fixture (§9), which does not exist yet.
- **`practice_charge`** sits between invoice items and the workspace via `ON DELETE RESTRICT`. It is not
  in this table because no trigger on it fires on DELETE, but a RESTRICT FK can abort a cascade on its
  own. **The full FK topology under `practice_workspace` has not been walked.**
- **§8 non-database resources** — storage, booking handles, QR routes, integrations — untouched.

---

## 4. Recommendation

**Do not write migration 351 yet.** One of the two blockers is a documented deliberate brake and the
other is a financial-retention question. Both are §4 Class D by the spec's own test.

What unblocks it, in order:

1. **Decide `practice_invoice_item`** — may a practice deletion destroy issued invoice line items, or are
   they independently retained? This is the legal question, and §13 reserves it.
2. **Decide `practice_lifecycle_transition`** — is the brake permanent (governed ordered deletion) or
   provisional (cascade)? The author of 247 is the right person to answer.
3. **Walk the full FK topology** under `practice_workspace` for `RESTRICT`/`NO ACTION` edges — a
   migration that fixes two triggers and then aborts on `practice_charge` is worse than none.
4. **Then** 351, scoped to whatever (1) and (2) authorise, with the staging fixture from §9 proving it.

The engineering statement §13 asks for is accurate as written and unchanged by the re-measurement:

> *The current schema prevents execution of the intended Practice deletion lifecycle. This is a
> privacy/deletion-capability defect and must be corrected before Competen claims the Practice deletion
> obligation is operationally supported.*
