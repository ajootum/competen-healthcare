# CP-SCHED-002 — One decision, one answer

**Status:** scoped, not built. Queued behind the registration scheduling card, which owns `patient-booking.ts`.

**Origin.** The practice owner stated the rule directly:

> "We want to make this a patient- and staff-driven process in which both are able to book without
> affecting the other. The only thing that should let patients fail to book is I have said 'not bookable'
> and a full-booking list (all times taken) or am unavailable e.g. on a Sunday."

Three permitted reasons. This document is about the other ten.

---

## 1. The gates a patient must clear today

Every one of these is a silent no, and any one of them stops a booking:

| # | Gate | Where | An empty/absent value means |
|---|---|---|---|
| 1 | a `practice_booking_access` row exists | `resolveBookingPage` | **no page at all** |
| 2 | `publish_state` in `PUBLISH_STATES_LIVE` | `patient-booking.ts:116` | not live |
| 3 | `mode` in `MODES_ADMITTING` = `public\|link_only` | `patient-booking.ts:117` | not admitting |
| 4 | location in `visible_location_ids` | `patient-booking.ts:127` | ⚠ **NO locations** — `if (ids.length > 0)` |
| 5 | type in `visible_appointment_types` | same | ⚠ **no types** |
| 6 | the session's own `booking_mode` is patient-facing | `isPatientFacingMode` | not bookable |

⚠ **The owner's practice currently fails at gate 1.** `practice_booking_access` holds no row for it, so every
patient-facing call returns `404 "There is no booking page at that address."` — a failure that is none of the
owner's three reasons.

To express one intent — *patients may book my Wednesday clinic* — a practitioner must currently say yes in
**six** places, four of which default to no.

## 2. The collapse: the session's `booking_mode` is the only authority

`practice_session_constants` already carries the whole vocabulary, and it is the practitioner's own words:

- `none` — "Nobody may book into this session. Time you have set aside for yourself."
- `internal` — "You and authorised staff may book patients in. No patient-facing route exists."
- `link_only` — "Reachable through a private link you share."
- `public` — "Discoverable on a public booking page."

That is the decision. Everything else becomes **derived**, not separately configured:

- **Visible locations** = the locations that actually have a patient-facing session. Not a stored list.
- **Visible appointment types** = the types linked to those sessions.
- **The page row** is provisioned rather than remembered; its absence stops being a refusal.

⚠ **AND DELIBERATELY *NOT* "EMPTY MEANS ALL ACTIVE".** The obvious reading of "collapse the gates" is to make
an empty `visible_location_ids` mean every active location. That would publish a clinic the practitioner never
intended to expose — a home-visit address, or a hospital where they take no public bookings. Deriving from
*where patient-facing sessions actually are* gives the owner exactly the rule they asked for AND is strictly
safer, because every listed location traces back to an explicit decision they made.

**What stays an explicit act:** the page being live at all. A practitioner turning patient booking on is a real
decision and keeps a real switch — but ONE switch, surfaced beside the sessions it governs, not a separate
screen's hidden state that silently outranks them.

## 3. One honest answer — and the tension in it

Four call sites return the same sentence: *"There is no booking page at that address."* A patient sees it
whether the practitioner never claimed a handle, paused the page, has no patient-facing session, or the address
was mistyped. It is the same answer to four different questions, and three of them are fixable by the
practitioner who does not know they need to.

⚠ **BUT IT CANNOT SIMPLY BECOME EXPLICIT, AND THE EXISTING CODE IS RIGHT ABOUT WHY.** From
`practice/book/[handle]/page.tsx`:

> A HIDDEN PRACTITIONER IS A 404, NOT A REFUSAL. "This person exists but will not see you" is a disclosure
> about a named individual; nothing here distinguishes it from a handle never issued.

So "tell the patient which of the three applies" and "do not confirm that a named clinician exists" are in
direct conflict for anyone probing addresses.

**The settlement: distinguish by whether the address resolves at all.**

- **Handle not issued, or deliberately hidden** → stays a 404, unchanged. No disclosure.
- **Address resolves** — the practitioner published it and gave it out — → name the reason:
  - `NOT_BOOKABLE` — the practitioner has not opened this to patients
  - `FULLY_BOOKED` — every time is taken
  - `NOT_WORKING` — no session on that day
- ⚠ **And a fourth class, said plainly rather than dressed as one of the three:**
  - `CANNOT_VERIFY` — no way to send a code exists in this deployment (today: no mail provider, no SMS
    gateway). This is the one that actually blocks the owner's practice, and calling it "fully booked"
    would be a lie.
  - `UNREADABLE` — a read failed. Never rendered as "no times available".

**A failed read is never a zero** applies with particular force here: three of the four honest answers are
about absence, and the fourth is about a query that did not complete.

## 4. What this does not fix

The OTP. `issueOtp` refuses in a deployment with no SMS gateway and no mail provider, so no patient can verify
and therefore no patient can book, regardless of every gate above. That is blocked on DNS for
`competenhealthcare.com`, not on code. Migration 272's unverified-request door is the deliberate workaround and
ships shut.

## 5. Order

1. The channel split (in flight) — staff booking stops depending on patient page configuration.
2. This document's §2 — derive, stop storing, provision the row.
3. This document's §3 — the resolver returns a reason, and the screens render it.

§2 before §3: there is no point naming a reason while four gates can produce the same one.
