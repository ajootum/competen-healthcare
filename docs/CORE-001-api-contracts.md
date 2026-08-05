# Competen Practice — API Contracts (`/api/v1/practice/*`)

**Satisfies:** CPR-CORE-001 s18, "developer documentation and API contracts are published in the code repository".
**Source of truth:** the route files themselves. Every row below was read out of
`src/app/api/v1/practice/**/route.ts`; nothing here is inferred from a specification.
**Companions:** [`CORE-001-implementation.md`](./CORE-001-implementation.md), [`CORE-001-engines.md`](./CORE-001-engines.md).
**Verified against** the working tree at `5a686ce`.

69 route files. 8 of s10's 17 recommended endpoints exist; **9 do not** — §4.

---

## 1. The envelope every route shares

### Authentication and context

One function guards every route: `requirePracticeContext(capability)` — `src/lib/practice/api-context.ts:14`.
It runs SHELL-001's guard order (authentication → workspace → membership → workspace status →
entitlement → capability) because evaluating capability before membership leaks which routes exist to
non-members (`access.ts:11-13`).

| Refusal | Status | Body | Cause |
|---|---|---|---|
| — | 401 | `{ error: "Unauthorized" }` | no session (`src/lib/api-auth.ts:24`) |
| — | 403 | `{ error: "No Practice workspace" }` | authenticated, no membership anywhere |
| `WORKSPACE_CHOICE_REQUIRED` | 409 | `{ error, code }` | more than one workspace and no `practice_active_ws` cookie |
| — | 404 | `{ error: "Not found" }` | `NO_MEMBERSHIP` — enumeration-safe, never 403 |
| — | 403 | `{ error: "WORKSPACE_INACTIVE" \| "NOT_ENTITLED" }` | workspace suspended/closing/closed, or no live entitlement |
| — | 403 | `{ error: "Forbidden" }` | membership fine, **declared capability not held** |

A capability of `null` means "any authenticated member of this workspace" — used where the resource is
the caller's own (preferences, notifications, security, delegation approvals, reflection, portfolio).

### Conventions

- **`correlationId` on every success body.** It is the request's trace id (`caller.traceId`), so an
  audit row and the response a practitioner saw can be put beside each other afterwards.
- **Engine failures** come back as `{ error: { code, message }, correlationId }` at the engine's own
  status. Codes are engine constants, listed per route below.
- **Malformed JSON** is always `400 { error: "invalid JSON" }` — the body is parsed with
  `.catch(() => null)` rather than allowed to throw a 500.
- **201 for creation, 200 for change.** `POST /encounters` returns **200** when it resumed a live
  encounter rather than creating one (`encounters.ts:69`).
- **Optimistic concurrency** where a record can be edited concurrently: `recordVersion` /
  `expectedVersion` in, `409 VERSION_CONFLICT` out.

---

## 2. The CORE-001 surface, in full

These are the four routes this workstream added or owns. They are documented in more depth than the rest
because they are what s10 was asking for.

### `GET /api/v1/practice/dashboard`

s10's `GET /practice/dashboard`; backlog CORE-08. `src/app/api/v1/practice/dashboard/route.ts`.

| | |
|---|---|
| Capability | `practice.home.view` |
| Request | none — day/session scope is **resolved server-side**, not chosen by the caller (`dashboard.ts:176-181`) |
| Cache | `dynamic = "force-dynamic"`, no cache header. s12 permits caching calendar data; caching the assembled whole to suit its slowest part would make the queue stale (`route.ts:15-18`) |
| Status | **always 200**, even when feeders failed — a 500 would throw away eleven working cards over one timed-out query (`route.ts:28-30`) |

Response — `DashboardReadModel` (`src/lib/practice/dashboard.ts:95-138`) plus `correlationId`:

