# CP-HQ-NAV-001 — Capability-filtered navigation for Competen HQ

**Status:** steps 1 and 2 SHIPPED (`9c4f4ce1`). Step 3 is the substantive remainder and is not started.
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

## 5. Step 3 — convert the 167 role-gated pages (NOT STARTED)

⚠ **This is what makes step 1 more than decoration.** Until a page checks the capability itself, hiding its
link is security theatre: the URL still works for anyone holding the role. Today the filter is *honest* for
both audiences — it removes links that would refuse the person who clicked them — but it guarantees nothing.

The work is mechanical, because the classification already exists: every one of the 205 routes resolves to a
capability under `HQ_ROUTE_INTENT`. Each page replaces its `roles.includes("super_admin")` test with
`requireHqContext()` (null argument → the intent map supplies the capability).

**Batch by space, and only where somebody is appointed**, so each batch has a real person who can say whether
the result is usable:

| batch | routes | appointee today |
|---|---|---|
| practice | 2 | yes — Practice Product Director |
| executive | 26 | Chief Executive (owner, so no behaviour change) |
| platform | 76 | none |
| learning | 55 | none |
| quality | 46 | none |

⚠ **Order matters and `platform` is not first despite being largest.** It contains
`/super-admin/users/appointments` (who may appoint) and `/super-admin/system/*` (identity and security), so a
conversion error there widens the blast radius of every other batch.

⚠ **`hq_config.mode` is still `observe`.** Converting a page does not refuse anybody yet — it records to
`hq_access_observation`. The migration path is: convert, read the observations, correct the intent map, and
only then flip the mode. Flipping it early is how an owner gets locked out of the console they would use to
unflip it.

⚠ **The 174 `isAdmin`/`isSuper` API routes are a separate, unstarted problem.** Membership is enforced at the
layout boundary, not the API boundary.

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
- `scripts/hq-guard-harness.ts` — **60/0**, unchanged.
- `npx tsc --noEmit` clean; eslint clean.

⚠ **Not verified in a browser.** The signed-in view of the filtered sidebar has not been looked at by a
person — verifying it requires signing in, which is the user's to do. The specific thing worth checking is
that an **owner's** sidebar is still complete, since that is the regression this change could cause.
