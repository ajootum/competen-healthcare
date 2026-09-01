# CPR-BOOK-PROFILE-001 — Public Booking Profile: current state

Owner spec received 2026-09-01 with a visual comp. Built, verified and deployed the same day.

This records what the build does, where it departs from the comp and why, and the three substrate gaps
that are owner decisions rather than engineering ones.

---

## 1. What the page was, and what it is

The public page at `/practice/book/@handle` composed itself from two reads taken at the screen: the
identity row's public view, and the booking entry. Every field either object happened to carry was
available to render, and four of them were being rendered to patients:

| On the live page before this arc | Why it was wrong | Now |
|---|---|---|
| `CP-000102-9` under the name | s4/AC-02: an internal identifier | Absent from the projection entirely |
| The raw booking URL, printed | AC-04: the patient is already at that address | Absent; the page links |
| "Consultation types: **All types**" | AC-05: the identity's free-text field, whose live value on the owner's own profile was literally "All types" | Replaced by the booking page's own visible types, in patient words |
| "this page is not listed in search" | AC-09: search policy is not a patient's task, and it undermines the page it sits on | Removed from the page; still stated to robots via the metadata directive |

None of those four was a decision anybody made. Each was simply present in an object the screen already
had — which is the failure mode `publicBookingProfile()` exists to end.

## 2. The data contract (s14)

`src/lib/practice/public-profile.ts` is the boundary. One projection, one allowlist exported **as data**
(`PUBLIC_PROFILE_FIELDS`), asserted two ways: a render pin over the output, and a harness assertion that
the real object's key set equals the allowlist exactly — no more, no fewer.

Deliberately absent, each for a stated reason in the file header: the practitioner number, the raw
booking URL, location ids, the workspace id and the user id.

**Interpretation recorded:** s8 says "do not expose internal location IDs"; s14 says internal IDs must
not be serialized. The booking *wizard* legitimately needs a location handle and the server re-validates
it (`submitBookingRequest` refuses a location that was never offered). So the rule is applied as: the
**profile** carries no ids, and no id is ever displayed. The booking journey's own read keeps them.

## 3. The verified badge — built, then refused by a harness, and NOT shipped

**This is the most important thing in this arc, and it is an owner decision that is now open.**

The comp shows a green **"Verified practitioner"** badge. s4 permits the indicator "only if CP has a
canonical verification state that justifies the claim". I read `licence_verified_at` as that state,
projected it, and rendered the badge.

`scripts/practice-booking-link-harness.ts` **5b-tick** went red, and it was right:

> ⚠ AND NONE OF THEM REACHES A PATIENT. A blue tick beside a clinician's name tells a patient that
> somebody checked; what this product holds is a note that a named person looked at a licence, and
> nothing has ever contacted a council. The internal record stays internal.

`identity-service.ts`'s own `NOT_BUILT` list says the same thing in the product's voice: the
licence_verified state is *"a provenance record rather than a verification. Nothing here contacts a
council."*

So s4's condition is **unmet**: the state exists, and it does not justify the claim. Per CLAUDE.md — a
spec is not permission to overturn a recorded decision, and the safer branch is taken without asking —
**the badge was removed**:

- the projection carries **no licence or verification field at all**, so no screen can render one by
  accident (asserted, including for an identity that *has* been internally licence-checked);
- `publicView` is back to what it was;
- the preview tells the practitioner plainly that no profile in this product shows a badge, and why, so
  they do not hunt for a setting that does not exist.

**Open for the owner:** turning this on is not a UI change. It needs real verification behind it — the
professional-council integration PIS-000 s14 defers. If you want a trust marker sooner, the honest
options are ones the product can stand behind (e.g. "Practice verified by Competen" tied to something
that was actually checked), and that is a decision about what claim you are willing to make.

Separately, the schema enforces the weaker rule already: `practice_identity_licence_has_a_verifier`
rejects a `licence_verified_at` with no `licence_verified_by` — discovered when the harness was refused
while trying to fake one. Even the internal record cannot be a tick with nobody behind it.

## 4. What the comp shows that the spec does not, and that this build does not invent

The comp carries a statistics strip — **"Experience 10+ years"**, **"Patients 500+ cared for"** — plus a
practitioner photograph, a hospital photograph, and "Kampala, Uganda" as a locality.

None of those is in the spec's own §3 information hierarchy, and none is representable:

- **Experience / patients cared for**: no column, no derivation, and §9 forbids inferring clinical
  facts from unrelated fields. A count of patients would also be a disclosure about the practice.
- **Locality**: `practice_location` has `name`, `type`, `country` — and `country` is null on all four of
  the owner's locations. "Kampala, Uganda" cannot be produced from anything.
- **Photographs**: no field exists (see §7 below).

Rendering any of them would have meant inventing figures about a real clinician. They are absent.

## 5. What is derived, and from where

