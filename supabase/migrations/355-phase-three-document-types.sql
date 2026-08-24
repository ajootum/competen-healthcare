-- 355 FOUR MORE KINDS OF DOCUMENT
--
-- CPR-DOC-AUTO-001 sections 3, 5 and 13, Phase 3.
--
-- Section 5's priority sequence runs to eight. Phases 1 and 2 built the first
-- three. This adds the types for priorities 4 to 7:
--
--   clinical_summary        4  the longitudinal one. Select + summarise.
--   investigation_request   5  what is being asked for, and why.
--   follow_up_instructions  6  what the patient must come back for.
--   medication_list         7  the current treatment list, for the patient.
--
-- PRIORITY 8 IS DELIBERATELY ABSENT, and this is the one decision in this file
-- worth arguing with. Sick leave and fitness certificates are section 5's eighth
-- capability and would be the highest-frequency of the lot. Section 14 stops
-- them: "Statutory/jurisdiction-specific documents require approved controlled
-- templates before automation", and "AI must never decide fitness, incapacity or
-- duration independently". No controlled template has been approved for any
-- jurisdiction this product operates in, so there is nothing to generate INTO.
--
-- Adding a medication_list type is a labelling decision. Adding a sick_leave
-- generator would be issuing a document with legal effect from a template nobody
-- has signed off. 'sick_note' has existed in this CHECK since 195 and the
-- blank-body form can still produce one by hand -- which is exactly the state
-- section 14 asks for.
--
-- THE VOCABULARY IS MIRRORED IN THREE PLACES IN THE APPLICATION, and adding a
-- value here without adding it there ships a document whose type renders blank:
--
--   src/lib/practice/document-constants.ts            DOC_TYPES        (authoring)
--   src/lib/practice/documents-workspace-constants.ts DOC_TYPE_OPTIONS (filter)
--   src/lib/practice/intelligence.ts                  DOCUMENT_TYPES   (reporting)
--
-- All three are updated in the same commit as this file, and assertion 11f in
-- practice-document-automation-harness.ts fails if any type the engine writes is
-- missing a label in any of them. That assertion was added in Phase 2 for exactly
-- this migration.

-- Same constraint 354 rewrote, widened again. Every existing row satisfies a
-- strictly wider list, so nothing legal becomes illegal.

alter table practice_clinical_document
  drop constraint if exists practice_clinical_document_doc_type_check;

alter table practice_clinical_document
  add constraint practice_clinical_document_doc_type_check
  check (doc_type in ('consultation_summary', 'referral_letter', 'sick_note',
                      'procedure_note', 'discharge_summary', 'general',
                      'patient_instructions', 'clinical_summary',
                      'investigation_request', 'follow_up_instructions',
                      'medication_list'));

notify pgrst, 'reload schema';
