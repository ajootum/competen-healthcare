# ENT-DEC-001 — Decisions taken before building Competen Enterprise

Settled 2026-08-11, after surveying eighteen ENT-* specifications against the repository.
**Five were the owner's; the rest were taken under the standing rule "on conflict, take the safer branch".**

**All twelve are now decided.** D10 was the last one open and was settled by the owner on 2026-08-12:
_"new enterprise surfaces fail closed, estate unchanged for now."_

This document exists so none of it is re-derived. Where a decision forecloses something the specs ask
for, that is stated rather than left to be discovered.

---

## ⚠ The finding that shaped every decision below

**There is no tenant-facing Enterprise product today, and the tenancy model cannot express one.**

`getCaller()` returns `{ hospitalId, organisationId }` — **there is no `tenantId`**. Throughout the estate
plane, "tenant" means "one hospital". `074-rls-tenant-lockdown.sql` states the doctrine: scoping is
`.eq("hospital_id", hid)` in code. A multi-facility Enterprise tenant with facility-scoped and
unit-scoped administrators — which every one of the eight sub-product specs requires in its slice 0 — is
**not expressible**.

Three unrelated things in the repo currently look like "Enterprise" and are not:

1. `plat_product_line` has an `enterprise` row — a governance taxonomy entry, no surface.
2. `/super-admin/enterprise/**` is called "Enterprise Administration (ENT-001)" and is a **landlord**
   surface: every route is `if (!isSuper(c)) return forbidden()`, loaders read globally with no tenant
   predicate. It is not the tenant-facing product.
3. The estate role workspaces (`educator`, `assessor`, `unit-manager`, …) are the real tenant-facing
   surfaces and are **hospital-scoped, not tenant-scoped**.

---

## D1 — `tenantId` reaches the caller through `getCaller()`

**Decision:** add `tenantId` to `getCaller()`, resolved from the same membership read that already
produces `hospitalId`. Not a second context object.

**Why:** a parallel resolver is a second place for the answer to be wrong, and this repository has
already paid for that — the `getCaller()` estate-gate regression 403'd 115 of 125 Practice API routes
while every page still rendered, because pages resolve through a different path from routes.

---

## D2 — A new Enterprise person master, with an optional link to the account ⭐ OWNER'S DECISION

**Decision:** `ent_workforce_person` is a new Enterprise-plane table with a **nullable** pointer to
`profiles`. Nothing existing is repointed.

**The problem it solves.** WF-001 AC-02: *"A workforce person can exist without a Competen login
account."* In this repo every person **is** `profiles`, which **is** `auth.users` — and
`250-close-profile-insert-door.sql` records "47 auth users, 47 profiles rows, zero auth" as the
invariant it protects. There is no record for a person with no login.

**Why not the full split.** ENT-DATA-001 asks for one canonical Person across all product lines. That
means rewriting the table **377 foreign keys** point at, across 141 migration files, immediately after
migrations 279/280 stabilised its `role` column, by hand, with no rollback.

⚠ **WHAT THIS FORECLOSES, STATED PLAINLY.** ENT-DATA-001 AC-01's "one canonical record for each Person"
becomes true **only within the Enterprise plane**. Two person masters coexist:

| | Master | Used by |
|---|---|---|
| Account-bound | `profiles` (= `auth.users`) | estate workspaces, Practice |
| Enterprise | `ent_workforce_person` | the eight Enterprise sub-products |

The link between them must be kept honest by whatever creates both. **This is a real cost and it was
accepted deliberately** — the alternative was the single riskiest migration available in this codebase.

⚠ **A related trap recorded here so nobody tries it:** `practice_practitioner_identity` must **not** be
repointed at `ent_workforce_person`. It is keyed on `user_id` and deliberately not workspace-scoped so a
practitioner's permanent number survives closing a practice (migrations 218/219). Absorbing it would
breach the plane boundary and re-create the gate-2→gate-1 leak migration 279 closed.

⚠ **Also note the schema is profession-bound.** `nurse_id` is the column name across roughly ten tables.
Workforce is explicitly profession-neutral. New Enterprise tables use `person_id`.

---

## D3 — The eight sub-products are a dimension of the `enterprise` line ⭐ OWNER'S DECISION

**Decision:** a new `plat_enterprise_subproduct` table (WF, ASMT, COMP, LRN, MC, QLT, SIM, INT), plus a
**nullable** `subproduct_code` on `hq_position` and `ogs_office_appointments`.

