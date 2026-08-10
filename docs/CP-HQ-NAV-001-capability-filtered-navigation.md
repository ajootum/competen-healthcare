# CP-HQ-NAV-001 — Capability-filtered navigation for Competen HQ

**Status:** steps 1, 2 and 3 SHIPPED (`9c4f4ce1`, `fc1a584d`). All 205 pages enforce a capability.
**Date:** 2026-08-10
**Predecessors:** PLAT-ARCH-SURVEY-001 (the space/position model), COMP-ARCH-PSA-001 (the two gates),
CP-SPLIT-002 (platform membership).

---

## 1. The problem, as reported

> "Elisha sees superadmin mission control for a second and is then bounced back to admin."

That specific bounce was a stale deploy of `16e191dc`. Behind it sat the real defect: once Elisha reached
Mission Control, the sidebar offered ~30 sections and his position could open **one**.

## 2. What was measured, before deciding anything

| | |
|---|---|
| `/super-admin` page files | **205** |
| gated on a capability (`requireHqContext`) — a position can pass | **38** |
| gated on the `super_admin` role directly — no position can ever pass | **167** |
| routes with a declared capability in `HQ_ROUTE_INTENT` | **205 — zero unmapped** |

Routes per HQ space, from the intent map that already existed:

| space | routes |
|---|---|
| platform | 76 |
| learning | 55 |
| quality | 46 |
| executive | 26 |
| **practice** | **2** |

Reach per position, **if every page enforced the capability the intent map already assigns it**:

| position | capabilities | would reach | reaches today |
|---|---|---|---|
| Platform Director | 10 | 76 / 205 | 20 |
| Learning Product Director | 9 | 56 / 205 | 8 |
| Quality Council Member | 6 | 47 / 205 | 3 |
| Chief Executive | 6 | 27 / 205 | 10 |
| Chief Financial Officer | 4 | 18 / 205 | 2 |
| **Practice Product Director** | 3 | **3 / 205** | **1** |

### ⚠ The finding that shaped the answer

The Practice Product Director's three pages are `/super-admin`, `/super-admin/platform-ops/practice` and
`/super-admin/platform-ops/practice/identifiers` — and **that is correct, not broken**. `/super-admin` is the
Competen *Platform* estate: learning, competency, quality, governance. Competen *Practice* is the other
product, behind gate 2, and its operator surface in this building is the pilot gate and nothing else.

So the question is never "how do we give Elisha more of `/super-admin`". It is "does a Practice Product
Director need an operator surface *for Practice*, and does it live here?" — which is a product question,
recorded in §6 and deliberately not answered by this change.

---

## 3. Step 1 — filter the sidebar (SHIPPED)

`src/lib/hq/nav-filter.ts` — pure, no I/O. `filterHqNav(sections, viewer)` keeps a link when
`capabilityForRoute(href)` resolves to a capability the viewer holds. Empty groups are dropped so no header
appears over nothing.

- **Owners are untouched.** `filterHqNav` returns the input array unchanged.
- **Unmapped hrefs are hidden**, matching the programme-wide default that null denies. This also hides every
  link that *leaves* `/super-admin` (`/platform-admin`, `/admin/approvals`, `/competency-office/*`) — those
  are other workspaces behind their own gates, and an HQ appointment grants nothing in any of them.
- The nav tables moved to `src/app/super-admin/_components/nav-tables.ts` (data only, no `"use client"`) so
  the harness asserts over the tables that ship.

### ⚠ `isOwner` is passed separately and it is load-bearing

The layout resolves `hqCapabilities` **only for non-owners** — an owner short-circuits before any HQ table is
read, and therefore arrives with `capabilities: []`. Inferring ownership from a non-empty capability list
would hand every platform owner a blank console. `isOwner` is a required prop and the owner branch is first.

### ⚠ Highlighting is derived from the UNFILTERED table

`parentHrefs(table.flatMap(...))`, not `nav`. If a viewer cannot see a child, the parent would stop looking
like a parent and revert to prefix matching — so in observe mode, which still renders a `would_deny`, an
appointee standing on a hidden child would light up its parent. The parent set is a property of the nav, not
of the viewer.

## 4. Step 2 — the way in (SHIPPED)

`/super-admin` is not in `WORKSPACE_CATALOGUE` and never was: super admins reach it through `ROLE_CONFIG`,
which maps a **role** to a portal. An HQ appointment grants no `AppRole`, so an appointee held a live
position that opened the door and had **no link to it anywhere in the product**. They landed in their estate
portal (`/admin`) with no way across. Fifth "engine built, screen missing" of this programme.

`workspaceLinksForUser` now offers it, which feeds both switchers at once (the sidebar's `RoleSwitcher` and
`GlobalHeader`, since `loadHeaderContext` calls the same resolver).

- **Labelled "Competen HQ", never "Super Admin".** A position is not a role. Elisha holds one that opens
  three pages; a switcher entry naming the most powerful role in the product would tell him something untrue
  about his own authority. The same correction was applied to the identity line under the viewer's name in
  the sidebar ("HQ Appointee") and to the header's `workspaceTitle`.
- **Offered on capabilities, not positions** — a deactivated position reports a non-empty `positions` list
  while granting nothing, so `positions` would keep advertising a door that has been shut. This matches the
  layout gate exactly, so the switcher cannot offer a destination the gate then refuses.
