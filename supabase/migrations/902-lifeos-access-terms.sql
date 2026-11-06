-- ====================================================================================================
-- MIGRATION 902: LIFEOS TERMS, AND THE ACCEPTANCE RECORDED ON AN ENTITLEMENT
--
-- LIFEOS-API-001 delivery step 6. ADR-018.
--
-- APPLY ON STAGING FIRST. It adds one lifeos_ table and two nullable columns on lifeos_entitlement. It writes
-- no row: with no published terms, nobody can opt in, so this stays closed after application.
--
-- DEPENDS ON: 901-lifeos-core.sql.
-- ----------------------------------------------------------------------------------------------------
-- Opting in to LifeOS through a Competen account is a person's own choice, and it records which terms they
-- accepted and when. Version and time are written together or not at all. A self-service access row that does not
-- say which terms it was accepted under cannot be stored.
-- ====================================================================================================

create table if not exists lifeos_terms (
  version text primary key check (length(version) between 1 and 80),
  title text not null check (length(btrim(title)) between 1 and 200),
  url text not null check (url ~ '^https://'),
  status text not null default 'published' check (status in ('published', 'retired')),
  published_at timestamptz not null default now()
);

alter table lifeos_entitlement add column if not exists terms_version text references lifeos_terms (version);
alter table lifeos_entitlement add column if not exists terms_accepted_at timestamptz;

alter table lifeos_entitlement drop constraint if exists lifeos_entitlement_terms_whole;
alter table lifeos_entitlement add constraint lifeos_entitlement_terms_whole
  check ((terms_version is null) = (terms_accepted_at is null));

alter table lifeos_entitlement drop constraint if exists lifeos_entitlement_optin_has_terms;
alter table lifeos_entitlement add constraint lifeos_entitlement_optin_has_terms
  check (source <> 'competen_individual' or terms_version is not null);

alter table lifeos_terms enable row level security;
revoke all on lifeos_terms from anon, authenticated;

notify pgrst, 'reload schema';