**The problem it solves.** ENT-GOV-001 §2 requires eight Product Owner appointments. An appointment
binds to a product line by foreign key (migration 281):

```
alter table hq_position add constraint hq_position_product_line_fk
  foreign key (product_line_code) references plat_product_line(code);
```

There is no `workforce` row in `plat_product_line`. **A "Workforce Product Owner" appointment is
literally unwritable today.**

**Why not add them as product lines.** `src/lib/governance/product-lines.ts` documents having already
migrated exactly this mistake once: *"ROLES AND WORKSPACES ARE NOT PRODUCTS"*, and *"THIS IS NOT
plat_products, AND THE DIFFERENCE IS THE WHOLE POINT OF THE SPEC"*. The five lines are frozen and a
two-way harness asserts code and database agree.

**Why not `plat_products`.** That catalogue holds `competency, mclip, lms, simulation, passport, coe,
pce, practice`. The intersection with the eight is **two names**, and both mean something adjacent but
not identical. Workforce, Assessment, Quality and Intelligence do not exist there at all.

```
plat_product_line (5, FROZEN)
  platform | enterprise | individual | practice | recruitment
                 |
                 v
plat_enterprise_subproduct (8, NEW)
  WF | ASMT | COMP | LRN | MC | QLT | SIM | INT
```

---

## D4 — A third membership gate: `enterprise_membership` ⭐ OWNER'S DECISION

**Decision:** hospital tenants get their own gate, mirroring the two that exist.

```
platform_membership   -> Competen staff (HQ / super-admin)
practice_membership   -> practitioners (/practice)
enterprise_membership -> hospital tenants (NEW)
```

