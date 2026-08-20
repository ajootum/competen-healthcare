-- ============================================================
-- MIGRATION 347: REVOKE TWO CAPABILITIES THAT CONFER NOTHING (CPR-PD-013 s9, finding 13)
--
-- THE FINDING. hq.practice.export.execute and hq.practice.licence.verify are granted to
-- practice_product_director by migration 311 and enforced by NOTHING: no API route gates on either, no
-- screen references either, and the only mention of either anywhere is the grant itself. They were
-- created alongside seven other write capabilities that all found a use, and these two did not.
--
-- WHY THAT IS WORTH A MIGRATION. An unenforced grant is not a security hole -- nothing reads it, so
-- nothing can be done with it. It is worse than that for governance: an access review reads the
-- position as holding authority to export data and to verify licences, and the position does not. The
-- record of who may do what is the one place a wrong answer is expensive, and this one is wrong in the
-- direction of overstating.
--
-- ============================================================ REVOKED, NOT DELETED
--
-- hq_position_capability is a TEMPORAL table: effective_from and effective_to exist so a grant has a
-- history rather than a present tense. activeGrants() filters on that window, so closing it is what
-- revocation means here, and the row stays as evidence that the grant existed and when it ended.
--
-- Deleting the rows would work and would erase the fact that these were ever held, which is exactly
-- what an access review needs to see.
--
-- !! REGRANTING IS AN UPDATE, NOT AN INSERT, AND THAT MATTERS BECAUSE OF uq_hq_position_capability.
-- Migration 264 line 92 puts a UNIQUE index on (position_code, capability_code), so a second row for
-- the same pair is refused -- a fresh INSERT to regrant would fail with 23505. Setting effective_to
-- back to null on the existing row restores the grant and is what a later regrant should do.
--
-- ============================================================ WHAT IS NOT DONE HERE
--
-- The capability CODES are left in hq_capability and in the code registry. They are not being deleted
-- from the estate -- CPR-PD-010 s19 asks for a separate export capability by name, so the code has a
-- specification behind it and only the enforcement is missing. When something enforces it, the grant
-- is one UPDATE away.
--
-- No other grant is touched. practice_product_director keeps the other nineteen.
-- ============================================================

update hq_position_capability
   set effective_to = now()
 where position_code = 'practice_product_director'
   and capability_code in ('hq.practice.export.execute', 'hq.practice.licence.verify')
   and effective_to is null;

notify pgrst, 'reload schema';
