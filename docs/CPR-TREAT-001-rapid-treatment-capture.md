

COMPETEN PRACTICE
CPR-TREAT-001
Rapid Treatment & Medication Capture
Developer Specification | Version 1.0 | 9 August 2026
Implementation objective: fast, selection-first treatment capture with medication safety, configurable/no-code clinical lists, and minimal typing.
1. Purpose
Define the Treatment tab workflow for Competen Practice. The practitioner should be able to record medications and non-drug treatments rapidly while preserving structured prescribing data, medication-safety checks, auditability and the CP non-EMR boundary.
The broader encounter design target remains less than 45 seconds for routine capture. Treatment entry should therefore prefer taps, search, favourites and templates over repetitive typing.
2. Core interaction model
Medication Catalogue → Quick Add/Search → Smart Prescription Builder → Pending Treatment Plan → Safety Check → Batch Record
Allow multiple treatments to be assembled before final recording.
Support medication and non-medication treatment.
Use practitioner favourites, frequently used items and recent items for one-tap access.
Use reusable practitioner/practice prescription templates, subject to safety validation every time.
Do not describe frequently used items or templates as clinical recommendations.
3. Treatment types
Type
Purpose
Medication
Record a medication prescribed/continued in this encounter.
Stop medication
Record a decision to stop a medication.
Change medication
Record a change to an existing treatment.
Non-drug treatment
Physiotherapy, wound care, dietary intervention, observation or configured alternatives.
No treatment change
Explicitly record that current treatment continues unchanged.
Other
Configurable fallback for legitimate treatment decisions not represented in the current list.
4. Medication picker
Primary action: + Add medication.
Search by generic name, configured brand name, formulation and aliases.
Show Frequently used, My favourites and Recent before the full catalogue.
Underlying medication identity should use stable catalogue IDs; display names may be locally configured.
If a medication is not found, custom/local handling follows the governed medication catalogue policy.
5. Smart prescription builder
Field
Fast-entry behaviour
Configurable fallback
Formulation
Tap common forms such as tablet, liquid, injection.
Other/custom.
Dose
Tap common values where appropriate or enter structured dose.
Other/custom.
Route
Tap configured common routes, context-ranked where feasible.
Other/custom.
Frequency
Tap configured frequencies such as Once, OD, BD, TDS, QID, PRN.
Other/custom frequency.
Duration
Tap common configured durations.
Other/custom.
Reason / notes
Optional concise text unless locally required.
Practice-configurable requirement.
Selecting Other for Frequency opens a compact custom-frequency field. The exact entered wording must be preserved in the encounter record.
6. No-code / configurability requirement
FROZEN REQUIREMENT: All clinically appropriate selectable values, catalogue entries, quick actions, favourites, templates, sets, labels, field visibility, requirement status, ordering, defaults, thresholds and workflow options SHALL be configuration-driven wherever feasible. Hard-coded clinical lists SHALL be avoided.
Platform defaults may be supplied as seed configuration.
Practice configuration may activate, deactivate, reorder, relabel or extend permitted values.
Practitioner preferences may personalize favourites, Quick Add and templates without altering practice-wide configuration.
Patient/encounter-specific override is allowed only where clinically and operationally appropriate.
Configuration changes should not require software deployment.
Safety-critical configuration must be permission-controlled, versioned and auditable.
System integrity, security and audit controls remain system-governed and cannot be weakened by local configuration.
Other/custom remains the escape hatch for legitimate values absent from configured lists.
7. Configuration hierarchy
Platform defaults → Practice configuration → Practitioner preferences → Patient/encounter-specific override where permitted.
Configuration class
Examples
Governance
Workflow/display
Labels, ordering, visibility, favourites, templates, quick actions.
Practice/practitioner configurable.
Clinical configuration
Dose ranges, safety thresholds, required clinical parameters, medication rules.
Restricted permissions, versioned, auditable.
System-governed
Tenant isolation, audit integrity, authentication, immutable event history.
Not locally overridable.
8. Weight-based medication workflow
Consume the most appropriate recorded patient weight from the Safety Snapshot according to provenance/recency rules.
Support Fixed dose and Weight-based dose methods.
For weight-based entry, practitioner selects/enters the intended mg/kg/dose or equivalent; CP calculates the corresponding patient dose.
The calculation is a tool, not an autonomous prescription recommendation.
Display weight value, source and timestamp used for the calculation.
If required weight is absent or stale according to configured rules, surface an actionable warning.
9. Pending treatment plan and batch recording
Each selected treatment is added to a pending encounter list before final record.
Show medication/non-drug type, dose, route, frequency, duration and optional reason as applicable.
Allow Edit and Remove before final recording.
Support Record N treatments as one logical UI action.
Backend must create auditable individual treatment records within the batch transaction.
Do not require a separate Record action for each medication.
10. Medication safety checkpoint
Before final medication recording, the Treatment workflow consumes the existing Safety Snapshot and medication-safety engine.
Safety input
Expected behaviour
Weight
Show available weight and use it for configured weight-dependent checks.
Allergies
If unknown/not recorded, display a prominent unresolved state and quick actions such as No known drug allergies / Record allergy.
Dose alerts
Run configured dose-range checks where supported.
Drug interactions
Run supported interaction checks against known current medications.
Duplicate therapy
Identify supported duplicates/therapeutic duplication.
Relevant patient parameters
Use configured parameters where required by a medication rule.
Safety Snapshot data should feed the prescription workflow directly; do not require duplicate data entry.
11. Safety alerts and overrides
Warnings must distinguish missing information from an actual detected medication risk.
Do not claim 'safe' merely because a rule could not be evaluated.
Configured warning/override behaviour must follow medication-safety governance.
Any override requiring justification must capture user, timestamp, alert, reason and resulting action.
Templates never bypass current safety checks.
12. Quick Add and prescription templates
Quick Add ranking may use explicit favourites, frequency of use and recency.
Never label these as Recommended or Suggested medications.
Medication favourite may store medication identity only.
A prescription template may store explicitly practitioner-created formulation, route, frequency, dose and/or duration values.
Templates are editable before recording and are revalidated against the current patient context every time.
Practice-shared templates and practitioner-personal templates must have separate ownership and permissions.
13. Non-drug treatments
Use the same selection-first/no-code approach for non-drug treatment categories.
Examples may include physiotherapy, wound care, dietary intervention and observation, but the list is configuration-driven.
Support Other/custom.
Capture concise details, duration and notes only where applicable/configured.
14. Data model expectations
Entity
Minimum fields
encounter_treatment
id, encounter_id, patient_id, type, status, recorded_at, recorded_by
encounter_medication
treatment_id, medication_ref, formulation, dose_value/text, dose_unit, route, frequency_code/text, duration, reason
treatment_template
id, owner_type, owner_id, name, active, version
treatment_template_item
template_id, treatment/medication_ref, configured defaults
treatment_configuration
practice_id, field/list key, values, ordering, active, version
safety_evaluation
encounter/treatment ref, rule/version, result, alert, evaluated_at
safety_override
alert_ref, user, reason, timestamp, action
15. API / transaction expectations
Fetch practice-enabled medication/treatment configuration and practitioner Quick Add preferences.
Search medication catalogue incrementally.
Validate prescription structure and applicable safety rules server-side.
Batch record treatments using one logical transaction or idempotent batch operation.
Return per-item success/failure without silently dropping treatments.
All writes enforce tenant scope, role authorization and audit logging.
Offline behaviour must follow the existing CP synchronization framework; locally pending medication records must not be represented as server-confirmed.
16. Non-EMR boundary
CP records what the practitioner prescribed or decided, not what was administered. CP does not hold an inpatient medication administration chart in this capability. External prescribing/order transmission requires a separate explicitly governed integration.
Do not infer administration from prescription.
Do not infer dispensing.
Do not imply an external pharmacy received the prescription unless integrated and confirmed.
17. Acceptance criteria
AC-01  Practitioner can add medication primarily through search or one-tap Quick Add.
AC-02  Frequency includes a configuration-driven Other option with preserved custom text.
AC-03  Formulation, dose, route, duration and treatment type provide configurable Other/custom fallbacks where appropriate.
AC-04  Clinical selectable lists are not hard-coded when configuration is feasible.
AC-05  Practice can change configured options without a software deployment.
AC-06  Practitioner can assemble multiple treatments and record them in one batch action.
AC-07  Weight recorded in Safety Snapshot can feed weight-based calculations without re-entry.
AC-08  Unknown allergy status is clearly distinguished from no known allergies.
AC-09  Medication templates are rechecked against current safety rules every time.
AC-10  Frequently used items are not presented as clinical recommendations.
AC-11  Non-drug treatments are supported through the same configurable model.
AC-12  Safety-critical configuration is permission-controlled, versioned and auditable.
AC-13  Treatment records remain distinct from medication administration records.
AC-14  Offline/pending synchronization status is represented accurately.
18. Reference design

Figure 1. Approved Treatment & Plan rapid-capture design direction.
19. Implementation rule
Selection first, typing second, safety always, configuration wherever feasible.