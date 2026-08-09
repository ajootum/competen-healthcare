

COMPETEN PRACTICE
CP-SCHED-001
Practitioner Scheduling, Availability & Booking Integration Framework
Developer Specification • Version 1.0 • 09 August 2026
Core architectural rulePractice Setup defines when and where the practitioner works. A shared Availability & Scheduling Engine calculates bookable inventory. Registration, staff booking, patient self-booking and follow-up booking consume that same inventory. Confirmed appointments update the practitioner calendar immediately; the calendar does not independently decide availability.
Status: APPROVED IMPLEMENTATION DIRECTION
Product: Competen Practice (CP)Scope: Practitioner-centric scheduling and booking integrationDesign principle: <45-second common workflow; no-code/configurable where feasible; one source of truth for availability.

1. Purpose
This specification defines the missing integration layer between the practitioner program already configured in Practice Setup and all CP appointment-creation surfaces. It establishes a single scheduling model so that a patient registered by the practitioner or practice team can be assigned a valid location, date and free time without opening a separate calendar workflow.
The implementation must also support patient self-booking, follow-up booking, walk-in/session operations and future booking channels without duplicating availability logic.
2. Required outcome
A practitioner configures recurring work locations, days and session times once in Practice Setup.
CP generates potential appointment slots from that program using configurable booking rules.
The registration screen asks for location first, then exposes only valid working dates and currently free times.
Booking is concurrency-safe: a slot cannot be successfully booked twice.
A successful booking creates an appointment and immediately appears in the practitioner calendar.
The same appointment becomes part of the relevant Current Session/queue on the day of care.
Patient self-booking and staff/practitioner booking use the same availability service.
One-off schedule changes, leave and blocks override the recurring program without destroying it.
3. System boundary and source-of-truth rules
Domain
System responsibility / source of truth
Practice Setup
Recurring practitioner program, locations, session definitions, appointment types, durations, buffers, booking horizon, self-booking permissions and capacity rules.
Availability & Scheduling Engine
Computes effective sessions and bookable/free slot inventory after applying overrides, appointments, blocks and booking rules.
Appointment Service
Owns the appointment record and booking state transitions.
Calendar
Operational view/edit surface for appointments and schedule blocks. It must consume the scheduling domain; it is not a second availability engine.
Patient Registration
Creates/updates the patient and optionally consumes one free slot to create an appointment.
Self-booking
Consumes the same availability API with channel-specific visibility/rules.
Current Session
Consumes today's appointments and arrival/queue states; does not duplicate booking records.
4. Target architecture
Logical flow:
PRACTICE SETUP  →  AVAILABILITY & SCHEDULING ENGINE  →  BOOKING CHANNELS  →  APPOINTMENT  →  CALENDAR  →  CURRENT SESSION
Booking channels include Patient Registration, practitioner/staff booking, patient self-booking and follow-up booking. Future channels must integrate through the same service contract rather than recreate slot calculations.
5. Availability computation
For a practitioner + location + date, the engine shall compute effective availability in the following order:
Load the applicable recurring practitioner program/session template.
Apply date-specific overrides: cancelled session, changed location/time, additional session, leave or blocked period.
Resolve appointment type duration, booking interval and any pre/post buffer.
Generate candidate slots within the effective session.
Remove slots conflicting with confirmed/held appointments, blocks or capacity constraints.
Apply channel rules: self-bookable, staff-only, minimum notice, booking horizon and other configured restrictions.
Return only currently bookable slots plus appropriate reason codes for unavailable dates/times.
ImportantDo not persist every theoretical future slot as an appointment-like row unless an implementation-specific optimization requires it. The recurring program and overrides should remain authoritative; free inventory can be computed/cached and invalidated as needed.
6. Patient registration UX contract
Replace the current free-form Appointment date/time control with a compact scheduling card. Reason for visit remains above it.
Step
Required behaviour
1. Location
Dropdown/searchable selector of practitioner locations eligible for booking. Default to the current active session location when context makes this unambiguous.
2. Next available days
After location selection, show a small set of next valid working/bookable dates. Provide 'View calendar' / 'More' for broader selection.
3. Available times
After date selection, fetch and display only free slots as tappable/chip controls. Do not require time typing for the common path.
4. Confirmation
Primary CTA becomes contextual, e.g. 'Register & book 10:20'. Secondary action: 'Register only'.
Today's queue
Where applicable, offer 'Add to today's queue' as a separate operational action using today's active session.
The location-first pattern is intentional: choosing a location narrows the practitioner's valid program and avoids asking users to search arbitrary dates with no session.
7. Minimum domain model
Entity
Minimum fields / notes
PracticeLocation
id, practice_id, name, active, booking_enabled, self_booking_enabled.
PractitionerProgram
id, practitioner_id, location_id, weekday/recurrence rule, effective_from/to, active.
SessionTemplate
program_id, start_time, end_time, default appointment type/duration, capacity rules.
ScheduleOverride
practitioner_id, date/time range, type [cancel/change/add/block/leave], optional replacement location/session, reason.
AppointmentType
id, name, duration_minutes, buffer_before/after, booking interval/rules, channel eligibility.
Appointment
id, patient_id, practitioner_id, practice_id, location_id, session/effective-session reference, appointment_type_id, start_at, end_at, status, booking_source, reason_for_visit, encounter_id nullable.
SlotHold
Optional short-lived reservation/hold for self-booking or multi-step flows; expires automatically.
8. Appointment statuses and booking sources
Status vocabulary should be configurable at presentation level but map to stable platform states. Minimum suggested states: HELD, BOOKED/CONFIRMED, ARRIVED, WAITING, IN_CONSULTATION, COMPLETED, CANCELLED, NO_SHOW. A reschedule should retain audit history.
Minimum booking_source values: PRACTITIONER, PRACTICE_STAFF, PATIENT_SELF_BOOKING, WALK_IN, FOLLOW_UP, IMPORT/EXTERNAL. Store actor/user ID separately from source.
9. API/service contracts
Capability
Illustrative contract
List eligible locations
GET practitioner/{id}/booking-locations?channel=staff|self
Next available dates
GET availability/dates?practitioner_id=&location_id=&appointment_type_id=&from=&limit=
Free slots
GET availability/slots?practitioner_id=&location_id=&date=&appointment_type_id=&channel=
Create booking
POST appointments with patient, practitioner, location, appointment type, start time and source.
Register + book
Application orchestration/transaction: create patient (or resolve existing) + atomically create appointment.
Reschedule
PATCH/command appointment: validate new slot, release old occupancy, preserve audit.
Cancel
PATCH/command appointment: transition status and release inventory according to policy.
Endpoint naming is illustrative; developers may align it to the existing CP API conventions. The behavioural contracts are mandatory.
10. Concurrency and double-booking protection
Availability shown to a user is advisory until booking commits. The server must revalidate the slot during appointment creation.
Enforce a database-level or equivalent transactional uniqueness/conflict constraint for practitioner time occupancy.
Use an atomic transaction for registration + booking where the UI promises a combined action.
If another user takes the slot after it was displayed, return a conflict response and immediately refresh nearby free times.
Self-booking may use short-lived SlotHold records where the flow requires several steps; holds must expire automatically.
Never rely on client-side disabled buttons as double-booking protection.
11. Calendar integration
A successful appointment must be visible in the CP practitioner calendar immediately. The preferred implementation is a shared appointment data source with event-driven/cache invalidation updates rather than creating a second independent 'calendar appointment' record.
Event
Calendar/session consequence
appointment.created
Render new appointment; update session booked count.
appointment.rescheduled
Move event to new date/time/location; update old and new session counts.
appointment.cancelled
Remove/relabel occupied slot according to UI policy; release availability.
schedule.override.changed
Recompute affected availability and surface conflicts for already-booked appointments rather than silently moving them.
arrival/status changed
Update Current Session/queue presentation while retaining the same appointment identity.
12. Current Session integration
On the day of care, Current Session should derive its expected patient list from appointments matching the active practitioner, location and effective session. Arrival and queue state transitions attach to the existing appointment. Do not create a separate daily patient-list record merely to reproduce bookings.
13. Follow-up booking
When an encounter produces a follow-up target (for example, four weeks), the follow-up workflow should query the same scheduling engine around the target date, offer the practitioner's valid locations/dates/free times, and create a normal appointment with booking_source=FOLLOW_UP. The follow-up requirement and resulting appointment should remain linked.
14. No-code/configurable scheduling rules
Configuration
Expected control
Locations
Active/inactive; staff booking; patient self-booking eligibility.
Regular program
Day/recurrence, location, start/end time, effective dates.
Appointment types
Name, duration, buffers, booking interval, channel visibility.
Booking horizon
How far into future a channel can book.
Minimum notice
Earliest allowed booking relative to start time.
Capacity
Per session/type rules; optional walk-in reserve.
Overrides
Leave, cancel session, add session, change time/location, block period.
Overbooking
Default prohibited; explicit permission/role/rule if enabled.
Default location
Context-derived from active session; user can change where permitted.
Configuration should be data-driven. Avoid hard-coding weekday programs, slot lengths, locations or self-booking visibility into UI components.
15. Required edge cases
Patient is registered without an appointment: registration succeeds and no calendar event is created.
Selected location has no future program: show a clear empty state and allow another location.
Session exists but is full: show next available date/time rather than a generic failure.
Practitioner changes/cancels a session containing bookings: flag impacted appointments for resolution; do not silently delete or relocate patients.
Appointment type does not fit at the end of a session: do not offer that slot.
Two locations overlap in the practitioner's program: configuration validation must warn/block unless explicitly supported.
Time-zone handling: store canonical timestamps consistently while presenting practice-local time. Multi-country expansion must not assume one global timezone.
Inactive location/program: preserve historical appointments but prevent new bookings.
Patient self-booking and staff booking hit same last slot: only one commit succeeds.
16. Permissions and audit
All create/reschedule/cancel/override actions must be permission-controlled and auditable. Record actor, timestamp, previous/new values, booking source and reason where required. Patient-facing channels must never expose another patient's identity or appointment details through availability responses.
17. Performance targets
Measure
Target / requirement
Registration common path
Designed to complete in under 45 seconds when required patient details are available.
Location/date suggestions
Return fast enough for interactive selection; cache derived availability where useful.
Slot refresh
Refresh immediately after conflict or booking mutation.
Calendar consistency
Appointment mutation reflected without manual re-entry or page-level reconciliation.
18. Acceptance criteria
AC-01  Given a configured Tuesday TMR session, selecting TMR in registration exposes Tuesday as a valid date without manual calendar setup.
AC-02  Given an existing booking at 09:00, the 09:00 slot is not offered as free to another booking channel.
AC-03  Given a free 10:20 slot, 'Register & book 10:20' creates the patient and appointment and the appointment appears on the practitioner calendar.
AC-04  Given 'Register only', the patient is created and no appointment/calendar occupancy is created.
AC-05  Given the active Current Session is TMR, opening New Patient defaults location to TMR when permitted.
AC-06  Given a one-off practitioner leave/cancellation, affected future slots are not offered.
AC-07  Given simultaneous attempts for the same slot, exactly one booking succeeds.
AC-08  Given a self-booking request, the available slots are derived from the same underlying scheduling engine as staff registration.
AC-09  Given a completed encounter with a follow-up target, the workflow can offer valid future slots without implementing separate follow-up availability logic.
AC-10  All scheduling parameters identified as configurable are persisted as configuration, not hard-coded UI logic.
19. Recommended implementation sequence
Phase
Developer deliverable
1
Normalize/confirm scheduling domain entities and Practice Setup program data.
2
Implement effective-session + availability calculation service and tests.
3
Implement transactional appointment create/reschedule/cancel with conflict protection.
4
Connect practitioner calendar to the shared appointment source.
5
Replace registration Appointment field with Location → Date → Available Time component.
6
Connect Current Session/queue to today's appointment states.
7
Connect patient self-booking to the same availability contracts.
8
Connect follow-up booking; add analytics/audit events and operational hardening.
20. Out of scope for this specification
External calendar synchronization (e.g., Google/Microsoft), payments, patient portal authentication, communications/reminders, detailed encounter documentation and EMR functionality are not defined here. They may consume appointment events later but must not change the single-source scheduling architecture.
21. Developer decision summary
Freeze for implementationBuild one shared Availability & Scheduling Engine. Practice Setup supplies the practitioner program and booking rules. Registration, self-booking and follow-up consume the same free-slot service. Appointment creation is transactional and concurrency-safe. The practitioner calendar displays the resulting appointment automatically, and Current Session consumes the same appointment on the day of care. Preserve no-code configurability and the <45-second registration/booking principle.