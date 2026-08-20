-- ============================================================
-- MIGRATION 346: GIVE THE OBSERVER POSITION ITS PRODUCT LINE (corrects migration 345)
--
-- WHAT WENT WRONG. Migration 345 created practice_product_observer with (code, space, name,
-- description) and left product_line_code NULL. hq_position carries that column and the Product
-- Director has it set to the practice line.
--
-- WHY IT MATTERED, WHICH IS NOT OBVIOUS FROM THE COLUMN NAME. resolveMissionProfile decides WHICH
-- WORKSPACE SHELL a person sees, and it decides it by reading product_line_code off the positions they
-- hold -- not off their capabilities. Its own comment says the mechanism exists so that "adding a
-- second Practice position needs no code change", and it was right. The column simply was not filled.
--
-- THE SYMPTOM, OBSERVED RATHER THAN REASONED. Appointed as an observer, the fixture held all thirteen
-- view capabilities and every Product Director page rendered correctly by URL -- and the sidebar showed
-- the generic Competen HQ nav instead of the eleven-item Practice workspace. Every screen was
-- REACHABLE and none of it was DISCOVERABLE, which is the exact failure this estate has recorded
-- before under that name.
--
-- With no product line the profile filter matches nothing, and resolution falls through to the
-- hq_super_admin profile, which is a reasonable default for an HQ appointee who governs no product and
-- the wrong answer for one who governs this one.
--
-- !! 345 IS NOT EDITED. It is applied on both projects, and editing an applied migration makes the file
-- a description of something that never ran. This is the correction as its own step, which is also how
-- 298 corrected 297.
-- ============================================================

update hq_position
   set product_line_code = 'practice'
 where code = 'practice_product_observer'
   and product_line_code is distinct from 'practice';

notify pgrst, 'reload schema';
