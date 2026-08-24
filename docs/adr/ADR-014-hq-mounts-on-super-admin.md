# ADR-014: HQ mounts on `/super-admin`; `/hq/*` is an alias at most, never a second estate

**Status:** Accepted — owner ruling, 2026-08-17. Written down 2026-08-24.

> **On the delay.** This decision has been in force since 2026-08-17 and shaped everything built in the
> HQ arc after it, but the rationale was never recorded — a grep of `docs/`, `docs/adr/` and `src/`
> finds the *architecture* enforced in four places and the *reason* in none. It surfaced again during
> COMP-ACCESS-URL-001, where a second specification names `/hq` and a reader with no memory of the
> ruling would reasonably have built it. That is the failure mode this layer exists to prevent, so the
> ADR is written now rather than left implicit for a third spec to trip over.

## Context

Two developer specifications name a route family this application does not have.

- **COMP-HQ-ACCESS-001** §14 sets out `/hq/{practice, enterprise, individual, recruitment, platform,
  security, support, commercial, governance, access}`.
- **COMP-ACCESS-URL-001** §2 names `/hq` as the main-domain route equivalent for the Staff/HQ gateway,
  alongside `/practice`, `/enterprise`, `/individual` and `/recruitment`.

Measured 2026-08-24, `src/app/hq` does not exist and never has. What does exist:

| Surface | Reality |
|---|---|
| `/staff` | The staff door (`STAFF_DOOR_PATH`), aliased by `staff.competenhealthcare.com` |
| `/staff/workspaces` | The gateway selector |
| `/super-admin` | **33 sections**, including `platform-ops/MissionControlBoard.tsx` |
| `src/lib/hq/**` | **35 modules** — governance context, capability planes, mission profile and widgets, nav filter, spaces, appointments, API gate, the whole PD family |

**The name "HQ" is not missing — the route is.** The module directory is literally `src/lib/hq/`, the
door's label is "Competen HQ", and `resolveStaffGateway` already composes `admitToEstate`,
`workspaceLinksForUser` and `listGovernanceContexts` into it. HQ is the concept the estate implements;
`/hq` is a path nothing serves.

That left a genuine fork:

1. **Build the `/hq/*` family fresh.** Faithful to the spec's route table, and it duplicates a
   33-section estate — two canonical homes for the same governance plane, each able to drift from the
   other, with `src/lib/hq/**` serving both.
2. **Mount the spec's behaviours on `/super-admin`** and treat `/hq` paths as later aliases if anyone
   ever wants them.

COMP-HQ-ACCESS-001 §25's definition of done is **behavioural** — direct context resolution, a persistent
switcher, deep-link revalidation, HQ never a compulsory intermediate page — and names no path. The
second reading satisfies it in full.

## Decision

**HQ mounts on the existing `/super-admin` estate.** The behaviours COMP-HQ-ACCESS-001 requires are
built there. `/hq/*` is not built as a route family.

**If `/hq` is ever wanted, it is an alias — a rewrite onto the existing estate, in the manner of
`staff.competenhealthcare.com` → `/staff` — and never a parallel route tree.** This is the same rule
`staff-host.ts` already states for its own subdomain: *"the subdomain is an alias for it, never a second
implementation."*

Two reasons carry this beyond mere convenience:

- **One canonical home.** A governance plane with two front doors is two things to keep in step, and
  this codebase has a recorded history of the second spelling quietly diverging from the first.
- **A second entrance to a privileged plane is a security surface, not a rename.** `/super-admin` is the
  landlord estate. Adding another way in is a decision with a blast radius, and it should be taken
  deliberately with its own threat argument — not as a side effect of matching a route table.

## Consequences

- **COMP-ACCESS-URL-001 §2's `/hq` row is superseded by this ADR.** The Staff/HQ gateway's main-domain
  route equivalent is `/staff`. `src/lib/identity/domains.ts` records `/staff` for that reason.
- `staff.competenhealthcare.com` aliases `/staff`, which resolves a single-destination holder straight
  into `/super-admin` (COMP-HQ-ACCESS-001 §7/§8, commit `5058535e`). The chain has one estate at the end
  of it, whichever door was used.
- The HQ *name* stays in use — `src/lib/hq/**`, the "Competen HQ" label — and carries no implication
  that a `/hq` route exists or should.
- **Reversing this is expensive**, which is why it belongs here: it means duplicating 33 sections and
  then keeping both copies honest.
- A future specification naming `/hq/*` routes does not, on its own, authorise building them. It is a
  conflict to raise with whoever owns both documents, per `CLAUDE.md`'s documentation-authority rule.

## Where this is enforced

| Enforcement | Location |
|---|---|
| The HQ door's href, for staff who are not owners | `src/lib/staff/selector.ts:102` — `HQ_DOOR = { label: "Competen HQ", href: "/super-admin" }` |
| The same pair in the workspace launcher | `src/lib/workspace-links.ts:10` — `HQ_WORKSPACE` |
| The owner's own route into the estate | `src/lib/roles.ts:73` — `super_admin.portal = "/super-admin"` |
| The staff door resolves to `/staff`, derived not typed | `src/lib/identity/staff-host.ts` — `STAFF_DOOR_PATH = GATEWAYS.staff.route` |
| The registry records `/staff`, not `/hq` | `src/lib/identity/domains.ts` — `GATEWAYS.staff.route` |
| The gateway lands on `/super-admin` | `scripts/access-doors-harness.ts:143,170` |
| **`/hq` is absent, and the registry names only served routes** | `scripts/domain-registry-harness.ts` — 2b (every registered route exists on disk), 2c (staff route is `/staff`), 2d (`src/app/hq` does not exist), 2e (`STAFF_DOOR_PATH` cannot drift from the registry) |

Break-tested: changing the registry's staff route to `/hq` turns 2b, 2c and 2e red.

## What this ADR does not decide

- **Whether `/hq` should ever exist as an alias.** It does not exist and nothing needs it; if it is
  wanted, it is a rewrite, and that is a small separate change.
- **Whether `/super-admin` is the right *name*.** It is the path in force. Renaming a 33-section estate
  is its own decision with its own migration, and this ADR neither blesses nor blocks it.
- **Anything about `staff.competenhealthcare.com` resolving.** Measured 2026-08-24, it does not — see
  `docs/COMP-ACCESS-URL-001-inventory.md`. DNS is an owner action, and no ADR performs it.
