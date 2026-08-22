# CPR-BOOK-E2E-001 — Self-Booking Acceptance Report

| Field | Value |
| --- | --- |
| Specification | CPR-BOOK-E2E-001, Self-Booking Readiness & End-to-End Acceptance |
| Date | 2026-08-22 |
| Commit | `ea9c9006` (report), rule coverage closed same day |
| Environment used | **Staging** ref `ezhvpgtcqcdsgylrxgdb` for Gates C and D; production `Trial` for the Gate B configuration snapshot |
| Environment required | **Staging** (§Primary environment) |
| Personas run | **None.** The journey reaches slot selection and stops at the confirmation code. |
| Status (§13) | **READINESS CONTROLS GREEN** + **PRODUCTION DEPENDENCY OPEN** |

> **Status changed 2026-08-22, later the same day.** The rule-coverage failure below was closed, so
> every checker prerequisite now passes and the publish readiness surface reports **0 blocking**.
> That moves the status off NOT READY to READINESS CONTROLS GREEN — which §13 defines as
> *"Not sufficient for release"*, and §2 as *necessary but insufficient*. **It is not
> FUNCTIONALLY READY IN STAGING and must not be recorded as such**: no acceptance journey has been
> run to completion: it stops at the one-time code, which no configured provider can send.

---

## The blocking finding: no messaging provider, so no booking can complete

> **⚠ CORRECTION, 2026-08-22.** An earlier revision of this report stated that no staging project
> existed. **That was wrong.** It was sourced from a code comment — `.github/workflows/ci.yml:17`,
> "no staging project exists yet" — which is stale, and which I treated as a fact about
> infrastructure without verifying it. The correction came from the repository owner.
>
> This is the failure mode this codebase has recorded before: an absence that stopped being true,
> restated by a reader who did not re-check it. A comment is evidence of what someone believed when
> they wrote it, never of what is true now, and infrastructure claims in particular have to be
> measured against the infrastructure.

§Primary environment: *"Staging. Do not use production as the routine acceptance environment."*

**Staging exists and is healthy.** A separate Supabase project, ref `ezhvpgtcqcdsgylrxgdb`,
distinct from production's `rnnqhlrcgvsauigxwszl`. Credentials for it are present locally as
`STAGING_SUPABASE_URL`, `STAGING_ANON_KEY`, `STAGING_SERVICE_ROLE_KEY` and `STAGING_DB_URL`. The
schema is deployed, and the synthetic smoke practitioner exists and is confirmed.

| Staging table | Rows |
| --- | --- |
| `practice_workspace` | 2 (`Automation Practitioner (synthetic)`, `Retry Proof (synthetic)`) |
| `practice_membership` | 4 |
| `practice_practitioner_identity` | 2 |
| `practice_location` | **0** |
| `practice_availability_template` | **0** |
| `practice_booking_rule` | **0** |
| `practice_booking_access` | **0** |
| `practice_registration_template` | **0** |

**The real blocker is narrower and far more tractable than "no staging".** `scripts/provision-staging-fixture.ts`
provisions the practitioner and workspace through the real provisioning engine — deliberately, so the
fixture gets the capabilities and entitlement the product actually creates — but it stops there. It
provisions no location, session, booking rule, booking-access handle or registration template, so
there is nothing in staging for a public booking journey to touch.

**Gates C, D, §8 (concurrency) and §9 (patient-facing HFE) were therefore not executed, and no claim
is made about them.** Marking them anything other than NOT RUN would be the precise failure §2 of
this specification was written to prevent. What unblocks them is extending the staging fixture to
cover the publication prerequisites — bounded work against an environment that already exists.

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
| **Location / rule coverage** | **PASS** (closed 2026-08-22) | Was FAIL: the only patient-bookable session — Wednesday 08:30 at **Nsambya Hospital** (`link_only`) — was covered by no rule in force, the single rule being scoped to **TMR International Hospital**. Closed by adding `Public self-booking - Nsambya Hospital` (horizon 120, notice 30, visibility public, active). |
| Notification channel | **OPEN** | `practice_message_channel`: 0 rows. The surface says so in its own words: *"This deployment has no SMS gateway and no mail provider configured, so nothing can send a code."* Named as a production/pilot dependency per §10, not silently treated as complete. |

**The prerequisites are now simultaneously valid**, notification excepted and named.

