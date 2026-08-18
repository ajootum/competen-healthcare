# ADR-012: The actual security architecture — three layers, not RLS-enforced RBAC

**Status:** Accepted — owner ruling, 2026-08-19.

## Context

COMP-SEC-001's acceptance criteria include *"RBAC enforced platform-wide"*, and the conformance map
recorded it as holding. Read casually — and it was read casually — that phrase implies the database
enforces role-based access through RLS. **It does not, and the gap is not small:**

- **209 of 209 `practice_*` tables have RLS enabled with zero policies** (confirmed live). A table with
  RLS on and no policy denies everything to an ordinary client; it is not a rule expressing who may read
  what.
- **The service role bypasses RLS entirely**, and the estate reaches the database through it.
- So what actually stops a cross-tenant read is **application code**, and it always has been.

Survey §8 item 6 asked whether to fix the RLS recursion or accept service-role + `api-auth.ts` as the
architecture. The owner accepted it — with the condition that **the documentation stop claiming
otherwise.**

## Decision

The architecture is stated in three layers, each with an honest scope:

```
DATABASE ENFORCEMENT
  RLS where technically appropriate
        +
APPLICATION AUTHORIZATION
  getCaller() / approved boundaries
  capability resolution
  tenant + product boundary
        +
PRIVILEGED SERVER ACCESS
  service-role, strictly server-side, audited
```

- **Database enforcement is a supporting control, not the primary one.** RLS is used where it genuinely
  fits; it is not the answer to "how is RBAC enforced".
- **Application authorization is the primary control.** This is where a principal is resolved, a
  capability is checked, and the tenant/product boundary is applied.
- **Privileged server access is deliberate**, and it is precisely *why* the middle layer must hold:
  nothing underneath it will catch a mistake.

**"RBAC enforced platform-wide" may only be stated as application-layer enforcement.** Any wording that
implies database-level RBAC is inaccurate and must be corrected where found.

## Consequences

**The priority order changes, and this is the practical point.** A route that never reaches the
authorization gateway is more consequential than one that reaches it and then uses an older role
abstraction inside. So:

1. **Routes bypassing the boundary** — `scripts/auth-boundary-harness.ts`, ratcheted at 91 with a target
   of zero. **Ranks above ADR-008.**
2. **Role-name checks inside the boundary** — ADR-008's governed burn-down.

Measured 2026-08-19: **455 routes = 358 guarded + 4 public + 2 system + 91 inline-auth, 0 unclassified.**
The 91 are not unauthorized — they call `auth.getUser()` themselves — but they authenticate without the
tenant/product boundary, capability resolution, or the consistent refusal shape the gateway applies.

⚠ **The harness carries a drift control, and it exists because the measurement was wrong twice.** A
hand-written list of guard helpers reports *gated* routes as *open* the moment a new helper appears: the
first pass missed `getLandlordCaller` and returned the platform-plane mutation routes as unauthenticated;
corrected, it then missed `hqApiGate` and did the same to four HQ write routes. Both looked like critical
findings and both were artifacts. The harness now fails when a guard-shaped export in `src/lib` is
classified nowhere.

## Do not

- Do not describe this system as enforcing RBAC through RLS, in any document, spec response, or
  attestation.
- Do not add RLS policies to `practice_*` as a drive-by change because this ADR notes their absence. That
  posture is load-bearing and changing it is a governance decision with real blast radius
  (`CLAUDE.md` § Tenant and data isolation).
- Do not add a guard helper without classifying it in the auth-boundary harness in the same commit. This
  class of omission has recurred four-plus times here.
