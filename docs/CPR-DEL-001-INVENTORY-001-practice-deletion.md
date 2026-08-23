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

---

# Addendum — §3 FK topology under `practice_workspace`

**Measured:** 2026-08-23, staging catalog, read-only (`scripts/cpr-del-001-topology.mjs`)

## The shape of a practice deletion

A delete of one `practice_workspace` row would **cascade into 183 tables**. 133 further edges are
`SET NULL` — those rows survive with a nulled reference, which is a deliberate design and not a blocker.

**Eight distinct blockers abort it.** Not thirty-seven, and the difference is the point.

## Why the raw count is wrong, and what corrects it

A first pass counted every `RESTRICT` and `NO ACTION` edge and reported **37**. That overstates it about
fourfold, because the two actions do not behave alike:

- **`NO ACTION`** is checked at the **end of the statement**. If the referencing row is *also* removed by
  the same cascade, nothing is left pointing anywhere and the constraint passes. Most of these edges are
  between two tables the cascade deletes together — `practice_parameter_measurement` →
  `practice_parameter_definition`, `practice_form_answer` → `practice_form_field`, and so on. **Benign.**
- **`RESTRICT`** does not wait. It refuses the parent delete while any referencing row exists at that
  instant, *even one the cascade is about to remove*.

So a `NO ACTION` edge blocks only when its child is **unreachable** from the cascade — which cannot be
known until the whole graph is walked. That reachability pass is what takes 37 to 8.

## The eight

| # | Table | Blocker | Reading |
|---|---|---|---|
| 1 | `practice_lifecycle_transition` | `NO ACTION` on `workspace_id` | table unreachable by cascade — **the brake from §247** |
| 2 | `practice_lifecycle_transition` | `NO ACTION` on `actor_membership_id` | same table, second edge |
| 3 | `practice_patient_identifier` | `RESTRICT` → `practice_facility` | reference-data protection |
| 4 | `practice_encounter_identifier` | `RESTRICT` → `practice_facility` | reference-data protection |
| 5 | `practice_patient_pathway_stage` | `RESTRICT` → `practice_pathway_stage` | reference-data protection |
| 6 | `practice_patient_pathway` | `RESTRICT` → `practice_pathway_template` | reference-data protection |
| 7 | `practice_invoice_item` | `RESTRICT` → `practice_charge` | financial evidence |
| 8 | `practice_invoice_item` | `practice_invoice_item_frozen_guard` | refuses once the invoice leaves DRAFT |

## What this changes about the recommendation

**Five of the eight are `RESTRICT` edges onto reference data the cascade is itself deleting** — facility,
pathway stage, pathway template, charge. That is not an accident and not a defect. `RESTRICT` is how this
schema protects a config row from vanishing while something still points at it.

A pure database cascade **cannot** satisfy them, in any ordering, because `RESTRICT` refuses before the
cascade gets to the child. They can only be satisfied by deleting in a **deliberate order**: identifiers
before facilities, patient pathways before templates, invoice items before charges.

Which is exactly what migration 247 anticipated when it kept its brake:

> *"…while still permitting a full cascade if one is ever built to run in the right order."*

**So the schema already assumes an ordered deletion service rather than a single `DELETE`.** That tilts
the §4 Class D question on `practice_lifecycle_transition` toward reading (1) — the brake stays, and a
governed service removes children in order — because reading (2) (make the FK `CASCADE`) would still
leave five `RESTRICT` edges that no cascade can pass.

This is a finding, not an authorisation. It narrows the decision; it does not make it.

## Consequence for migration 351

**A trigger-only migration cannot deliver practice deletion.** Relaxing
`practice_invoice_item_frozen_guard` and `practice_lifecycle_transition_immutable` would leave five
`RESTRICT` edges intact and the delete would still abort — with the added risk of *looking* fixed.

What the evidence now supports:

1. §6's **authorized deletion path is the deliverable**, not the migration. It must delete in dependency
   order, and the topology above is its order of operations.
2. Migration 351 shrinks to whatever that service genuinely cannot do for itself — on current evidence,
   the two immutability triggers, and only where §4 authorises them.
3. The §10 ratchet should assert **this walk**, not a trigger inventory: *no `RESTRICT` or unreachable
   `NO ACTION` edge under `practice_workspace` without a documented exception.*

Still unmeasured, and still required by §3: **direct and cascade DELETE are not demonstrated.** Everything
above is static analysis of the catalog. The §9 staging fixture is what would prove it.

---

# Addendum 2 — §9 staging fixture: the blocker is a DEADLOCK, not an ordering problem

**Ran:** 2026-08-23, staging project `ezhvpgtcqcdsgylrxgdb`, confirmed by project ref
(`scripts/cpr-del-001-fixture.mjs`). This is the first **demonstrated** result in this document;
everything before it was static analysis.

## What was observed

A synthetic practice with one lifecycle transition and one facility. Deleting the workspace:

```
1. blocked by FK practice_lifecycle_transition_workspace_id_fkey
   and its own delete is refused:
   "practice_lifecycle_transition is append only. DELETE refused on transition …"
```

**Both directions are closed.** The workspace cannot be deleted while transitions exist, and the
transitions cannot be deleted at all. No ordering resolves it, because there is no order in which the
child may go first.

## This resolves the §4 Class D question on `practice_lifecycle_transition`

The static analysis offered two readings of migration 247's brake. The fixture eliminates one:

> **Reading (1) — "the brake stays, and a governed service deletes transitions in order" — is not
> implementable.** The service would have to issue a direct `DELETE`, and the trigger refuses direct
> `DELETE` unconditionally. Ordering cannot help; the door is locked from both sides.

