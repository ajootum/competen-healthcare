# QUEUED — CP-PLAN-002 §9–§15, the Booking Requests workflow

**Status:** queued, not started. Reserved migration number: **277**.

**Queued behind:** the CP-PLAN-002 §3–§7 planner-views arc (in flight), and CP-SCHED-001's engine work
(in flight: the channel split, the dates engine, and migration 276's atomic register-and-book).

**Why this is written down.** A spec handed over while another arc is in flight has been stranded in this
project before — CPR-V5-007's phases 4–6 sat unbuilt because they were queued in conversation and the
conversation moved on. This file is the queue.

---

## Why it cannot be built yet

The spec declares its own dependency, and both halves are real:

- **§13 accept workflow:** *"Server atomically creates/updates the required patient linkage and confirmed
  appointment, then marks the request ACCEPTED and links request_id ↔ appointment_id."* That atomic write is
  **migration 276's function**, currently being built. Doing it before then means either a non-atomic accept
  (the exact half-finished-record problem the owner asked to remove) or a second function that does the same
  job.
- **§14 propose another time:** *"The alternative-time selector must use the same Location → Date → Available
  Time engine as registration and self-booking. Do not allow arbitrary typing of a time that bypasses
  availability validation."* That is the **dates engine**, same in-flight arc.

Building either now would create a second availability calculation — the one thing §2 and §8 forbid.

## The state gap, which needs migration 277

`practice_booking_request.status` today (migration 254:265–266):

```
check (status in ('submitted', 'verified', 'booked', 'refused', 'withdrawn', 'expired'))
```

Against §11's stable backend states:

| §11 state | Today | Note |
|---|---|---|
| `PENDING` | `submitted` | maps |
| `REVIEWING` | ⚠ **absent** | "opened/claimed for review", optional workflow state |
| `ALTERNATIVE_PROPOSED` | ⚠ **absent** | required by §14 — there is nowhere to record that a slot was proposed |
| `ACCEPTED` | `booked` | maps |
| `DECLINED` | `refused` | maps |
| `WITHDRAWN` | `withdrawn` | maps |
| `EXPIRED` | `expired` | maps |

⚠ `verified` is **not** one of §11's states and should not be treated as one. Since migration 272,
verification is a `generated always` column (`verification_state`) derived from `challenge_id` and
`verified_at` — it is orthogonal to workflow status, and collapsing the two would make a forged-proof
question look like a workflow question.

§11: *"Presentation labels may be configurable, but backend state semantics must remain stable."* So keep the
stored vocabulary and map to §11 names at the edge, OR widen the CHECK — but do not rename stored values,
because migration 254's partial indexes and 272's constraints reference `'booked'` by name.

⚠ **Widening a CHECK fails if an existing row violates it** — query live data first. And any new state must be
reachable and leavable: a `REVIEWING` row nobody can move on is a request that disappears.

## What §13–§15 require beyond the states

- **§13:** resolve patient identity first — *"match existing patient first; register only if no match according
  to CP registration rules"*. That is `registerPatient`'s duplicate detection, which refuses on exact
  identifier collision and returns candidates on demographic similarity. Do not bypass it; a bulk-accept that
  guesses is the split-clinical-record failure.
- **§13:** *"Re-query live availability. A time requested earlier is not assumed to remain free."* And on
  conflict, *"do not accept into a conflict; show nearby valid alternatives."*
- **§14:** *"do not occupy the slot indefinitely without an explicit hold policy."* ⚠ The booking arc
  **deliberately declined slot holds**, with reasons recorded: the public endpoint is unauthenticated so a
  script could empty a clinic's week, and `messaging.ts` records that this deployment has no scheduled runner
  and no durable outbox — so a hold would be written and never released, a permanent block dressed as a
  temporary one. Any hold introduced here needs a runner first, or it must not be introduced.
- **§12:** the sidebar badge counts **actionable pending requests only**, never confirmed appointments.
- **§15:** decline captures a configured reason; expiry needs something to run it — see the runner point above.

## Doctrines that bite here

- **A failed read is never a zero.** An inbox that cannot be read must not render "no requests".
- **Every figure is the length of a list you can open** — the badge count included.
- **No action without a store.** Do not draw "Propose another time" until there is somewhere to record the
  proposal and its timestamp.
