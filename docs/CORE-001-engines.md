# Competen Practice — Engine Map, Doctrines and Recorded Traps

**Satisfies:** CPR-CORE-001 s18, "developer documentation and API contracts are published in the code repository".
**Core rule this document exists to keep true:** *dashboard widgets consume shared engines; widgets do not
own business logic* (CPR-CORE-001 cover page).
**Companions:** [`CORE-001-implementation.md`](./CORE-001-implementation.md), [`CORE-001-api-contracts.md`](./CORE-001-api-contracts.md).
**Verified against** the working tree at `5a686ce`. Line numbers drift; the sentence quoted beside each
reference is the durable anchor — search for it rather than trusting the number.

§5 is the part worth keeping. Four bug classes have shipped in this codebase, three of them silently, and
each cost a rediscovery. They are recorded here so the fifth does not.

---

## 1. Engine map

Each row: what the engine owns, what it must never do, and the file. "Must never do" is not style advice —
every entry is a rule something in the codebase already broke once.

| Engine | Owns | Must never | File |
|---|---|---|---|
| **Current Activity** | today's plan; which activity is running; plan/start/end and their refusals; the `activity.*` + `session.*` envelopes | be upserted (migration 232's index is partial); default the event `source`; start a second running activity; rewrite the plan to match what happened — overrunning is *recorded*, not corrected | `src/lib/practice/activity.ts` |
| **Session** | the session **clock** — window, progress, elapsed, remaining, patients remaining; the queue split; the follow-up lenses; alert rules; draft encounters | **count patients.** `SessionWithFigures` exists so the session engine is *handed* `patientsSeen` and the consult average rather than computing them (`session.ts:53-60`) | `src/lib/practice/session.ts` |
| **Session Timeline** | the day as it actually went, in order, from timestamps on rows that exist | store anything. No table, no event log — an events table would be a second place for the day to be recorded and therefore a second place for it to disagree (`session-timeline.ts:32-37`). Never mix planned entries into `events`; they go in `upcoming` with `occurred: false` | `src/lib/practice/session-timeline.ts` |
| **Encounter** | encounter creation, state machine, signing boundary, interruption, `encounter.*` envelopes | let two encounters be ACTIVE for one practitioner; restamp a resumed encounter's `activity_id`; write a note (that is `documentation.ts` since CPR-130 — recorded at `encounters.ts:334-340`) | `src/lib/practice/encounters.ts`, `encounter-constants.ts` |
| **Metrics** | **all twelve of s8**, one function each, each carrying its own `formula` and `sources` | render, label, or decide a tone. Return a default. Average a truncated page | `src/lib/practice/metrics.ts` |
| **Events (outbox)** | writing one domain event per state change; validating the envelope | throw; swallow an error; emit *before* the write it describes commits; fail the operation when the emit fails | `src/lib/practice/events.ts` |
| **Event stream** | which types the dashboard cares about; the cursor; the published marker | filter on `published_at` — the cursor is **per connection**, or a second practitioner silently misses everything the first has seen (`event-stream.ts:19-23`) | `src/lib/practice/event-stream.ts` |
| **Brief** | turning the attention list into s11's brief with source refs and a method sentence | issue a query of its own; reword the tile's sentence; use any word in `FORBIDDEN_IN_BRIEF` | `src/lib/practice/brief.ts` |
| **Operations home** | the attention list, blind spots, and which reads failed | conflate `blindSpots` (not permitted) with `unreadable` (query failed) with empty (calm) — three states, one of them is calm (`operations-home.ts:511-524`) | `src/lib/practice/operations-home.ts` |
| **Today's Work** | the six CPR-V3-002 panels as a lens over existing stores | report a denied read as a zero (`todays-work.ts:83-89`) | `src/lib/practice/todays-work.ts` |
| **Practice Intelligence** | approved aggregates, and a named list of what cannot be computed at all | compute a rate; compare against a baseline that does not exist; invent a cohort | `src/lib/practice/intelligence.ts` |
| **Dashboard assembler** | the **scope decision**, made once; running feeders in isolation; stamping `asOf` | contain a calculation. "If a calculation ever appears in here, it is in the wrong place — that is the rule this file exists to enforce, and it is the first thing to check in review" (`dashboard.ts:78-83`) | `src/lib/practice/dashboard.ts` |
| **Access / API context** | membership, entitlement, time-bounded capability grants; the one route gate | trust the active-workspace cookie as authority; compare a database-clock timestamp against this process's clock | `src/lib/practice/access.ts`, `api-context.ts` |

