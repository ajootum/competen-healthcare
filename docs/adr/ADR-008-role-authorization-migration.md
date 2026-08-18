# ADR-008: Role names are not authorization primitives (PLAT-GOV-001 §14)

**Status:** Accepted — owner ruling, 2026-08-19.

## Context

PLAT-GOV-001 §14 states that *"hard-coded role-name checks are prohibited for authorization
decisions."* The question left open until now was how to read it, because the readings differ by two
orders of magnitude in scope, and because §14 collides with a decision this repo has already frozen.

**The collision.** `CLAUDE.md` records, as frozen architecture, that `profiles.role` is nullable and
that Practice must never read it (the two-gate split, `docs/COMP-ARCH-PSA-001-product-separation.md`,
migrations 279+280). Yet the estate plane's entire authorization model resolves through
`getCaller()` (`src/lib/api-auth.ts`), which reads exactly that column:

```ts
const { data: me } = await admin.from("profiles").select("role, roles, hospital_id, organisation_id, tenant_id")...
const roles = estateRolesOf(me) as string[];
```

Every legacy check is ultimately `c.roles.some(r => roles.includes(r))` — a string comparison against a
column the product-separation decision has already declared non-authoritative. Both facts are live in
the repository simultaneously.

**Measured baseline, 2026-08-19** (by `scripts/role-authorization-ratchet-harness.ts`, counting
in-process so CI and a developer machine agree):

| Metric | Count |
|---|---|
| Legacy helper call sites (`isSuper`/`isStaff`/`isEducator`/`isSupervisor`/`isAdmin`/`hasRole`/`requireRole`) | **653** across 203 files |
| Role-name literal comparisons (`x.role === "…"`, `x.roles.includes("…")`) | **114** |
| API `route.ts` files gated on a role | **220** |
| API `route.ts` files gated on a **capability** | **2** |

⚠ **Three of those numbers correct an earlier report, and the corrections matter.**

- The capability-gated count was first reported as **7**. Five of those seven are the helper *names
  appearing inside explanatory comments* (`"requireHqCapability: this is a fetch"`), not calls. Only
  `register-and-book` and `security` actually call one, and both use *Practice's* `hasCapability`, not
  an estate-plane grant. **The estate plane has no capability enforcement whatsoever today**, which
  makes phase 1 below greenfield rather than an extension of something existing.
- The role-gated route count was first reported as **127**; that pattern omitted `isSuper`, `isStaff`,
  `isEducator`, `isSupervisor` and `isAdmin`. The real figure is **220**.
- An earlier "~217 role-gated API routes" from an older note was wrong in both directions: too high on
  routes, far too low on total blast radius.

## Decision

**§14 is interpreted architecturally: role names are not authoritative authorization primitives.**
A controlled capability migration — neither a big-bang rewrite of 653 call sites, nor indefinite
grandfathering.

**Effective immediately:**

- No new raw `.role` / `.roles` authorization checks.
- A harness/ratchet prevents the raw-role surface from increasing
  (`scripts/role-authorization-ratchet-harness.ts`, in the CI `harnesses` job).
- No new authorization design may be based on role-name literals.
- New routes and features must use capabilities.

**The existing centralised helpers are temporarily grandfathered as compatibility adapters only.**
They are explicitly *not* the target architecture, and their existence is not an endorsement.

**Sequence — the burn-down is governed, not opportunistic:**

1. **Define and implement the estate-plane capability/grant model**, including migration and backfill
   semantics for existing users. ⚠ This repo has a recorded failure mode here: a capability catalogue
   insert *without* a backfill locks every existing tenant out while all harnesses stay green (it has
   happened twice — migrations 192, then 303/305, healed by 307). The backfill is part of the design,
   not a follow-up.
2. **Repoint the centralised helpers at capabilities** rather than `profiles.role`, wherever that is
   technically safe. This collapses most of the blast radius without touching 653 call sites.
3. **Migrate call sites to explicit capability checks** through a governed burn-down, lowering the
   ratchet's ceilings as each tranche lands.

**Standing constraints:**

- `profiles.role` remains non-authoritative, and Practice must continue never to read it.
- `super_admin` remains the break-glass identity classification, **but ordinary authorization must not
  depend on a `super_admin` string comparison.** Break-glass elevation is to be designed as a
  separately audited privileged-capability path — not as the 355 `isSuper()` calls that exist today.
- The migration must have a defined path to **zero**, not merely a promise not to get worse.

## Consequences

- CI blocks any increase in the legacy counts from the day this lands. A ceiling is never raised to
  make a build pass; that is the one thing the ratchet exists to prevent.
- The ratchet counts *shapes characteristic of* role authorization, not authorization itself — a grep
  cannot distinguish `if (x.role === "admin")` from `<td>{member.role}</td>`. It deliberately ignores
  the 558 `.role` property reads in `src`, the overwhelming majority of which render a role rather than
  decide with one. A falling number is progress; it is not a proof of correctness.
- Until phase 2 lands, the estate plane keeps authorising against a column the product-separation
  decision calls non-authoritative. That is a known, accepted, time-boxed inconsistency — recorded here
  so it cannot quietly become permanent.
- Phase 1 is a real design task with a schema, not a refactor. It is not started.

## Do not

- Do not raise a ceiling in the ratchet harness to make CI green.
- Do not add a capability catalogue entry without the backfill for existing tenants.
- Do not delete the compatibility adapters while callers remain — removing the definitions is the last
  step of phase 3, not a shortcut to a lower number.
- Do not treat `isSuper()` as satisfying this ADR because it is centralised. Centralisation was the
  reason the migration is affordable, not a reason it is unnecessary.