- **A cheap indexed probe runs first.** This executes on every authenticated page load for every user; one
  `ogs_office_appointments` lookup by `person_id` ends it for the ~45 people who hold no appointment at all.
- **Fails soft toward NO link.** This function decides what is *offered*; the layout decides what is
  *admitted*. A missing link costs an appointee a URL they can still be sent. A link added on a failed read
  would advertise a console to somebody the gate will refuse.

---

## 5. Step 3 — every page enforces its capability (SHIPPED, `fc1a584d`)

Classifier after: **`hq-position=205, single-role=0`**. Done by codemod (`scripts/hq-convert-pages.ts`),
which verifies each edit by re-classifying its own output and is re-runnable — a second run finds nothing.

### ⚠ The plan above was wrong, and the way it was wrong is the point

It said to convert to `requireHqContext()`. **That would have widened all 167 pages, not narrowed them.**
`requireHqContext` honours `hq_config.mode`; the mode is `observe`; and observe **admits** a `would_deny` —
that is what observe *is*. Every converted page would have become reachable by any appointee holding any
position, in the name of least privilege.

### ⚠ And the 38 already-converted pages were already doing it

Measured against live data before the conversion, with one non-owner appointee holding 3 capabilities:

| | |
|---|---|
| pages he held the capability for | 3 |
| **pages he could reach WITHOUT holding their capability** | **37** |

The 37 included `/super-admin/settings`, `/super-admin/hospitals`, `/super-admin/organisations` and —
decisively — **`/super-admin/users/appointments`, the screen that grants HQ positions.** Anybody holding any
position could have appointed themselves Chief Executive. After: **3 held, 0 over-reach.**

### The resolution

`requireHqCapability(capability)` — identical to `requireHqContext` except the capability is enforced
regardless of rollout mode.

- **Use `requireHqCapability` when REPLACING a real access check.** Observe must not loosen a door that was
  already shut.
- **Use `requireHqContext` when adding the first check to a page that had none.** There, observe is doing its
  intended job: not refusing somebody on a capability map nobody has validated.
- Refusals are **still recorded** either way, so the observation ledger keeps filling.
- Owners are unaffected by both: `isOwner` short-circuits before mode is read.
- **`hq_config.mode` is untouched and still `observe`.** No data was changed. It now governs nothing under
  `/super-admin`, which is why flipping it can no longer widen anything — asserted by `E5`.

### ⚠ The scanner had to learn the new helper FIRST

`hq-scan.ts` matched only `requireHqContext|resolveHqContext`. A scanner that had never heard of
`requireHqCapability` would have fallen through to `classifyGate`, matched no idiom, and reported all 167 as
`kind: "none"` — *"no access check of any kind — reachable without signing in"* — publishing the entire HQ
estate to a manager as open to the world, one commit after locking it down. **That is the third instance of
this exact bug in this codebase** (98 practice routes, then `requireHqContext` itself). Any future guard
helper goes into `HQ_GUARDS` before it goes into a page.

### Still open

⚠ **The 174 `isAdmin`/`isSuper` API routes are a separate, unstarted problem.** Membership is enforced at the
layout and page boundary, not the API boundary. `/api/hq/appointments` is the exception — it checks
`ctx.isOwner` on every write verb.

## 6. Open — not answered here

1. **Is `/super-admin` the right building for a Practice Product Director at all?** Three pages is a correct
   answer to the question as posed, and possibly the wrong question. The alternative is an operator surface
   inside Competen Practice.
2. **Should the position matrix widen?** `hq_position_capability` is data; widening is an INSERT, not a
   build. It should follow a person saying what they could not do, not precede it.
3. **The `/hq` rename** still waits on every page carrying its own guard, so that no window exists in which
   `/hq/*` is reachable ungated (`src/lib/hq/spaces.ts`).

## 7. Verification

- `scripts/hq-nav-filter-harness.ts` — **27/0**. Every assertion family proven able to fail by deliberate
  break; files restored with `cp` + `sha256sum`, never `git checkout --`.
- `scripts/sidebar-active-harness.ts` — **8/0**. It went red the moment the nav tables moved, which is its
  count controls working; it now imports the tables rather than regexing them out of the component, so that
  failure mode is gone.
- `scripts/hq-guard-harness.ts` — **64/0**. `E3` (all 205 gated), `E5` (zero pages honour the mode),
  `E6`+`E6-control` (the mode distinction does work), `E7` (the guard really asks for enforce) are new, each
  proven failable by a deliberate break.
  ⚠ `E4` was a control that counted real `single-role` pages to prove the classifier still told kinds apart.
  Converting the last one turned a **genuine success into a red**, so it now asserts against a fixture rather
  than demanding the estate stay partly unconverted. Same lesson as `sidebar-active` C7/C8: when live data
  stops exercising a property, exercise it directly.
- `scripts/hq-appointment-harness.ts` — **26/0**.
- `npx next build` — clean.
- `npx tsc --noEmit` clean; eslint clean.

⚠ **Not verified in a browser.** The signed-in view of the filtered sidebar has not been looked at by a
person — verifying it requires signing in, which is the user's to do. The specific thing worth checking is
that an **owner's** sidebar is still complete, since that is the regression this change could cause.