| Key | Type | Notes |
|---|---|---|
| `asOf` | ISO instant | s12 |
| `timezone` | IANA | the **practice's**, never the server's |
| `scope` | `{ date, kind: "session"\|"day", sessionId, fromIso, toIso }` | half-open window; `kind` is stated so a screen labels what it drew |
| `plan` | `TodaysPlan` | `{ date, timezone, activities[], current, next, unavailable }` |
| `session` | `SessionWithFigures \| null` | clock figures from the session engine; `patientsSeen` / `averageMinutesPerPatient` handed in from `metrics.ts`; `runningBehindMinutes` **null until earned** |
| `glance` | `{ tiles[], scope, unavailable }` | 8 tiles, each `{ key, label, count, href, status, reason, formula, sources }` |
| `metrics` | `PracticeMetrics \| null` | all twelve of s8 |
| `queue` | `{ groups[], total, unavailable }` | groups `booked` / `walk_ins` / `emergency` |
| `timeline` | `SessionTimeline` | `{ events[], upcoming[], sources[], unavailable, partial }` |
| `followUps` | `FollowUpLens[]` | five overlapping lenses; **no total, deliberately** (`session.ts:194-198`) |
| `alerts` | `{ alerts[], unavailable }` | |
| `drafts` | array \| null | resumable draft encounters |
| `operations` | `operationsHome` result \| null | the rows the brief was derived from |
| `brief` | `PracticeBrief` | `{ status: "derived", calculatedAt, items[], sourceRefs[], blindSpots[], method, unavailable }` |
| `feeders` | `Record<string, "ok"\|"unavailable">` | keys: `plan`, `glance`, `queue`, `timeline`, `followUps`, `alerts`, `drafts`, `brief` |
| `unavailable` | boolean | **true only when every feeder failed** (`dashboard.ts:283`) |

Metric `status` is one of `ok` / `unknowable` / `unreadable` / `not_permitted` — a null `count` is never
a zero, and `reason` says which of the four it is.

### `GET /api/v1/practice/stream`

s10's `GET /practice/stream`; backlog CORE-09. `src/app/api/v1/practice/stream/route.ts`.

| | |
|---|---|
| Capability | `practice.home.view` |
| Transport | Server-Sent Events. Not a WebSocket: traffic is one-directional, SSE replays by itself via `Last-Event-ID`, and it is plain HTTP — a proxy that mangles WebSocket upgrades is a real and unexplainable failure on clinic connectivity (`route.ts:6-11`) |
| Resume | `Last-Event-ID` header, or `?since=<eventId>`. An unknown id starts from **now**, never replays a week (`route.ts:63-70`) |
| Headers | `content-type: text/event-stream`, `cache-control: no-cache, no-transform`, `connection: keep-alive`, `x-accel-buffering: no` (nginx buffers by default and would deliver a whole morning at once, in the evening) |
| Timing | poll 2s, heartbeat 25s, connection age limit 10min then `event: bye` |

| SSE event | Payload | Meaning |
|---|---|---|
| `ready` | `{ resumed, correlationId }` | connected — lets a client tell "connected" from "quiet" |
| `practice` | `StreamedEvent` = `{ id, eventType, recordedAt, occurredAt, patientId, encounterId, sessionId }`, with `id:` set | one dashboard-relevant domain event |
| `degraded` | `{ message }` | the event log could not be read — told, not hidden |
| `bye` | `{ reason }` | deliberate close, distinguishable from a drop |
| `:heartbeat` | — | SSE comment; keeps proxies from closing an idle socket |

Filtered to `DASHBOARD_EVENTS` (`event-stream.ts:41-61`), 32 of the 34 catalogue types; `NOT_STREAMED`
(`:67`) is the declared complement. ⚠ **Only 8 types are ever emitted** — see
[`CORE-001-implementation.md`](./CORE-001-implementation.md) §CORE-09.

Client: `src/app/practice/(shell)/LiveRefresh.tsx` — subscribes, coalesces bursts at 400ms, calls
`router.refresh()` rather than patching cards client-side (a client reducer would be a second
implementation of every metric — `LiveRefresh.tsx:13-19`), and runs s12's 45-second poll **alongside**
the stream, not instead of it.

### `GET | POST /api/v1/practice/current-activity`

s10's `GET /practice/activities/today` and the session lifecycle half of `POST/PATCH /practice/sessions`.
`src/app/api/v1/practice/current-activity/route.ts`.

⚠ **Not `/api/v1/practice/activities`** — that path belongs to `practice_clinical_activity`, the
retrospective portfolio record. Two different things called "activity" is already one too many
(`route.ts:8-10`).

