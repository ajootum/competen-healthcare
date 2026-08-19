# CPR-PD-014 — Product Operations optimisation, build record

**2026-08-19.** Migrations 339–342 applied and verified. 30/30 harnesses, plane boundary green,
`tsc` clean, all five routes compile and enforce their capability guard.

## §11 sequence

| | Work package | State |
|---|---|---|
| 1 | Provisioning & Onboarding + onboarding projection | **done** |
| 2 | Launch Readiness + attestation ledger | **done** |
| 3 | Technical Operations + retry/control hardening | **done** |
| 4 | Practice Workspaces + health derivation / Practice 360 | **done** |
| 5 | Regression pass against Operations Overview | **done — this section** |

## §11 step 5 — the regression pass

**Operations Overview is unchanged: zero lines differ** against the pre-arc baseline. §12 permits
"strictly necessary compatibility wiring", and none was necessary — the three modules it depends on
(`pd-operations.ts`, `ops-ui.tsx`, `practice/operations.ts`) are also byte-identical, because every new
loader was added alongside rather than folded into them.

It remains a synthesis layer: four summary stats, launch state, "what needs attention", and a *Where
each fact is owned* panel linking to the three detail screens. It answers no question the detail screens
answer in full.

### One real finding: §7.3 duplication

Technical Operations still rendered **the entire cutover gate** — the same twelve items Launch Readiness
now presents as a governed decision. §7.3 forbids it: "Do not repeat the full Launch Readiness
checklist."

Two surfaces answering the same question is worse than it sounds, because the one with *less* context
is the one an operator happens to be looking at. Replaced with the summary a control-plane operator
actually needs before touching a toggle — how many controls are outstanding, which automatic checks are
failing right now — and a cross-link. Passing and pending items belong to the observational screen.

## Substrate delivered

| Migration | What | Verified |
|---|---|---|
| 339 | onboarding projection + `pd_ops_config` thresholds | 8 columns, `step_data` absent, real stall/complete rows |
| 340 | human attestation ledger, append-only | 12 columns, trigger enabled, secdef pinned |
| 341 | `provisioning_request.payload` for faithful retry | present as `jsonb` |
| 342 | launch-flag change history projection | 6 columns, no payload fields, real history |

## What is proven, and what is not

**Proven by break-test:** the health derivation (removing the activation window, and letting FAILED lose
to NEW, each turn it red), and the Practice 360 boundary (planting a patient link turns it red).

⚠ **Not proven:** the append-only trigger on 340 has never been seen to refuse an UPDATE, and the retry
endpoint has never been exercised. Both need a database that can be written to and rolled back —
staging, whose Postgres port is currently refusing TLS. Neither is a claim this record makes.

**Screenshots are now produced.** All five surfaces at 1440px in `docs/evidence/cpr-pd-014/`, captured
as a synthetic Practice Product Director against staging. §14 asks for healthy and exception states and
staging carries both: a practice stalled at 0/6, a launch gate with four outstanding controls, a failing
automatic check, alongside an ACTIVE/HEALTHY workspace. See "The fixture, and what it exposed" below.

## §7 C — the guided provisioning console

Five steps replace the single form: find account, verify eligibility, configure, review, provision.

**Step 2 is the one that earns the rewrite.** The old form let an operator type a practice name,
market, timezone and profession for somebody who already owned a Practice, and told them at submit.
The search endpoint already returned `existingPracticeStatus` on every result, so the information was
present and simply arrived after the work.

⚠ **It does not block.** §7.2 C says a duplicate-safe request returns the existing workspace rather
than creating another, so one Practice per person stays enforced by the ENGINE. This flow states
plainly what a request will do and leaves the API as the thing that decides. A client-side block would
be a rule nobody can rely on and a second place to disagree.

Step 5 keeps created versus replayed visible, which a success toast usually loses: both are a 200, and
only one of them made a workspace. The page no longer reloads out from under the operator.

Two unused reads went with it. The console kept a style constant orphaned by the move, and the
identifiers page selected role and roles from profiles and used neither. That second one is the same
§9 violation found on Technical Operations, except it read ONLY the authorization columns, so the
query was removed entirely rather than narrowed.

## Both unproven controls are now proven — and one was wrong

