

COMPETEN PRACTICE
CP-PLAN-002
Practice Planner, Schedule Navigation & Booking Requests
Developer Specification • Version 1.0 • 09 August 2026
Product intentTransform Practice Planner from a week-construction screen into the practitioner's time-navigation and schedule-management workspace: past, present and future; Day, Week, Month and Agenda; fast search; booking overlays; and a dedicated Booking Requests inbox for requests that still require practitioner/staff action.
Depends on: CP-SCHED-001 — Practitioner Scheduling, Availability & Booking Integration Framework.

1. Purpose
This specification defines the upgraded Practice Planner and the Booking Requests capability. It addresses the current difficulty of locating appointments outside the visible week and establishes a consistent way to review any period without creating a second scheduling system.
Practice Planner must read the practitioner program, effective schedule and appointments from the shared scheduling domain defined in CP-SCHED-001.
2. Frozen product principles
Past, present and future are navigated through one schedule workspace, not separate modules.
Day, Week, Month and Agenda are views of the same underlying schedule.
Time range and content filters are separate controls.
Confirmed appointments belong in the schedule; Booking Requests contains only requests awaiting a decision or other action.
The practitioner program remains the source of planned sessions; appointments overlay/consume availability.
No-code/configurable rules remain the default where feasible.
Common navigation must be fast: next week, previous week, today and next month should be one-click actions.
3. Practice Planner top navigation
Control
Required behaviour
Today
Return immediately to the current date in the active view.
Previous / Next
Move by one unit of the selected view: day, week, month; Agenda uses the active range.
Period label
Display current date/range, e.g. August 2026 or 03–09 Aug 2026.
Go to date
Date picker/direct date jump. Selecting a date retains the chosen view where practical.
View switcher
Day | Week | Month | Agenda.
Quick periods
Last week | This week | Next week | This month | Next month | Custom period.
Custom period
User-defined start/end dates, especially for Agenda and reporting/review.
4. Content controls and schedule search
The user must be able to decide what appears without changing the underlying practitioner program.
Control
Minimum options
Show
All; Appointments; Activities/Sessions; Available time; Follow-ups; Walk-ins; Blocked time; Cancelled.
Location
All active/historical locations relevant to selected range.
Activity type
All plus configured activity/session types.
Appointment type
Optional filter when appointment types are configured.
Status
Booked/confirmed, arrived, waiting, completed, cancelled, no-show, etc., where useful.
Search schedule
Search patient name/identifier, location, activity/session and other safe appointment descriptors.
Search requirementSearching for a future patient must return the appointment date, time, location and session with a direct 'View appointment' / 'Go to date' action. The user should not have to navigate week-by-week to find a known booking.
5. View specifications
View
Primary purpose
Minimum display
Day
Operational detail for one day.
Chronological sessions, appointments, free/blocked periods, location, status and quick actions.
Week
Near-term planning and workload.
Seven days; planned sessions/activities with booked/free counts; expandable booking detail.
Month
Rapid orientation across a longer period.
Standard month grid; each working day shows compact location/session and booked/free counts; click day to drill down.
Agenda
Find/review bookings over arbitrary periods.
Chronological grouped list by date/session; optimized for patient names, times, locations and statuses.
6. Month view interaction
Each date cell may show one or more compact session cards.
Session card minimum: location/activity, time range, booked count and available count where calculable.
Click date → Day view for that date.
Click booked count/session → session booking list.
Click appointment → appointment/patient context.
Click valid free time or 'Book appointment' → booking flow using the shared scheduling engine.
Day off/no program should be visually distinct without creating an appointment-like record.
7. Right-side contextual panel
When a day/session is selected, show a contextual panel rather than forcing navigation away.
Section
Content
Day/session header
Date, location, activity/session, time.
Capacity summary
Total slots/capacity, booked, available, blocked where applicable.
Appointments
Compact time-ordered patient list with status and drill-in.
Quick actions
Book appointment; block time; add activity/note where supported; print/export schedule if implemented.
Conflict state
Visible warning when schedule overrides affect existing appointments.
8. Planner vs Calendar vs Current Session
Surface
Question it answers
Practice Planner
What am I planning to do, where, and what is booked into that plan across time?
Calendar/Schedule
What events/appointments occupy my time?
Current Session
What is happening in the active clinical session now?
These are different views/workflows over shared scheduling data. Do not create independent appointment stores for each surface.
9. Booking Requests — definition
Critical distinctionBooking Requests are NOT confirmed appointments. They are inbound requests that require acceptance, rejection, alternative-slot selection, clarification, or another configured decision before becoming a confirmed appointment.
Once a request is accepted and a valid slot is committed, it becomes a normal Appointment and appears in Practice Planner/Calendar. The request record remains as audit/history but leaves the active request inbox.
10. Booking Request sources
Patient self-booking flow when the practice requires approval rather than instant confirmation.
Patient request for a preferred day/time where exact slot confirmation is pending.
Practice website/booking link request.
Staff-created request requiring practitioner approval, if enabled.
Reschedule request from a patient, when that capability is enabled.
Other future channels may create requests through the same request service.
11. Booking Request states
Stable state
Meaning
PENDING
Awaiting initial action.
REVIEWING
Opened/claimed for review; optional workflow state.
ALTERNATIVE_PROPOSED
Practice has proposed another valid slot and awaits response where required.
ACCEPTED
Request accepted and successfully converted/linked to a confirmed appointment.
DECLINED
Request rejected; reason captured according to policy.
WITHDRAWN
Requester withdrew/cancelled before confirmation.
EXPIRED
Request exceeded configured response/validity window.
Presentation labels may be configurable, but backend state semantics must remain stable.
12. Booking Requests inbox UX
The sidebar 'Booking Requests' item should display a badge for actionable pending requests only.
Inbox capability
Specification
Default ordering
Oldest actionable request first, unless configurable priority rules apply.
Filters
Status; requested date/range; location; request source; appointment type; new/unread.
Search
Patient/requester name or safe identifier.
Request card/row
Patient/requester, requested location/date/time or preference window, appointment type/reason summary where permitted, received time, status.
Quick actions
Accept; propose another time; decline. Open request for full detail.
Badge count
Count of actionable requests, not confirmed appointments.
13. Accept request workflow
Open request and resolve patient identity: match existing patient first; register only if no match according to CP registration rules.
Re-query live availability. A time requested earlier is not assumed to remain free.
If requested slot is free and rules permit, user selects Accept.
Server atomically creates/updates the required patient linkage and confirmed appointment, then marks the request ACCEPTED and links request_id ↔ appointment_id.
Calendar/Planner updates immediately through the shared appointment source.
If the slot is no longer available, do not accept into a conflict; show nearby valid alternatives.
14. Propose another time workflow
The alternative-time selector must use the same Location → Date → Available Time engine as registration and self-booking. Do not allow arbitrary typing of a time that bypasses availability validation.
Choose location if change is permitted.
Show next valid dates based on practitioner program.
Show only live free slots.
Record proposed slot and proposal timestamp.
If patient confirmation is required, state becomes ALTERNATIVE_PROPOSED; do not occupy the slot indefinitely without an explicit hold policy.
If staff/practitioner is authorized to directly rebook on the patient's behalf, create the appointment through normal booking rules instead.
15. Decline, expiry and withdrawal
Action
Rules
Decline
Capture configured reason/category and optional internal note. Do not create appointment.
Expire
Configurable validity/response rule; expired requests remain in history and leave actionable badge count.
Withdraw
Requester cancellation before confirmation; preserve audit trail.
Reopen
Only if explicitly supported and permission-controlled; otherwise create a new request.
16. Booking Request minimum data model
Field
Notes
id
Unique request identifier.
practice_id / practitioner_id
Required ownership/routing.
patient_id nullable
Null until matched/registered where appropriate.
requester identity/contact reference
Minimum data permitted for request handling.
requested_location_id
Nullable if patient is flexible.
requested_start / preference window
Exact slot or date/time preference.
appointment_type_id
Nullable/configurable.
reason_summary
Only if product rules permit; not detailed clinical notes.
source
SELF_BOOKING, WEBSITE, STAFF, RESCHEDULE, etc.
status
Stable request state.
linked_appointment_id
Set on successful conversion.
created_at / updated_at / acted_by
Audit.
17. Request/appointment integrity rules
A request never reserves a slot merely because it exists, unless an explicit short-lived SlotHold has been created.
Accept must revalidate availability at commit time.
A confirmed appointment must not remain in the active Booking Requests inbox.
Cancelling an accepted appointment does not automatically revert the old request to PENDING.
Duplicate request detection should warn when the same patient appears to request the same practitioner/time repeatedly.
No patient-identifying information may leak through availability endpoints or other patients' request views.
18. Notifications and response communication hooks
This specification defines events/hooks, not the communications provider. Emit events suitable for the CP communications capability:
booking_request.received
booking_request.accepted
booking_request.alternative_proposed
booking_request.declined
booking_request.withdrawn
booking_request.expired
appointment.created_from_request
Email/SMS/WhatsApp delivery and templates are handled by the communications framework and configuration, not hard-coded in Practice Planner.
19. Permissions and audit
Permissions should distinguish viewing the planner, editing the practitioner program/day overrides, booking appointments, blocking time, and acting on Booking Requests. Every accept/decline/propose/reschedule action must record actor, timestamp and relevant before/after values.
20. No-code/configurable items
Item
Configurable examples
Planner defaults
Default view (Week/Month/etc.), start day of week, visible content filters.
Request policy
Instant-confirm vs approval-required by location/appointment type/channel.
Request expiry
Response/validity duration.
Request reasons
Decline reason list; optional priority categories.
Self-booking visibility
Locations, appointment types, horizons and rules.
Capacity display
Whether/how booked/free counts appear.
21. API/service capability expectations
Capability
Illustrative behaviour
Schedule query
Fetch effective sessions + appointments for arbitrary date range and filters.
Schedule search
Search appointments/sessions by safe terms and return direct navigation context.
Booking request list
Paged/filterable actionable/history query.
Booking request detail
Full authorized request context.
Accept request
Transactional validation + appointment creation + request state/link update.
Propose alternative
Validate live slot; persist proposal/hold according to policy.
Decline/withdraw
Permission/state validation + audited transition.
Endpoint naming should follow existing CP conventions. Behaviour is mandatory; route names are illustrative.
22. Empty/error states
No activities in selected period: show clear empty state plus Add Activity/Go to Setup as appropriate.
No appointments: distinguish 'no bookings' from 'no practitioner program'.
No search result: offer clear filters/date-range reset.
No booking requests: show 'No requests awaiting action' rather than a blank panel.
Requested slot lost: explain that the slot is no longer available and immediately offer alternatives.
Schedule conflict: never silently move existing patients when a program/override changes.
23. Acceptance criteria
AC-01  User can switch among Day, Week, Month and Agenda without changing underlying schedule data.
AC-02  Last week, This week, Next week, This month and Next month are directly accessible.
AC-03  User can jump to any date and can review a custom date range.
AC-04  Month view displays practitioner sessions plus compact booked/free counts.
AC-05  Clicking a day/session drills into its appointments without week-by-week navigation.
AC-06  Searching a known patient returns their future/past appointment with direct navigation.
AC-07  Confirmed appointments never appear as pending Booking Requests.
AC-08  Booking Requests badge counts only actionable requests.
AC-09  Accepting a request revalidates the slot and creates one confirmed appointment linked to the request.
AC-10  If a requested slot has been taken, acceptance fails safely and valid alternatives are offered.
AC-11  Proposed alternatives come from the shared availability engine.
AC-12  Planner, Calendar and Current Session reflect the same confirmed appointment identity.
AC-13  Planner/request policy settings identified as configurable are data-driven rather than hard-coded.
24. Recommended implementation sequence
Phase
Deliverable
1
Range-capable schedule query over effective practitioner program + appointments.
2
Universal navigator: Today, previous/next, Go to date, quick periods, custom period.
3
Day/Week/Month/Agenda views and shared filter/search state.
4
Schedule search with direct patient/appointment navigation.
5
Contextual day/session panel and booking overlays.
6
Booking Request entity/state machine + inbox/badge.
7
Accept/propose/decline workflows integrated with CP-SCHED-001 availability and transactional booking.
8
Audit, permissions, notification events, configuration and performance hardening.
25. Final developer freeze
Implementation baselinePractice Planner becomes CP's universal time-navigation and schedule-management workspace. It supports Day, Week, Month and Agenda across arbitrary past/present/future periods, with search and filters. Planned sessions and confirmed appointments are overlaid from the shared scheduling domain. Booking Requests is a separate actionable inbox only for unconfirmed requests; acceptance converts a request into a normal appointment through the same live availability and concurrency-safe booking engine.