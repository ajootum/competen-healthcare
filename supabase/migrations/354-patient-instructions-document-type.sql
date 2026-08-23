-- 354 PATIENT INSTRUCTIONS IS A KIND OF DOCUMENT
--
-- CPR-DOC-AUTO-001 sections 3, 5 and 13, Phase 2.
--
-- Section 5 makes patient instructions the third document to automate, and
-- section 3 gives it its own primary source (treatment/plan/follow-up) and its
-- own automation mode. It is not a consultation summary: one is a record of what
-- happened, the other is what the patient is being asked to do about it, and a
-- patient searching their documents for "what did they tell me to do" needs to
-- find the second without reading the first.
--
-- WHY NOT 'general'. The vocabulary already has an escape hatch and using it here
-- would be the cheap answer. Section 15 requires the stored artifact to carry its
-- document type, and a type of "Other document" carries none -- every patient
-- instruction sheet would file itself under the same bucket as everything the
-- product has no name for. The filters in the Documents workspace would offer no
-- way to see them, and the timeline would show a row that says nothing.
--
-- THE VOCABULARY IS MIRRORED IN THREE PLACES IN THE APPLICATION, and adding a
-- value here without adding it there ships a document whose type renders blank:
--
--   src/lib/practice/document-constants.ts        DOC_TYPES        (authoring)
--   src/lib/practice/documents-workspace-constants.ts DOC_TYPE_OPTIONS (filter)
--   src/lib/practice/intelligence.ts              DOCUMENT_TYPES   (reporting)
--
-- All three are updated in the same commit as this file, and
-- practice-document-automation-harness.ts asserts that every type the generation
-- engine can write has a label in all three. That assertion exists because this
-- codebase has shipped a catalogue insert without its counterpart before.
--
-- VISIT SUMMARY NEEDS NOTHING HERE. Section 5's second document is the
-- consultation summary, and 'consultation_summary' has been in this list since
-- migration 195. Adding a second name for it would split one kind of document
-- across two types for no gain.

-- The constraint is 195's inline column check, so it carries the name Postgres
-- generated for it -- confirmed live against the database rather than assumed.
-- Recreating it revalidates every existing row against a STRICTLY WIDER list, so
-- nothing that was legal becomes illegal.

alter table practice_clinical_document
  drop constraint if exists practice_clinical_document_doc_type_check;

alter table practice_clinical_document
  add constraint practice_clinical_document_doc_type_check
  check (doc_type in ('consultation_summary', 'referral_letter', 'sick_note',
                      'procedure_note', 'discharge_summary', 'general',
                      'patient_instructions'));

notify pgrst, 'reload schema';
