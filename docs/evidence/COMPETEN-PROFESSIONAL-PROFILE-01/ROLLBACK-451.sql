-- ROLLBACK 451 (STAGING ONLY). COMPETEN-PROFESSIONAL-PROFILE-01 part B, verification.
-- Removes the verification history (and every row in it), its two trigger functions, the holds-capability
-- function, the position grants, the position and the capability. It removes NO appointment, because 451
-- creates none. Run it only while no appointment to individual_professional_verifier exists (check below).
-- Plain statements only, so it is safe for a runner that splits on semicolons.

select count(*) as verifier_appointments_must_be_0 from ogs_office_appointments where role = 'individual_professional_verifier';

drop table if exists individual_professional_item_verification;
drop function if exists public.individual_professional_item_verification_guard();
drop function if exists public.individual_professional_item_verification_append_only();
drop function if exists public.individual_holds_capability(uuid, text);

delete from hq_position_capability where position_code = 'individual_professional_verifier';
delete from hq_position where code = 'individual_professional_verifier';
delete from hq_capability where code = 'hq.individual.professional.verify';

notify pgrst, 'reload schema';
