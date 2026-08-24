-- 359 A DELIBERATE NO-OP, KEPT AS A RECORD
--
-- THIS MIGRATION CHANGES NOTHING. practice_treatment.dose_unit already existed
-- when this file was written -- migration 275 added it, alongside the
-- practice_treatment_option vocabulary that seeds mg, g, mcg, mL, IU, units,
-- tablets, drops and puffs. Every row already carried a unit. The statement below
-- is `add column if not exists` against a column that exists, and applying it
-- returned no rows because there was nothing to do.
--
-- IT IS KEPT RATHER THAN DELETED so the sequence has no gap a later reader has to
-- account for, and so the mistake is legible where somebody would look for it.
--
-- WHAT ACTUALLY HAPPENED. A referral letter printed:
--
--     Treatment given
--     - Paracetamol (medication - 1000 - Oral - Twice a day (BD) - 5 days)
--
-- One thousand of what, to the consultant receiving it. That is a real defect and
-- it is now fixed. But the cause was NOT a missing column. The fact registry in
-- src/lib/practice/document-facts.ts selected `dose` and did not select
-- `dose_unit`, so a unit that was recorded, correct, and sitting in the same row
-- was dropped on the way into the letter. The fix is one column added to one
-- select, plus the shared doseWithUnit helper from medication-constants.ts.
--
-- HOW THE WRONG CONCLUSION WAS REACHED, because the method is the lesson. The
-- table was probed with an explicit six-column select -- label, treatment_type,
-- dose, route, frequency, duration -- that never asked for dose_unit, and the
-- create-table grep beside it used a line window that stopped before migration
-- 275's later ALTER. Neither looked, and both were read as evidence of absence.
-- An absence is a claim, and a claim about a schema is checkable in one query.
--
-- The medication side of the same bug WAS real: dose_text is free text and some
-- rows carry the unit while others leave it in dose_unit, so the two had to be
-- rejoined. That fix stands. This file is the treatment half, where the column
-- was never the problem.

alter table practice_treatment
  add column if not exists dose_unit text;

notify pgrst, 'reload schema';