**Dependency direction** (s4): Current Activity → Session → Queue/Encounter → Patient/Follow-up/Documents
→ Intelligence → Assistant. In code: `dashboard.ts:167-170` resolves plan then session *before* anything
that needs the scope, and every feeder after that runs in parallel.

---

## 2. The five doctrines

### 2.1 A failed read is never a zero

"Nobody is waiting" and "I could not find out who is waiting" are different sentences and only one of them
may be shown to somebody about to close a clinic (`metrics.ts:29-32`).

| Mechanism | Where |
|---|---|
| Four-valued metric status: `ok` / `unknowable` / `unreadable` / `not_permitted` | `metrics.ts:109-117` |
| A null count with no error is **not** a zero — PostgREST returns null when the count was not computed, a missing table among them | `metrics.ts:250-257` |
| Per-feeder `ok`/`unavailable`, per card rather than per page | `dashboard.ts:234-258` |
| Timeline sources reported individually: `unavailable` (nothing read) vs `partial` (some read) | `session-timeline.ts:308-313` |
| A denied panel says "you do not have access", never "nothing is overdue" | `todays-work.ts:83-89` |
| The brief distinguishes calm / not-visible / not-read | `brief.ts:140-143` |
| `todaysPlan` checks the **workspace timezone read's** error — discarded, it silently became UTC, matched no `plan_date`, and returned an empty day with `unavailable: false` | `activity.ts:155-163` |
| `transitionEncounter` checks the read error — discarded, a timeout became `404 NOT_FOUND`, telling a practitioner their consultation does not exist | `encounters.ts:140-146` |

⚠ Two subtler versions of the same trap, both already found and fixed, both worth re-reading before adding
a feeder:

- **Judging a card by figures it does not show.** `glance` availability was derived from
  `PracticeMetrics.unavailable`, which asks "did all twelve fail" — so one metric *outside* the eight tiles
  being merely `unknowable` reported a glance of eight em dashes as healthy (`dashboard.ts:236-242`).
- **Returning a value is not the same as having read anything.** `operationsHome` does not throw when its
  queries fail, so a feeder judged only on "did it return" called itself healthy while every read behind it
  had failed (`dashboard.ts:252-257`).

### 2.2 Counts, not rates

"A percentage is where a small number hides, and a practice with nine follow-ups does not have an 86.2%
anything" (`intelligence.ts:26-30`). Every figure is a count and its denominator; what cannot be counted
is **named** rather than omitted — `NOT_AVAILABLE` (`intelligence.ts:51`) lists patient satisfaction,
benchmarks and the rest, each with the reason it cannot exist here.

The same rule at metric level: no average without its denominator. Every `Metric` carries `observations`
(what it was computed over) and `excluded` (what a documented exclusion dropped) — disclosed, not hidden
(`metrics.ts:131-134`).

### 2.3 Derived, not stored

| Thing | Derived from | Why not stored |
|---|---|---|
| Activity state (`planned`/`running`/`done`) | `started_at`, `ended_at` | a stored status and a clock disagree the moment nobody clicks anything — a clinic that ran late would still read "In Progress" the next morning (`232:52-56`, `activity.ts:97`) |
| Follow-up "overdue" | `due_on` vs the practice's today | migration 196 deliberately has no `OVERDUE` status (`metrics.ts:644-646`) |
| The timeline | timestamps on live rows | a cancelled encounter would stay on a stored timeline, because nothing would go back and delete its event (`session-timeline.ts:32-37`) |
| Operational alerts | live counts | no `practice_alert` table exists anywhere |
| All twelve metrics | live rows, on read | no `practice_metric_snapshot` table exists; s5's Metric Snapshot entity is unbuilt |
| Session progress, remaining, running-behind | the clock + measured figures | none of it can go stale and none of it needs a background job (`session.ts:15-31`) |

