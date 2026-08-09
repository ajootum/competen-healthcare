

COMPETEN PRACTICE
CINV-CAP-001
Investigation Catalogue & Configuration Engine
Developer Specification | Version 1.0 | 9 August 2026
1. Purpose
Create a reusable Competen investigation catalogue capability that supports fast, searchable, configurable investigation capture in Competen Practice without turning CP into a laboratory/radiology order-entry system.
Seed a platform-level master catalogue of common investigations.
Allow practice-level activation, hiding, local naming and custom additions.
Support aliases, synonyms and abbreviations for search.
Support practitioner favourites, frequently used items and reusable investigation sets.
Keep the master catalogue separate from patient-specific encounter investigation records.
Remain configurable and extensible without code releases where feasible.
2. Architectural model
Master Catalogue → Practice Catalogue → Practitioner Preferences/Sets → Encounter Investigation
Layer
Owner
Purpose
Master catalogue
Platform governor
Canonical investigation definitions, categories, aliases and active status.
Practice catalogue
Practice
Selects what is visible/usable locally; may rename or hide items and add custom items.
Practitioner preferences
Practitioner
Favourites, frequency-derived quick add and personal sets.
Encounter investigation
Encounter
Patient-specific record that an investigation was requested/recorded/reviewed/cancelled.
3. Master catalogue data model
Field
Requirement
Example
investigation_id
Stable immutable ID
LAB-HAEM-001
canonical_name
Required
Full Blood Count
short_name
Optional
FBC
category
Required
Laboratory
subcategory
Optional
Haematology
aliases
0..n searchable aliases
CBC; Full Haemogram
active
Required boolean
true
source_system
Optional provenance
Competen Seed
created_at / updated_at
Audit timestamps
ISO-8601
4. Seed taxonomy
Category
Typical subcategories / examples
Laboratory
Haematology, chemistry, coagulation, microbiology, serology/immunology, endocrine, blood bank, pathology.
Radiology
Plain X-ray, ultrasound, CT, MRI, fluoroscopy, nuclear imaging where applicable.
Cardiology
ECG, echocardiogram, Holter and related diagnostics.
Neurophysiology
EEG, EMG, nerve conduction studies.
Respiratory / Physiology
Spirometry, pulmonary function and other physiology tests.
Other diagnostics
Configurable uncategorized or specialty investigations.
The seeded catalogue should be broad enough for launch but must never block users from creating a local custom investigation.
5. Practice configuration
Practice Setup → Investigations exposes the practice catalogue.
Practice can enable/disable master items without deleting them.
Practice may override display name while preserving the master ID relationship.
Practice can create a custom investigation when no suitable master item exists.
Custom items require name, category and active status; short name and aliases are optional.
A practice may add a custom item to Quick Add immediately.
Platform updates to master catalogue must not overwrite local activation state or local display-name overrides.
6. Search and alias behaviour
Search must match canonical name, short name and aliases.
Search should be case-insensitive and tolerant of common spacing/punctuation differences.
Examples: FBC → Full Blood Count; CBC → Full Blood Count; CT head → CT Brain when configured as an alias.
Ranking priority: exact short-name match, exact alias, prefix, then broader token match.
Search results only include items enabled for that practice plus authorized local custom items.
7. Practitioner preferences
Capability
Behaviour
Favourites
Explicitly pinned by practitioner.
Frequently used
Derived from practitioner use history; this is workflow personalization, not clinical recommendation.
Recent
Recently used investigation items.
Quick Add
Short visible list combining favourites/frequency/recent items using configurable ranking.
Sets
Named reusable bundles referencing catalogue IDs.
8. Investigation sets
Set has ID, owner scope (practitioner or practice), name, active status and ordered items.
Each set item references a master/practice/custom investigation ID; do not duplicate names into the set as the source of truth.
Examples such as 'Routine labs' or 'Pre-operative' are user-defined workflow sets, not Competen clinical recommendations.
Practice-shared sets may be published to practitioners; practitioners may retain personal sets.
Editing a set affects future uses only; it must not rewrite historical encounter investigations.
9. Core entities
Entity
Key fields
investigation_catalogue
id, canonical_name, short_name, category, subcategory, active
investigation_alias
id, investigation_id, alias
practice_investigation
practice_id, investigation_id, enabled, local_display_name
custom_investigation
id, practice_id, name, short_name, category, aliases, active
practitioner_investigation_preference
practitioner_id, investigation_ref, favourite, usage_count, last_used_at
investigation_set
id, owner_type, owner_id, name, active
investigation_set_item
set_id, investigation_ref, sequence
10. Governance and safety
Catalogue presence must never be labelled as a recommendation.
Do not infer test appropriateness from frequency or favourites.
Master catalogue edits require platform governance and audit logging.
Local custom items remain scoped to the practice unless deliberately promoted by platform governance.
If a local item is later mapped to a master item, preserve historical references and audit the mapping.
11. API expectations
GET practice-enabled investigations with search, category and pagination filters.
POST/PUT practice activation/override configuration.
POST custom investigation.
GET/POST practitioner favourites/preferences.
GET/POST/PUT investigation sets.
APIs must enforce tenant scope, authorization and stable identifiers.
Quick Add endpoint may return ranked items but must expose why an item is present (favourite/frequent/recent) for transparency.
12. Acceptance criteria
AC-01  Practice can enable/disable seeded investigations without code change.
AC-02  User can find Full Blood Count by FBC or CBC.
AC-03  Practice can create a custom investigation and use it immediately.
AC-04  Practitioner can pin favourites and create personal sets.
AC-05  Frequently used items are based on observed use and are not described as recommendations.
AC-06  Historical encounter records remain stable if catalogue labels or sets later change.
AC-07  Tenant isolation and auditability are enforced.