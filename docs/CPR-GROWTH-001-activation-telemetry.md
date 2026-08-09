

COMPETEN PRACTICE
Practitioner Activation, Telemetry & Customer Success Specification
Product instrumentation for the first 200 paying practitioners
CPR-GROWTH-001  |  Version 1.0  |  9 August 2026
Commercial objectiveSupport acquisition and retention of 200 paying practitioners at UGX 50,000/month by December 2026 by measuring activation, friction, engagement and progressive capability adoption.
1. North-star activation definition
A practitioner is Activated when the practice is configured, a booking link is created and shared, and the first patient booking is received. Payment alone is not activation.
2. Practitioner success pipeline
Milestone
Event key
Why it matters
Account created
practice.created
Acquisition
Practice configured
practice.setup_completed
Readiness
Booking link generated
booking.link_created
Distribution asset
Booking link shared
booking.link_shared
Intent to acquire patients
First booking
booking.first_received
Core activation
10th booking
booking.tenth_received
Habit formation
First follow-up
followup.first_created
Value expansion
First encounter closed
encounter.first_closed
Continuity adoption
First Close My Day
close_day.first_completed
Admin-saving adoption
First insight actioned
intelligence.first_action
Advanced value
3. Commercial dashboard
Area
Required metrics
Acquisition
qualified prospects, demos, trials, paid conversions, source/referrer
Activation
setup completion, link creation, link share, first booking, time-to-first-booking
Engagement
WAU/MAU, bookings/practitioner, planner use, follow-ups, encounters closed
Retention
30/60/90-day retention, churn, downgrade/deactivation reasons
Growth
referrals sent, referral conversions, facility/specialty clusters
Friction
abandoned setup steps, unresolved encounters, slow screens, support contacts
Time value
estimated admin time avoided, self-booking share, batch-close efficiency
4. Customer success work queue
Risk state
Rule example
Suggested action
Green
First booking received + weekly use
No intervention; invite referral at suitable milestone.
Amber
Setup complete but link not shared
Offer help placing link/QR on WhatsApp and reception materials.
Amber
Link shared but no booking after defined interval
Check availability, booking rules and patient-facing page.
Red
Setup incomplete
Concierge onboarding outreach.
Red
Previously active, now inactive
Identify friction/churn reason before promotional messaging.
5. Concierge onboarding workflow
Sales/customer success may configure the practice with practitioner permission.
Minimum data: practitioner identity, locations, usual days/times, appointment duration and booking preferences.
System records who performed assisted setup.
Practitioner reviews and confirms before public booking activation.
Generate shareable booking link and QR code immediately after successful validation.
6. December 2026 operating targets
Month
Illustrative paying target
Primary objective
August
20
Founding practitioners; validate onboarding and booking.
September
50
Improve activation and first-booking conversion.
October
90
Referral and facility/specialty cluster growth.
November
140
Scale acquisition while protecting retention.
December
200
Conversion, referral and retention push.
7. Privacy & governance
Commercial telemetry must avoid exposing unnecessary patient clinical content.
Use event metadata and aggregate counts wherever possible.
Role-based access separates practice operations from Competen commercial analytics.
Telemetry schemas are versioned and auditable.
Customer success users must not receive clinical record access merely because they can view activation status.
8. Definition of done
Every activation milestone emits a reliable event.
Commercial dashboard can segment by acquisition source, facility cluster and specialty without exposing clinical content.
Customer success can identify setup and activation blockers.
Practitioner-facing prompts are driven by real usage rather than fixed dates alone.
Churn/deactivation reasons are captured in structured configurable categories.