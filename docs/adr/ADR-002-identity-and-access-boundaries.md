# ADR-002 — Identity & Access Boundaries

**Status:** Accepted
**Enforced by:** migrations 281, 282; `src/lib/hq/context.ts` (`resolveHqPositions`, `resolveHqContext`);
`src/lib/hq/spaces.ts` (`HQ_CAPABILITIES`, `decideHq`)

## Context

Competen HQ (the landlord/platform staff plane) needs to know, for any given staff member, what they may
see and do — across potentially several governance product lines, several possible appointments, and a
break-glass owner account that must never be locked out by a broken query.

## Decision

**Access is capability-based and resolved from live appointment data, never inferred from a role label.**

- `plat_product_line` is a distinct concept from `plat_products` — a product line is a governance
  grouping; a product is a sellable thing. Code must not conflate them.
- Authorization is decided by **exactly one active appointment at a time**. A person may hold several
  appointments; only the one currently selected as context decides what `decideHq()` will allow.
- The owner (`super_admin` / `platform_owner`) is resolved and short-circuited **before** any HQ table is
  read, so a broken `ogs_offices` row or a missing capability grant can never lock out the two owner
  accounts. This is deliberate break-glass design, not an oversight — see the comment block in
  `src/app/super-admin/layout.tsx` on `isOwner`.
- `hqCapabilities` for a genuine owner is `[]` (empty) — the resolution short-circuits before reading any
  capability table. Any code that infers ownership from a non-empty capability list is wrong; ownership
  is `isOwner`, passed separately.
- Capabilities are compared by **live value**, never by an app-clock timestamp against a DB-clock one — a
  documented recurring bug class (see git history on `access.ts`) where clock skew made a just-granted or
  just-expired capability answer incorrectly for a window around the boundary.

## Consequences

- A new HQ surface must call the existing resolver (`resolveHqContext` / `requireHqCapability`), not
  write its own appointment-lookup query. Two independent resolvers is how they drift and start
  disagreeing about who can do what.
- Rendering a piece of navigation or a page based on capability grants that a page's own guard doesn't
  also check is a bug: CPR-PD-001 §7's rule — *"a hidden navigation item does not constitute
  authorization"* — is enforced by requiring every page to call its own guard on arrival, not by trusting
  that nothing links to it.
- The capability catalogue in code (`HQ_CAPABILITIES`) must stay in sync with what's actually seeded in
  the database — a capability the database grants that the code has never heard of does not fail closed
  by being invisible to the code; it is read from the database directly by the resolver. Code-side
  catalogues that go stale become blind spots for tooling built against them, not runtime denials.

## Do not

Do not decide authorization from a role string. Do not build a second appointment/capability resolver for
a new surface. Do not let the owner short-circuit depend on a successful HQ table read.