The Nsambya rule was scoped to that location rather than clearing the existing rule's location, so
the TMR rule keeps the scope it was configured with and the change is reversible by archiving one
row. It was written through `saveBookingRule`, not SQL, so it carries the same validation, version
and audit trail the screen produces; `RULE_CONFLICTS_RESOLVED` reports **PASS / 0**, two rules on
different locations having no overlapping scope to tie on.

### Readiness surface after the change

| | |
| --- | --- |
| Blocking checks failing | **0** |
| Could not be checked | 2 — `LOCATION_DIRECTIONS`, `WAITING_LIST` (advisory, honest-absence by design) |
| Warnings | 1 — `NOTIFICATION_CHANNEL`, `0 of 2` |
| Every published session resolves horizon, notice and public visibility | **PASS — 1 of 1** |
| Required registration fields are valid | **PASS — 10 of 10** |
| Booking page status | Draft |

---

## Gate C — the canonical public journey, run against staging

Built server on `127.0.0.1:3100` against staging ref `ezhvpgtcqcdsgylrxgdb`, signed out, through the
public address and the authoritative API. No developer shortcuts and no direct database writes in the
journey itself.

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Open public booking address | **PASS** | `/practice/book/@stagingclinic` → 200, renders the practitioner and `CP-000002-1` |
| 2. Select location | **PASS** | `Staging Clinic (synthetic)` offered |
| 3. Select appointment context | **PASS** | `new_consultation` offered; `emergency` refused with `TYPE_NOT_OFFERED` |
| 4. Select date | **PASS** | 14-day window, first slot Wed 2026-08-26 |
| 5. Select slot | **PASS** | **24 server-authorised slots** — 09:00–13:00 Kampala at 20 minutes, two Wednesdays |
| 6–13. Register → confirm → commit → downstream | **BLOCKED** | No messaging provider exists, and the code is not optional |

### Why 6–13 stopped, and why that is the correct behaviour

The public page refuses booking outright:

> *"Online booking is not open here yet: this practice has no way to send you the confirmation code
> that booking requires. Contact them directly."*

`patient-booking.ts` raises `NO_WAY_TO_SEND_A_CODE` from real deliverability, not from a settings row,
so enabling a channel would not have unblocked it — correctly. Delivery needs `TWILIO_ACCOUNT_SID` /
`TWILIO_AUTH_TOKEN`, an Africa's Talking equivalent, or `RESEND_API_KEY`; none is configured in any
environment. And the code cannot be waived: migration 254's `practice_booking_access_publishable`
refuses to publish a page with `otp_required` false.

**So a deployment with no messaging provider cannot take a public booking at all, by design.** The
product says so plainly rather than sending a patient to wait for a message that is never coming,
which is exactly §10's posture.

---

## Gate D — negative and boundary cases, against the real public endpoint

Each case was applied to the live rule, queried through
`/api/v1/practice/public/booking`, and reverted.

| Case | Expected | Observed |
| --- | --- | --- |
| baseline | slots returned | **24** |
| `visibility = "internal"` | no public slots | **0** |
| `booking_horizon_days = null` | NULL_AS_MISSING, no public slots | **0** |
| horizon shorter than the next session | no public slots | **0** |
| appointment type not offered | refused | `TYPE_NOT_OFFERED` |
| restored | slots return | **24** |

The final row is the control. Without it, four zeroes prove only that the endpoint was broken.

This is the first evidence in this arc that the frozen NULL_AS_MISSING decision and the visibility
rule hold **through the authoritative public path** rather than through a unit assertion over the
predicate.

---

## Findings raised as separate work (§14)

Three conditions were found in which `publishReadiness` reports **0 blocking** while no patient can
book. Each was measured, not inferred. None is fixed here, per §14's instruction not to redesign
booking architecture while executing the pack.

**1. A hidden identity 404s the published page, and no check mentions it.**
`resolveHandle` refuses an identity whose `discovery` is `hidden` or whose `status` is outside
`RESOLVABLE_STATES` (`active`, `licence_verified`). Every identity *starts* hidden and `created`.
Measured both ways on the live page: `discovery=hidden` → **404**, `discovery=public` → **200**, and
`publishReadiness` returned **0 blocking in both states**. A practitioner can clear every blocker,
publish, hand out their address, and have it answer 404.

**2. A published page offers nothing until locations and types are chosen.**
`visible_location_ids` and `visible_appointment_types` default to empty, and empty means *none* —
`patient-booking.ts` narrows behind `if (ids.length > 0)` and raises `NOTHING_OFFERED`. A page that
was published, resolvable and 0-blocking told patients *"this practice has not yet chosen what it
offers online."*

