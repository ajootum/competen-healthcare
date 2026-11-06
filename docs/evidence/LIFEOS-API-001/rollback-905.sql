-- ROLLBACK FOR MIGRATION 905. Restores hostname uniqueness over every row. It fails if two rows now share a hostname, and
-- those rows must then be resolved by hand first. Only for use with an owner GO.
begin;
drop index if exists lifeos_tenant_domain_one_verified;
drop index if exists lifeos_tenant_domain_one_open_claim;
drop index if exists lifeos_tenant_domain_hostname;
alter table lifeos_tenant_domain drop column if exists verified_hostname;
alter table lifeos_tenant_domain drop column if exists open_hostname;
alter table lifeos_tenant_domain add constraint lifeos_tenant_domain_hostname_key unique (hostname);
commit;
notify pgrst, 'reload schema';
