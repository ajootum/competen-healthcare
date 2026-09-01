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

## 5. Substrate gap: the emergency statement (§8.5)

The spec asks for a concise "online booking is not for emergencies" statement whose "wording must be
deployment-appropriate and configurable". **There is no field for one.** The practice's `instructions`
are general booking guidance and already render on step 1, so reusing them would print the same
paragraph twice and relabel ordinary instructions as a safety warning.

`safetyNote` is therefore wired and passed `null`. Inventing the sentence would be worse than omitting
it — an emergency instruction naming the wrong service for the country is the kind of copy that gets
somebody hurt. It needs a configurable field, which is an owner decision.

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

## 7. Not done

- **§19 analytics** (step-to-step conversion, abandonment, OTP failure rate). No event surface exists on
  the public booking path; adding one touches the activation-telemetry arc.
- **§6.1 slot holds** — deliberately not simulated. The spec is explicit that a hold must be a canonical
  booking-engine capability rather than UI state. Concurrency is still settled where it always was, by
  migration 255's exclusion constraint at the moment of the write.
- **§13 add-to-calendar and directions** on the success screen — no calendar artifact or map
  configuration exists yet.
- The emergency statement and the "Parent"/"Other relative" vocabulary, per §4 and §5 above.
