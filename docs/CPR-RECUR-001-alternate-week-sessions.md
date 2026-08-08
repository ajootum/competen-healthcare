# CPR-RECUR-001 — Sessions that do not repeat every week

**Status: QUEUED, behind the booking Phase 4/5 work.** Scope note, not a survey — the measurement here is
small and was done on 2026-08-08.

## The requirement

The practice owner, walking the product:

> *"I would like to set my weekly plan as alternate Saturdays to be at TMR, not every Saturday. How do we
> do this?"*

You cannot. That is the whole of the finding.

## What exists

A session is a **weekday and a time**, and it repeats **every** week. The screen says so in its own words —
*"A session is a day and a time, not fifty-two copies."*

`practice_availability_template` (migration 240) carries `weekday`, `starts_minute`, `ends_minute`,
`effective_from`, `effective_to`, `walk_ins_allowed`, `walk_in_limit`. ⚠ **There is no recurrence
interval, no anchor and no parity — verified by grep across `supabase/migrations/` and
`src/lib/practice/`, which returns nothing for fortnight / biweekly / every_n / week_parity / nth_week.**

## What can be done today, and why it is not an answer

`schedule-exceptions.ts` can only **remove** time — `EXCEPTION_KINDS` offers `leave` and `closure`, both
`effect: "removes"`. So the workaround is: create the weekly Saturday session, then add a closure on every
alternate Saturday, indefinitely.

⚠ **It makes the week grid lie between corrections.** The pattern claims TMR every Saturday and is
corrected one fortnight at a time. On a screen whose entire subject is when a practitioner is available,
that is worse than the gap.

## The shape it needs

**A recurrence interval on the template: repeat every N weeks, plus an ANCHOR DATE saying which week is
the on-week.**

⚠ **THE ANCHOR IS THE DESIGN DECISION, AND THE TEMPTING SHORTCUT IS WRONG.** ISO week-number parity —
even weeks on, odd weeks off — is one integer and no extra column, and it **breaks at year boundaries**:
a 53-week ISO year puts two odd weeks side by side, so a fortnightly clinic silently skips or doubles
once a year. An anchor date cannot drift. Store the anchor, derive the parity.

Related trap already recorded in this codebase: **never compare an app-clock timestamp against a DB-clock
one** (`access.ts` records an ~800ms skew that made a fresh grant read as "starts in the future"). Week
arithmetic must be done against one clock, and `effective_from` defaults to the database's.

## What it touches

| Piece | Where |
|---|---|
| Storage | `practice_availability_template` — migration 268+ |
| Slot generation | `generateSlots`, `src/lib/practice/availability-config.ts:775`, writing `practice_availability_slot` |
| The form | `SessionWorkspace.tsx` — the day is now the first field, so recurrence belongs beside it |
| The week grid | A fortnightly session must READ as fortnightly on the card, or the grid resumes lying |

## ⚠ Why it is queued rather than started

The booking Phase 4/5 agent is editing `practice_availability_template` and the availability engine right
now. Recurrence lands in exactly those files, and two agents in one engine produce a merge neither of them
tested.

## Not settled, and worth asking before building

1. **Does the interval belong to the session or to a pattern above it?** A practitioner alternating TMR
   and somewhere else has TWO fortnightly sessions in antiphase, not one that skips.
2. **What happens to slots already generated** when an existing weekly session becomes fortnightly, and to
   appointments already booked into the weeks that disappear. ⚠ This is the same class as
   `practice-sessions.ts`'s existing refusal to delete a session somebody is booked into — the engine asks
   how many first and says the number.
3. **Monthly patterns** ("first Tuesday") are a different model again. Out of scope unless asked.