So any workable correction **must change the trigger**, whichever way the FK is decided. That was not
knowable from reading the schema, and it narrows §4 from an open question to a bounded one:

| Option | Requires | Note |
|---|---|---|
| FK → `CASCADE` + canonical trigger allowance | migration | matches the `practice_access_log` comparator already in this plane |
| FK stays `NO ACTION` + trigger recognises a governed service | migration | §2 discourages inventing a Practice-only mechanism |

Both need a migration. The choice is which, not whether.

## A finding about the fixture itself

**Its first run stranded its own workspace in staging** — the FK refused the parent, the trigger refused
the child, and ordinary cleanup had no move. That is the defect reproducing *on the test*, and it is
worth recording because a fixture that litters when it finds the bug is one people stop running.

The cleanup now disables the immutability trigger as a last resort, removes only its own rows, re-enables
it, and **verifies the trigger is back on** rather than assuming. Legitimate only because the guard at the
top has already proved this is staging by project ref — the same three lines against production would be
tampering with an audit trail.

Verified after the run: **0 fixture workspaces left, 11 of 11 immutability triggers enabled.**

## Safety guard worth reusing

The project check compares the **connection string's username**, not its host. A Supabase pooler
connection is `aws-1-eu-west-1.pooler.supabase.com` for *every* project — comparing hosts would have
compared two identical pooler addresses and passed against production. The project ref lives in the
username (`postgres.<ref>`).

## Still not demonstrated

- The five `RESTRICT` edges (facility, pathway stage, pathway template, charge) — the run stopped at the
  first blocker, so they remain predicted rather than observed. They need a fixture that seeds patients,
  identifiers, pathways and charges, which is the fuller §9 fixture.
- §9's other PASS conditions: cross-practice isolation, unauthorized delete refused, Class B retention,
  non-DB cleanup, shared identity safety.

---

# Addendum 3 — the fuller fixture disproves the topology prediction

**Ran:** 2026-08-23, staging `ezhvpgtcqcdsgylrxgdb`, full graph
(`scripts/cpr-del-001-fixture.mjs`, three variants, three repeats of the default).

## What was seeded

Facility · patient · encounter · patient identifier · encounter identifier · pathway template ·
pathway stage · patient pathway · patient pathway stage · charge · invoice · invoice item —
i.e. **both ends of every predicted `RESTRICT` edge**, plus the conditional trigger's table.

## The result

| Variant | Outcome |
|---|---|
| Full graph | **DELETE SUCCEEDED** (3 of 3 repeats) |
| Full graph + `--issued` invoice | **DELETE SUCCEEDED** |
| Full graph + `--deadlock` | blocked by `practice_lifecycle_transition` |

**Eight predicted blockers. One real one.**

## Why the five `RESTRICT` edges did not block

`RESTRICT` refuses the deletion of a *referenced* row while a referencing row exists. Under a cascade
both ends are children of the same workspace, and Postgres removes the referencing rows first — so by the
time it reaches the facility, pathway template or charge, nothing points at them and `RESTRICT` has
nothing to refuse.

**My Addendum 2 conclusion was wrong.** It said *"a pure database cascade cannot satisfy them, in any
ordering"* and inferred that the schema requires an ordered deletion service. It does not. The cascade
orders itself correctly, and it was demonstrated three times.

## Why the issued-invoice guard did not block either

`practice_invoice_item_frozen_guard` reads:

```
if coalesce((select status from practice_invoice where id = …), 'DRAFT') <> 'DRAFT' then
  raise exception 'the line items of an issued invoice are frozen';
```

Under a cascade the parent invoice is already deleted when the line's own trigger fires, so the subquery
returns `NULL`, the `coalesce` yields `'DRAFT'`, and the guard permits the delete. **It is cascade-safe by
accident** — the default was written for a missing invoice, not for a deletion, and happens to be right.

That is worth stating plainly: it works, but nothing records *why*, and a later author tightening that
`coalesce` would reintroduce the blocker without touching anything that looks related.

## What this does to §4

**`practice_invoice_item` — Class D withdrawn.** It is not a blocker. There is no financial-retention
decision to make *for the purposes of this spec*, because practice deletion never asks it to refuse. (The
separate question of whether issued invoices *should* survive a practice deletion remains a governance
matter — but it is not what is stopping deletion today.)

**`practice_lifecycle_transition` — the only remaining Class D**, and the only blocker.

## What this does to migration 351

It shrinks to **one table**. The needed change is the canonical cascade-safe pattern on
`practice_lifecycle_transition` — the comparator being `practice_access_log_immutable`, already in this
plane — plus whatever the FK decision requires.

Nine tables I would have touched on the topology evidence turn out to need nothing.

## Two lessons recorded rather than smoothed over

1. **Static FK analysis predicted eight blockers; the database has one.** The topology walk was still
   worth doing — it produced the candidate set — but it could not model cascade *ordering*, and ordering
   was the whole answer. §3's insistence on demonstrated behaviour is not ceremony.
2. **The fixture masked its own findings on the first run.** `practice_lifecycle_transition` aborts before
   the cascade reaches anything else, so seeding it by default made the other blockers unobservable and
   the fixture reported "one blocker" while proving nothing about the rest. It is now opt-in via
   `--deadlock`, and the default run exercises the chain the deadlock would hide.

## Still not demonstrated

§9's remaining PASS conditions: cross-practice isolation, unauthorized delete refused, Class B retention
behaviour, non-database cleanup (§8), shared identity safety. None of these are schema questions — they
need the §6 deletion service, which does not exist yet.