⚠ The corollary: **null until earned.** With no completed encounter there is no average, and with no
average there is no projection — so "Running behind" is *absent*, not 0. It is the one figure a
practitioner would rearrange an afternoon over, and a default would be a guess wearing a number's clothes
(`session.ts:68-75`).

### 2.4 One owner per metric

s16: "no widget independently calculates a conflicting version of a shared metric." Two implementations
were **deleted** rather than corrected, because two *correct* implementations drift into two answers just
as surely as a wrong one, only later and more quietly (`dashboard.ts:23-25`).

| Deleted | Was | Recorded at |
|---|---|---|
| `todayAtAGlance` (session.ts) | Waiting read from appointment status, so a walk-in was invisible and a patient already in the room still counted as waiting; Completed counted a clerical desk action; Follow-ups Due folded the whole overdue backlog into "due" | `session.ts:142-153` |
| `heroStats`/`performance` (command-centre.ts) | `patients_seen` = every encounter started with no status filter; `avg_consult` excluded no paused duration; `avg_wait` dropped VERIFIED arrivals and measured nothing for walk-ins; `clinic_delay` was a mean with negatives clamped to zero and no minimum-observation gate | `command-centre.ts:260-277` |

The surviving structure: `metrics.ts` computes; `dashboard.ts:30-39` is a **lookup table** of which metric
goes in which tile and where its list lives — "no arithmetic, no query".

⚠ **This doctrine is not yet fully held.** Follow-up Intelligence still has two implementations
(`session.ts:202` and `command-centre.ts:252`) with different categories, and both render on
`home/page.tsx` (lines 503 and 647). So does the timeline (418 and 594) and the waiting queue (377 and 618,
with different status sets). See [`CORE-001-implementation.md`](./CORE-001-implementation.md) §CORE-07.

### 2.5 Capability codes are database strings

A capability code is compared against `practice_role_capabilities` at runtime. **Inventing a plausible one
costs nothing at compile time and silently disables the feature.** It has happened twice:

| Invented code | In | Effect |
|---|---|---|
| `practice.calendar.manage` | `activity.ts` | `hasCapability` returned false for **every** user including the owner; every write returned 403 and the dashboard *hid* the Start button rather than showing an error. "Start the day in one click" was unreachable and looked like nothing happened. Real code: `appointment.manage` (`activity.ts:77-87`) |
| `appointment.view` | `todays-work.ts` | the Walk-in Queue and Next Patient reported a confident nought to every practitioner for as long as it existed — a denied read and an empty clinic look identical from outside (`todays-work.ts:25-32`) |

The countermeasure: **hoist codes into named constants, export the list, and assert in a harness that each
one exists in the database** — asserted against the constants, never against a list re-typed in the test,
because a re-typed list can invent the same fiction and agree with it forever.

| Export | Asserted? |
|---|---|
| `ACTIVITY_CAPABILITIES` (`activity.ts:94`) | yes — `scripts/practice-audit-harness.ts:253` |
| `TODAYS_WORK_CAPABILITIES` (`todays-work.ts:39`) | yes — `scripts/practice-current-activity-harness.ts:90` |
| `METRIC_CAPABILITIES` (`metrics.ts:160`) | **no.** Exported with the comment saying a harness should prove it, and no harness reads it. |

---

## 3. The twelve metrics of s8

Every one carries its own `formula` and `sources` in the payload, because traceability is a property of the
**number**, not of a document somebody may never open (`metrics.ts:105-107`, `dashboard.ts:41-47`).

