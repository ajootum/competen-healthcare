-- ============================================================
-- MIGRATION 364: 'parent' AND 'other_relative' (CPR-BOOK-FLOW-002 s8.4)
--
-- s8.4 asks for a generic "Parent" -- for somebody who is a parent without mother/father specificity --
-- and an "Other relative" so the list need not enumerate every kinship. Neither existed, so the booking
-- form could not offer them: an answer the CHECK refuses is a form that fails on submit.
--
-- ---- BOTH TABLES, IN ONE MIGRATION, BECAUSE THEY ARE ONE VOCABULARY -------------------------------
--
-- The same fifteen values are enforced twice: practice_patient_relationship.relationship_type
-- (migration 221, the clinical record) and practice_booking_request.representative_relationship
-- (migration 254, the booking intake). They are the same concept and they must not drift.
--
-- Widening one alone would be worse than widening neither: a patient could choose "Parent" while
-- booking, the intake row would accept it, and the moment somebody promoted that booking into a patient
-- record the write would be refused by a constraint on a different table -- a failure that surfaces
-- days later, to a member of staff, with no way to tell what the patient originally meant.
--
-- ---- WHAT 'other_relative' DELIBERATELY DOES NOT CHANGE -------------------------------------------
--
-- Nothing about authority. s8.4: "do not imply verified legal status", and s8.3: "Do not infer legal
-- guardianship merely from relationship selection." An aunt is a relative and is not thereby a legal
-- guardian, so 'other_relative' is added to the vocabulary and NOT to the guardian set in
-- relationships.ts. 'parent' IS added there, because a parent holds exactly the authority a mother or a
-- father holds and excluding it would mean a minor with a recorded parent reading as having no
-- guardian -- the gap this pair of columns exists to close.
--
-- No existing row changes. A widened CHECK accepts everything it accepted before.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The clinical record (migration 221) -------------------------------------------------------

alter table practice_patient_relationship
  drop constraint if exists practice_patient_relationship_relationship_type_check;

alter table practice_patient_relationship
  add constraint practice_patient_relationship_relationship_type_check
  check (relationship_type in ('guardian', 'parent', 'mother', 'father', 'spouse', 'partner', 'sibling',
                               'child', 'grandparent', 'other_relative', 'emergency_contact',
                               'interpreter', 'employer', 'insurance_contact', 'carer',
                               'social_worker', 'other'));

-- ---- 2. The booking intake (migration 254) --------------------------------------------------------

alter table practice_booking_request
  drop constraint if exists practice_booking_request_representative_relationship_check;

alter table practice_booking_request
  add constraint practice_booking_request_representative_relationship_check
  check (representative_relationship is null or representative_relationship in
         ('guardian', 'parent', 'mother', 'father', 'spouse', 'partner', 'sibling', 'child',
          'grandparent', 'other_relative', 'emergency_contact', 'interpreter', 'employer',
          'insurance_contact', 'carer', 'social_worker', 'other'));

-- Verification: EXACTLY TWO relationship CHECK constraints exist, one per table, and both name the new
-- values.
--
-- The count is the part worth reading. A drop-then-add whose drop missed -- because the constraint was
-- created under a different auto-generated name -- leaves the OLD narrow constraint in place beside the
-- new one, and every insert is still judged by both. The migration would report success while 'parent'
-- stayed refused. Expect two rows, each containing parent and other_relative.
select rel.relname as table_name,
       con.conname,
       pg_get_constraintdef(con.oid) like '%parent%' as accepts_parent,
       pg_get_constraintdef(con.oid) like '%other_relative%' as accepts_other_relative
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
 where con.contype = 'c'
   and rel.relname in ('practice_patient_relationship', 'practice_booking_request')
   and pg_get_constraintdef(con.oid) like '%mother%'
 order by rel.relname;

notify pgrst, 'reload schema';
