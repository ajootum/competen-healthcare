

COMPETEN PRACTICE
Practice Configuration & Capability Activation Framework
Progressive adoption architecture for a configurable, low-friction practitioner workspace
CPR-CAP-001  |  Version 1.0  |  9 August 2026
Governing product principleCP must give back more time than it takes. Configure once, reuse everywhere; zero-entry before quick-entry; routine work should flow automatically; CP adapts to the practitioner.
1. Purpose
Define how Competen Practice provisions a practice, activates capabilities progressively, manages dependencies, and keeps the experience simple for practitioners who may initially want only booking and calendar functionality.
2. Scope
Practice provisioning and setup wizard.
Capability Registry and dependency rules.
Practice Modes as configurable presets, not hard-coded product tiers.
Capability-driven navigation, dashboard composition and permissions.
Progressive activation and safe deactivation.
Configuration hierarchy: platform, practice and user preferences.
No-code administration wherever feasible.
3. Configuration hierarchy
Level
Owner
Purpose
Examples
Platform
Competen governance
Defines available capabilities, schemas and dependencies
CP.BOOKING, CP.FOLLOWUPS, CP.CLOSE_DAY
Practice
Practice owner/admin
Defines how a specific practice operates
locations, schedule, booking rules, active capabilities
User
Individual user
Personalises experience without changing practice rules
notifications, preferred views, shortcuts
4. Capability Registry
Capability ID
Display name
Core dependencies
Default
CP.BOOKING
Online Booking
Locations, Practitioner Program, Availability, Registration, Calendar
On in Booking preset
CP.CALENDAR
Practice Calendar
Practitioner Program, Locations
On
CP.PATIENTS
Patient Register
Registration
On
CP.FOLLOWUPS
Follow-ups
Patients, Calendar
Optional
CP.ENCOUNTERS
Quick Encounters
Patients
Optional
CP.INVESTIGATIONS
Investigations
Patients; Encounters recommended
Optional
CP.MEDICATIONS
Treatments & Medication
Patients; Encounters recommended
Optional
CP.PROCEDURES
Procedures
Patients; Encounters recommended
Optional
CP.DOCUMENTS
Documents
Patients
Optional
CP.CLOSE_DAY
Close My Day
Calendar, Patients
Optional
CP.INTELLIGENCE
Practice Intelligence
Telemetry + relevant source capabilities
Optional
CP.AI_ASSIST
AI Assistance
Permissioned data sources
Optional
5. Practice Modes
Preset
Practitioner promise
Capabilities activated
Booking Only
Let patients book themselves
Booking, Calendar, Patients, basic notifications
Organise My Practice
Organise clinics and returns
Booking/Calendar as selected, Patients, Follow-ups, Planner, Practice Brief
Remember My Patients
Maintain lightweight continuity
Quick Encounters, Investigations, Treatments, Procedures, Documents
Intelligent Practice
Reduce end-of-day admin and surface insights
Close My Day, Intelligence, AI assistance
Modes are presets only. A practice may activate or deactivate individual capabilities subject to dependency rules.
6. Dependency behaviour
Selecting a capability automatically identifies required dependencies.
Required dependencies are activated or configured in the same guided flow.
The practitioner is never asked to recreate data already held in the Practitioner Program.
Deactivation must warn when dependent capabilities would be affected.
Deactivation hides workflow surfaces but must not delete historical patient or audit data.
7. Setup wizard
Step
Question
System action
1
Where do you practise?
Create/select locations and clinic contexts.
2
When do you practise there?
Populate Practitioner Program; derive availability.
3
How should appointments work?
Configure duration, notice, horizon, walk-ins and booking rules.
4
What should patients provide?
Apply Registration Configuration schema.
5
What should CP help you with?
Apply capability preset/individual selections and dependencies.
6
Review & activate
Validate setup; generate booking link/QR where enabled.
8. Acceptance criteria
A booking-only practitioner can become operational without configuring clinical capture.
Availability is derived from the practitioner program and location schedule.
Capability activation is configuration-driven and does not require code deployment.
Hidden capabilities do not clutter navigation or dashboard surfaces.
Historical data remains available after a capability is disabled.
Every activation/deactivation is auditable.