| Metric | Function | Source tables | Decision recorded in the code |
|---|---|---|---|
| Booked | `bookedAppointments` `:332` | `practice_appointment.scheduled_at/.status` | **No-shows stay booked.** They consumed a slot; if they left the total, "12 booked" at 09:00 and "9 booked" at 17:00 would both be true (`:178-186`). Counted by allow-list, not `neq`, so a status a later migration adds is refused rather than silently admitted |
| Waiting | `waitingPatients` `:373` | `practice_queue_entry` + `practice_encounter` | Counted over **the day, not the session window** — waiting is a live state, not a period count. Narrowed to the window it read 0 while four people sat outside at 16:59 against an 08:00–13:00 clinic (`:386-397`). An entry is dropped when the visit already has an engaged encounter, because `launchEncounter` does not touch the queue |
| Completed | `completedEncounters` `:456` | `practice_encounter.status` | Rows, not transitions — counting `practice_encounter_status_history` would double-count every reopen (`:448-454`) |
| Walk-in | `walkIns` `:500` | queue + encounters, deduped by patient | Two sources, one count. A desk-recorded `walk_in` appointment is still a walk-in — it is an arrival without a *prior* booking. `entry_pathway` confirms, never infers purpose (`:486-498`) |
| Cancelled | `cancelledAppointments` `:565` | `practice_appointment.status` | ⚠ **Not measurable as specified.** No `cancelled_at` column, so this is *scheduled-for-the-period and now cancelled*. Stated in the formula rather than approximated silently (`:560-563`) |
| Emergency | `emergencyEncounters` `:607` | appointment type + activity type | The encounter carries no urgency field. An emergency with neither an emergency-typed diary entry nor an `emergency_consult` activity is **under-counted** rather than inferred from clinical text, which s8 forbids by name (`:594-605`) |
| Follow-ups Due | `followUpsDue` `:653` | `practice_follow_up.due_on/.status` | Within the period means within it. Rolling the backlog in makes the tile grow forever and stop meaning today (`:648-651`) |
| No-show | `noShows` `:690` | `practice_appointment.status` | ⚠ **The grace period is not implemented because it does not exist, and is not invented here.** Deriving no-show from "the time passed and nobody arrived" would mark every appointment of a day the practice never opened the app — a fabricated clinical-administrative fact about a patient (`:684-688`) |
| Patients Seen | `patientsSeen` `:727` | `practice_encounter.patient_id` | Distinct by id, never by name: two Mary Achiengs are two people and one typed two ways is one. PostgREST cannot `COUNT DISTINCT`, so ids are read bounded and an overflow is refused (`:718-725`) |
| Avg Consult Time | `averageConsultMinutes` `:776` | encounter + `practice_encounter_status_history` | Paused duration reconstructed from the transition log — s6.2's "interruption time must not be counted as active consultation time for another patient". ⚠ **A missing pause record means never paused, not unmeasurable**: excluding log-less encounters shrank the denominator silently and drifted the average toward whichever consultations happened to be interrupted (`:821-827`) |
| Avg Wait Time | `averageWaitMinutes` `:881` | `practice_arrival` then `practice_queue_entry` | Two front doors in precedence order; a walk-in's queue entry is the only check-in they ever get. Encounters with no check-in are excluded — treating it as a zero wait would make a busy morning look punctual (`:864-879`) |
| Clinic Delay | `clinicDelayMinutes` `:991` | encounter + appointment | **Median, signed, positive = late** — the aggregation method s8 requires be stated. Median because one emergency is a two-hour outlier; signed because clamping negatives can never report a clinic running early. Null below `MIN_OBSERVATIONS_FOR_DELAY = 5` (`:170-176`) — enforced in the engine rather than left to a widget to remember |

---

## 4. The event catalogue

34 types (`events.ts:33-48`), mirrored by a `CHECK` constraint (`233:49-64`) — a closed vocabulary so a
projection that switches exhaustively is actually safe. The harness asserts every TypeScript entry is
accepted by the database (`practice-events-harness.ts:308`) and that the database refuses one that is not
(`:319`), because a name that exists in TypeScript and not in the constraint fails on every emit, forever,
in a swallowed error.

Envelope (`events.ts:67-83`, columns `233:31-131`):