**3. A session template is not slots.** `practice_availability_slot` was empty estate-wide in
staging, so public availability answered `slots: []` for a fully configured, 0-blocking page.
Emptiness there is indistinguishable from "fully booked". Slots are materialised by `generateSlots`;
nothing prompts a practice to run it.

**4. `NOTIFICATION_CHANNEL` is classified as a warning but behaves as a blocker.** It is publishable
with `acceptWarnings`, yet it makes every public booking impossible, because the one-time code is
mandatory and undeliverable. A check whose failure means zero bookings is not advisory. This is the
single most consequential classification in the readiness list.

---

## §15 Acceptance matrix

| Area | Required evidence | Result |
| --- | --- | --- |
| Verdict semantics | Scoped uncovered + unresolved, both break-tested | **PASS** |
| Public handle | Canonical handle resolves correct Practice | **PASS** — /practice/book/@stagingclinic resolves the correct Practice |
| Registration | Published template works for adult/minor/returning | **NOT RUN** — blocked at the code step |
| Constraints | Explicit notice + finite horizon + capacity enforced | **PASS** — proven through the public endpoint (Gate D) |
| Visibility | Internal sessions absent from public server response | **PASS** — internal returns 0 slots, restore returns 24 |
| Atomic booking | Valid state after success, safe state after failure | **NOT RUN** — no messaging provider |
| Concurrency | No overbooking under deliberate race | **NOT RUN** — needs a committable booking |
| Downstream Practice | Appointment appears in Planner | **NOT RUN** — needs a committable booking |
| HFE | Public mobile/desktop walkthrough | **PARTIAL** — public page reviewed; the wizard is unreachable |
| Notifications | Required for release, or explicitly OPEN | **OPEN** — named dependency |

---

## §16 Definition of Done

| Criterion | Met |
| --- | --- |
| Corrected 19/0 verdict reproduced from a clean state | Reproduced; **not** from a clean staging state |
| Assertion 16 proves both arms independently | **Yes** |
| All publication prerequisites simultaneously valid | **Yes**, notification excepted and named |
| Adult / minor / returning journeys pass in staging | **No** — staging holds no booking fixture |
| Negative cases pass | **No** — staging holds no booking fixture |
| Public availability cannot bypass server-side constraints | Proven by control only |
| Successful booking produces correct appointment + downstream visibility | **No** — staging holds no booking fixture |
| Human HFE review at both widths | **No** |
| Notification limitation explicitly classified | **Yes** — OPEN |
| Acceptance report stored in the evidence location | **Yes** — this file |
| Status changed to FUNCTIONALLY READY IN STAGING | **No, and it must not be** |

---

## Status and what would move it

**READINESS CONTROLS GREEN** + **PRODUCTION DEPENDENCY OPEN**.

One thing now stands between this and FUNCTIONALLY READY IN STAGING:

**Staging holds no booking fixture.** It blocks nine of the ten matrix rows. The environment, the
schema, the credentials, the CI job, the production refusal and the synthetic practitioner all
already exist; what is missing is the booking configuration inside it — a location, at least one
patient-facing session, a rule covering it, a claimed handle on a booking-access profile, and a
published registration template. Extending `scripts/provision-staging-fixture.ts` to provision those
through the real engines, the way it already provisions the workspace, is what makes Gates C, D, §8
and §9 runnable.

Notification remains **PRODUCTION DEPENDENCY OPEN**, and under §10 no green verdict may imply
confirmations are operational while it stands. The readiness surface currently states the limitation
itself rather than hiding it behind the verdict, which is the posture §10 asks for.

⚠ **What "0 blocking" does and does not mean.** It means every prerequisite the checker can test is
satisfied. It does not mean a patient can book. §2's table is explicit that the readiness verdict
does not prove public availability, registration and booking integrate correctly — and that remains
entirely unproven here, because it can only be proven by a journey nobody can yet run.

### Not done

§12 asks for public-route integration tests and a minimum stable staging smoke journey. They come
after the fixture, not before: written against an unprovisioned staging they would pass by touching
nothing, which is the shape §2 warns against. The order is fixture → journey → regression control.

### Correction to the CI comment

`.github/workflows/ci.yml:17` still asserts that no staging project exists. It is wrong, it is the
source of the error corrected at the top of this report, and it should be fixed in the same pass as
the fixture work — a stale absence left in place is the thing that produced this.
