-- ====================================================================================================
-- 298  RELAX THE SEEDED SITE REQUIREMENT  (CPR-PROC-HFE-005 s20, correcting 297 section 7)
-- ====================================================================================================
--
-- WHAT THIS DOES
--   Migration 297 seeded site_rule = 'required' on the four wound and skin procedures. The owner has
--   ruled that back to 'optional'. This is the whole change.
--
-- WHY IT IS A MIGRATION RATHER THAN AN UPDATE RUN BY HAND
--   297 is still in the history and still contains the seed. A database rebuilt from migrations would
--   apply 297, set the four rows to required, and come up stricter than the live one -- so the live
--   database and a fresh one would disagree about a rule that blocks recording mid-consultation. The
--   correction has to sit in the same history as the thing it corrects.
--
-- WHY 297 IS NOT EDITED INSTEAD
--   It has been applied. Editing an applied migration makes the file a description of something that
--   never ran, and the next person to read it would be reading fiction.
--
-- WHAT WAS WRONG WITH THE SEED
--   Not the clinical reasoning -- a dressing record that does not say WHICH wound really does say very
--   little. What was wrong is that it was my judgement imposed on every practice as a hard block, on a
--   screen used with a patient in the room, in a migration whose stated purpose was to make
--   applicability CONFIGURABLE. The tri-state column is still there and a practice can still set
--   'required' deliberately. Shipping it switched on by default made the choice for them.
--
-- WARNING: THIS DELIBERATELY TOUCHES ONLY THE PLATFORM ROWS SEEDED BY 297. A practice that has since
--   set site_rule on its OWN catalogue entry has made a real decision, and this migration must not
--   reach across and undo it. Probed before writing: four rows, all platform, no practice-owned row
--   carries a non-default site_rule today -- but the workspace_id filter is what keeps that true
--   tomorrow, when this file may be applied to a database that has moved on.
--
-- WARNING: NOTHING ELSE FROM 297 IS RELAXED. laterality_rule, consent_rule, the allowed-value lists
--   and the stricter-of-two enforcement are untouched. The seeded left/right restriction on
--   abscess_incision and cannulation also stays -- it narrows a choice that is already required rather
--   than adding a new demand, so it cannot block a record that would otherwise have been made.
-- ====================================================================================================

update practice_procedure_type set site_rule = 'optional'
where workspace_id is null and site_rule = 'required'
  and code in ('wound_dressing', 'suturing', 'abscess_incision', 'lesion_excision');

notify pgrst, 'reload schema';
