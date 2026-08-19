# CPR-PD-013 §9 — Product Director workspace reconciliation

**2026-08-19.** The §3 method applied across the whole PD sidebar: what each screen shows, what the
Product Director can actually do there, what the backend permits, and where those three disagree.

Every figure below was **measured against the code and the live capability tables**, not sampled. The
scan covered all **86 PD destinations** plus the 43 `platform-ops` pages, reading each page's guard, its
loaders, and every component in its reachable tree for a write surface. Where a count is quoted, the way
it was counted is stated — this estate has a recorded history of capability counts being wrong by
including comment mentions.

---

## 1. The headline: the Product Director's workspace contains none of their write actions

**86 PD pages. Zero write surfaces.** Not one page under `/super-admin/pd/` issues a `POST`, `PATCH`,
`PUT` or `DELETE`, or calls any API route — verified across each route's whole component tree, not just
its `page.tsx`.

Every write a Product Director can perform lives under `/super-admin/platform-ops/`, and exactly **one**
of those 43 pages is in the PD sidebar (`platform-ops/practice`, shown as *Technical Operations*).

| The three real doors | Route | Capability |
|---|---|---|
| Flip a launch flag | `PATCH /api/v1/practice/flags` | `hq.practice.flags.manage` |
| Provision / retry a pilot workspace | `POST /api/v1/practice/provisioning/*` | `hq.practice.provision.execute` |
| Set the practitioner identifier format | `/api/v1/practice/identifier-format` | `hq.practice.configuration.manage` |

All three are driven from **Technical Operations** or its `identifiers` child — the one borrowed screen.

**Gap class:** `SPEC/UI_DRIFT` at the workspace level. **HFE severity: medium.** Nothing is
mis-enforced and nothing is unreachable; the finding is that ten of the eleven sidebar sections are
purely observational, and the eleventh is a page that lives in another module's tree. §10's rule — *"do
not make the Product Director hunt through unrelated modules for an action implied by the current
screen"* — is satisfied only because Technical Operations is linked from the screens that imply it.

**Correction:** none proposed as a defect. This is a product-shape decision, and the honest options are
(a) accept that PD is an observation plane whose one control surface is Technical Operations and say so
in the module headers, or (b) move the three doors under `/pd/`. Both are the owner's call.
**Acceptance test:** whichever is chosen, `pd-screen-doctrine-harness` gains a pin asserting it.

## 2. Two capabilities are granted and inert

Nine write capabilities exist in the `hq.practice.*` space. Measured per capability — enforcing API
routes found by searching `src/app/api`, UI references by searching `src/app/super-admin`:

| Capability | Held by Product Director | Enforcing routes | Verdict |
|---|---|---|---|
| `flags.manage` | ✅ | 1 | real door |
| `provision.execute` | ✅ | 2 | real door |
| `configuration.manage` | ✅ | 1 | real door |
| `release.activate` | ✅ | 0 | **declared absent on screen** — see §4 |
| `release.rollback` | ✅ | 0 | **declared absent on screen** — see §4 |
| `export.execute` | ✅ | **0** | ⚠ **inert** |
| `licence.verify` | ✅ | **0** | ⚠ **inert** |
| `change.approve` | ❌ | 0 | correctly withheld |
| `risk.accept` | ❌ | 0 | correctly withheld |

⚠ **`export.execute` and `licence.verify` are granted to the position and referenced nowhere at all** —
zero enforcing routes, zero UI references, zero mentions outside the grant itself. They are inert: they
confer nothing, refuse nothing, and appear in an access review as authority this position does not
actually have.

**Gap class:** `AUTHORITY_MISMATCH` (inverted — the grant overstates rather than the UI). **HFE
severity: low** for a user, **medium for governance**, because the misstatement is in the access record.

**Correction:** either revoke both from `practice_product_director` until something enforces them, or
record in the position's charter why a dormant grant is intended. **Acceptance test:** a harness
assertion that every capability granted to a position is enforced by at least one route, with a named
allowlist for deliberate dormancy.

## 3. Twenty-three screens are honest shells, and that is the doctrine working

23 of 86 PD pages render `PdNotBuilt` — a component that names the screen, its governing spec, what it
*would* show, and the specific reason it cannot.

| Module | Pages | Shells | Root cause given |
|---|---|---|---|
| Product Intelligence | 11 | **11** | no product telemetry exists in the schema — no page-view, feature-invocation or session event anywhere |
| Commercial | 11 | **11** | a Practice subscription is unrepresentable — `plat_subscriptions` keys on `tenants(id)` and `practice_workspace` has no `tenant_id` |
| Adoption & Growth | 1 | 1 | same telemetry absence as Intelligence |

