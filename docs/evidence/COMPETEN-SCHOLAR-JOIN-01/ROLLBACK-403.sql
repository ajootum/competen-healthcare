-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 403 (individual_age_declaration, individual_entitlement.adult_declaration_id).
-- THE STAGING ROLLBACK, AND THE PRODUCTION ROLLBACK SHOULD 403 EVER BE APPLIED THERE UNDER ITS OWN GO.
--
-- RUN THIS BEFORE ROLLBACK-402. Reverse order of application: 403 first, then 402.
--
-- !! THIS DELETES EVERY ADULT-AGE DECLARATION. Dropping individual_age_declaration removes all declarations
-- with the table. Export them first if they must be kept. Nothing else is deleted: memberships and
-- entitlement periods stay (370 owns them), and the audit_log rows individual_scholar_self_activated stay
-- as the record.
--
-- !! A SELF-DECLARED SCHOLAR PERIOD LOSES ITS EVIDENCE. Dropping adult_declaration_id leaves such a period
-- with adult_confirmed_at and no confirmer, indistinguishable from an HQ confirmation whose administrator
-- was deleted. The first SELECT below counts them: it must read 0 before the rest is run. On staging the
-- scholar-join harness deletes its own fixtures, so it reads 0 there unless somebody activated by hand. End
-- any such period first.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb) the objects exist after 403.
-- This file is safe where they do not exist, except the first SELECT, which needs the column -- skip it
-- there.
--
-- Dependency order: the CHECK and the index on individual_entitlement, then the column (its foreign key
-- goes with it), then the trigger, its function, and the table (its index, constraints and RLS policy go
-- with it). Every statement is IF EXISTS, so re-running it is a no-op. It touches no object 403 did not
-- create, and leaves the 370 CHECK individual_entitlement_scholar_adult exactly as it was.
--
-- After this, the Scholar join activation fails closed (the declaration insert is refused) and the
-- individual_self_registration flag must stay OFF, as it already is.
--
-- ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

select count(*) as self_declared_periods_must_be_zero from public.individual_entitlement where adult_declaration_id is not null;

alter table if exists public.individual_entitlement drop constraint if exists individual_entitlement_adult_basis_exclusive;
drop index if exists public.idx_individual_entitlement_adult_declaration;
alter table if exists public.individual_entitlement drop column if exists adult_declaration_id;

drop trigger if exists trg_individual_age_declaration_append_only on public.individual_age_declaration;
drop function if exists public.individual_age_declaration_append_only();
drop table if exists public.individual_age_declaration;

notify pgrst, 'reload schema';