| Field | Rule |
|---|---|
| `practitionerId` / `actorId` | **Two people, never collapsed.** Whose work it is, and who caused it. They are the same today and stop being so the first time a receptionist checks a patient in — at which point a log that kept only one cannot say which (`233:76-83`) |
| `source` | `web \| mobile \| integration \| system`. Not nullable **and not defaulted** — the database cannot know which surface it is talking to, and a default would file a cron's writes as a person's (`233:85-88`) |
| context columns | `location_id`, `activity_instance_id`, `session_id`, `patient_id`, `encounter_id` — **columns, not payload keys**, because these are what a consumer filters on. **No foreign keys on any of them**: `set null` would rewrite "encounter completed for patient X" into "for nobody" and a replayed projection would produce different numbers than yesterday (`233:96-102`) |
| `occurred_at` vs `recorded_at` | kept apart. They differ on retry or replay, and a cursor ordering by `occurred_at` would skip events it had already passed (`233:70-74`) |
| `published_at` | left null on emit **on purpose** — marking a row delivered at insert time would hand the first real dispatcher an empty backlog and a week of events nobody sent (`events.ts:141-143`) |

**Why a failed emit does not fail the write it describes** — the argument, in full, is at `events.ts:10-31`.
Short version: there is no transaction to join (PostgREST, one statement per round trip), so refusing
cannot roll the state change back; it would take a clinic that genuinely started and report it as a 500. A
lost event costs freshness (s12's poll repaints within a minute); a lost state change costs the work. The
error is returned, never swallowed, because an outbox failing quietly for a week is exactly what nobody
notices until a projection is rebuilt wrong.

⚠ **Only 8 of the 34 are ever emitted.** See [`CORE-001-implementation.md`](./CORE-001-implementation.md)
§CORE-09 for the table of which, and what that means for each card.

---

## 5. Recorded traps

These are the ones that have already cost time here. Each is written into the code at the site where it
bites; they are gathered here so a new engine does not have to rediscover them.

### 5.1 A partial index cannot be a PostgREST upsert target

`onConflict` requires a **non-partial** unique constraint. Pointed at a partial index it fails **at
runtime, not at compile time** — and in this codebase the failing shape is a silent write failure.

Three partial indexes exist, and each carries the warning at its definition:

| Index | Enforces | Warning |
|---|---|---|
| `uq_practice_activity_one_running` | one running activity per practitioner | `232:74-79` |
| `idx_practice_domain_event_unpublished` | the dispatcher's backlog | `233:149-154` |
| `uq_practice_encounter_one_active` | one ACTIVE encounter per practitioner | `234:45-49` |

**The pattern that works:** end the running row, then insert; use `UPDATE ... WHERE id =` for transitions;
treat the index as the **backstop for the two-tab race**, not the mechanism (`activity.ts:357-364`). Handle
`23505` explicitly and return a sentence — `ALREADY_RUNNING` 409 (`activity.ts:432-436`), `ANOTHER_ACTIVE`
409 (`encounters.ts:182-185`).

**Corollary:** never discard an upsert's error.

### 5.2 The 1000-row page cap

PostgREST caps an unbounded `select` at 1000 rows and says nothing about it. A truncated page averaged is
a wrong average that looks right.

The rule (`metrics.ts:33-36`): **every row-level read carries an explicit limit so a full page is
DETECTABLE, and a detectable overflow is reported as not-knowable rather than quietly averaged.** Pure
counts use `head + count`, which is computed server-side and is not subject to the cap.

| Mechanism | Where |
|---|---|
| `ROW_CAP = 2000`, deliberately far above a clinic day and deliberately *below nothing* | `metrics.ts:167` |
| `readRows` returns `overflowed` when `rows.length >= cap`; every caller turns that into `unreadable` | `metrics.ts:262-267` |
| `IN_CHUNK = 100` — a 500-uuid `.in()` list is a ~19KB query string and fails in ways that look like an empty result | `metrics.ts:168`, `:269-284` |
| One failed batch fails the whole read — a partial join is a wrong average | `metrics.ts:278` |

⚠ **Not applied uniformly.** `waitingQueue` (`session.ts:165-172`) has no limit and no day filter, so
`queue.total` can silently be a page. `command-centre.ts:145-149` reads the queue the same way.

### 5.3 An invented capability code

Covered as doctrine 2.5 above; repeated here because it is the trap with the worst signature: **the feature
does not error, it disappears.** A hidden button and a confident zero are what an invented code looks like
from the outside. Two have shipped (`practice.calendar.manage`, `appointment.view`).

Check the migration before typing a capability string. The three the metric engine uses were each read out
of one, and the migration is named beside each (`metrics.ts:150-157`).

### 5.4 Semicolons inside SQL comments break the migration runner

The runner splits migration files on `;`. A semicolon **inside a comment** cuts the file mid-sentence and
the rest of the migration never runs — and because the first half applied, a re-run looks idempotent and
fine.

Recorded at `234:15-17`: *"no semicolon anywhere except at the end of a statement"*. It was found the hard
way — commit `c69da4f`, "Strip semicolons from migration 233's comments before anyone runs it".

Related migration-file constraints this codebase holds to, same reason (a runner that is simpler than
`psql`): **plain idempotent statements, ASCII only, no `DO` blocks.**

### 5.5 App clock vs database clock

Never compare a timestamp defaulted by the database against `new Date()` in this process. Both were found:

- `practice_role_assignment.effective_from` defaults to the DB's `now()`; filtering in TypeScript against
  the app clock made a grant made a moment ago read as "starts in the future" and be **invisible** on a
  deployment where the DB clock led by ~800ms.
- `practice_entitlement.starts_at` likewise: a brand-new practice read as `NOT_ENTITLED` on its first page
  load.

Fix: compare server-side with the Postgres literal `'now'`, and use **two unambiguous queries** rather than
one PostgREST or-filter across a null test — that or-filter shape has twice been written here in a way that
quietly matched every row (`access.ts:86-131`).

### 5.6 Timezone: the practice's, never the server's

Day boundaries come from `zonedDayRange(date, practiceTimezone)` and "today" from
`practiceToday(timezone, at)` — never the server's date. Using the server's is right for about
twenty-one hours a day and silently wrong for the three that matter most: a Kampala practice could not
start a clinic between 21:00 and midnight local, and could start yesterday's before 03:00
(`activity.ts:384-393`, `metrics.ts:74-80`). Wall-clock minutes-from-midnight is the storage convention for
plans (`232:42-49`), so a stored plan does not move when an offset changes.

---

## 6. Harnesses

The harnesses are the specification of behaviour here. Each is runnable standalone and each is
**failable** — controls assert the fixture actually produced the condition being tested, so a green run
cannot be green vacuously.

| Harness | Proves |
|---|---|
| `scripts/practice-clinic-day-harness.ts` | **CORE-15.** One clinic morning through the real engines, asserting s16's twelve criteria as *changes* — before and after the action meant to move them |
| `scripts/practice-dashboard-harness.ts` | the assembler: `asOf` is injectable, scope flips, partial failure does not blank the page |
| `scripts/practice-current-activity-harness.ts` | activity lifecycle, one-running enforcement, encounter context inheritance, and the whole navigation invariant set |
| `scripts/practice-command-centre-harness.ts` | the twelve metrics, including the `MIN_OBSERVATIONS_FOR_DELAY` gate and permission blindness |
| `scripts/practice-interruption-harness.ts` | CORE-05/06: one active encounter, interruption, rollback, and that paused time really leaves the consult average |
| `scripts/practice-events-harness.ts` | the outbox: envelope fields, both events per transition, catalogue accepted by the DB, a *broken* outbox not failing the write, tenancy |
| `scripts/practice-stream-harness.ts` | the cursor: resume, no replay of what was already seen, **a second client still receives what the first was shown**, tenancy |
| `scripts/practice-brief-harness.ts` | CORE-12: derived label, source refs, forbidden wording, and that an unreadable brief does not read as calm |
| `scripts/practice-audit-harness.ts` | s13: actor, timestamp, source and an audit entry on every state change; capability codes exist |
