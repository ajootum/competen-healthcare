-- ROLLBACK for the Individual release batch 370 -> 372 -> 373 (production, 2026-10-23).
-- USE ONLY IF A STEP FAILS VERIFICATION. Run the section for each migration that was applied, in this order:
-- 373 first, then 372, then 370. Every object below was created by these migrations and held no rows
-- before the batch. Recovery reference: competen-production-20261023-1021.dump.gpg
-- (sha256 a31369ef34765172aa7d6bc018c9b470e2199a4815ea557a8ba206fe3ee266c0), isolated restore PASS 715/715.

-- ---- undo 373 ----
drop table if exists public.individual_professional_share;
drop table if exists public.individual_professional_evidence;
drop table if exists public.individual_professional_cpd;
drop table if exists public.individual_professional_goal;
drop table if exists public.individual_professional_need;
drop table if exists public.individual_professional_profile;
delete from storage.buckets where id = 'individual-professional-evidence'
  and not exists (select 1 from storage.objects o where o.bucket_id = 'individual-professional-evidence');

-- ---- undo 372 ----
drop table if exists public.individual_scholar_card;
drop table if exists public.individual_scholar_attempt;
drop table if exists public.individual_scholar_question;
drop table if exists public.individual_scholar_chunk;
drop table if exists public.individual_scholar_material;
drop table if exists public.individual_scholar_consent;
delete from storage.buckets where id = 'individual-scholar-materials'
  and not exists (select 1 from storage.objects o where o.bucket_id = 'individual-scholar-materials');

-- ---- undo 370 ----
drop view if exists public.individual_live_entitlement;
drop table if exists public.individual_entitlement;
drop table if exists public.individual_membership;

notify pgrst, 'reload schema';
