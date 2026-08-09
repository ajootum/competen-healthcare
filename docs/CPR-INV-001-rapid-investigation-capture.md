

COMPETEN PRACTICE
CPR-INV-001
Rapid Investigation Capture & Review Workflow
Developer Specification | Version 1.0 | 9 August 2026
1. Purpose
Define the encounter-level investigation workflow so a practitioner can record multiple laboratory, radiology or other investigations in seconds, with minimal typing and without converting CP into an order-entry EMR.
Design target: the practitioner should commonly be able to record 3–6 investigations in roughly 10–20 seconds, supporting the broader less-than-45-second encounter-entry principle.
2. Core UX decision
Replace the current one-investigation-at-a-time text-entry flow with a multi-select Investigation Picker plus Quick Add and Investigation Sets.
One dominant + Add investigations action.
Searchable multi-select catalogue.
Quick Add chips for frequently used/favourite investigations.
Reusable investigation sets for common combinations.
Single batch confirmation: e.g. Add 4 investigations.
Typing remains available only for search, optional reason or creation of a custom item.
3. Encounter screen layout
Region
Required behaviour
Requested/recorded list
Shows all encounter investigations with category, requested/recorded timestamp, status and actions.
Batch review controls
Select all / multi-select and Mark selected as reviewed.
Quick Add
Visible high-frequency one-tap items such as FBC, U&E, CRP, CT Brain, MRI Brain, EEG, based on practitioner preferences.
My sets
One-tap cards for practitioner/practice-defined sets.
+ Add investigations
Opens the full searchable multi-select picker.
4. Multi-select picker
Search box at top.
Sections: Frequently used, Favourites, Recent, Laboratory, Radiology, Other configured categories.
Each result has checkbox/tap target and optional short label/category.
Selection persists while searching or changing category.
Footer always shows selected count and primary action: Add N investigations.
Do not require an individual save action per investigation.
Allow removal from the pending selection before batch add.
5. Investigation sets
Selecting a set adds all referenced active investigations to the pending selection. The practitioner may remove individual items before confirmation.
Set use is a workflow shortcut only.
No set is clinically recommended by Competen unless a separately governed decision-support capability is later introduced.
Duplicate investigations already present in the encounter should be detected and handled according to configurable duplicate rules.
6. Reason / clinical question
Reason remains optional unless the practice configures it as required.
Support one shared reason for all selected investigations.
Allow an individual investigation to override the shared reason.
Do not force repetitive typing of the same reason for every selected item.
7. Encounter investigation record
Field
Purpose
encounter_investigation_id
Stable patient-specific record ID
encounter_id
Links to encounter
investigation_ref
References master/practice/custom catalogue item
display_name_snapshot
Optional immutable display snapshot for historical readability
status
requested / reviewed / cancelled-not-pursued
recorded_at
When practitioner recorded it
reviewed_at
When marked reviewed
reason_shared / reason_override
Optional clinical question
linked_document_id
Optional link to result/document stored elsewhere
created_by / reviewed_by
Audit principals
8. Status semantics
Status
Meaning
Must not imply
Requested
Practitioner recorded that they asked for/expected the investigation.
That an external lab/radiology system received or performed it.
Reviewed
Practitioner recorded that they looked at the result/information.
That CP independently verified the result.
Cancelled / not pursued
Practitioner indicates it was not pursued.
A laboratory cancellation transaction unless integrated.
9. Batch review
Individual Mark reviewed action remains available.
Checkbox selection enables Mark selected as reviewed.
Batch action records one review event per selected encounter investigation with shared timestamp and reviewing user.
If a linked result/document exists, the UI may offer direct view before marking reviewed.
Review status must remain auditable.
10. Quick Add ranking
Quick Add must prioritize favourites, then frequent/recent usage using a configurable ranking strategy.
Do not label Quick Add as Suggested or Recommended Investigations.
Do not automatically add an investigation solely because it was used in prior similar encounters.
Allow practitioner to pin/unpin quick items.
11. Duplicate handling
If an investigation is already recorded in the same encounter, warn or prevent duplicate addition according to configuration.
If repeat testing is clinically intended, allow an explicit Add again action with a new encounter-investigation instance.
Never silently merge distinct repeated investigation events.
12. Custom investigation fallback
If search returns no suitable item, provide + Create custom investigation subject to practice permission. On save, it becomes immediately selectable in the current encounter and is stored in the practice catalogue for future use.
13. Performance target
Picker should open without waiting for full catalogue download; use cached practice catalogue and incremental search where appropriate.
Quick Add should be available immediately from cached preferences where feasible.
Batch add should be a single logical transaction from the UI perspective.
Avoid one network round-trip per selected investigation.
Optimistic UI is acceptable only if synchronization state is clearly managed by the agreed CP offline/sync framework.
14. Non-EMR boundary
The screen records what the practitioner requested/recorded and what they reviewed. It is not an order-entry system: no order is sent to a laboratory or radiology service unless a separate integration capability is deliberately implemented.
Do not display performed/completed merely because Requested exists.
Do not store the full result here if Documents or an integrated result service is the authoritative store.
A linked result/document may be referenced from this encounter investigation without duplicating the file.
15. Acceptance criteria
AC-01  Practitioner can select multiple investigations before saving.
AC-02  A batch of four investigations can be added with one final Add 4 investigations action.
AC-03  Search recognizes aliases supplied by the catalogue engine.
AC-04  Quick Add requires no typing.
AC-05  Practitioner can add an entire investigation set in one tap and adjust before confirmation.
AC-06  A shared optional reason can be applied to all selected items.
AC-07  Batch Mark reviewed is supported.
AC-08  Custom investigation can be created when no catalogue item fits.
AC-09  Duplicate handling does not silently merge repeated tests.
AC-10  UI language does not imply that the investigation was externally ordered or performed.
AC-11  Workflow remains compatible with offline synchronization and audit requirements.
16. Reference design

Figure 1. Proposed rapid investigation capture layout.