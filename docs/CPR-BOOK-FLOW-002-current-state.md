# CPR-BOOK-FLOW-002 — Public Booking Journey: current state

Owner spec received 2026-09-02 with screenshots of the live flow. Built and verified the same day.

---

## 1. The defect the screenshots exposed

`BOOKING_INTAKE_FIELDS` is read by **two screens with two audiences**: the practitioner's Registration
Config workspace, where a practice decides which questions it asks, and the public booking form, where
a patient answers them. Both rendered the same `label` and `help`.

So a patient mid-booking was reading the rule engine's own reasoning:

| Rendered to patients | What it actually is |
|---|---|
| "A booking nobody can call by name is one nobody can call." | Why the field is mandatory in the schema |
| "A rule written for children cannot apply to somebody whose date of birth you never asked for." | Why the practice should collect DOB |
| "three spellings of 'mother' is how a report starts disagreeing with itself" | A data-quality argument for a shared enum |
| "This is not what makes a rule apply to referred patients — that is a property of the booking, not a sentence somebody typed." | A warning to whoever configures rules |
| "⚠ NOT A DIAGNOSIS… ⚠ NOT A MEDICATION LIST… ⚠ A claim, never an identifier of record" | Governance semantics for downstream readers |

**Two of them had also stopped being true.** "Nothing sends to it. This is the address the practice
would use" and "Nothing in this product sends a patient a message, so a yes here changes what is stored
and nothing else" were written when no channel existed. Since CPR-SET-COMMS-001 the product sends a
verification code and a booking confirmation — so a live page was telling patients nothing would reach
them **while the booking they were making emailed them twice**.

A sentence describing an absence rots the day the absence is filled, and nothing makes anyone revisit it.

**Fix:** `patientLabel` / `patientHelp` beside `label` / `help` on every field, and the stale
practitioner-facing strings rewritten to describe what a field is *for* rather than what the deployment
cannot do. `patientHelp: null` is a decision (no help needed) and deliberately does not fall through.

## 2. The journey, per §2 and §4

Stepper is now **Appointment → Date & time → Your details → Confirm**, completed steps carry a check as
well as a colour, and a narrow screen collapses to "Step 2 of 4 · Date & time".

- **§3 identity strip** — practitioner name, credential, specialty and location on every step, from the
  same projection the public profile renders. Replaces a header that showed `@elisham1` in primary
  colour over **"Trial"** — the practice's internal name — as the strongest identity on the page.
- **§5 Step 1** — "What would you like to book?" with the single location *stated* rather than offered
  as a one-option dropdown, and appointment types as selectable cards.
- **§6 Step 2** — slots grouped under their date, timezone as *"Times shown in East Africa Time"*
  (derived from the practice's canonical zone, not hard-coded; the "(GMT+3)" suffix is suppressed
  because it repeats the words before it). **"Week 2" is gone** — an implementation concept on a
  patient's screen; the control now names the dates it covers.
- **§7 persistent summary** — right rail on desktop, compact card on mobile, with Change actions that
  return to the owning step.
- **§11 Step 4** — a real review (practitioner, appointment, where, when, patient, masked contact) with
  per-row Change, *then* verification. It used to be an OTP box; the first time anyone saw the booking
  whole was after it existed.
- **§12 OTP** — "Check your email", masked destination, `autocomplete="one-time-code"`, Resend, and
  Change email which discards the prior challenge.

## 3. Step 3, the principal redesign (§8)

Sixteen flat controls became five sections with three conditional reveals. **The questions are
unchanged** — the practice chose them, and `resolveApplicable` still decides which apply.

