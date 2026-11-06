-- ====================================================================================================
-- MIGRATION 906: LIFEOS PUBLIC API, USER-DELEGATED ACCESS
--
-- LIFEOS-API-001 delivery step 9. ADR-018.
--
-- APPLY ON STAGING FIRST. It adds four lifeos_ tables and two views, and writes no row. With no approved client and no
-- lifeos_public_api flag, no third party can reach anything.
--
-- DEPENDS ON: 901-lifeos-core.sql.
-- ----------------------------------------------------------------------------------------------------
-- There is no master API key. A third party acts only for a person who approved it, within the scopes that person saw,
-- until that person revokes it. Codes and tokens are stored only as hashes, so reading these tables cannot produce a
-- working credential. Whether a code or token is live is judged by the database clock, through the views.
-- ====================================================================================================

create table if not exists lifeos_api_client (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  name text not null check (length(btrim(name)) between 1 and 200),
  redirect_uris text[] not null check (array_length(redirect_uris, 1) >= 1),
  allowed_scopes text[] not null check (array_length(allowed_scopes, 1) >= 1),
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- One person's approval of one client. Revoking it ends every code and token beneath it.
create table if not exists lifeos_oauth_grant (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  client_id uuid not null references lifeos_api_client (id),
  individual_id uuid not null references lifeos_individual (id),
  scopes text[] not null check (array_length(scopes, 1) >= 1),
  revoked_at timestamptz,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint lifeos_oauth_grant_revoked_shape check ((status = 'revoked') = (revoked_at is not null))
);

create table if not exists lifeos_oauth_code (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  grant_id uuid not null references lifeos_oauth_grant (id),
  code_hash text not null unique check (length(code_hash) = 64),
  code_challenge text not null check (length(code_challenge) between 43 and 128),
  redirect_uri text not null,
  expires_at timestamptz not null,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'issued' check (status in ('issued', 'used')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists lifeos_oauth_token (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  grant_id uuid not null references lifeos_oauth_grant (id),
  access_hash text not null unique check (length(access_hash) = 64),
  refresh_hash text not null unique check (length(refresh_hash) = 64),
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('active', 'rotated', 'revoked')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create or replace view lifeos_live_oauth_code with (security_invoker = true) as
  select * from lifeos_oauth_code where status = 'issued' and expires_at > now();

-- A token whose grant is revoked is not live, so revoking a grant ends its tokens with no second step.
create or replace view lifeos_live_oauth_token with (security_invoker = true) as
  select t.*, g.client_id, g.individual_id, g.scopes,
    (t.access_expires_at > now()) as access_live, (t.refresh_expires_at > now()) as refresh_live
  from lifeos_oauth_token t join lifeos_oauth_grant g on g.id = t.grant_id
  where t.status = 'active' and g.status = 'active';

create index if not exists lifeos_oauth_grant_person on lifeos_oauth_grant (individual_id, status);
create index if not exists lifeos_oauth_token_grant on lifeos_oauth_token (grant_id, status);

create or replace trigger lifeos_stamp_api_client before insert or update on lifeos_api_client for each row execute function lifeos_stamp();
create or replace trigger lifeos_stamp_oauth_grant before insert or update on lifeos_oauth_grant for each row execute function lifeos_stamp('client_id', 'individual_id');
create or replace trigger lifeos_stamp_oauth_code before insert or update on lifeos_oauth_code for each row execute function lifeos_stamp('grant_id', 'code_hash', 'code_challenge', 'redirect_uri');
create or replace trigger lifeos_stamp_oauth_token before insert or update on lifeos_oauth_token for each row execute function lifeos_stamp('grant_id', 'access_hash', 'refresh_hash');
create or replace trigger lifeos_audit_api_client after insert or update on lifeos_api_client for each row execute function lifeos_audit('api_client');
create or replace trigger lifeos_audit_oauth_grant after insert or update on lifeos_oauth_grant for each row execute function lifeos_audit('oauth_grant');
create or replace trigger lifeos_audit_oauth_token after insert or update on lifeos_oauth_token for each row execute function lifeos_audit('oauth_token');

alter table lifeos_api_client enable row level security;
alter table lifeos_oauth_grant enable row level security;
alter table lifeos_oauth_code enable row level security;
alter table lifeos_oauth_token enable row level security;

revoke all on lifeos_api_client, lifeos_oauth_grant, lifeos_oauth_code, lifeos_oauth_token, lifeos_live_oauth_code, lifeos_live_oauth_token
  from anon, authenticated;

notify pgrst, 'reload schema';
