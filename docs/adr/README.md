# Architecture Decision Records

Created under COMP-ENG-001 §5 as the durable decision layer between the high-level product
documentation in `docs/` and day-to-day implementation. A developer specification says what to build; an
ADR says which settled architectural decision that build must not contradict.

## What belongs here

A decision that:
- has already been made and is in force in the running system (not a proposal),
- constrains future work across more than one feature or screen,
- would be expensive or risky to silently reverse.

A decision that only affects one screen or one migration belongs in that migration's own header comment
or that screen's own doctrine, not here.

## What does not belong here

Product feature specs (those live in `docs/` under their own spec ID), UI copy decisions, or anything
still under active debate. An ADR records what **is**, not what someone is proposing.

## Format

Each ADR is short: Status, Context, Decision, Consequences, and where in the codebase the decision is
actually enforced (a file, a migration, a harness) — an ADR that describes a rule nothing enforces is a
wish, not a record.

## Status meanings

- **Accepted** — in force, enforced somewhere checkable in this repo.
- **Superseded** — replaced by a later ADR; the old one stays for history and links to the new one.

## Index

| ADR | Title | Status |
|---|---|---|
| [ADR-001](./ADR-001-product-separation.md) | Product Separation | Accepted |
| [ADR-002](./ADR-002-identity-and-access-boundaries.md) | Identity & Access Boundaries | Accepted |
| [ADR-003](./ADR-003-tenant-isolation.md) | Tenant Isolation | Accepted |
| [ADR-004](./ADR-004-governance-freeze.md) | Governance Freeze | Accepted |
| [ADR-005](./ADR-005-hfe-design-language.md) | HFE Design Language | Accepted |
| [ADR-006](./ADR-006-database-and-rls-governance.md) | Database & RLS Governance | Accepted |
| [ADR-007](./ADR-007-specification-traceability.md) | Specification Traceability | Accepted |
| [ADR-008](./ADR-008-role-authorization-migration.md) | Role names are not authorization primitives (PLAT-GOV-001 §14) | Accepted |
| [ADR-009](./ADR-009-recovery-objectives.md) | Initial recovery objectives - RPO 24h, RTO 8h | Accepted |
| [ADR-010](./ADR-010-email-verification.md) | Production accounts require verified email addresses | Accepted |
| [ADR-011](./ADR-011-clinical-session-policy.md) | Clinical session policy - 10-minute lock, 30-minute logout | Accepted |
| [ADR-012](./ADR-012-security-architecture.md) | The actual security architecture - three layers, not RLS-enforced RBAC | Accepted |

Initial set published under COMP-ENG-001 §5, 2026-08-18. Each ADR below was written by reading the actual
code, migrations, and harnesses cited in it — not reconstructed from memory of what the decision was
supposed to be.
