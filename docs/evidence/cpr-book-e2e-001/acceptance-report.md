# CPR-BOOK-E2E-001 — Self-Booking Acceptance Report

| Field | Value |
| --- | --- |
| Specification | CPR-BOOK-E2E-001, Self-Booking Readiness & End-to-End Acceptance |
| Date | 2026-08-22 |
| Commit | `5027f1a426441d9851d002fea79105631bc246d1` |
| Environment used | **Production** (`Trial`, workspace `b7c5dbc1…`) — see the blocker below |
| Environment required | **Staging** (§Primary environment) |
| Personas run | **None.** No acceptance journey was executed. |
| Status (§13) | **NOT READY** |

---

## The blocking finding: the required environment does not exist

§Primary environment: *"Staging. Do not use production as the routine acceptance environment."*

**There is no staging project.** The repository states this itself, in
`.github/workflows/ci.yml:17`:

> against the one live Supabase project this repo has (no staging project exists yet — see
> `docs/HARNESS-INVENTORY.md`)

The staging *contract* is built and waiting — the `smoke-authenticated` CI job, the
`STAGING_SUPABASE_URL` / `STAGING_ANON_KEY` / `STAGING_SERVICE_ROLE_KEY` variables, and a synthetic
practitioner helper that refuses production at the network layer
(`e2e/helpers/synthetic-practitioner.ts` via `scripts/production-guard.ts`). What is missing is the
project those variables would point at.

This is not a gap that can be worked around by substituting production, and not only because the
spec forbids it: **the suite that would run Gate C actively refuses to.** That refusal is correct and
should not be softened.

**Consequently Gates C, D, §8 (concurrency) and §9 (patient-facing HFE) were not executed, and no
claim is made about them.** Marking them anything other than NOT RUN would be the precise failure
§2 of this specification was written to prevent.

---

## Gate A — public readiness verdict semantics

| Item | Result |
| --- | --- |
| Verdict scoped to public-relevant blockers only | **PASS** |
| Internal clinic names absent from publication reasons | **PASS** |
| Assertion 16 evaluates both scoped arms | **PASS** |
| Each arm break-tested independently | **PASS** |
| Control suite | **19 / 0**, typecheck 0 errors |

Both arms were scoped, and it took two passes to get there. Scoping only the `unresolved` loop took
the counter from `11 of 1` to `0 of 1` while three internal clinics were still named underneath it
as reasons the practice could not publish — the number improved and the meaning did not. `uncovered`
is now scoped at the point of use, so `rw.uncovered` keeps the broader meaning the rules-management
screen legitimately needs (§1). Assertion 16 fails if either filter is removed; both plants were
verified to go red and both files restored under `sha256sum -c`.

Per §17 the corrected verdict is now **frozen**. No further refinement of the counter was made after
this result.

---

## Gate B — publication prerequisites, evaluated together

Read-only evidence from the production workspace. This records the *current configuration state*; it
is not an acceptance run.

| Prerequisite | State | Evidence |
| --- | --- | --- |
| Public booking handle | **PASS** | `booking_access.handle = elisham1`, unique in the estate; `mode=link_only`, `publish_state=draft` |
| Registration template | **PASS** | `Patient registration`, published, default, 10 fields; required+visible = `display_name`, `birth_date`, `phone` |
| Booking horizon | **PASS** on the rule | `booking_horizon_days = 120` (explicit, finite) |
| Notice period | **PASS** on the rule | `lead_time_minutes = 30` |
| Capacity | **PASS** | `capacity = null` = the derived ceiling per migration 241, not "unlimited" and not missing |
| Visibility | **PASS** on the rule | `visibility = public` |
| **Location / rule coverage** | **FAIL** | The only patient-bookable session — Wednesday 08:30 at **Nsambya Hospital** (`link_only`) — is covered by **no rule in force**. The single rule is scoped to **TMR International Hospital**. |
| Notification channel | **OPEN** | `practice_message_channel`: 0 rows. Named here as a production/pilot dependency, per §10 — not silently treated as complete. |

**The prerequisites are not simultaneously valid.** Six hold on a rule that does not govern the one
session a patient could book. Clearing the rule's location, or adding a rule covering Nsambya, is
what closes this; it is configuration, not code.

---

## §15 Acceptance matrix

| Area | Required evidence | Result |
| --- | --- | --- |
| Verdict semantics | Scoped uncovered + unresolved, both break-tested | **PASS** |
| Public handle | Canonical handle resolves correct Practice | **PARTIAL** — handle valid; resolution not exercised end-to-end |
| Registration | Published template works for adult/minor/returning | **NOT RUN** — no staging |
| Constraints | Explicit notice + finite horizon + capacity enforced | **PARTIAL** — enforced in code and unit-proven; not proven through a public request |
| Visibility | Internal sessions absent from public server response | **PARTIAL** — proven by control, not by a public response |
| Atomic booking | Valid state after success, safe state after failure | **NOT RUN** |
| Concurrency | No overbooking under deliberate race | **NOT RUN** |
| Downstream Practice | Appointment appears in Planner | **NOT RUN** |
| HFE | Public mobile/desktop walkthrough | **NOT RUN** |
| Notifications | Required for release, or explicitly OPEN | **OPEN** — named dependency |

---

## §16 Definition of Done

| Criterion | Met |
| --- | --- |
| Corrected 19/0 verdict reproduced from a clean state | Reproduced; **not** from a clean staging state |
| Assertion 16 proves both arms independently | **Yes** |
| All publication prerequisites simultaneously valid | **No** — rule coverage fails |
| Adult / minor / returning journeys pass in staging | **No** — not runnable |
| Negative cases pass | **No** — not runnable |
| Public availability cannot bypass server-side constraints | Proven by control only |
| Successful booking produces correct appointment + downstream visibility | **No** — not runnable |
| Human HFE review at both widths | **No** |
| Notification limitation explicitly classified | **Yes** — OPEN |
| Acceptance report stored in the evidence location | **Yes** — this file |
| Status changed to FUNCTIONALLY READY IN STAGING | **No, and it must not be** |

---

## Status and what would move it

**NOT READY** (§13: *"Any mandatory public-booking invariant or acceptance journey fails."*) Two
distinct things hold it there, and they are not the same size:

1. **No staging project.** This blocks nine of the ten matrix rows. It is an infrastructure decision
   for the owner, not a code change: provision a second Supabase project, populate the three
   `STAGING_*` CI secrets, and provision the synthetic practitioner there (never in production).
2. **Rule coverage.** One configuration change in the product — clear the rule's location, or add a
   rule for Nsambya.

Notification remains **PRODUCTION DEPENDENCY OPEN** either way, and under §10 no green verdict may
imply confirmations are operational while it stands.

### Not done, deliberately

§12 asks for public-route integration tests and a minimum stable staging smoke journey. Both would
target an environment that does not exist, so writing them now would produce tests that cannot run
and cannot fail — the shape this specification's own §2 warns against. They are named here as the
first work to do once staging exists, rather than written blind.