The ISP change restored the staging database port, so the two controls this record listed as
unexercised were exercised.

### The append-only ledger holds

Against staging, inside a transaction that rolled back: a row appends, an `UPDATE` is refused, a
hand-written `DELETE` is refused, both with the intended message.

### ⚠ But the same test found a real defect in the read

Appending a `SUPERSEDED` row over an `ATTESTED` one and asking
`plat_pd_launch_attestation_current` which verdict stood returned **ATTESTED**.

`now()` in PostgreSQL is **transaction** time, so two attestations recorded in one transaction carry
an identical `attested_at`, and `distinct on … order by attested_at desc` resolves that tie
arbitrarily. The ledger recorded both rows perfectly; the READ of it was undefined.

This is not a test-only edge. A supersession appended in the same request as the attestation it
replaces is the ordinary case, and any batch correction ties too. **Migration 343** adds a monotonic
`seq` and orders on it — a sequence answers "which row was appended later" without reference to any
clock, which is the actual question. Verified on staging: identical timestamps, correct verdict.

**Reading the migration would not have found this.** It took appending two rows and asking.

### The retry endpoint is idempotent

| Assertion | |
|---|---|
| Unauthenticated `POST` | **401**, refused before touching anything |
| Run 1 | created exactly one workspace |
| Retry | created **no** additional workspace |
| Retry | continued the **same** workspace |
| Memberships | not duplicated (`practice_owner`, `practitioner`) |

`scripts/pd-retry-idempotency-proof.ts` drives the engine with exactly what the POST handler passes,
so what is proven is the endpoint path rather than a re-implementation. It writes, so it is a proof
script against staging and not a CI harness — supabase-js speaks HTTP, not transactions, so this
cannot be rolled back. The membership assertion is there because capability and membership
duplication is a failure this estate has actually had.

## The fixture, and what it exposed

§14 needed an authenticated HQ session. `scripts/provision-staging-hq-fixture.ts` creates one on
staging — an RFC 2606 address that can never be a real mailbox, appointed to `practice_product_director`,
guarded by the same production predicate the smoke fixture uses so it refuses any other target. It exists
so that nobody signs in to production for a screenshot.

### ⚠ A capability alone does not open /super-admin

The first version appointed the fixture, the resolver confirmed all 20 capabilities, and **every route
still redirected to `/practice/no-account`**. `src/app/super-admin/layout.tsx` calls `admitToEstate`
before any capability is consulted, so the account also needed an active `platform_membership` row.

That is COMP-ARCH-PSA-001's two-gate split doing exactly what it says — gate 1 asks whether a person
belongs to Competen Platform at all, gate 2 asks what they may do there. An identity satisfying only the
second holds every permission the product defines and cannot open the door. It is written up in the
capability matrix because the appointment is the half that looks finished.

The membership is an explicit row, not the `super_admin` break-glass short-circuit, which would also have
admitted the account and would have made every screenshot evidence of what an OWNER sees rather than what
a Product Director sees — the distinction §9 exists to protect.

### ⚠ And the capture tool reported five screenshots of the refusal

It counted files. Five identical pictures of `/practice/no-account`, announced as delivery evidence. It
now asserts the landed path against the requested one and exits non-zero on a mismatch, so a redirect is a
failure rather than an artefact.

A second artefact was fixed the same way. Playwright's `fullPage` capture composites a `position: fixed`
element against beyond-viewport content differently, so the PD sidebar landed on top of the page beside
it and three of five images read "ovisioning & Onboarding". Measured live, the h1 starts at x=264 and the
sidebar ends at x=240 on exactly those pages — **the product was correct and the evidence invented a
layout defect**, which is worse than no evidence because the reader cannot tell it from a real one. The
viewport is now grown to the document so nothing is ever beyond it.

## Outstanding

Nothing. §14 delivery evidence is complete: screenshots in `docs/evidence/cpr-pd-014/`, and the
capability matrix at `docs/CPR-PD-014-CAPABILITY-MATRIX.md`.

Two findings were recorded rather than fixed, both in the matrix §6: there is no read-only Product
Operations access (one position holds the five screens and both writes), and the provision and flag
controls are enforced at the API but not conditioned in the UI. The second is invisible only because of
the first, and both turn on a decision about separating the grants.
