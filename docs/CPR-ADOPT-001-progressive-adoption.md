

COMPETEN PRACTICE
Progressive Adoption, Capture Later & Close My Day
Workflow specification for low-interruption clinical continuity
CPR-ADOPT-001  |  Version 1.0  |  9 August 2026
Design targetDo not force real-time documentation. Booking and workflow events should create as much structure as possible automatically; practitioner input is reserved for clinically meaningful exceptions.
1. Adoption ladder
Stage
User perception
CP value created
Activation signal
1
Booking tool
Patients self-book; schedule begins to populate
First booking
2
Calendar organiser
Daily/weekly clinic visibility
Recurring calendar use
3
Patient register
Known patients accumulate automatically
Repeat patient identified
4
Follow-up assistant
Due/overdue patients become visible
First follow-up action
5
Practice memory
Lightweight encounter history
First quick encounter
6
End-of-day assistant
Exceptions closed in batch
First Close My Day
7
Practice intelligence
Trends and actionable insights
Repeated insight use
2. Capture Later
A practitioner may mark a scheduled or walk-in patient as Seen without completing clinical capture. CP creates an encounter shell linked to patient, date, location, practitioner and appointment context.
Event
Automatically known
Practitioner action
Booked
patient, location, date/time, appointment type
None
Arrived
arrival status/time where captured
None or one tap by authorised user
Seen
encounter occurred
One tap
Clinical exception
diagnosis/treatment/investigation/procedure/follow-up changed
Quick capture now or later
End of day
open encounter shells
Batch review in Close My Day
3. Close My Day
Entry point from Current Activity, Practice Command Centre and Practice Planner.
Shows scheduled, walk-in, seen, cancelled, DNA/no-show and unresolved encounters.
Prioritises incomplete or exceptional encounters; routine/unchanged cases can be closed rapidly.
Supports quick actions: No change, New diagnosis, Treatment changed, Investigation, Procedure, Follow-up, Other.
Supports next/previous patient keyboard and touch navigation.
Allows defer with reason; never silently marks incomplete clinical information as complete.
4. Routine encounter optimisation
Scenario
Preferred interaction
Stable follow-up
No change → follow-up interval → close
Investigation ordered
Search/select investigation → status → follow-up if needed
Medication changed
Search/select medication → dose/rules → close
Procedure planned/performed
Search/select procedure → status/date → close
Complex case
Open full Quick Encounter workflow
5. Progressive prompts
CP may suggest additional capabilities only after a relevant need is evidenced. Prompts must be dismissible, non-blocking and frequency-limited.
Observed behaviour
Suggested capability
Example prompt
Repeated bookings
Follow-ups
Would you like CP to remind you when patients are due to return?
Seen patients left unresolved
Close My Day
You have 6 visits awaiting closure. Review them now?
Repeated investigation capture
Documents/Results
Keep related results with the patient?
Sufficient longitudinal activity
Practice Intelligence
See follow-up and booking trends for your practice.
6. Performance requirements
Routine quick-close target: generally under 15 seconds where clinically appropriate.
No duplicate entry of patient, location, appointment or practitioner data already known.
Searchable configurable lists for investigations, procedures, medications and common diagnoses.
Autosave after each meaningful action.
End-of-day batch workflow must resume safely after interruption.
All actions preserve audit history and user attribution.
7. Safety and data rules
CP remains a practitioner-centred continuity tool, not a replacement for a facility EMR.
System-derived data must be distinguishable from practitioner-confirmed clinical data.
A Seen status must not imply that diagnoses, medications or investigations were reviewed unless explicitly confirmed.
No destructive bulk completion of unresolved clinical exceptions.
Permissions must respect practice/team roles.