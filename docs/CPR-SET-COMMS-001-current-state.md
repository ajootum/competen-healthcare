# CPR-SET-COMMS-001 — Patient Communications: implementation record

Status: **built 2026-09-01**, pending migration 361 (owner-applied) for the preference store.
Spec: `CPR-SET-COMMS-001_Patient_Communications_Developer_Specification.docx` (owner's Downloads).

## What the spec prescribes, and where each piece landed

| Spec | Where |
|---|---|
| s3.1 email card, derived badge, sender name, reply-to, **Save settings** | `src/app/practice/(shell)/setup/patient-communications/CommunicationsConsole.tsx` |
| s3.2 message types (verification locked; 3 configurable; reminders coming-later, no fake toggle) | same console + `CONFIGURABLE_MESSAGE_TYPES` / `REQUIRED_MESSAGE_TYPES` in `src/lib/practice/messaging.ts` |
| s3.3 SMS / WhatsApp coming-soon cards, zero dead controls | console (render-pinned: no button/input/link in either card) |
| s4 compact readiness mirror + CTA to canonical workspace | `patient-communications/page.tsx` (rows from `emailChannelState` + `bookingLinkSummary`; CTA → `/practice/setup/patient-booking?tab=publish`) |
| s5 copy replacements | console + page (the engine's pinned `SENDER_REQUIRED` sentence stays engine-side and unrendered; the UI validates first and maps the code to the s5 sentence) |
| s6 state model | `emailChannelState()` in messaging.ts — derived at read time, never stored |
| s7 data model | migration **361**: `practice_message_channel.message_preferences jsonb not null default '{}'` — absent key = ON; required types have **no key at all** (issueOtp never consults preferences → "verification off" is unrepresentable). Reply-to = the existing `sender_address` column (email's from-address is platform-managed, so the one address a practice owns on this channel is where replies land — no second column) |
| s8 validation | sender trimmed/required (engine, pinned); reply-to syntax (engine `EMAIL_SYNTAX` + console inline); saves idempotent (upsert); failures preserve entries; provider errors never reach the page |
| s9 audit | `practice.channel_enabled/disabled` events now carry `changed: [channel_state, sender_name, reply_to]` categories; new `practice.channel_preferences_changed` with the changed keys; no OTP values, no secrets |
| s10 HFE | one primary action; badge = words not colour; required/optional labelled; reminders = dimmed sentence, not a disabled control; cards stack on mobile |

## The two real substrate gaps §13's inspection found (both closed)

1. **`sender_name` never reached an email.** Stored since migration 224, required to enable — and the
   From line was the platform address verbatim. `sendMessage` now threads the channel's identity to the
   transport as a 6th argument; `handOver`'s Resend branch composes `"<sender name>" <platform-addr>`
   (name sanitised of `<>"` and newlines; the **address** stays platform-managed) and passes the
   practice's reply-to into `resendEmailBody` (env reply-to remains the fallback).
2. **The public booking flow never sent a confirmation.** `submitBookingRequest` hard-coded
   `confirmationSent: false` with "this practice has no way to send one yet" — false the moment email
   went active. New `publicBookingNotice()` (messaging.ts) sends `appointment_confirmation` to the
   **session-verified destination** (the address the code actually reached — never a form field), only
   for a CONFIRMED appointment, gated by the `booking_confirmation` preference, never able to fail the
   booking. `confirmationSent` is now read from the hand-over; both sentences are honest.

## Preference gating in the send path

`sendMessage` takes an optional `preferenceKey`; `refusalFor` refuses `explicit false` with
"this practice switched off <label>" — recorded as a refusal row like every other. Key mapping:

- `notifyAppointment`: `appointment_cancelled` → `cancellation_notice`; confirmation → `booking_confirmation`,
  **unless** the caller passed `trigger: "rescheduled"` → `rescheduling_notice`. The reschedule route
  (PUT `/api/v1/practice/appointments/{id}`) passes the trigger — the sentence sent is still the true
  confirmation-with-new-time (the purpose CHECK list is closed on purpose); the *preference* is the
  practice's rescheduling choice.
- OTP paths pass no key — structurally ungateable.
- `invitation_code` (team, not patient comms) passes no key.

## Rulings taken (owner may veto)

- **No off switch for email.** s6 has no DISABLED state and AC-01 removes the switch; saving valid
  settings activates. The wire format still accepts `enabled:false` (`save_email`), no screen sends it.
- **Reply-to is Saved, never Verified.** No verification loop exists; the UI claims only "where replies
  are directed". s8's Saved/Verified distinction applies "if verification is required" — it is not.
- **Reply-to prepopulation**: left empty when unset. No canonical verified practice-contact-email store
  exists to prepopulate from; inventing one (e.g. the owner's login email) risks routing patient
  replies to a personal inbox unasked.
- **No Test email button.** The comp shows one; the spec's s3.1 element table does not prescribe it.
  Queued as a candidate follow-up (needs a template + a purpose, the list is CHECK-closed).
- **Mockup's sidebar/breadcrumb IA ignored** — the comp's sidebar contradicts the frozen CPR-HFE-001
  sidebar and the shipped SETUP-HFE Setup Home; s10 itself says use the existing Practice Setup system.

## Found-in-passing product bug, fixed

`resolveBookingRule` (availability-config.ts) selected within a specificity rung from an **unordered**
select — a coin-toss between the CPR-PROV-DEFAULTS starter rule and a practice's own same-rung rule.
Now ordered `priority desc, created_at asc` (priority wins, the older rule wins ties), matching the
card engine's winner-takes-all semantics. Caught by practice-patient-manage-harness 4a going red.

## Harness reality after CPR-PROV-DEFAULTS (fixed in this arc)

Fresh harness worlds now carry the baseline: an enabled email channel and a practice-wide starter rule.
- messaging-harness 13d re-pinned: B's channels are B's OWN (seeded sender = B's name; rest off).
- availability-config + booking-rules harnesses delete the starter rule at provision() — their
  fixtures test the clean slate they were written for.
- intake-harness 2d FLIPPED: online booking now sends the confirmation; the pin asserts it is claimed
  only because the transport took it, addressed to the code-proven number. `lastCode` reads the last
  message that *carries* a code (the confirmation follows the OTP into the outbox now).
- manage-harness 5e re-pinned to the BOOK-HFE-002 s16 ruling (paused says so; never-issued discloses
  nothing) — it predated s16.

## Verification

- vitest 259/259 + new `CommunicationsConsole.test.tsx` (12 pins: AC-01, AC-04 both halves, AC-05,
  AC-06, s3.2 reminders, s6 states + derivation, permission gate, no provider name in HTML).
- practice-messaging-harness 40/0 (§14 = 12 further checks **SKIP until migration 361**; rerun after).
- appointment-notice 32/0, intake 45/0, manage 47/0, screens 75/0, availability-config 81/0,
  booking-rules (see run log).

## Remaining

- Owner applies migration 361, then: rerun messaging harness (§14 goes live) + break-test the
  preference gate (plant `=== false` → `=== true`, red, restore).
- Owner E2E per Stage-1 step ①: the console now says **Save settings** (not "Turn email on").
- Follow-ups queued: patient manage-page self-cancel/reschedule notices; a Test email action.