**The problem it solves.** Today `hospital_admin` reaches `/organisation-admin` through the estate role
gate — so **every hospital administrator is a Competen Platform member**. Against ENT-GOV-001 §7
(*"Cannot: Access Competen HQ governance"*) and ENT-ADM-001 §1 (*"does not create a customer superadmin
equivalent to Competen HQ"*), that is the exact collapse `COMP-ARCH-PSA-001` was written to prevent.

**Why structural rather than by capability.** A gate makes the boundary a fact about membership; a
capability check makes it "we got all 205 pages and 438 routes right". The `getCaller` regression is what
a structural boundary makes impossible.

⚠ **Consequence:** `requireEnterpriseContext` must be taught to `scripts/hq-scan.ts` **in the same
commit as the guard**. `src/lib/access/hq-scan.ts` records this being forgotten **four times**; the
generated matrix publishes unknown-guard pages as `kind: "none"` — "reachable without signing in".

---

## D5 — First slice: shell + tenant scope + one working Workforce screen ⭐ OWNER'S DECISION

**Decision:** roughly 4–6 weeks, ending in something walkable.

1. `tenantId` on `getCaller` (D1)
2. `enterprise_membership` + `requireEnterpriseContext` + the `hq-scan` entry (D4)
3. `plat_enterprise_subproduct` + entitlement gating (D3)
4. Navigation composed from registry ∩ entitlement ∩ permission
5. **One** Workforce screen, reading real people, read-only

**Why not the specs' own full-foundation order.** ENT-001 shell + the ENT-OPS import framework before any
screen is 8–12 weeks with nothing walkable, and the import framework alone is the largest greenfield item
in the survey (1,200–1,800 lines). Every defect the owner has found in this product was found **by
looking at a screen** — a foundation nobody has used is a foundation nobody has tested.

**Why Workforce.** ENT-WF-001 is headed *"First Saleable Enterprise Sub-product"*, nothing is upstream of
it, and seven other specs say "use Workforce canonical context when active". The repo agrees: it has the
most transferable material (`organisations→hospitals→departments→units`, `positions`,
effective-dated `workforce_assignments`, `employment_records`, `professional_credentials`).

---

## D6 — ENT-OPS-001 owns the tenant runtime; ENT-PROV-001 owns the implementation project

The two documents are **complementary, not duplicates** — each has large sections the other lacks. But
they contradict on three points, and each is a schema decision:

| | ENT-PROV-001 | ENT-OPS-001 |
|---|---|---|
| The onboarding case | the **parent**, exists before the tenant | created at **step 8 of 10**, after entitlements |
| Admin vs organisation | admin **before** organisation | organisation (step 3) **before** admin (step 7) |
| State machine | DRAFT … **READY_FOR_GO_LIVE** … LIVE | PROSPECT … **READY_FOR_GO_LIVE** … ACTIVE |

⚠ **Both state machines contain `READY_FOR_GO_LIVE` and no mapping is given in either document.** Two
columns that can both read the same value and disagree is precisely the reconciliation defect
ENT-OPS-001 §24 asks us to detect.

**Decision:** OPS owns the runtime (states, offboarding, reconciliation, support access); PROV owns the
project (case, readiness, go-live, backfill). **The mapping table is written before any migration.**
`onboarding_case.tenant_id` is therefore NOT NULL at insert (OPS's causality).

---

## D7 — Entitlement states: ENT-OPS §8, plus `grace`

Three vocabularies compete:

| ENT-OPS §8 | ENT-COMM §8 | Live `practice_entitlement` CHECK |
|---|---|---|
| PENDING, TRIAL, ACTIVE, SUSPENDED, EXPIRED, CANCELLED, RETIRED | PENDING, ACTIVE, TRIAL, **GRACE**, SUSPENDED, EXPIRED, TERMINATED | active, trial, expired, suspended, cancelled |

A CHECK constraint admits one list. **Decision:** ENT-OPS §8 extended with `grace`. Adding `grace` is one
constraint change, already costed in `docs/PCS-BILLING-SURVEY-001.md`.

---

## D8 — The `ENT-001` collision

**There are two documents numbered ENT-001**, and the collision is already live in code:
`src/app/super-admin/enterprise/page.tsx:11` cites `ENT-001` meaning the **org-hierarchy** spec — which
is **already built**. Anyone grepping `ENT-001` lands there and concludes the controlling architecture
exists. It does not.

**Decision:** fix the code citation to `ENT-ORG-001`. **Recommended to the owner:** renumber the
document. This is the `COMP-SEC-001` problem — cheap now, expensive once cited in migrations.

⚠ Note also `docs/ENT-REVIEW-001-three-enterprise-specs.md` already uses the `ENT-` prefix for
**unrelated** specs (PIS-000, CPR-PRM-001, IAM-000). Do not overwrite it.

⚠ And a **name** collision: `/super-admin/enterprise` is *already called* "Enterprise Administration"
and is HQ-internal. ENT-ADM-001's workspace has the same name and is customer-facing. Both must exist;
one must be renamed before either ships.

---

## D9 — No new catalogue

Four product-ish catalogues already exist (`plat_product_line`, `plat_products`, `plat_workspaces`,
`practice_plans`), and `docs/PCS-BILLING-SURVEY-001.md` **D9 — which one is the catalogue — is still
open**. ENT-COMM-001 would make it a fifth.

**Decision:** the eight sub-products are a dimension of the `enterprise` line (D3) and **do not** become
a catalogue. ⚠ `plat_plans` already has a plan coded `'enterprise'` while `plat_product_line` has a
product line coded `'enterprise'` — same string, two meanings, exactly the bug class migration 281's
header warns about. Do not add a third.

---

## D10 — Fail-open versus fail-closed ⭐ OWNER'S DECISION

**DECIDED 2026-08-12, in the owner's words: _"new enterprise surfaces fail closed, estate unchanged
for now."_**

So the asymmetry is deliberate and recorded, not drift:

| Plane | On an unreadable entitlement/membership read | Where |
|---|---|---|
| **Enterprise (gate 3)** | **REFUSES** | `enterprise-membership.ts` — `unreadable` returns `admitted: false` |
| Platform (gate 1) | admits | `platform-membership.ts`, argued at length there |
| Estate orchestration | admits | `orchestration/licensing.ts`, explicitly fail-open |

**Already true in code, and asserted.** `enterprise-membership-harness.ts` proves gate 3 refuses on an
unreadable store **beside a control proving gate 1 admits on the same store**, so the asymmetry is
demonstrated rather than claimed. Nothing had to change to honour this decision — it ratifies what the
walkable slice was built with.

**What the decision forbids going forward:** an Enterprise surface must not be gated on anything that
resolves through the estate's fail-open path. `canEnterWorkspace()` is the trap — it reads
`ent.workspaces`, which is built fail-open, and it has no call sites outside its own file. It now
carries that warning in place (`src/lib/orchestration/entitlements.ts`) rather than being deleted,
because deleting it would quietly drop the §10 re-authorisation obligation it states.

**The estate keeps failing open** until that is changed as its own announced decision, with its own
timing — flipping it would start refusing anyone currently admitted by a failed read, with no warning.

---

### The original open question, kept for the record

`src/lib/orchestration/licensing.ts` is **deliberately fail-open** and says so: *"unmapped workspaces, an
unknown tenant, or an unprovisioned store all resolve to available"*. `src/lib/platform-membership.ts`
admits on `unreadable` and argues the asymmetry at length.

ENT-OPS-001 **OP-08** requires the opposite: *"Tenant lifecycle operations MUST fail closed where
entitlement or authorization cannot be established."* ENT-001 §23 agrees.

⚠ **Flipping it changes behaviour for existing users** — anyone currently admitted by a failed read
starts being refused. Note also that `canEnterWorkspace` has **zero call sites outside its own file**, so
today the gate protects nothing either way; reconcile or delete it before adding a fourth engine beside
it.

**Recommendation (ADOPTED):** new Enterprise surfaces are fail-closed from the start; the existing estate behaviour
is changed only as a separate, announced decision.

---

## D11 — `/organisation-admin`'s hard-coded roles are rewritten, after D4

`src/app/organisation-admin/layout.tsx:27`:

```ts
const ALLOWED = ["hospital_admin", "super_admin"];
```

restated inline at `page.tsx:34`. ENT-GOV-001 §23 forbids this **by name**: *"No permanent hard-coded
hospital administrator in application logic."* Eleven pages.

**Decision:** rewrite to capability + entitlement gating — **after D4**, since the gate decides what
replaces it. ENT-NAV-001 §8 prefers a controlled redirect over a duplicate implementation, so
`/organisation-admin` migrates into the new surface rather than being cloned.

---

## D12 — Any new guard reaches `hq-scan.ts` in the same commit

Non-negotiable, and it is not a style preference: `src/lib/access/hq-scan.ts` records this being
forgotten **four times**, and the consequence each time was the generated access matrix publishing gated
pages as `kind: "none"` — read by a human as "reachable without signing in".

---

## What is already built — do not rebuild it

| Thing | State | Where |
|---|---|---|
| **Configuration inheritance** | ⚠ **Essentially DONE** | migrations 076, 092, 093 (whose scope check *already admits* `'enterprise'`), 16 modules in `src/lib/config/` |
| Activation engine (activation ≠ permission) | Built one product over | migration 278, `src/lib/practice/capability-registry.ts` |
| Composable command centre | Built one product over | migration 281, `src/lib/hq/mission-profile.ts` |
| Org hierarchy + people/facility admin | Built (landlord plane) | `052-enterprise-administration.sql`, `src/lib/enterprise/*` |
| Provisioning saga (idempotent, resumable, ledgered) | Engine reusable, steps are not | `src/lib/practice/provisioning.ts` |
| Entitlement store | Right shape, wrong grain | `tenant_product_licenses` (105/106) |

⚠ `provisioning_step.step_code` carries a CHECK constraint of eight practice-specific codes
(migration 191). The seeding upsert **discards its error**, so a wrong code records nothing and still
reports success. Any shared Enterprise ledger must widen the constraint or get its own table.

---

## Deferred, with reasons

- **ENT-REL-001 REL-0…REL-3.** They presuppose a migration ledger. `grep` for
  `schema_migrations|migration_ledger|applied_migrations` returns **nothing**, and the runner splits
  statements on semicolons — which is why deployed `language sql` functions all have single-statement
  bodies. These slices are a **replacement of the deployment substrate**, not application features.
  Costed and scheduled separately.
- **ENT-DATA-001 effective dating (AC-12).** Additive and cheap, but no history exists to backfill, so it
  can only ever be true **from the day it ships**. Saying otherwise would be a claim about data that does
  not exist.
- **ENT-OPS import framework.** Deliberately after the first walkable slice — see D5.

---

## Scale, for planning

**24–36 developer-months. 120–190k new lines. 95–130 migrations.** For calibration, Competen Practice —
one comparable tenant-facing product line in this repo — is ~143k lines. This is a second Practice.

The lever on that number is **scope per slice**, not parallelism: the eight sub-products share a shell
and a person model, and building them concurrently would fork that model eight ways.