| Method | Capability | Request | Success |
|---|---|---|---|
| GET | `practice.home.view` | — | `{ plan, correlationId }` |
| POST | `practice.home.view` (the **engine** additionally requires `appointment.manage` to write) | `{ action: "plan" \| "start" \| "end", ... }` | `{ ...result, plan, correlationId }` — the refreshed plan comes back with the write so the screen cannot draw a stale current activity |

| `action` | Body | Refusals (`code` / status) |
|---|---|---|
| `plan` | `activityType, title, planDate, plannedStartMinute, plannedEndMinute, facilityId?, locationId?, room?` | `FORBIDDEN` 403 · `VALIDATION_ERROR` 400 (unknown type, empty title, ends before it begins) · `INSERT_FAILED` 500 |
| `start` | `id` | `FORBIDDEN` 403 · `READ_FAILED` 500 · `NOT_FOUND` 404 · `ALREADY_ENDED` 422 · `ALREADY_RUNNING` 409 (incl. the `23505` race on migration 232's partial index) · `NOT_TODAY` 422 · `SWITCH_FAILED` 500 · `START_FAILED` 500 |
| `end` | `id` | `FORBIDDEN` 403 · `READ_FAILED` 500 · `NOT_FOUND` 404 · `NOT_STARTED` 422 · `ALREADY_ENDED` 422 · `END_FAILED` 500 |
| — | anything else | `UNKNOWN_ACTION` 400 |

`start` and `end` return `eventWarnings: string[]` alongside a **success**. A failed outbox write does not
unstart a clinic; the warnings let a caller tell a broken outbox from a quiet practice (`activity.ts:450-453`).

### `PATCH /api/v1/practice/queue/{entryId}`

The only queue route. Capability `queue.manage`. Body `{ action: "ready"|"wait"|"start"|"pause"|"complete"|"left" }`
→ `{ entry: { status }, correlationId }`. Refusals: 400 unknown action, `NOT_FOUND` 404,
`ILLEGAL_TRANSITION` 422.

---

## 3. Full route index

Capability column: the string passed to `requirePracticeContext`. `null` = any authenticated member.
`super` = `getCaller()` + `isSuper` rather than a practice capability. `auth` = authentication only.

### Clinical work

| Method + path | Capability | Request | Success | Refusals |
|---|---|---|---|---|
| GET `/encounters` | `encounter.list` | `?status=live\|all` | `{ encounters[], correlationId }` | — |
| POST `/encounters` | `encounter.create` | `patientId`, `pathway`, `appointmentId?`, `encounterMode?`, `reasonForVisit?` | `{ encounter, correlationId }` 201, **200 when resumed** | 400 missing `patientId` / bad pathway · `NOT_FOUND` 404 · `PATIENT_NOT_ACTIVE` 422 · `APPOINTMENT_PATIENT_MISMATCH` 422 · `CONTEXT_READ_FAILED` 500 · `VALIDATION_ERROR` 400 |
| GET `/encounters/{id}` | `encounter.list` | — | `{ encounter, patient, notes, diagnoses, treatments, history, correlationId }` | 404 |
| PATCH `/encounters/{id}` | `encounter.edit`, or `encounter.sign` when `action` targets SIGNED | `{ action }` or `{ noteType, body, source }` | `{ encounter \| saved, correlationId }` | 400 unknown action · `NOT_FOUND` 404 · `ILLEGAL_TRANSITION` 422 · `ANOTHER_ACTIVE` 409 · `VERSION_CONFLICT` 409 · `REFUSED_BY_DATABASE` 422 · `READ_FAILED` 500 |
| GET/PUT/DELETE `/encounters/{id}/drafts` | `encounter.edit` | PUT `{ noteType, body, basedOnVersion }`; DELETE `?noteType=` | `{ ...draft, correlationId }` | engine codes |
| GET/POST `/encounters/{id}/notes` | `encounter.list` / `encounter.edit` | POST `{ templateId, mode }` | `{ history \| applied, correlationId }` | 400 missing `templateId` |
| POST `/encounters/{id}/diagnoses` | `diagnosis.record` | `label`, `code?`, `codeSystem?`, `certainty?`, `isPrimary?`, `problemLabel?` | `{ diagnosis, correlationId }` 201 | 400 missing label · `ENCOUNTER_LOCKED` 422 · `ENCOUNTER_CANCELLED` 422 · 404 |
| POST `/encounters/{id}/treatments` | `treatment.record` | `label`, `treatmentType`, `dose?`, `route?`, `frequency?`, `duration?`, `notes?`, `diagnosisId?` | `{ treatment, correlationId }` 201 | 400 label / type · `ENCOUNTER_LOCKED` 422 |
| GET/POST `/procedures` | `encounter.list` / `procedure.record` | GET `?encounterId&patientId&activity=1&since`; POST `encounterId`, `procedureTypeId?`, `label?`, … | `{ procedures \| activity \| procedure, correlationId }` | `NOT_FOUND` 404 · `ENCOUNTER_LOCKED` 422 · `PROCEDURE_NOT_PUBLISHED` 422 · `LATERALITY_REQUIRED` 422 · `CONSENT_REQUIRED` 422 · `TREATMENT_ENCOUNTER_MISMATCH` 422 |
| GET/POST `/procedures/{id}` | `encounter.list` / `procedure.record` | POST records an **outcome** (deliberately POST, not PATCH) | `{ procedure… \| outcome, correlationId }` | `SEVERITY_REQUIRED` 400 · `SEVERITY_NOT_APPLICABLE` 400 · `ENCOUNTER_PATIENT_MISMATCH` 422 |
| GET/POST/PATCH `/procedure-types` | `encounter.list` / `procedure.manage` | | `{ procedureTypes \| procedureType, correlationId }` | `CODE_RESERVED` 409 · `CODE_IN_USE` 409 · `PLATFORM_PROCEDURE` 403 |
| GET/POST/PATCH `/activities` | `procedure.record` | GET `?procedureId&trace&view&from&to&mine&performedBy&kind` | `{ activities \| templates \| … , correlationId }` | engine codes |
| GET/POST/DELETE `/attachments` | `encounter.list` / `encounter.edit` | POST multipart `file`, `encounterId`, `kind?`, `caption?` | `{ attachment \| attachments \| url, correlationId }` | 400 no file / bad mime / size · 500 storage unavailable |

### Diary, queue and follow-up

| Method + path | Capability | Request | Success | Refusals |
|---|---|---|---|---|
| GET `/appointments` | `practice.calendar.view` | `?date=YYYY-MM-DD` | `{ date, ...day, correlationId }` | 400 bad date |
| POST `/appointments` | `appointment.manage` | `patientName`\|`patientId`, `scheduledAt`, `appointmentType`, `durationMinutes?`, `locationId?`, `reason?`, `allowOverlap?` | `{ appointment, correlationId }` 201 | 400 required fields · engine codes |
| PATCH `/appointments/{id}` | `appointment.manage` | `{ action: confirm\|cancel\|no_show\|arrive\|complete }` | `{ appointment, correlationId }` | 400 unknown action · 422 illegal move · 409 version conflict |
| PUT `/appointments/{id}` | `appointment.manage` | `scheduledAt?`, `durationMinutes?`, `locationId?`, `allowOverlap?`, `expectedVersion?` | `{ appointment, correlationId }` | 400 nothing to change |
| POST `/availability` | `appointment.manage` | `startsAt`, `endsAt`, `status?`, `locationId?`, `note?` | `{ slot, correlationId }` 201 | 400 bad window |
| POST `/availability-config` | `appointment.manage` | `{ action: add_clinic\|add_session\|edit_session\|duplicate_session\|remove_session\|add_exception\|set_booking_rule\|generate, … }` | per action | 400 unknown action · engine codes |
| **PATCH `/queue/{entryId}`** | `queue.manage` | `{ action }` | `{ entry, correlationId }` | `NOT_FOUND` 404 · `ILLEGAL_TRANSITION` 422 |
| GET/POST `/follow-ups` | `followup.view` / `followup.manage` | GET `?board=1&patientId&status`; POST `patientId`, `originEncounterId?`, `kind?`, `reason?`, `dueOn?`, `intervalCode?`, `priority?` | `{ followUps \| board \| followUp, correlationId }` | `VALIDATION_ERROR` 400 · `PATIENT_NOT_ACTIVE` 422 · `ENCOUNTER_PATIENT_MISMATCH` 422 · `UNKNOWN_INTERVAL` 400 |
| GET/PATCH `/follow-ups/{id}` | `followup.view` / `followup.manage` | PATCH `{ appointmentId }` or `{ action, outcome?, outcomeCode?, closingEncounterId? }` | `{ followUp, correlationId }` | `ILLEGAL_TRANSITION` 422 · `APPOINTMENT_NOT_LIVE` 422 · `APPOINTMENT_ALREADY_LINKED` 409 · `OUTCOME_REQUIRED` 400 · `VERSION_CONFLICT` 409 |
| GET/POST/PATCH `/follow-up-plans` | `followup.view` / `followup.manage` | GET `?view=recall\|outcomes\|templates&patientId&from&to` | `{ plans \| templates \| recall …, correlationId }` | `CODE_IN_USE` 409 · `TEMPLATE_RETIRED` 422 · `REASON_REQUIRED` 400 |

### Patients and registration

| Method + path | Capability | Request | Success | Refusals |
|---|---|---|---|---|
| GET `/patients` | `patient.list` | `?q=` | `{ results[], correlationId }` | — |
| POST `/patients` | `patient.create` | `displayName`, `sex?`, `birthDate?`, `ageEstimateYears?`, `phone?`, `email?`, `identifiers?`, `confirmNew?` | `{ patient, correlationId }` 201 | `VALIDATION_ERROR` 400 · `DUPLICATE_IDENTIFIER` 409 + `candidates` · `POSSIBLE_DUPLICATE` 409 + `candidates` · `IDENTIFIER_GENERATION_FAILED` 502 |
| GET/PATCH `/patients/{id}` | `patient.view` / `patient.edit` | PATCH requires `recordVersion` | `{ patient…, correlationId }` | 400 missing `recordVersion` · `NOT_EDITABLE` 422 · `VERSION_CONFLICT` 409 |
| POST `/patients/{id}/merge` | `patient.merge` | `duplicatePatientId`, `reason?` | `{ merge: { moved }, correlationId }` | `ILLEGAL_MERGE` 422 · `VALIDATION_ERROR` 400 |
| GET `/patients/{id}/export` | `data.export` | — | **file download**, `Cache-Control: no-store, private`; logged twice (access log + audit) | `NOT_FOUND` 404 |
| GET/POST `/registration` | `patient.create` | GET `?specialty&country&practiceType` | `{ patientId, practiceId, relationships, appointmentId, incomplete[], correlationId }` 201 | `TEMPLATE_INCOMPLETE` 422 · `GUARDIAN_REQUIRED` 422 · `CONTACT_REQUIRED` 400 + all `registerPatient` codes |
| GET/POST/DELETE `/registration-workspace` | `patient.list` / `patient.create` | POST `{ queuePatientId }` **(this is how a walk-in reaches the queue)** or `{ draftId, payload, label }` | `{ id, alreadyWaiting?, correlationId }` | `MERGED` 422 · `NOT_FOUND` 404 |
| GET/POST/PATCH/DELETE `/registration-templates` | `practice.settings.manage` | | | `PUBLISHED` 409 · `NOT_PUBLISHABLE` 422 · `PROTECTED_FIELD` 422 |
| GET/POST `/contacts` | `patient.list` / `comm.record` | POST `patientId`, `channel`, `direction`, `outcome`, `summary` | `{ contact, correlationId }` 201 | 400 missing `patientId` |

### Documents, tasks, messages, inbox

| Method + path | Capability | Notable refusals |
|---|---|---|
| GET/POST `/documents` | `document.view` / `document.author` | 400 missing `patientId` |
| GET `/documents/{id}` | `document.view` | 404 |
| PATCH `/documents/{id}` | `document.author`, **`document.sign`** when the action targets SIGNED | 400 unknown action |
| GET/POST `/documents/batch` | `document.view` / `document.author` | 400 `patientIds` not an array |
| POST `/documents/generate` | `document.author` | `UNRESOLVED_FIELDS` 422 unless `allowUnresolved` |
| GET/POST/PATCH/DELETE `/library` | `document.view` / `template.manage` | `NAME_IN_USE` 409 · `CLINICAL_DOCUMENT` 422 · `ALREADY_PURGED` 422 · 400 mime/size |
| GET/POST `/note-templates`, GET/PATCH `/note-templates/{id}` | `encounter.edit` / `template.manage` | `CODE_RESERVED` 409 · `PLATFORM_TEMPLATE` 403 |
| GET/POST/DELETE `/smart-phrases` | `encounter.edit` (sharing re-checks `template.manage`) | `SHORTCUT_IN_USE` 409 · 403 plain-string when sharing without `template.manage` |
| GET/POST `/tasks`, GET/PATCH `/tasks/{id}` | `task.view` / `task.manage` | `NOT_A_MEMBER` 422 · `REMINDER_AFTER_DUE` 400 · `TASK_CLOSED` 422 · `VERSION_CONFLICT` 409 |
| GET/POST/PATCH `/task-orchestration` | `task.view` / `task.manage` | `TOO_MANY` 422 · `NOT_BULK_SAFE` 422 · `TEMPLATE_EMPTY` 422 |
| GET/POST `/threads`, GET/POST/PATCH `/threads/{id}` | `message.use` | 400 `{ read: true }` is the only patch |
| GET/POST/PATCH `/inbox` | `inbox.record`; **`inbox.review`** for `action:"review"` | `ILLEGAL_TRANSITION` 422 · `NOTE_REQUIRED` 400 |
| GET/PATCH `/notifications` | `null` | — |

### Intelligence, search, reporting

| Method + path | Capability | Notes |
|---|---|---|
| GET/POST/PATCH `/assistant` | `encounter.list` | returns `refused: REFUSED` — what the assistant will not do, in the payload |
| GET/POST/DELETE `/case-memory` | `encounter.list`; writing a learning point against a consultation additionally needs `encounter.edit` (403 `FORBIDDEN` in-route) | |
| GET `/search` | `search.use` | returns `notSearched[]` — domains skipped for want of a capability, rather than silently omitted |
| GET/POST/PATCH/DELETE `/saved-searches` | `search.use` | `NAME_IN_USE` 409 · `NOT_YOURS` 403 |
| GET/POST `/report-schedules` | `report.view` | every schedule carries `fires: false` and the list carries `automated: false` — **nothing runs them** |
| GET `/reports/export` | `report.view` | raw CSV download |
| GET/POST/PATCH `/reflections` | `practice.home.view` | `TOO_SHORT` 400 · `LOCKED` 409 · `NOT_YOURS` 403 |
| GET/POST/PATCH/DELETE `/portfolio` | `practice.home.view` | `EXPIRES_BEFORE_ISSUE` 400 · export carries `notVerified` and `coversWholeCareer` |

### Practice administration, access and identity

| Method + path | Capability | Notes |
|---|---|---|
| GET/PATCH/POST/PUT `/configuration` | `practice.settings.manage` (POST/PUT: `practice.locations.manage`) | |
| GET/PATCH/PUT/DELETE `/preferences` | `null` | `PREFERENCE_LOCKED` 422 · `EMPTY_DASHBOARD` 422 · `CATEGORY_NOT_OPTIONAL` 422 |
| GET/POST/PATCH `/security` | `null` at the door; **each sub-view re-checks its own** (`patient.view`, `access.review`, `patient.edit`, `practice.settings.manage`) | `BREAK_GLASS_DISABLED` 422 · `SELF_REVIEW` 422 · `ALREADY_OPEN` 422 |
| GET/POST/PATCH `/team` | `practice.members.manage` | `LAST_OWNER` 422 · `CANNOT_DELEGATE_WHAT_YOU_LACK` 403 · `ROLE_NOT_INVITABLE` 400 |
| POST `/team/join` | **auth only** — the workspace is derived from the invitation code | `INVALID_CODE` 404 · `ALREADY_A_MEMBER` 409 · `WORKSPACE_INACTIVE` 422 |
| GET/POST/PATCH `/delegation` | `null` for approvals; `practice.members.manage` for templates and delegations | |
| GET `/workspaces` | auth only | |
| GET `/workspaces/{id}/access` | auth only | 200 `{ access: "restricted", reason }` rather than 403, so the shell can route |
| POST `/workspaces/{id}/activate` | auth only | sets the `practice_active_ws` cookie |
| GET/PATCH `/workspaces/{id}/onboarding` | auth only | 400 unknown `stepCode` / unknown timezone |
| POST `/provisioning/individual` | auth + launch flag; `Idempotency-Key` **required** | `IDEMPOTENCY_CONFLICT` 409 · `PRACTICE_ALREADY_EXISTS` 409 · 202 while in flight |
| GET `/provisioning/{requestId}` | auth; visible to actor, target or super | 404 for everyone else — enumeration-safe |
| POST `/signup` | **platform flag `practice_public_signup`**, not a capability | `SIGNUP_CLOSED` 403 · `ALREADY_AUTHENTICATED` 409 · `IDENTITY_EXISTS` 409 |
| PATCH `/flags` | **super only** | 403 Forbidden |
| GET/PATCH `/identifier-format` | **super only** | `ACKNOWLEDGEMENT_REQUIRED` 409 · `TOO_NARROW` 409 |
| GET `/operations/users` | **super only** | `?q` under two characters short-circuits with a note rather than a guess |
| GET/POST/PATCH `/availability-config`, `/hospital-booking`-adjacent | see diary section | |

---

## 4. Against s10's recommended surface

s10 lists 17 endpoints. This is what exists, endpoint by endpoint.

| s10 endpoint | Status | Reality |
|---|---|---|
| `GET /practice/dashboard` | **exists** | `GET /api/v1/practice/dashboard` |
| `GET /practice/activities/today` | **exists, renamed** | `GET /api/v1/practice/current-activity` — `/activities` was already taken by the portfolio record |
| `POST /practice/sessions` | **exists, folded in** | `POST /api/v1/practice/current-activity` `{ action: "plan" \| "start" }` |
| `PATCH /practice/sessions/{id}` | **partial** | `{ action: "end" }` only. **Pause and resume do not exist** in any form. |
| `GET /practice/sessions/{id}/summary` | **DOES NOT EXIST** | the session summary is a field of the dashboard payload (`session`), never addressable on its own |
| `GET /practice/sessions/{id}/queue` | **DOES NOT EXIST** | the grouped queue is a field of the dashboard payload (`queue`) |
| `POST /practice/sessions/{id}/queue` | **DOES NOT EXIST** | entries are created by `PATCH /appointments/{id}` `{action:"arrive"}` and by `POST /registration-workspace` `{queuePatientId}` |
| `PATCH /practice/queue/{id}` | **exists** | state only. **Position cannot be changed** — no ordering field, ordering is `entered_at` |
| `POST /practice/encounters` | **exists** | |
| `PATCH /practice/encounters/{id}` | **exists** | save/pause/complete/reopen all present |
| `GET /practice/encounters/drafts` | **DOES NOT EXIST** as a collection | `GET /encounters?status=live` is the nearest; `/encounters/{id}/drafts` is per-encounter note drafts, a different thing |
| `GET /practice/followups/summary` | **DOES NOT EXIST** | and there are **two** internal implementations that disagree (see implementation doc, CORE-07) |
| `POST /practice/followups` | **exists** | `POST /api/v1/practice/follow-ups` |
| `GET /practice/brief` | **DOES NOT EXIST** | the brief is a field of the dashboard payload |
| `GET /practice/alerts` | **DOES NOT EXIST** | alerts are a field of the dashboard payload |
| `GET /practice/metrics/today` | **DOES NOT EXIST** | metrics are a field of the dashboard payload |
| `GET /practice/stream` | **exists** | SSE |

**The pattern, stated once:** five of the nine missing endpoints (`sessions/{id}/summary`,
`sessions/{id}/queue`, `followups/summary`, `brief`, `alerts`, `metrics/today`) are **not missing
functionality** — every one of them is a key inside `GET /dashboard`. That was a deliberate reading of
s11 ("the frontend should receive an assembled dashboard payload to reduce inconsistent calculations and
excessive client-side joins"). The cost is real and worth naming: a caller that wants only the metrics
pays for the queue, the timeline and the brief, and there is no way to poll one card.

The genuinely absent capabilities are three: **session pause/resume**, **queue position**, and a
**drafts collection**.
