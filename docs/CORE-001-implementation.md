# CPR-CORE-001 — What Is Actually Built

**Scope:** the fifteen backlog items of CPR-CORE-001 Appendix A, against the code in this repository.
**Satisfies:** CPR-CORE-001 s18, "developer documentation and API contracts are published in the code repository".
**Companion documents:** [`CORE-001-api-contracts.md`](./CORE-001-api-contracts.md) (the real HTTP surface),
[`CORE-001-engines.md`](./CORE-001-engines.md) (ownership, doctrines, recorded traps).
**Verified against** the working tree at `5a686ce`. Line numbers drift; the sentence quoted beside each
reference is the durable anchor — search for it rather than trusting the number.

## How to read this

A verdict here is a claim about a file, not about a specification section. **SHIPPED** means a
practitioner can reach it through the product. **PARTIAL** means something real exists and something
named in the spec does not — the missing half is stated. **NOT BUILT** means nothing exists, and why.

The most useful rows are the PARTIAL ones. Three things in this workstream look finished and are not:
the event outbox has no dispatcher, the interruption engine has no route, and Follow-up Intelligence
is implemented twice by two engines that disagree and both render on the same screen.

---

## 1. Verdict table

| ID | Backlog item | Verdict | Where |
|---|---|---|---|
| CORE-01 | Activity definition and activity instance tables/models | **PARTIAL** | `supabase/migrations/232-practice-current-activity.sql`, `src/lib/practice/activity.ts` |
| CORE-02 | Session lifecycle service and constraints | **PARTIAL** | `src/lib/practice/activity.ts:365,458`; index `232:77` |
| CORE-03 | Active-session resolver for dashboard scope | **SHIPPED** | `src/lib/practice/dashboard.ts:176`; `src/lib/practice/activity.ts:188,209` |
| CORE-04 | Queue entry model and grouped queue endpoint | **PARTIAL** | model `192`; engine `src/lib/practice/session.ts:165`; **no endpoint** |
| CORE-05 | Encounter start/pause/resume/complete transitions | **SHIPPED** | `src/lib/practice/encounters.ts:132`; `src/lib/practice/encounter-constants.ts:10` |
| CORE-06 | Interruption-safe encounter behaviour | **PARTIAL** | `src/lib/practice/encounters.ts:271` — **engine only, no route, no UI** |
| CORE-07 | Follow-up lifecycle and summary query | **PARTIAL** | lifecycle `src/lib/practice/follow-ups.ts`; **two conflicting summaries** |
| CORE-08 | Dashboard assembler endpoint | **SHIPPED**, with a caveat | `src/lib/practice/dashboard.ts:162`; `src/app/api/v1/practice/dashboard/route.ts` |
| CORE-09 | Domain event outbox and dashboard event stream | **PARTIAL** | `events.ts`, `event-stream.ts`, `stream/route.ts` — **8 of 34 types emitted, no dispatcher** |
| CORE-10 | Metric definitions and validation tests | **SHIPPED** | `src/lib/practice/metrics.ts` (all twelve of s8) |
| CORE-11 | Operational alert rules | **PARTIAL** | `src/lib/practice/session.ts:236` — three rules, no endpoint, no events |
| CORE-12 | Derived brief service with source references | **SHIPPED** | `src/lib/practice/brief.ts` |
| CORE-13 | as_of timestamps and stale-state handling | **SHIPPED**, one gap | `dashboard.ts:261`; `src/app/practice/(shell)/LiveRefresh.tsx` |
| CORE-14 | Audit logging and permissions checks | **SHIPPED** | `src/lib/practice/api-context.ts:14`; `access.ts:103`; `audit()` on every write path |
| CORE-15 | End-to-end clinic-day acceptance test | **SHIPPED** | `scripts/practice-clinic-day-harness.ts` (s16's twelve criteria) |

---

## 2. Item by item

### CORE-01 — Activity definition and activity instance — PARTIAL

| | |
|---|---|
| Built | `practice_activity` (migration `232:21`) is the **activity instance**: practitioner, type, title, facility/location/room, `plan_date`, `planned_start_minute`, `planned_end_minute`, `started_at`, `ended_at`. Model + shaping in `src/lib/practice/activity.ts:55` (`PlannedActivity`), `:151` (`todaysPlan`), `:260` (`planActivity`). |
| Missing | **There is no activity definition table.** s5 lists Activity Definition as a first-class entity with `practice_id` as its mandatory link — a reusable type a practice configures. Here the type list is a hard-coded `CHECK` constraint (`232:30-32`) mirrored by `ACTIVITY_TYPES` (`activity.ts:23-27`). A practice cannot add "Endoscopy List" without a migration. |
| Also missing | No `status` column, **deliberately** — planned/running/done are derived from the two timestamps (`activity.ts:97`, and `232:52-56` says why). This is a divergence from s6's activity state model (`planned → confirmed → active → paused → completed → cancelled`): `confirmed`, `paused` and `cancelled` have no representation at all. |

### CORE-02 — Session lifecycle service and constraints — PARTIAL

**The session is the running activity.** There is no `practice_session` table; migration `233:108-114`
records the decision and keeps `session_id` as its own event column so consumers survive the day
sessions become rows.

| s6 session state | Built? | Evidence |
|---|---|---|
| `draft` / `ready` | no | an activity is planned or it is not |
| `active` | yes | `startActivity` — `activity.ts:365` |
| `paused` | **no** | no engine function; `session.paused`/`session.resumed`/`activity.paused` are in the event catalogue (`events.ts:35-37`) and **nothing emits them** |
| `closing` | no | — |
| `closed` | yes | `endActivity` — `activity.ts:458` |
| `cancelled` | **no** | an activity can only be ended, never cancelled |

Constraints that do exist, and are real:

- **One primary active session per practitioner** (s6.1) — partial unique index `232:77-79`, plus the
  engine's own check. The `23505` path is handled explicitly (`activity.ts:432-436`).
- Five refusals are declared as data so a screen can render them: `ACTIVITY_REFUSES`, `activity.ts:44-51`.
- Starting a session emits `activity.started` **and** `session.started` (`activity.ts:352-354`) —
  two envelopes for one transition, because s7's feeder matrix has different cards listening for each.

s6.1's "booked appointments matching the session context are loaded into the expected queue but are not
marked arrived" is **not implemented**: nothing writes a queue entry at session start. `practice_queue_entry`
has no `expected` state (migration 192), and `metrics.ts:203-211` argues that the table's shape satisfies
s8's "do not count expected patients who have not arrived" instead.

### CORE-03 — Active-session resolver for dashboard scope — SHIPPED

The scope decision is made **once**, in `dashboard.ts:176-181`, and everything downstream receives it:

```
session running  → kind: "session", sessionId, window = activity's planned start/end
no session       → kind: "day",     sessionId: null, window = zonedDayRange(date, practice timezone)
```

`metricScope` (`metrics.ts:81`) turns it into the object every metric is computed over. Proven as a
*change* — before and after — by `scripts/practice-clinic-day-harness.ts` assertions 1a, 2a, 2b, 2c and 12b.

⚠ **The two scopes are not symmetrical, and the code says so.** `practice_encounter` carries `activity_id`
so encounter membership of a session is a fact (`metrics.ts:302-305`); appointments, queue entries and
follow-ups carry no activity link, so their session membership is approximated by the clock and named as
such in each metric's `sources` (`metrics.ts:50-55`).

### CORE-04 — Queue entry model and grouped queue endpoint — PARTIAL

| | |
|---|---|
| Model | `practice_queue_entry`, migration `192:93` — predates CORE-001. Vocabulary: `WAITING / READY / IN_CONSULTATION / PAUSED / COMPLETED / LEFT`. |
| Grouped queue | `waitingQueue`, `session.ts:165` → three groups (`booked`, `walk_ins`, `emergency`), derived from the linked appointment's type rather than a column on the queue (`session.ts:155-160`). |
| **Missing endpoint** | s10 asks for `GET /practice/sessions/{id}/queue` and `POST /practice/sessions/{id}/queue`. **Neither exists.** The only queue route is `PATCH /api/v1/practice/queue/{entryId}` (state transitions only). |
| How entries are created today | `transitionAppointment(... to: "ARRIVED")` writes one (`scheduling.ts`; asserted at clinic-day 3c), and `POST /api/v1/practice/registration-workspace` with `queuePatientId` queues a walk-in. Both are correct; neither is the spec's endpoint. |
| ⚠ Defect | `waitingQueue` has **no day filter and no `.limit()`** (`session.ts:168-172`). An entry left `WAITING` last week still counts, and the read is subject to the PostgREST 1000-row cap that `metrics.ts` refuses everywhere else. `queue.total` can silently be a page rather than a total. |

### CORE-05 — Encounter transitions — SHIPPED

`transitionEncounter` (`encounters.ts:132`) over `ENCOUNTER_TRANSITIONS` (`encounter-constants.ts:10`),
reachable at `PATCH /api/v1/practice/encounters/{encounterId}` with the action vocabulary at
`encounter-constants.ts:29`. Optimistic concurrency on `record_version` (`encounters.ts:180`), a
`VERSION_CONFLICT` when it loses, an `ILLEGAL_TRANSITION` when the table forbids the move.

The state table lives in a module with **no server imports** so the consultation UI derives its buttons
from the same table the engine enforces (`encounter-constants.ts:1-7`) — a rendered button cannot 422.

### CORE-06 — Interruption-safe encounter behaviour — PARTIAL: built, proven, unreachable

The engine is complete and careful:

- `interruptWith` (`encounters.ts:271`) pauses the running consultation **first**, then opens the
  interrupting one — the order is forced by migration `234:47-49`'s one-active index.
- If the second step fails, the first is **rolled back** (`encounters.ts:301-313`), because there is no
  transaction to join and a practitioner left with nothing active is worse than a refusal.
- `interrupted_by_id` records *what* displaced the consultation (`234:28`), cleared on resume
  (`encounters.ts:177`).
- The queue is untouched, which is s16's acceptance criterion — nothing in `interruptWith` reads or
  writes `practice_queue_entry`.

**No user can do this.** `ENCOUNTER_ACTIONS` (`encounter-constants.ts:29`) has no `interrupt`, no route
calls `interruptWith`, and no page imports it. Its only callers are
`scripts/practice-clinic-day-harness.ts:195` and `scripts/practice-interruption-harness.ts:146,165`.
A practitioner can reach the same end state manually — pause, then start — but without
`interrupted_by_id` being set and without the rollback guarantee.

### CORE-07 — Follow-up lifecycle and summary query — PARTIAL

Lifecycle is complete: `src/lib/practice/follow-ups.ts` and `follow-up-plans.ts`, with
`GET|POST /api/v1/practice/follow-ups`, `GET|PATCH /api/v1/practice/follow-ups/{followUpId}`, and a
board view at `?board=1`. Overdue is **derived from the clock, never stored** — migration 196 has no
`OVERDUE` status (`metrics.ts:644-646`).

⚠ **The summary is implemented twice, with different categories, and both render on the Command Centre.**

| | `activeFollowUps` (`session.ts:202`) | `followUpIntelligence` (`command-centre.ts:252`) |
|---|---|---|
| Categories | Due Today · Overdue · Waiting Results · Booked · Completed | Booked Today · Need Booking · Overdue · Completed · Due This Week |
| Reaches the page as | `dash.followUps` → rendered `home/page.tsx:503` | `cc.followUpIntelligence` → rendered `home/page.tsx:647-651` |
| Matches s7's named read model | no | **yes** ("booked today, need booking, overdue, completed, due this week") |

This is the exact defect s16 names — "no widget independently calculates a conflicting version of a
shared metric" — surviving inside the workstream that was written to end it. Neither is exposed as
s10's `GET /practice/followups/summary`.

### CORE-08 — Dashboard assembler endpoint — SHIPPED, with a caveat

`dashboardReadModel` (`dashboard.ts:162`) assembles s11's payload: `asOf`, `timezone`, `scope`, `plan`,
`session`, `glance`, `metrics`, `queue`, `timeline`, `followUps`, `alerts`, `drafts`, `operations`,
`brief`, `feeders`, `unavailable`. Served at `GET /api/v1/practice/dashboard` and consumed directly by
the server-rendered page — one implementation, two surfaces (`dashboard/route.ts:9-13`).

Partial failure is first-class: every feeder runs inside `feed()` (`dashboard.ts:147`) so a throw cannot
take the batch down, and `feeders` reports each one (`dashboard.ts:234-258`). The route returns **200 even
when feeders failed** (`dashboard/route.ts:28-31`).

⚠ **Caveat.** `src/app/practice/(shell)/home/page.tsx` calls `commandCentre` (line 76) *as well as*
`dashboardReadModel` (line 89), and renders three cards from it: a second timeline (`:594-612` beside
`:418-422`), a second waiting queue (`:618-625` beside `:377`, with a different status set — `command-centre.ts:147`
includes `PAUSED`), and the second follow-up summary above. The assembler is not yet the only source on
the screen it was written for.

### CORE-09 — Domain event outbox and dashboard event stream — PARTIAL

**What is real.** The outbox table (`233:31`) with s9's complete catalogue as a `CHECK` — a closed
vocabulary so a consumer can switch exhaustively. The writer `emitEvent` (`events.ts:104`) never throws
and never swallows: failures come back as `{ ok: false, code, message }` and ride along with the
successful result as `eventWarnings`. The reasoning for that trade is written at `events.ts:10-31`.
The stream: `eventsSince` (`event-stream.ts:94`) with a per-connection cursor ordered by `recorded_at`
(never `occurred_at` — `event-stream.ts:26-32`), served as SSE at `GET /api/v1/practice/stream`, consumed
by `LiveRefresh.tsx` which degrades to a 45-second poll and says which of three states it is in.

**Three things are not what a reader would assume.**

1. **Eight of thirty-four event types are ever emitted.** The catalogue has 34 entries
   (`events.ts:33-48`, asserted at `practice-events-harness.ts:310`). Only two modules emit anything:

   | Emitted | From |
   |---|---|
   | `activity.started`, `session.started` | `activity.ts:352` (`startActivity`) |
   | `activity.completed`, `session.closed` | `activity.ts:354` (`startActivity` on switch, `endActivity`) |
   | `encounter.started`, `encounter.paused`, `encounter.completed` | `encounters.ts:231-235` |
   | `encounter.reopened` | `encounters.ts:199-201` |

   Never emitted, though declared as dashboard-relevant at `event-stream.ts:41-61`:
   `encounter.created` (`launchEncounter` audits but does not emit), `appointment.created`,
   `appointment.cancelled`, `patient.checked_in`, `queue.entry_created`, `queue.entry_status_changed`,
   all four `followup.*`, `result.*`, `task.*`, `document.*`, `message.received`, `alert.*`,
   `metric.snapshot_created`. **Consequence:** booking a patient, checking one in, raising a follow-up
   or completing a task pushes nothing to the stream; those cards move only on the 45-second poll.

2. **There is no dispatcher, and `published_at` does not mean what its column comment implies.**
   `events.ts:141-143` leaves it null on purpose. The only writer is `markPublished`
   (`event-stream.ts:138`), called by the SSE reader *after* it has written to that one client
   (`stream/route.ts:98`). So it means "at least one connected browser pulled this row", not "dispatched".
   The unpublished-backlog partial index (`233:152-154`) has no consumer. The reconciler that
   `events.ts:22-25` describes as always possible does not exist.

3. **The stream is a two-second tail, not a broker** — stated plainly at `stream/route.ts:13-19`.
   `POLL_MS = 2000` (`stream/route.ts:33`), heartbeat at 25s, connection age limit 10 minutes.

### CORE-10 — Metric definitions and validation tests — SHIPPED

All twelve of s8 in `src/lib/practice/metrics.ts`, one owning function each, each carrying its own
`formula` and `sources` (`metrics.ts:124-142`). See [`CORE-001-engines.md`](./CORE-001-engines.md) for the
full definition table and the exclusions each one applies. The previous implementations were **deleted**,
not corrected: `todayAtAGlance` (`session.ts:142-153` records the removal and why) and
command-centre's four performance figures (`command-centre.ts:260-277` lists what each of them got wrong).

Tests: `scripts/practice-command-centre-harness.ts:178-259` and `scripts/practice-interruption-harness.ts:211`.

⚠ One declared safeguard is not wired: `METRIC_CAPABILITIES` (`metrics.ts:160`) is exported with the
comment "so a harness can prove each one EXISTS in `practice_role_capabilities`" — **no harness reads it.**
`ACTIVITY_CAPABILITIES` and `TODAYS_WORK_CAPABILITIES` are asserted (`practice-audit-harness.ts:253`,
`practice-current-activity-harness.ts:90`); the metric ones are not.

### CORE-11 — Operational alert rules — PARTIAL

`operationalAlerts` (`session.ts:236`) — three rules, each a non-zero count with a link to the list
behind it: unreviewed incoming documents (`info`), overdue **urgent** follow-ups (`danger`), incomplete
encounters (`warning`). A rule with a count of nought renders nothing, so a quiet practice shows an
empty card rather than four reassurances (`session.ts:230-232`).

Missing: no `GET /practice/alerts` endpoint (alerts ride inside the dashboard payload); no
`practice_alert` table — alerts are **derived, not stored**, which is the right call and has the
consequence that `alert.created` / `alert.resolved` can never be emitted even though the stream declares
them dashboard-relevant (`event-stream.ts:53-54`).

### CORE-12 — Derived brief with source references — SHIPPED

`practiceBrief` (`brief.ts:100`) is a **pure function over rows already read** — it issues no query, so
it cannot disagree with the tiles beside it. Each item carries `sourceRefs` as `{ table, id }` pairs
(never names — s13), `refsArePartial` when the count exceeds the refs sampled, and the payload carries
`status: "derived"`, `calculatedAt` and `method` as **fields rather than page text** (`brief.ts:22-25`).
`FORBIDDEN_IN_BRIEF` (`brief.ts:155`) is a list of claims — predict, trend, better than, benchmark —
that the service has no basis for. Three ways to be empty are distinguished at `brief.ts:140-143`:
nothing waiting, nothing visible, nothing read.

No `GET /practice/brief` endpoint; served inside `/dashboard`.

### CORE-13 — as_of and stale-state handling — SHIPPED, one gap

`asOf` and `timezone` on every dashboard response (`dashboard.ts:261-262`), `calculatedAt` on the brief,
`asOfIso` on the metric bundle (`metrics.ts:1087`). Per-card partial failure via `feeders`, surfaced to
the practitioner in their own words (`home/page.tsx:108-113`). `LiveRefresh.tsx` shows `live` /
`Updating every 45s` / `Connecting` and explains itself in the tooltip — the failure it exists to prevent
is a dead stream looking exactly like a quiet morning (`LiveRefresh.tsx:27-29`).

**Gap:** s14 requires stale/degraded mode to "disable actions that cannot safely queue". Nothing is
disabled; the indicator is display-only.

### CORE-14 — Audit logging and permissions checks — SHIPPED

- One gate for every route: `requirePracticeContext(capability)` (`api-context.ts:14`), in
  SHELL-001's order — authentication, workspace, membership, status, entitlement, then capability.
- Capabilities are resolved per request from live membership; the cookie is a **preference**, revalidated
  every time (`access.ts:5-13`, `:156`).
- Capability grants are time-bounded and compared **on the database's clock** (`access.ts:103-131`) —
  two unambiguous queries instead of one PostgREST or-filter across a null test.
- `audit()` on every write path in this workstream: `planActivity` `:294`, `startActivity` `:444`,
  `endActivity` `:481`, `launchEncounter` `encounters.ts:125`, `transitionEncounter` `:189`. The
  distinction between the audit trail and the event log is argued at `activity.ts:233-257` and
  `233:10-18`: one proves who did what, the other tells projections to rebuild.
- s13's "export and print actions must be logged" is honoured — the patient export is logged twice, in
  the access log and the audit trail (`patients/[patientId]/export/route.ts:10-12`).

### CORE-15 — End-to-end clinic-day acceptance test — SHIPPED

`scripts/practice-clinic-day-harness.ts` walks one morning through the real engines and asserts s16's
criteria **as changes** — before and after the action supposed to move them (`:9-13`). It provisions a
real workspace through the real saga and creates nothing it could create through an engine (`:15-17`).

Covered: session start (1a-1c), scope change (2a-2c), booking → arrival → queue → encounter (3a-3g),
emergency interruption with the queue intact (4a-4c), completion moving counts/patients-seen/timeline/
performance (5b-5e), follow-up creation moving the lens, the tile and the alert (6a-6d), formula and
reason on every metric (7a-7b), `as_of` (8a), one answer for Completed (11a-11b), partial failure
(10a with a non-vacuity control), session close and the event log (12a-12d).

**What it does not cover:** it drives *engines*, not HTTP. Route-level capability gates, request
validation and response shapes are outside it.

---

## 3. Spec claims that could not be verified in the code

| Claim | Where in spec | Finding |
|---|---|---|
| Metric Snapshot entity, `metric.snapshot_created` | s5, s9 | No `practice_metric_snapshot` table anywhere in `supabase/migrations`. Metrics are computed on read (`metrics.ts:1059`). The event type exists in the catalogue and can never fire. |
| Session as an entity with its own lifecycle | s5, s6 | No `practice_session` table. Collapsed into `practice_activity`; `233:108-114` records the decision and keeps the column. |
| Interruption "creates a child activity context, depending on configuration" | s6.2 | Only the same-session encounter path exists. No configuration switch, no child activity. |
| No-show grace period, "configurable" | s8 | Not implemented and **not invented** — there is no grace-period setting in `practice_configuration` (migration 203) and no automatic sweep. Only an explicitly marked `NO_SHOW` counts (`metrics.ts:684-688`). |
| "Cancelled in the selected period" | s8 | Not measurable: `practice_appointment` has no `cancelled_at`. What is counted is *scheduled for the period and now cancelled* — stated in the metric's own `formula` rather than approximated silently (`metrics.ts:560-563`). |
| Emergency classification on the encounter | s8 | `practice_encounter` carries no urgency field (migration 194 has `encounter_mode` and `entry_pathway`, neither of which expresses it). Counted from the appointment type `emergency` or activity type `emergency_consult`; an emergency with neither is **under-counted rather than inferred** (`metrics.ts:594-605`). |
| Queue ordering rules "configurable" | s7 | Not configurable. `waitingQueue` orders by `entered_at` ascending (`session.ts:172`). |
| Messages card "no PHI preview beyond configured privacy rule" | s7 | No privacy rule governs the messages card; the attention list is capability-gated only (`operations-home.ts:361-368`). |

## 4. Stale comments found while writing this

Two engines still document `practice_encounter.activity_id` as unwritten. It **is** written —
`encounters.ts:111`, by `launchEncounter`, and the clinic-day harness asserts it at 3g.

| File | Lines | Says | Consequence |
|---|---|---|---|
| `src/lib/practice/session.ts` | 33-36 | "Migration 232 added the column and nothing writes it yet" | Documentation only — the encounter counting it justified has since moved to `metrics.ts`. |
| `src/lib/practice/session-timeline.ts` | 45-50 | "written by nothing yet, so filtering on it would report every session as empty" | **Behavioural.** The timeline is still workspace-wide and day-scoped for arrivals and encounters. In a shared practice it draws the practice's day, not the practitioner's, on a reason that is no longer true. |

`metrics.ts:54` has it right: "written by `launchEncounter` since CPR-V3-001".

## 5. The navigation invariants, and where they are checked

Not part of CORE-001, but the frozen design (s17) is enforced here and it is worth knowing where.

| Invariant | Enforced by | Asserted by |
|---|---|---|
| No built module is unreachable from the sidebar | `orphanedNav()` `navigation.ts:262` — the **same function the sidebar uses**, so a check cannot reimplement the rule and agree with itself | `practice-current-activity-harness.ts:489` |
| A parent section is itself primary **and** built | `navigation.ts:74-83` | `:511` |
| Ten primary sections, in the order the specs list | `PRIMARY_ORDER` `navigation.ts:213` — declared, never inferred from array position | `:493`, `:503` |
| Every primary section belongs to exactly one sidebar group | `SIDEBAR_SECTIONS` `navigation.ts:230-237` (Workspace / Insights / Administration) | `:558` |
| Every built nav entry points at a page that exists | — | `:565`, checked on the file system |
| An unfinished route renders **nothing**, never a disabled grey promise | `built` flag, `visibleNav()` `navigation.ts:201` | — |

⚠ The one trap this file records rather than enforces: `/practice/[area]` renders public marketing pages
with `generateStaticParams`, so those slugs are prerendered at build time and **shadow the app shell in
production only** — dev looks perfect and the deployed site serves a marketing page, 200, no warning
(`navigation.ts:92-103`). Two routes have hit it. `scripts/practice-content-harness.ts` assertion 7a
fails the build on a new overlap.
