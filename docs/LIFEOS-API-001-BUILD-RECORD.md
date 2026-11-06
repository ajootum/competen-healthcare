# LIFEOS-API-001 — build record, Commitment Engine and API

**Branch:** `lifeos/commitment-engine-01`. **Design:** [LIFEOS-API-001](LIFEOS-API-001-v1.2-architecture.md). **Decision:** [ADR-018](adr/ADR-018-lifeos-sealed-product.md).

## State

| Item | State |
|---|---|
| Gate `lifeos_core` | OFF everywhere. No flag row is written by the migration. |
| Migration 901 | Applied to staging. **Not applied to production.** |
| Production | Unchanged. Nothing in this PR reads LifeOS tables unless the gate is on, and the gate reads as off while the migration is absent. |

## Migration 901-lifeos-core.sql

- **Dependencies:** none. It references no other migration's objects.
- **Application order:** any point in the sequence.
- **Pre-application state on staging:** 0 `lifeos_*` tables, functions and views.
- **sha256:** `008dfa62f2275da56b6c129813bc4d17a8bda2f3d703741f0c55bcce3361d5ad`
- **Applied to staging:** twice at this checksum, the second run a no-op. An earlier draft had been applied before it, so a clean apply was also proved: inside one transaction, the rollback SQL, then this file twice, then ROLLBACK, leaving staging untouched. Afterwards 24 tables, 3 views, 7 functions. The migration writes no flag row. The harness later wrote `lifeos_core`, and left it disabled.
- **Rollback:** [rollback-901.sql](evidence/LIFEOS-API-001/rollback-901.sql), removes every `lifeos_*` object and nothing else. Rehearsed on staging inside that same transaction: 0 tables, views and functions after it ran, and all 24 tables with their rows present after the ROLLBACK.
- **House rules:** `scripts/migration-house-rules.ts` all clear. It carries the APPLY THIS FILE WHOLE banner.

## Verification

| Check | Where | Result |
|---|---|---|
| Unit tests, `src/lib/lifeos` | local | 83 of 83 |
| Seal, including 13 planted violations | `scripts/lifeos-seal-harness.ts`, local, also in CI | 33 of 33 |
| Acceptance, real HTTP and real sessions | `scripts/lifeos-acceptance-harness.ts`, against staging | 187 of 187 |
| Independent security read | a separate reviewer | 8 findings, see below |

**The acceptance run covers:** the gate before authentication, entitlement admission and lapse, the full commitment lifecycle, idempotent retries including six concurrent ones, stale writes, private records hidden from other members and organisation admins, grants and revocation, cross-organisation references refused by the API and by the database, delegation keeping ownership, suggestions changing nothing until accepted, append-only audit with no content, anon and signed-in browser clients refused at the database, rate limits, leaving an organisation with personal work intact, and a suspended tenant.

**One earlier run stopped on a network drop.** The gate failed closed as designed, so that run stopped with an empty 404. The re-run passed in full.

**Findings from the independent read.** The read was of the code as it stood before these fixes.

| Finding | Severity | Outcome |
|---|---|---|
| A retry could return a record after access was lost | High | Fixed, tested (A23d) |
| A write-grant holder could widen a private record's scope | High | Fixed, tested (A23b) |
| Concurrent accepts could apply a suggestion twice | Medium | Fixed, tested (S25b) |
| A crafted cursor could test hidden column values | Low | Fixed, tested (L2b) |
| A non-owner finalising a review published private counts | Low | Fixed, tested (R5b) |
| Grants outlived the giver leaving | Low | Fixed for leaving, tested (C4b). Lapse is a known limit below. |
| Archiving an active delegation left grants open | Low | Fixed, tested (D4b) |
| Another member's block could stop a replan | Low | Fixed in code, no acceptance check of its own |
| An organisation entitlement outlives the organisation | Low | Known limit below |

The reader found no injection in `lifeos_mutate`, no trigger bypass, and no way for a suggestion to change anything without an accept.

**Not verified:**

- **Production.** Nothing has been applied or deployed there.
- **Load.** No performance or load test was run.
- **Per-person database rules.** RLS is deny-all with no per-person policies, by design. See LIFEOS-API-001 section 5.

## Stage 2: the interface (delivery step 5)

The V1.1 baseline rebuilt on the API at `/lifeos`: Calendar, Today, Capture, Commitments, My Worlds, Weekly Plan, Four Quadrants, Weekly Review and Chief of Staff. **No migration.** The gate stays off, so the page answers 404.

