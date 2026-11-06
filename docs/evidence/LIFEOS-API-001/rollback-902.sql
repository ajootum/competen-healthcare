-- ROLLBACK FOR MIGRATION 902. Removes the terms table and the acceptance columns, and nothing else.
-- It refuses while any opt-in entitlement exists, because the columns hold what those people accepted.
-- Only for use with an owner GO.
begin;
alter table lifeos_entitlement drop constraint if exists lifeos_entitlement_optin_has_terms;
alter table lifeos_entitlement drop constraint if exists lifeos_entitlement_terms_whole;
alter table lifeos_entitlement drop column if exists terms_accepted_at;
alter table lifeos_entitlement drop column if exists terms_version;
drop table if exists lifeos_terms;
commit;
notify pgrst, 'reload schema';