**Gap class: NO GAP.** These are not unbuilt queries over an empty table; each names a missing substrate
and refuses rather than rendering a flattering zero. **Do not re-report these as defects** — that is the
failure this estate keeps repeating.

⚠ **One observation worth a decision, not a fix:** twenty-two destinations resolve to **two** root
causes. A Product Director clicking through eleven Intelligence entries meets the same sentence eleven
times. Whether that is honest navigation or a hunt is an IA judgement, and it belongs to whoever owns the
frozen eleven-item sidebar — not to this pass.

## 4. Where a capability is held and the screen says so

PD Releases holds `release.activate` and `release.rollback` and renders **no button for either**. Rather
than hiding that, `release-ui.tsx`'s *WritesAndApprovals* panel states the capability is held, cites the
migration that granted it (311), and explains that §25's `rollout`, `rollout_stage` and `rollback_plan`
objects do not exist — so there is no row to activate and no plan to reverse.

It also states that `change.approve` is withheld from this position by design, as the checker half of
maker-checker. **Verified against the live grant table: `change.approve` and `risk.accept` are genuinely
not held.** The screen's claim about its own authority is true.

**Gap class: NO GAP**, and the best example in the workspace of §4's `MISLEADING_INTELLIGENCE` being
avoided rather than committed.

## 5. Authorization: clean

**All 129 pages** under `/super-admin/pd` and `/super-admin/platform-ops` call `requireHqCapability`.
Zero role-name checks, zero unguarded pages, zero `requireHqContext`-only pages. §11's first guardrail —
*"no raw role-name authorization checks may be introduced"* — holds across the whole surface.

Twelve distinct capabilities gate them, and the nav filter (`src/lib/hq/nav-filter.ts`) hides links whose
capability the viewer lacks, so a refused operator is not offered the door.

**Nav integrity:** 86 nav destinations, 86 pages, **no dead entries and no unreachable screens**. The one
page not in the nav is `/pd/practices/[practiceId]` — the Practice 360 detail route, correctly reached by
drilling from the register rather than by a sidebar item. **NO GAP.**

## 6. Module inventory

| Module | Pages | State | Capability | Gap class | Severity |
|---|---|---|---|---|---|
| Product Operations | 4 | built, dense (avg 226 lines) | `operations.view` | NO GAP — closed by PD-014 | — |
| Practices | 2 | built (avg 518 lines) | `practices.view` | NO GAP | — |
| Practitioners | 1 | built (492 lines) | `practitioners.view` | NO GAP | — |
| Releases & Capabilities | 12 | built (avg 243 lines) | `releases.view` | NO GAP — §4 above | — |
| Support & Incidents | 11 | built (avg 183 lines) | `support.view` | **one defect, fixed** — §6.1 | was high |
| Governance & Risk | 11 | built (avg 169 lines) | `governance.view` | NO GAP — §6.2 | — |
| Product Configuration | 11 | built (avg 151 lines) | `configuration.view` | NO GAP — §6.3 | — |
| Product Health | 11 | built (avg 109 lines) | `health.view` | NO GAP — §6.4 | — |
| Product Intelligence | 11 | **11 shells** | `intelligence.view` | NO GAP — §3 | — |
| Commercial | 11 | **11 shells** | `commercial.view` | NO GAP — §3 | — |
| Adoption & Growth | 1 | **1 shell** | `adoption.view` | NO GAP — §3 | — |

## 6A. The four remaining modules, read against their governing specs

Read against `CPR-PD-008` (Product Health), `CPR-PD-009` (Support & Incidents), `CPR-PD-010`
(Governance & Risk) and `CPR-PD-011` (Product Configuration), extracted from the owner's originals.

**Every one of the four builds all eleven of its spec's required submodules — 44 of 44, exact.** Each
spec's §2 names eleven; each module ships eleven, with names that map one to one.

### 6.1 Support & Incidents — ⚠ one real defect, fixed

**`support/affected` displayed 0 open escalations when the escalation register could not be read.**

The page loads four things and checks three of them for null, pushing a named problem for each. The
fourth — `loadEscalations` — was collapsed with `(escalations?.rows ?? []).filter(…).length` and fed
straight into a 22px bold figure. `ReadResult` is `{ rows, truncated } | null`, so an unreadable
`mos_escalation` rendered a confident zero with no notice beside it.

PD-009 §23 forbids this by name: *"Affected-scope Unknown is never displayed as zero."*

**Gap class:** `MISLEADING_INTELLIGENCE`. **HFE severity: high** — the figure is read by somebody
deciding whether anything is escalated right now, and zero is the most reassuring wrong answer
available. **Fixed:** the count is `null` on failure, renders *"Not known"* with the reason, and the
loader now has its own problem notice like the other three. **Acceptance test:** a structural pin in
`pd-screen-doctrine-harness` — a page that collapses a nullable read with `?? []` must also test that
read for null somewhere. Break-tested by reverting the fix.