- **API-first in practice:** the interface has no database access, and the seal check fails if it imports the service or the adapter.
- **New API surface:** `PATCH /me` for a person's own settings, and `scheduledFrom` and `scheduledTo` filters on commitments.
- **Kept from the baseline:** the look, the wording, and the rules: calculated quadrants, inbox until clarified, delegation keeping ownership, proposals needing approval.
- **Changed from the baseline, as HFE fixes:**
  - At tablet width the quadrants no longer cramp.
  - On a phone a More tab reaches the five screens that had no route there.
  - Touch targets follow the pointer, as CPR-MOB-001 requires.
  - Focus is visible, dialogs handle Escape, and search is on every screen.
  - A new person starts empty: the sample data is not seeded.

**Verified:** `scripts/lifeos-ui-harness.ts`, 38 of 38, in Chromium through the real API against staging. It covers the gate, sign-in redirect, a person with no access, worlds, capture, edit, Big Rock, protected time, a second device seeing the same record, complete and reopen, delegation, approving a proposal, plan, review, search, all nine screens at 375, 768 and 1366 px with no sideways scroll, the More tab, the back button, and no uncaught script errors. Screenshots are in `docs/evidence/LIFEOS-API-001/stage-2/`.

**Not verified:** real phones and tablets (widths were emulated), a screen reader, and production. No independent security read was run on this stage, because it adds no access logic beyond `PATCH /me`.

**Known limits:**

- Delegation in the interface names a person or team as text. Choosing an organisation member comes with step 8.
- Calendar events have no screen yet, since nothing creates them until an integration exists.
- Search covers open commitments, this week and worlds, and says so when nothing matches.
- After each change the view reloads from the server, so a slow connection shows disabled buttons rather than instant updates.

## Stage 3: optional access for Competen Individuals (delivery step 6)

A person with a live Competen Individual entitlement can choose to turn on LifeOS, and can turn it off.

- **Closed four ways, each failing closed:** the `lifeos_core` gate, the `lifeos_individual_access` flag, the eligibility read, and published terms in `lifeos_terms`.
- **Their choice:** nothing is created until they accept the terms. The version and time are recorded on the entitlement, and the database refuses opt-in access with no terms recorded.
- **Separation:** the adapter asks Competen Individual one yes-or-no question. Nothing flows the other way. LifeOS writes nothing to Competen Individual, and the two products cannot read each other's records.
- **Lifetime:** access through Individual ends when Individual ends, and the records survive. Turning LifeOS off keeps the records, and turning it on again finds them.
- **The link:** one plain link in the Individual account menu, behind `individual_lifeos_entry` in the estate's existing flag table. Absent means no link. Individual imports nothing from LifeOS.

### Migration 902-lifeos-access-terms.sql

- **Dependencies:** 901. Application order: 901, then 902.
- **Pre-application state on staging:** no `lifeos_terms` table.
- **sha256:** `129f70c051762235d30b00c83c277e36bb304777e0682ed05e81e346c3ff6535`
- **Applied to staging:** twice, the second run a no-op. It writes no row.
- **Rollback:** [rollback-902.sql](evidence/LIFEOS-API-001/rollback-902.sql), rehearsed on staging inside a rolled-back transaction.
- **Not applied to production.**

**Verified:** `scripts/lifeos-individual-access-harness.ts`, 32 of 32 over real HTTP on staging, and the opt-in screen in the browser walk.

**Not verified:** the Individual account-menu link in a browser. It renders only with its flag on, and is covered by the type check and lint only. No independent security read was run on this stage.

**Owner decisions this stage needs before it can be used:** LifeOS terms of use, then the flags. See the PR.

**Known limit:** the interface has no sign-out control of its own yet.

## Not done at this stage

- **No way to get access outside a script.** Provisioning and entitlement grants are `core/provision.ts`, called by the harness. There is no commercial plan or billing behind `lifeos_entitlement` yet. Step 6.
- **No AI model.** The Chief of Staff is rules only, matching the prototype. Connecting a model is a separate owner decision on what data may be sent.
- **No custom domains, no tenant admin screens.** Step 7.
- **No integration provider, no OAuth, no public routes.** Steps 8 and 9. Every route is `internal`.
- **Known limits, from the independent read, to close before organisation access is issued (step 7 or 8):**
  - An organisation entitlement is not tied to the tenant's status or the person's membership, so it outlives them. It exposes no organisation records, because workspace access is checked separately. Nothing issues these entitlements yet.
  - A person whose entitlement lapses cannot revoke grants they gave until it is renewed. The grants stay as they set them.
  - Grants made before a person leaves are revoked on leaving. Those on a suspended tenant's workspace stay, and the workspace itself refuses everyone.
- **Suggestions do not expire automatically,** and `lifeos_idempotency` has no purge job. Neither holds up the gate-off state.
