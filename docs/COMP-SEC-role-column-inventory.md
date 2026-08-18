# The six `profiles` role columns — inventory and verdicts

COMP-SECURITY-SURVEY-001 §8 item 5: *"Which of the six `profiles` role columns is the survivor?"*
Read-only inventory, 2026-08-19. **Nothing changed.**

## Where they came from

`role` predates the rest (migration 003, with a CHECK; made nullable by 279 for the two-gate split).
The other five arrived together in **migration 040 `platform-drift-fix`** — three singular/plural pairs
for three planes:

| Plane | Singular | Plural | Resolver |
|---|---|---|---|
| Estate | `role` | `roles` | `estateRolesOf` |
| Organisation | `org_role` | `org_roles` | `orgRolesOf` |
| Platform | `platform_role` | `platform_roles` | `platformRolesOf` |

## Live population (47 profiles)

| Column | Populated | Distinct values held |
|---|---|---|
| `role` | **46 / 47** | nurse 36, hospital_admin 4, educator 3, super_admin 2, assessor 1 |
| `roles` | 11 / 47 | educator 5, nurse 5, hospital_admin 4, assessor 3, super_admin 2 |
| `org_role` | 2 / 47 | charge_nurse 1, org_admin 1 |
| `org_roles` | 1 / 47 | ten values, all on a single row |
| `platform_role` | 1 / 47 | content_manager 1 |
| `platform_roles` | **0 / 47** | — **completely empty** |

Two consistency facts that decide the migration shape:

- **0 rows where `roles[]` does not contain `role`.** The pair never contradicts itself, because the
  canonical writer sets both: `enterprise/people/route.ts` does `.update({ roles, role: roles[0] })`.
- **35 rows have `role` set and `roles[]` empty.** So the plural cannot simply replace the singular —
  three quarters of the estate would lose its role. `estateRolesOf` already papers over this
  (`p.roles?.length ? p.roles : [p.role]`), which is why nothing is visibly broken.

## Reads, by resolver call site

| Resolver | Call sites | Reading |
|---|---|---|
| `estateRolesOf` | **359** | load-bearing; effectively the estate's authorization input |
| `orgRolesOf` | 8 | marginal |
| `platformRolesOf` | 5 | marginal |

(Counted on function names, which do not collide. A direct grep for `role` returns 628 "hits" and is
worthless — it matches ARIA `role=` throughout the JSX.)

## Writers

Ten files write a role column to `profiles`; the canonical editors are
`src/app/api/super-admin/users/route.ts` and `src/app/api/enterprise/people/route.ts`. The derivation
from org roles to the profile columns is deliberately single-sourced (`src/lib/roles.ts:210`) because
"two spellings of this arithmetic would be the estate-fold drift all over again".

## Verdicts

| Column | Product | Purpose | Verdict |
|---|---|---|---|
| `role` | Estate | **Authorization** (via `estateRolesOf`) | **RETAIN, then migrate.** 46/47 populated and 359 read sites — it *is* the estate's authorization input today. It cannot be dropped before ADR-008 phase 2 repoints the helpers at capabilities. |
| `roles` | Estate | **Authorization** | **RETAIN as the successor**, but it is not ready: 35 rows would need a backfill from `role` before it could be sole source. Backfill is safe — the two never disagree. |
| `org_role` | Organisation | Authorization (marginal) | **MIGRATE.** 2 rows, 8 read sites. Org-scoped authority belongs with org membership, not on the global identity row. |
| `org_roles` | Organisation | Authorization (marginal) | **MIGRATE**, same reason. The single populated row carries ten values and looks like a demo/seed artefact — verify before migrating it. |
| `platform_role` | Platform | Authorization (marginal) | **MIGRATE.** 1 row (`content_manager`). HQ already enforces capabilities on all 205 pages; this is a vestige. |
| `platform_roles` | Platform | — | **DEPRECATE.** **Zero rows.** It carries a CHECK constraint (migration 264) and no data, and nothing would notice its removal. The cheapest possible cleanup. |

**Answer to §8 item 5: `roles` is the survivor**, with `role` retained until the burn-down repoints its
359 readers. The four org/platform columns hold 4 populated cells between them across the entire estate.

## ⚠ Two-gate constraint — already satisfied, and it must stay that way

Practice reads **none** of these. It authorizes through `practice_membership` + `practice_role_capabilities`
(43+ codes). `CLAUDE.md` states `profiles.role` is nullable and Practice must never read it; ADR-008
restates it; migration 279 made it nullable precisely so Practice-only identities need no estate role.

**Nothing in this inventory may be used to give Practice an estate role semantic.** Consolidating the six
columns is estate-plane work whose *only* correct effect on Practice is none.

## Dependencies before anything moves

1. **ADR-008 phase 1** (estate capability/grant model) must land first for `role`/`roles`. Retiring the
   authorization input before its replacement exists is the lock-everyone-out failure this repo has
   already hit twice via missing capability backfills.
2. `platform_roles` is the exception: it depends on nothing, because it holds nothing. It can be dropped
   independently whenever a migration is convenient.
3. The org columns need the org-membership destination to exist before they can move.
