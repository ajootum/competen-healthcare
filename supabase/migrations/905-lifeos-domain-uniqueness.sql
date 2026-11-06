-- ====================================================================================================
-- MIGRATION 905: A HOSTNAME IS UNIQUE WHEN VERIFIED, NOT WHEN MERELY CLAIMED
--
-- LIFEOS-API-001 delivery step 7, from the independent read of Stages 3 to 5. ADR-018.
--
-- APPLY ON STAGING FIRST. It changes one constraint on lifeos_tenant_domain, adds two generated columns, and writes no
-- row. Nothing serves a domain unless it is verified, so this changes nothing a visitor sees.
--
-- DEPENDS ON: 903-lifeos-tenant-domains.sql.
-- ----------------------------------------------------------------------------------------------------
-- Before: uniqueness covered pending and removed rows, so any tenant could claim another organisation's name with no
-- proof, and the real owner's claim then failed for good. A tenant could not re-add a domain it had removed either.
-- Now: anyone may claim a name, but only one tenant can hold it verified, and a tenant holds one open claim per name.
-- Generated columns and FULL unique indexes, not partial indexes (house rule). Null never conflicts.
-- ====================================================================================================

alter table lifeos_tenant_domain drop constraint if exists lifeos_tenant_domain_hostname_key;

alter table lifeos_tenant_domain add column if not exists verified_hostname text
  generated always as (case when status = 'verified' then hostname end) stored;
alter table lifeos_tenant_domain add column if not exists open_hostname text
  generated always as (case when status <> 'removed' then hostname end) stored;

create unique index if not exists lifeos_tenant_domain_one_verified on lifeos_tenant_domain (verified_hostname);
create unique index if not exists lifeos_tenant_domain_one_open_claim on lifeos_tenant_domain (tenant_id, open_hostname);
create index if not exists lifeos_tenant_domain_hostname on lifeos_tenant_domain (hostname, status);

notify pgrst, 'reload schema';
