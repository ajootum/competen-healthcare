# ADR-001 — Product Separation

**Status:** Accepted
**Spec:** `docs/COMP-ARCH-PSA-001-product-separation.md`
**Enforced by:** migrations 279, 280; `profiles.role` (nullable); `platform_membership`

## Context

Competen is not one product with modes. It is a foundation (Competen Platform) underneath several
distinct SaaS lines — at minimum Practice, Enterprise, Individual and Recruitment — each with its own
governance, tenancy, and commercial model. Early in the codebase's history, product identity was
partially inferred from `profiles.role`, a single column shared across every line. That made "which
product is this person in" ambiguous the moment a person could plausibly belong to more than one.

## Decision

**Platform and Practice are separate products, gated explicitly, not inferred.** `platform_membership`
is the explicit gate for platform-side access. `profiles.role` is nullable, and Practice-side code must
never read it to decide product identity or authorization — Practice has its own membership and
capability model, independent of whatever `profiles.role` historically meant for other lines.

Each product line composes against the shared platform foundation but does not read another line's
tenancy, membership, or commercial state to make its own decisions.

## Consequences

- Adding a feature that needs to know "which product am I in" must use the explicit gate for that
  product, not `profiles.role`.
- A query or a page that spans two product lines is a deliberate cross-product surface (like the
  landlord/HQ plane — see ADR-003) and must say so, not an accident of a shared table.
- `profiles.role` remaining nullable is load-bearing: a migration that makes it `NOT NULL` or that
  Practice code starts depending on would silently reintroduce the ambiguity this decision closed.

## Do not

Do not use `profiles.role` to gate Practice-side behavior. Do not assume a person's product membership
without checking the explicit gate for the product in question.
