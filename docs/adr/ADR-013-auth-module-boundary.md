# ADR-013: `src/lib/auth/` is a bounded internal module, not a package

**Status:** Accepted — owner ruling, 2026-08-19.

## Context

COMP-AUTH-001 calls for a shared authentication/authorization "engine" *"consumed by all Competen
applications (CP, AFCAN, Competen Platform)"* and makes it an acceptance criterion. Survey §8 item 4
asked whether that means a literal publishable package.

**It does not.** This repository is one application. Extracting a package is a different project from
getting the boundary right here, and doing it first would mean versioning and publishing an interface
nobody has yet proven — while the actual problem (authorization logic scattered across planes) stays
scattered.

## Decision

Build a **clearly bounded internal module** at `src/lib/auth/`, with these concerns:

```
src/lib/auth/
  principal        who the caller is
  capabilities     what a principal may do
  grants           how capability is conferred, and for how long
  authorization    the decision, and the approved boundaries that reach it
  break-glass      the audited emergency path
  audit            the trail every decision above writes to
```

**Package extraction becomes worthwhile when multiple separately deployed applications genuinely need
the same implementation — not before.** Until then, "engine" is a design boundary, not a build artifact.

## Where the six concerns live today

Nothing here is greenfield except `grants`. The module is a **destination**, and this is what would move:

| Concern | Today | Note |
|---|---|---|
| principal | `src/lib/api-auth.ts` (`getCaller`), `src/lib/identity.ts` (`resolveIdentity`) | Two resolvers; `resolveIdentity` was proven equivalent across all 47 live profiles before repointing |
| capabilities | `src/lib/hq/context.ts` (`requireHqCapability`), `practice_role_capabilities` (43+ codes), `src/lib/practice/access.ts` | Practice and HQ have real capability models; **the estate does not** |
| grants | **does not exist for the estate** | ADR-008 phase 1. The one genuinely new piece |
| authorization | `api-auth.ts` (`hasRole` and the compatibility adapters), `hq/api-gate.ts`, `platform/landlord.ts`, `practice/api-context.ts` | Four planes, four entry styles — measured in `scripts/auth-boundary-harness.ts` |
| break-glass | `src/lib/access/permissions.ts`, `src/lib/hq/context.ts`, `/api/me/break-glass` | Exists and is audited; ADR-008 requires it stop depending on a `super_admin` string comparison |
| audit | `src/lib/practice/auth-audit.ts` (`recordAuthEvent`), `platform/landlord.ts` (`landlordAudit`), `audit_log` | Several writers, one general table |

## Consequences

**This module is the destination for two burn-downs already in flight**, which is why it is worth
defining now rather than after them:

- The **91 routes** authenticating ad-hoc (ADR-012, `auth-boundary-harness`) need somewhere to migrate
  *into*. Without a named boundary they will each be repointed at whichever helper the author happens to
  know — which is how four planes ended up with four entry styles.
- **ADR-008's capability migration** needs `grants` to exist before `role`/`roles` can stop being the
  estate's authorization input. `src/lib/auth/grants` is that thing.

⚠ **The order matters, and it is not "create the folder first".** Creating six empty modules and moving
files into them changes nothing about correctness while touching hundreds of imports — a large, risky
diff that improves no behaviour. The module earns its existence when `grants` is built inside it (ADR-008
phase 1), because that is the first piece with nowhere else to live. Everything else moves *behind* real
work, not ahead of it.

⚠ **Product separation is not negotiable inside this module.** A shared `src/lib/auth/` must not become
the place where Practice quietly acquires estate role semantics. Practice authorizes through
`practice_membership` + `practice_role_capabilities` and reads none of the six `profiles` role columns
(see `docs/COMP-SEC-role-column-inventory.md`). A shared module that "unifies" them would undo the
two-gate split by refactor rather than by decision.

## Do not

- Do not create a publishable package. Revisit only when a second separately deployed application
  genuinely needs the same implementation.
- Do not begin with a mass file move. The first real inhabitant is `grants`; the rest follows work.
- Do not let the shared module erase plane boundaries. Four planes having four *entry points* is a
  problem; four planes having four *authorization models* is the architecture.