The other six Support pages that collapse a nullable read all guard it. This was a single omission,
not a pattern.

**Checked and NO GAP:** all 11 submodules present; *"escalation does not transfer incident
ownership"* — the escalations page renders no owner column and quotes §9 as the reason, which is
correct rather than a gap; Incident 360 carries §7's three roles.

### 6.2 Governance & Risk — NO GAP

- *"Not Tested is never represented as Effective"* — rendered literally as **"Never Effective"**, with
  design and operating effectiveness kept as separate columns, and `aggregateEffectivenessPct` typed
  `null` so no aggregate score is invented from untested controls.
- *"Exceptions cannot silently remain active after expiry"* — the register carries `is_expired` and
  `days_to_expiry`, and an **Expired** tile states *"Cannot silently remain in force."*

### 6.3 Product Configuration — NO GAP

The comps draw hierarchy levels resolving at *100/100/92/88/85%* and ten domains at *58–100% coverage*.
**Every one of those percentages is refused**, with the reason recorded in place: *"85% resolvable"
needs a count of settings that could resolve and there is no such denominator in the schema.*

The one bar that remains is `aria-hidden` and the figure actually rendered beside it is `{readable}/{total}`
— counts, not a rate. That is the honesty rule applied exactly.

### 6.4 Product Health — NO GAP

PD-008 §25: *"Overall health never renders Healthy when required telemetry is stale/unknown."* The
overall state resolves to **Unknown**, and the loader states why: critical journeys and availability are
the gating domains under §5, both are unmeasured, and *"a journey with no attempts is unmeasured, not
healthy — they return null rather than zero, because zero attempts and no instrumentation render
identically on a screen and only one of them is a fact about the product."*

Workflow Health moved to *partial* coverage on evidence (six of eight journeys now emit) while keeping
its state Unknown, because §4 needs an objective and none is configured. Coverage and health are kept as
separate axes, which is the distinction the criterion is protecting.

### 6.5 Loader hygiene across all four

42 destructured reads in `src/lib/hq` were scanned for a discarded `error`. Seven discard it; **none of
the seven is in these four modules** — they are the capability resolvers in `context.ts` and
`governance-context.ts`, where an unreadable grant table yields no capabilities and therefore fails
closed, plus two in `pd-provisioning-health.ts` (Product Operations, already covered).

## 7. Carried forward from CPR-PD-014 §6

Both remain open and both are the owner's decision, in this order:

1. **There is no read-only Product Operations access.** `practice_product_director` is the only position
   holding `operations.view`, and it also holds both writes. Nobody can watch provisioning without being
   able to execute it. The precedent for the fix is in migration 264: `chief_financial_officer` is the
   CEO's space with narrower grants.
2. **Provision and flag controls are enforced at the API but not conditioned in the UI.** Invisible only
   because of (1); the symptom on the first grant split is a button that 403s. **Position first,
   conditioning second** — building the conditioning now ships a branch no identity can reach.

## 8. What this pass did NOT verify

Stated plainly rather than left to look complete:

- ~~Four modules were measured, not read line by line~~ — **done, see §6A.** All four were read against
  their governing specs (PD-008, PD-009, PD-010, PD-011): 44 of 44 required submodules present, one real
  defect found and fixed, three modules NO GAP on the criteria checked.
  ⚠ **What §6A did NOT do:** it checked each spec's §2 submodule list and the mechanically checkable
  acceptance criteria — the honesty ones, the ownership ones, the expiry ones. Criteria that need a
  running system or a person (*"responsive/accessibility/collapsed-sidebar testing passes"*, *"synthetic
  checks cannot create uncontrolled real patient records"*, *"recovery requires governed confirmation"*)
  were **not** exercised. Those need the browser pass in the next bullet.
- **No screen in this pass was opened in a browser.** The PD-014 §14 evidence run covered the five
  Product Operations surfaces; the other 81 have not been rendered as a signed-in Product Director.
- **`platform-ops`'s other 42 pages are out of scope** — they belong to the Platform Operations module,
  not the PD sidebar, and are reported here only because Technical Operations borrows one of them.
- **Write-surface detection is structural**, matching `method: "POST" | "PATCH" | "PUT" | "DELETE"` and
  `fetch("/api…")` across each route's component tree. A write issued through a **server action** would
  not be caught by that pattern, so it was checked separately: `"use server"` appears **nowhere** under
  `/super-admin/pd`, and no `<form action={…}>` exists there either. The zero in §1 is therefore a
  measured zero across both mechanisms, not the absence of one pattern.
