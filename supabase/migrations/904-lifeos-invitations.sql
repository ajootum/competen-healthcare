-- ====================================================================================================
-- MIGRATION 904: LIFEOS INVITATIONS TO AN ORGANISATION WORKSPACE
--
-- LIFEOS-API-001 delivery step 8. ADR-018.
--
-- APPLY ON STAGING FIRST. It adds one lifeos_ table and one view. It writes no row.
--
-- DEPENDS ON: 901-lifeos-core.sql and 903-lifeos-tenant-domains.sql.
-- ----------------------------------------------------------------------------------------------------
-- The token itself is never stored, only its hash, so reading this table cannot produce a working link.
-- An invitation names one email address and can be used once. Whether it is still live is judged by the
-- database clock, through the view.
-- ====================================================================================================

create table if not exists lifeos_invitation (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  tenant_id uuid not null references lifeos_tenant (id),
  owner_individual_id uuid not null,
  email text not null check (email = lower(email) and length(email) between 3 and 320),
  role text not null check (role in ('admin', 'member')),
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references lifeos_individual (id),
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  constraint lifeos_invitation_accepted_shape check ((status = 'accepted') = (accepted_at is not null))
);

create or replace view lifeos_live_invitation with (security_invoker = true) as
  select * from lifeos_invitation where status = 'pending' and archived_at is null and expires_at > now();

create index if not exists lifeos_invitation_workspace on lifeos_invitation (workspace_id, status);

create or replace trigger lifeos_stamp_invitation before insert or update on lifeos_invitation for each row execute function lifeos_stamp('tenant_id', 'email', 'token_hash');
create or replace trigger lifeos_audit_invitation after insert or update on lifeos_invitation for each row execute function lifeos_audit('invitation');

alter table lifeos_invitation enable row level security;
revoke all on lifeos_invitation, lifeos_live_invitation from anon, authenticated;

notify pgrst, 'reload schema';
