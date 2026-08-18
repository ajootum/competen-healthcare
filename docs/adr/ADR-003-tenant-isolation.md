# ADR-003 — Tenant Isolation

**Status:** Accepted
**Spec:** `docs/PLAT-OVERSIGHT-SURVEY-001*.md`
**Enforced by:** `src/lib/access/plane-boundary.ts`, `src/lib/access/plane-boundary-scan.ts`,
`scripts/plane-boundary-harness.ts`

## Context

The landlord/HQ plane (everything under `src/app/super-admin/**`) legitimately needs to read some
tenant-owned data — practice names, membership counts, lifecycle state — to do product-director-level
oversight. It must not become a back door into a tenant's clinical record. This is the same boundary
`op_incidents` violated in an earlier, corrected instance (it carried `patient_id` and would have put a
patient identifier in a row every other column of which meant something else).

Row-level security on the tenant tables (`practice_*`) is **not** what enforces this boundary today: as
of 2026-08-18, 209 of 209 `practice_*` tables with RLS enabled carry **zero** policies, and the service
role used by server-side code bypasses RLS entirely regardless. Isolation is enforced at the application
layer, and that layer must be treated as the real control, not a convenience wrapper around a database
guarantee that isn't there.

## Decision

**Every table and column the landlord plane may read from a tenant table family is named explicitly, with
a stated reason, in `PRACTICE_ALLOWLIST`** (`plane-boundary.ts`). Nothing outside that list is reachable
from `src/app/super-admin/**` — not because a developer remembered to scope a query, but because
`scripts/plane-boundary-harness.ts` walks the actual TypeScript AST of every file reachable from that
entry point and fails the build if a `.from(table)` call resolves to a table/column pair not on the list.

This is deliberately an AST walk and not a grep: a grep for a literal string once returned zero hits
against a page that read the forbidden table through one level of re-export (see
`plane-boundary-scan.ts`'s own header for the specific historical miss). A boundary that can be
routed around by an import indirection is not a boundary.

`"*"` (all columns) is permitted on the allowlist only for tables that hold no practitioner or patient
data at all — the landlord's own operational substrate (the `mos_*` tables, PD-010's `gov_*` tables). A
table that could ever hold clinical content gets an explicit, narrow column list, never `"*"`.

## Consequences

- Any new read from a `practice_*`, `mos_*`, or `pd_*` table inside the landlord plane must have a
  corresponding allowlist entry **added in the same commit**, with a stated reason, or CI's boundary
  harness fails the build.
- A table family added to the allowlist that nothing actually reads is a *dead grant* — the harness flags
  this too (a door left open for nobody is still open years later when someone wants to walk through it).
  Grants and reads land in the same commit in both directions.
- A `.select(columns)` where `columns` is a runtime variable rather than a literal cannot be checked by
  the AST walk and is refused (`UNRESOLVED_SELECT`). Query builders must take literal column lists at the
  call site precisely so they stay auditable — this has already forced a refactor of one shared helper in
  this codebase.

## Do not

Do not add a table to the landlord plane's reachable set without a corresponding allowlist entry in the
same commit. Do not build a generic "select these columns" helper that takes columns as a parameter for
any query reachable from `src/app/super-admin/**`. Do not treat RLS as the tenant-isolation control on
`practice_*` tables — today, it is not.