| Rule | Behaviour |
|---|---|
| §8.2 / AC-09 | Date of birth is asked; **age only** behind "I do not know the exact date of birth". Never both. |
| §8.3 / AC-10 | Guardian fields hidden for an adult booking themselves; shown automatically for a child (the engine's own `_is_child`), or when the patient says someone else is arranging it. "Use the same number as above" saves re-entry. |
| §8.5 / AC-12 | "Were you referred for this appointment?" No/Yes, with the referrer field revealed only on Yes. |
| §8.6 / AC-13 | Diagnosis, treatment and facility number collapsed behind "Add medical information (optional)". |
| §10 / AC-14 | The required data-processing acknowledgement is separated from the optional "Send me appointment updates by email" preference. |

**A required question is never behind a disclosure.** If the practice made a representative or a
medical field required, that section renders open — a form that will not submit for a reason nobody can
see is worse than a long form.

**Sections re-open from the answers already given**, so Back and forward does not collapse a section the
patient filled in (§4).

## 4. Relationship vocabulary (§8.4 / AC-11)

The stored vocabulary (migration 254's CHECK) keeps all fifteen values. What a **patient** is offered is
a curated subset: mother, father, guardian, spouse, partner, son or daughter, brother or sister,
grandparent, carer, someone else.

Interpreter, employer, insurance contact, emergency contact and social worker are real representative
roles and **none of them is a family relationship** — they stay in the store and out of the question
"who is arranging this appointment". This is §22's instruction applied: preserve the contract, change
the presentation.

**Gap recorded:** §8.4 also suggests a generic "Parent" and "Other relative". Neither exists in the
stored vocabulary, and offering them would produce answers the database refuses. Adding them is a
migration and a decision about the canonical vocabulary, not a UI change.

## 5. The emergency statement (§8.5) — built, migration 363

Owner asked for the field the same day the gap was recorded. `practice_booking_access.emergency_notice`,
nullable, bounded to 600 characters, **no database default**.

- **Nothing writes it automatically.** Not the migration, and not the provisioning baseline — seeding it
  would mean creating a booking-page row for a practice that has not made one, so a sentence could sit
  in it unread. It is written by a practitioner in the booking-page editor and nowhere else.
- **The suggested wording names no number and no country**: *"Online booking is not for emergencies. If
  you need urgent help, contact your nearest emergency service or go to your nearest emergency
  department."* It is offered behind a button ("Use the suggested wording, then add your local service"),
  because "call 911" under a booking form in Kampala sends somebody to a line that will not answer while
  they are having the emergency — worse than the silence it replaced.
- **Null renders nothing.** No empty amber box, and `instructions` are never relabelled as a warning.
- The read ladder steps down **one migration at a time** (363 → 272 → base), so a practice missing 363
  keeps 272's columns instead of silently losing them — the first version of this fell straight to the
  base list and would have turned "this practice allows unverified requests" back into "nobody knows".

Verified: harness round trip (null when unwritten → saves verbatim → clearing genuinely unsets rather
than storing `""`), plus two render pins for the patient side.

## 6. Verification

- **`DetailsStep.test.tsx` — 16 pins** over the §21 matrix rows a render can decide: guardian
  visibility (adult / child / required / already-answered), DOB-vs-age exclusivity in three
  configurations, the referral trigger, the medical collapse and its forced-open case, the curated
  relationship list, consent separation, and a **banned-phrase scan** listing all eleven developer
  sentences the old form showed patients.
- **Break-tested:** collapsing the audience split (`helpOf` returning `help` again) turned three tests
  red, including the banned-phrase scan; restored byte-identical (sha256) and green.
- The refusal harness's §8e rendered-vocabulary scan now covers `patientLabel`, `patientHelp` and the
  patient relationship labels — the half read by strangers, not by practitioners.
- Regression: vitest 302, refusal 61/0, booking-sections 111/0, screens 75/0, intake 45/0, build green.
- Walked in the browser at 1100px and 375px: no horizontal overflow, stepper collapses correctly, the
  full journey reaches the review screen with a masked contact.

## 6b. Add to calendar and directions (§13) — built, migration 365

- **Add to calendar builds the .ics in the browser**, from what the confirmation screen already holds.
  A route that served the file would be a new public endpoint returning a named patient's appointment,
  addressable by whatever it took as a parameter — an enumeration surface this product went to some
  trouble not to have.
- **The entry carries who, where and when, and never why.** It lands in a calendar this product cannot
  reach afterwards: synced to a phone, a work account, a shared family calendar. An appointment with a
  named clinician on a lock screen discloses an appointment; a specialty in the title discloses an
  illness. The description is the booking reference and nothing else — and the reference is the UID, so
  re-adding updates the entry rather than duplicating it.
- **Directions need an address, so migration 365 adds one** (`practice_location.address`) plus an
  optional exact `map_url`. **A pinned link always beats a search**: two clinics share a name and a
  street repeats in the next town, and the wrong guess sends a sick person to the wrong building. With
  only a name and no address there is **no directions button at all**.
- `map_url` is constrained to https **by the database and again by the engine**, because it becomes an
  anchor on a public booking confirmation. The link carries `rel="noopener noreferrer"`.
- **No "View booking details" button**, deliberately: no manage screen is served at this deployment, and
  §13 says not to promise functionality that is not live.

Verified: 18 unit pins on the calendar file (escaping order, folding at 75 octets without splitting a
multi-byte character, no clinical content, refusal of an unreadable instant) and 6 harness checks against
the live database (no address → no directions; address → search link; non-https refused with a sentence;
pin beats search; the file carries the address and no clinical words).

## 6c. The booking funnel (§19) — built, migration 366

- **The existing telemetry could not serve it.** `practice_activation_event` carries a unique index on
  `(workspace_id, event_key)`: it records *milestones*, one per practice, so an emitter may fire on every
  booking and only the first lands. A funnel needs many rows per practice — same shape, opposite
  requirement — so migration 366 adds its own table.
- **No beacon and no analytics endpoint.** Every rung is recorded from a request the wizard already
  makes, or from a server render. An endpoint whose purpose was to accept analytics would be an
  unauthenticated write surface on a public page, needing its own rate limiting and its own abuse story,
  for a metric.
- **There is no metadata column and no journey id, and both absences are the design.** A jsonb bag is
  exactly where somebody later puts a reason for a visit; a journey id at this scale — a practice taking
  three bookings a day, plus a timestamp — is a patient. Conversion is computed from counts instead. A
  patient's words *cannot* be written to this table rather than merely being forbidden, and the harness
  proves it by trying.
- **The cost is stated rather than hidden.** These are page counts, not people: a refresh counts twice
  and a crawler counts once, and the card says so beside the numbers. Time-to-complete is measured only
  on journeys that finished, and says that too. A step whose predecessor recorded nothing has a **null**
  conversion, never 0% — "nobody got that far" and "nobody converted" are different facts.
- **Recording can never cost a booking.** Every emitter swallows its own failures and returns nothing
  anybody can branch on.
- Read surface: a "Where patients stop" card on the Patient Booking Overview tab.

This also answers §6.1: the slot-taken-at-commit rate is now measured, and that is the evidence that
would justify building slot holds. At the time of writing the count is zero, because no patient has yet
completed the public flow.

Verified: 14 unit pins on the arithmetic (zero denominators, unreadable vs empty, a median rather than a
mean, never-throws) and 5 harness checks against the live schema — two of which prove the database
refuses a metadata column and an unreviewed step.

## 7. Not done

- **§6.1 slot holds** — deliberately not simulated, and now deliberately not *built*. The spec is
  explicit that a hold must be a canonical booking-engine capability rather than UI state, and a real one
  means a `HELD` appointment status inside migration 255's exclusion constraint — a change to the frozen
  appointment state machine — plus expiry-aware availability reads, and it introduces phantom
  unavailability (an abandoned booking makes a real slot look taken to everyone, including the
  practitioner's own diary). §6c now measures the rate that would justify that cost. Concurrency remains
  settled where it always was: by the exclusion constraint at the moment of the write.
Nothing else from this specification — see §6d, which closed the last item.

## 6d. Managing a booking (§13) — built, no migration

The engines had been finished and harness-proven since the patient-manage arc, and **nothing served
them**: no route mounted `requestManageCode`, `managedBookings`, `rescheduleManagedBooking` or
`cancelManagedBooking`. That absence is why the confirmation screen offered no "View booking details"
and promised no self-service reschedule — §13 forbids promising what is not live.

`/practice/book/@handle/manage`: verify the email you booked with, then view, move or cancel.

- **The screen decides no eligibility.** `canReschedule` / `canCancel` / `whyNot` come from the engine,
  derived from the appointment's state and the practice's own rule. A screen that computed them would
  eventually disagree with the engine that enforces them, and a patient meets that disagreement as a
  button that does nothing.
- **Asking for a code discloses nothing.** `requestManageCode` *is* `requestBookingCode`, and nothing on
  that path reads the booking table before sending — so the answer is identical whether or not that
  address has a booking here. There is no "no bookings for that email" state before verification,
  because that sentence is an enumeration oracle in a helpful tone.
- **It opens for any resolvable handle, including a practice that has since closed online booking.**
  Somebody who booked last week must still be able to cancel today.
- **Moves and cancellations now tell the patient.** `publicBookingNotice` was widened from
  confirmations-only, and **the appointment's status picks the message** — the caller never names it, so
  a cancelled booking cannot produce a message saying it is confirmed. That is break-tested: planting
  the wrong purpose turns the guard red.
- The engines' copy said *"no message has been sent to you for this change"*, which was true while
  nothing served them and false the moment something did. Both sentences are now read from the send.
- A capped list says so; a reason given on cancellation is stored on the booking and **never** reaches
  the funnel counters (§16).

Verified: manage harness 49/0 with the recorder transport injected into both paths, including a new
assertion that the message a cancellation sends says *cancelled* — break-tested by planting a
confirmation, restored byte-identical.