| Surface | Canonical source |
|---|---|
| Name, credential, specialty, sub-specialty, bio, languages | `practice_practitioner_identity` (practitioner-controlled) |
| Consultations offered | `practice_booking_access.visible_appointment_types` → `appointmentTypeLabel()` |
| Available at + mode | `practice_location.name` + `type`, collapsed to `in_person` / `virtual` |
| Booking eligibility, why-not | `publicBookingEntry` (unchanged engine) |
| Next available | `nextAvailableDates` across **every** offered type, earliest wins |
| Help contact | `fallback_email` / `fallback_phone` (migration 291) |

**Mode collapse (s8):** five location kinds become two patient answers. Only `teleconsultation` reads as
virtual; every other kind — including an unrecognised one — reads as in-person, because a patient who
travels needlessly is inconvenienced while one who waits at home misses the appointment.

## 6. Availability: three states, and why it streams

`profileAvailability()` returns `found` / `none_in_window` / `unreadable`, and each gets a different
sentence. The middle distinction is the load-bearing one: a scan that **failed** and a scan that found
**nothing** are not the same fact, and only one of them licenses "there are no times available".

A failed scan for any single offered type poisons the whole answer rather than returning the earliest of
what happened to reply — naming a later time as "next available" would hide a genuinely earlier one.

**Measured, then architected:** a slot scan costs ~3s against the live database from a developer
machine, and one scan costs the same as five in parallel — and the same for a 14-day window as for 120.
The cost is round trips, not arithmetic. Awaited inline it put the practitioner's *name* behind a diary
scan (6.1s to first byte). It is now awaited inside a `<Suspense>` boundary: profile 2.6s, availability
streams. Nothing is cached; the time is computed at request time by the engine the booking screen books
against. Next 16 serves bots the fully-resolved page, so indexing is unaffected.

## 7. Substrate gaps — owner decisions, not engineering ones

1. **Profile photograph (s4).** No field exists on `practice_practitioner_identity`. Every profile
   renders the initials avatar, which is the fallback s17 itself prescribes for the no-photo case. A
   column alone would be a field nothing can write; doing it properly means a public storage bucket, an
   upload route with the capability check and audit trail s15 requires, image validation, and a
   moderation position on patient-facing images of real clinicians. That is a new outward-facing surface
   and a decision, not a drive-by. The preview says so in as many words, so a practitioner does not hunt
   for a setting that does not exist.
2. **Public privacy / terms pages (s11).** This deployment serves no public route at either address —
   `src/app/practice/(shell)/privacy` is behind the authenticated shell. s11 requires real destinations,
   so the footer carries no dead links: it states secure booking, renders the practice's own privacy
   notice as text when it published one, and attributes Competen Practice. A public legal page is an
   owner/legal decision.
3. **Locality on locations.** No city/address column. If patient-facing addresses matter, that is a
   schema addition with its own decisions about what a public page may disclose about where a clinician
   works.

## 8. One claim deliberately not made

There is no "you will receive a confirmation email" line in the trust block. Since CPR-SET-COMMS-001 a
practice may switch booking confirmations off per message type, and this projection does not read that
preference — so the claim is one the page cannot stand behind for every practice. The booking reference
shown on screen is unconditional, so that is what is promised. Making the email claimable means exposing
the preference on the public entry.

## 9. The practitioner preview (s13)

New **Public profile** tab on `/practice/setup/patient-booking`. It mounts `ProfileView` — the public
page's own component — over the public page's own projection, and renders the shared `AvailabilityRegion`
rather than a preview-shaped copy of its three sentences. s13's anti-drift rule is only real if there is
one copy.

Beside it, readiness checks that read the projection just rendered, so a tick means "this is on the page
above" and never "a column somewhere is not null". **No percentage** — s13 forbids a vanity figure
without a canonical definition, so it counts what is actually missing. Optional rows (bio, languages,
badge, photograph) are marked optional rather than as failures.

## 10. Defect found by the tests

The booking card's **heading** read "Book an appointment" even in the request-only state, above a button
that only sends a request. A request is not a booking, and the heading is as much a claim as the button.
Caught by the render pin, fixed, pinned.

## 11. Verification

- `ProfileView.test.tsx` — 13 render pins: the four removed fields, badge-only-when-verified, CTA
  eligibility in all three states, optional collapse, mode labels, footer with no dead links.
- `scripts/practice-public-profile-harness.ts` — 35 checks against a provisioned world: routing
  outcomes (unknown / malformed / unreadable / found), the allowlist equality, leak regexes over the
  serialised object, the badge's absence even for an internally licence-checked identity, eligibility
  before and after publication, types and mode, the three availability states incl. a deliberately
  failed scan, and paused pages.
- `scripts/practice-booking-link-harness.ts` 34/0 — including **5b-tick**, the assertion that caught the
  badge. It is the reason this arc did not ship an unearned trust marker.
- **Break-tested:** planting `practitionerNumber` into the projection turned 3a and 3c red; restored
  byte-identical (sha256 verified) and green again.
- Regression: vitest 272, refusal 61/0, plus the patient-facing suites.

## 12. Not done

- s18's analytics measures (view → booking-start → complete conversion). No event surface for the public
  page exists; adding one touches the activation telemetry arc and is a separate piece of work.
- The photograph, public legal pages and locality, per §7.
