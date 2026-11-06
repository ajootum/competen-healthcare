-- ====================================================================================================
-- MIGRATION 901: LIFEOS CORE, THE COMMITMENT ENGINE AND ITS CONTRACTS, SCHEMA VERSION 1
--
-- APPLY THIS FILE WHOLE. It contains plpgsql function bodies, and a runner that splits on semicolons
-- would cut them in half.
--
-- LIFEOS-API-001 sections 3, 4, 5, 7 and 8. ADR-018 (sealed product).
--
-- APPLY ON STAGING FIRST. It creates new lifeos_ objects only. It alters no existing table, row, policy
-- or constraint, and no existing code reads these objects. Re-running it is a no-op. It writes no flag
-- row, so the lifeos_core gate stays OFF after application.
--
-- DEPENDS ON: nothing. No other migration needs to be present.
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS FILE ENFORCES, SO THAT A SECOND WRITER CANNOT FORGET IT.
--
--   Sealed: a lifeos_ table references only lifeos_ tables, never profiles, auth.users or tenants.
--   Cross-workspace references are impossible: composite foreign keys on (workspace_id, x).
--   A record owner, a delegatee and a grantee must each be a member of the workspace.
--   A personal workspace has exactly one member, its owner (trigger).
--   Quadrant is generated, so no writer can assign one.
--   Every write stamps its version and clock and leaves an audit row (triggers).
--   Audit rows carry field names, statuses and ids, never titles, notes or reflections.
--   Holding a live entitlement is what admits a person, judged by the database clock.
--   RLS is ON with zero policies, and anon and authenticated hold no privileges. The only door is the
--   service role behind the API. This is deliberate and is not a gap.
--
-- NOT IN THIS FILE: any custom-domain table (step 7), any OAuth client
-- table (step 9), any flag row, any seed data.
-- ====================================================================================================


-- ---- 1. the gate ------------------------------------------------------------------------------------

create table if not exists lifeos_flag (
  flag text primary key,
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);


-- ---- 2. the person -----------------------------------------------------------------------------------

create table if not exists lifeos_individual (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  timezone text not null default 'UTC' check (length(timezone) between 1 and 64),
  locale text not null default 'en' check (length(locale) between 2 and 35),
  access_source text not null check (access_source in ('direct', 'competen_individual', 'organisation', 'platform_grant')),
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- The ONLY place an external identity is recorded. After a carve-out the same row shape holds an OIDC
-- subject and lifeos_individual.id does not change.
create table if not exists lifeos_identity_link (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  individual_id uuid not null references lifeos_individual (id),
  issuer text not null check (length(issuer) between 1 and 200),
  subject text not null check (length(subject) between 1 and 200),
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
  unique (issuer, subject)
);


-- ---- 3. tenant, workspace, membership ----------------------------------------------------------------

create table if not exists lifeos_tenant (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  owner_individual_id uuid not null references lifeos_individual (id),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  kind text not null check (kind in ('organisation', 'partner_platform')),
  branding jsonb not null default '{}'::jsonb,
  access_scope text not null default 'workspace' check (access_scope in ('private', 'workspace')),
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'closed')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists lifeos_workspace (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  owner_individual_id uuid not null references lifeos_individual (id),
  kind text not null check (kind in ('personal', 'organisation')),
  tenant_id uuid references lifeos_tenant (id),
  name text not null check (length(btrim(name)) between 1 and 200),
  -- One personal workspace per person. A generated column and a FULL unique index, not a partial index.
  personal_key uuid generated always as (case when kind = 'personal' then owner_individual_id end) stored,
  access_scope text not null default 'workspace' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (personal_key),
  constraint lifeos_workspace_kind_shape check (
    (kind = 'personal' and tenant_id is null) or (kind = 'organisation' and tenant_id is not null)
  )
);

create table if not exists lifeos_membership (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  individual_id uuid not null references lifeos_individual (id),
  role text not null check (role in ('owner', 'admin', 'member')),
  access_scope text not null default 'workspace' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'left')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, individual_id)
);


-- A ledger of access periods, per person. Absence of a live row means no access to LifeOS. Any number of rows
-- may be live at once, so a person who subscribes directly and also receives access through an organisation keeps
-- going when one of them ends. The source says where the access came from and is required with no default.
create table if not exists lifeos_entitlement (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  individual_id uuid not null references lifeos_individual (id),
  source text not null check (source in ('direct', 'competen_individual', 'organisation', 'platform_grant')),
  tenant_id uuid references lifeos_tenant (id),
  plan_code text check (plan_code is null or length(plan_code) between 1 and 80),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
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
  constraint lifeos_entitlement_period check (ends_at is null or ends_at > starts_at),
  constraint lifeos_entitlement_revoked_shape check ((status = 'revoked') = (revoked_at is not null)),
  constraint lifeos_entitlement_organisation_shape check ((source = 'organisation') = (tenant_id is not null))
);

create or replace view lifeos_live_entitlement with (security_invoker = true) as
  select * from lifeos_entitlement
  where status = 'active' and archived_at is null and starts_at <= now() and (ends_at is null or ends_at > now());


-- ---- 4. worlds, goals, projects ------------------------------------------------------------------------

create table if not exists lifeos_world (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  context text check (context is null or length(context) <= 200),
  purpose text check (purpose is null or length(purpose) <= 2000),
  position integer not null default 0,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id)
);

create table if not exists lifeos_goal (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  world_id uuid,
  title text not null check (length(btrim(title)) between 1 and 500),
  description text check (description is null or length(description) <= 10000),
  target_on date,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('active', 'paused', 'achieved', 'dropped')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  foreign key (workspace_id, world_id) references lifeos_world (workspace_id, id)
);

create table if not exists lifeos_project (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  world_id uuid,
  goal_id uuid,
  title text not null check (length(btrim(title)) between 1 and 500),
  description text check (description is null or length(description) <= 10000),
  due_on date,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'dropped')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  foreign key (workspace_id, world_id) references lifeos_world (workspace_id, id),
  foreign key (workspace_id, goal_id) references lifeos_goal (workspace_id, id)
);


-- ---- 5. the commitment ---------------------------------------------------------------------------------

create table if not exists lifeos_commitment (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  world_id uuid,
  goal_id uuid,
  project_id uuid,
  title text not null check (length(btrim(title)) between 1 and 500),
  notes text check (notes is null or length(notes) <= 10000),
  important boolean,
  urgent boolean,
  quadrant text generated always as (
    case
      when important is null or urgent is null then null
      when important and urgent then 'q1'
      when important then 'q2'
      when urgent then 'q3'
      else 'q4'
    end
  ) stored,
  due_on date,
  scheduled_on date,
  scheduled_time time,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes between 1 and 1440),
  completed_at timestamptz,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'inbox' check (status in ('inbox', 'planned', 'in_progress', 'delegated', 'done', 'dropped')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  foreign key (workspace_id, world_id) references lifeos_world (workspace_id, id),
  foreign key (workspace_id, goal_id) references lifeos_goal (workspace_id, id),
  foreign key (workspace_id, project_id) references lifeos_project (workspace_id, id),
  constraint lifeos_commitment_clarified check (
    status not in ('planned', 'in_progress', 'delegated')
    or (world_id is not null and important is not null and urgent is not null)
  ),
  constraint lifeos_commitment_planned_has_date check (status <> 'planned' or scheduled_on is not null),
  constraint lifeos_commitment_time_needs_date check (scheduled_time is null or scheduled_on is not null),
  constraint lifeos_commitment_done_shape check ((status = 'done') = (completed_at is not null))
);

create table if not exists lifeos_quadrant_classification (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null,
  owner_individual_id uuid not null,
  commitment_id uuid not null,
  important boolean not null,
  urgent boolean not null,
  quadrant text generated always as (
    case when important and urgent then 'q1' when important then 'q2' when urgent then 'q3' else 'q4' end
  ) stored,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'recorded' check (status = 'recorded'),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  created_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, commitment_id) references lifeos_commitment (workspace_id, id) on delete cascade
);


-- ---- 6. delegation -------------------------------------------------------------------------------------

create table if not exists lifeos_delegation (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  commitment_id uuid not null,
  delegatee_individual_id uuid,
  delegatee_label text check (delegatee_label is null or length(btrim(delegatee_label)) between 1 and 200),
  follow_up_on date not null,
  expectations text check (expectations is null or length(expectations) <= 4000),
  closed_at timestamptz,
  -- One active delegation per commitment. True while active, null afterwards, under a FULL unique index.
  active_key boolean generated always as (case when status = 'active' then true end) stored,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  unique (commitment_id, active_key),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  foreign key (workspace_id, commitment_id) references lifeos_commitment (workspace_id, id),
  foreign key (workspace_id, delegatee_individual_id) references lifeos_membership (workspace_id, individual_id),
  constraint lifeos_delegation_names_someone check (delegatee_individual_id is not null or delegatee_label is not null),
  constraint lifeos_delegation_closed_shape check ((status = 'active') = (closed_at is null))
);


-- ---- 7. integrations and schedule ----------------------------------------------------------------------

create table if not exists lifeos_integration_connection (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  provider text not null check (length(provider) between 1 and 80),
  granted_scopes text[] not null default '{}',
  external_account_ref text check (external_account_ref is null or length(external_account_ref) <= 400),
  -- A POINTER to a secret store. No token or secret is ever held in this table.
  credential_ref text check (credential_ref is null or length(credential_ref) <= 400),
  last_synced_at timestamptz,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'revoked')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id)
);

create table if not exists lifeos_calendar_event (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  world_id uuid,
  commitment_id uuid,
  connection_id uuid,
  external_ref text check (external_ref is null or length(external_ref) <= 400),
  title text not null check (length(btrim(title)) between 1 and 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null default 'UTC' check (length(time_zone) between 1 and 64),
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  foreign key (workspace_id, world_id) references lifeos_world (workspace_id, id),
  foreign key (workspace_id, commitment_id) references lifeos_commitment (workspace_id, id),
  foreign key (workspace_id, connection_id) references lifeos_integration_connection (workspace_id, id),
  constraint lifeos_calendar_event_order check (ends_at > starts_at)
);

create table if not exists lifeos_protected_block (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  world_id uuid,
  commitment_id uuid,
  label text not null check (length(btrim(label)) between 1 and 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null default 'UTC' check (length(time_zone) between 1 and 64),
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'active' check (status in ('active', 'released')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  foreign key (workspace_id, world_id) references lifeos_world (workspace_id, id),
  foreign key (workspace_id, commitment_id) references lifeos_commitment (workspace_id, id),
  constraint lifeos_protected_block_order check (ends_at > starts_at)
);


-- ---- 8. the week ---------------------------------------------------------------------------------------

create table if not exists lifeos_weekly_plan (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  intention text check (intention is null or length(intention) <= 4000),
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, owner_individual_id, week_start),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id)
);

create table if not exists lifeos_big_rock (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  weekly_plan_id uuid not null,
  commitment_id uuid not null,
  position integer not null default 0,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'selected' check (status in ('selected', 'removed')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  unique (weekly_plan_id, commitment_id),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  foreign key (workspace_id, weekly_plan_id) references lifeos_weekly_plan (workspace_id, id),
  foreign key (workspace_id, commitment_id) references lifeos_commitment (workspace_id, id)
);

create table if not exists lifeos_weekly_review (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  weekly_plan_id uuid,
  week_start date not null check (extract(isodow from week_start) = 1),
  reflection text check (reflection is null or length(reflection) <= 20000),
  next_week_focus text check (next_week_focus is null or length(next_week_focus) <= 4000),
  snapshot jsonb,
  finalised_at timestamptz,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'draft' check (status in ('draft', 'final')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, owner_individual_id, week_start),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  foreign key (workspace_id, weekly_plan_id) references lifeos_weekly_plan (workspace_id, id),
  constraint lifeos_weekly_review_final_shape check ((status = 'final') = (finalised_at is not null))
);


-- ---- 9. grants, judged by the database clock -------------------------------------------------------------

create table if not exists lifeos_permission_grant (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  grantee_individual_id uuid not null,
  resource_type text not null check (resource_type in (
    'world', 'goal', 'project', 'commitment', 'delegation', 'calendar_event', 'protected_block',
    'weekly_plan', 'big_rock', 'weekly_review', 'integration_connection', 'suggestion', 'quadrant_classification'
  )),
  -- Null means every record of this type that the grantor owns in this workspace.
  resource_id uuid,
  capability text not null check (capability in ('read', 'write')),
  expires_at timestamptz,
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
  unique (workspace_id, id),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  foreign key (workspace_id, grantee_individual_id) references lifeos_membership (workspace_id, individual_id),
  constraint lifeos_permission_grant_revoked_shape check ((status = 'revoked') = (revoked_at is not null))
);

create or replace view lifeos_live_grant with (security_invoker = true) as
  select * from lifeos_permission_grant
  where status = 'active' and archived_at is null and (expires_at is null or expires_at > now());


-- ---- 10. suggestions: proposals only, separate from every record they might change ------------------------

create table if not exists lifeos_suggestion (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  workspace_id uuid not null references lifeos_workspace (id),
  owner_individual_id uuid not null,
  kind text not null check (kind in (
    'protect_q2', 'clarify_inbox', 'delegation_follow_up', 'big_rock', 'replan', 'priority', 'quadrant',
    'calendar_adjustment', 'weekly_insight'
  )),
  materiality text not null check (materiality in ('informational', 'material')),
  title text not null check (length(btrim(title)) between 1 and 500),
  rationale text check (rationale is null or length(rationale) <= 4000),
  target_type text,
  target_id uuid,
  proposed_change jsonb,
  generator text not null check (length(generator) between 1 and 80),
  dedupe_key text not null check (length(dedupe_key) between 1 and 300),
  decided_at timestamptz,
  decided_by uuid references lifeos_individual (id),
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed', 'expired')),
  provenance_source text not null check (provenance_source in ('user', 'ai_suggestion', 'integration', 'import', 'system')),
  provenance_ref text,
  version integer not null default 1,
  created_by uuid not null references lifeos_individual (id),
  updated_by uuid not null references lifeos_individual (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, owner_individual_id, dedupe_key),
  foreign key (workspace_id, owner_individual_id) references lifeos_membership (workspace_id, individual_id),
  constraint lifeos_suggestion_decided_shape check ((status in ('accepted', 'dismissed')) = (decided_at is not null)),
  constraint lifeos_suggestion_material_needs_change check (materiality <> 'material' or proposed_change is not null)
);


-- ---- 11. the audit log, which is also the event stream -----------------------------------------------------
-- NO foreign keys, so the trail outlives what it describes. NO content columns.

create table if not exists lifeos_audit_event (
  seq bigint generated always as identity primary key,
  id uuid not null default gen_random_uuid() unique,
  schema_version integer not null default 1,
  event_type text not null,
  event_version integer not null default 1,
  workspace_id uuid,
  owner_individual_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  changed_fields text[] not null default '{}',
  from_status text,
  to_status text,
  actor_individual_id uuid,
  actor_kind text not null check (actor_kind in ('user', 'ai', 'integration', 'system')),
  trace_id text,
  access_scope text not null default 'private' check (access_scope in ('private', 'workspace')),
  status text not null default 'recorded' check (status = 'recorded'),
  provenance_source text,
  provenance_ref text,
  occurred_at timestamptz not null default now()
);


-- ---- 12. idempotency and rate limiting -----------------------------------------------------------------------

-- Holds references, not record contents. A replay re-reads the record under the current access of the caller.
create table if not exists lifeos_idempotency (
  actor_individual_id uuid not null references lifeos_individual (id),
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key (actor_individual_id, idempotency_key)
);

-- Expiry is judged by the database clock, here, never by comparing an application timestamp.
create or replace view lifeos_live_idempotency with (security_invoker = true) as
  select * from lifeos_idempotency where expires_at > now();

create table if not exists lifeos_rate_window (
  subject text not null,
  bucket text not null,
  window_start timestamptz not null default now(),
  hits integer not null default 0,
  primary key (subject, bucket)
);


-- ---- 13. indexes -----------------------------------------------------------------------------------------------

create index if not exists lifeos_identity_link_individual on lifeos_identity_link (individual_id);
create index if not exists lifeos_entitlement_individual on lifeos_entitlement (individual_id, status);
create index if not exists lifeos_membership_individual on lifeos_membership (individual_id, status);
create index if not exists lifeos_workspace_tenant on lifeos_workspace (tenant_id);
create index if not exists lifeos_world_list on lifeos_world (workspace_id, created_at, id);
create index if not exists lifeos_goal_list on lifeos_goal (workspace_id, created_at, id);
create index if not exists lifeos_project_list on lifeos_project (workspace_id, created_at, id);
create index if not exists lifeos_commitment_list on lifeos_commitment (workspace_id, created_at, id);
create index if not exists lifeos_commitment_owner on lifeos_commitment (workspace_id, owner_individual_id, status);
create index if not exists lifeos_commitment_scheduled on lifeos_commitment (workspace_id, scheduled_on);
create index if not exists lifeos_quadrant_commitment on lifeos_quadrant_classification (workspace_id, commitment_id, created_at);
create index if not exists lifeos_delegation_list on lifeos_delegation (workspace_id, created_at, id);
create index if not exists lifeos_delegation_commitment on lifeos_delegation (workspace_id, commitment_id);
create index if not exists lifeos_connection_list on lifeos_integration_connection (workspace_id, created_at, id);
create index if not exists lifeos_calendar_event_list on lifeos_calendar_event (workspace_id, created_at, id);
create index if not exists lifeos_protected_block_list on lifeos_protected_block (workspace_id, created_at, id);
create index if not exists lifeos_weekly_plan_list on lifeos_weekly_plan (workspace_id, created_at, id);
create index if not exists lifeos_big_rock_list on lifeos_big_rock (workspace_id, created_at, id);
create index if not exists lifeos_weekly_review_list on lifeos_weekly_review (workspace_id, created_at, id);
create index if not exists lifeos_grant_list on lifeos_permission_grant (workspace_id, created_at, id);
create index if not exists lifeos_grant_grantee on lifeos_permission_grant (workspace_id, grantee_individual_id, status);
create index if not exists lifeos_suggestion_list on lifeos_suggestion (workspace_id, created_at, id);
create index if not exists lifeos_audit_owner on lifeos_audit_event (workspace_id, owner_individual_id, seq);
create index if not exists lifeos_audit_entity on lifeos_audit_event (entity_type, entity_id, seq);


-- ---- 14. triggers ----------------------------------------------------------------------------------------------

-- Stamps version and clock from the database, and refuses a change to anything immutable. Extra immutable
-- columns for one table are passed as trigger arguments.
create or replace function lifeos_stamp() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  o jsonb;
  n jsonb;
  c text;
  ignored text[] := array['updated_by', 'updated_at', 'version', 'quadrant', 'active_key', 'personal_key'];
  immutable text[] := array['id', 'workspace_id', 'owner_individual_id', 'created_at', 'created_by', 'schema_version'];
  i integer;
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  o := to_jsonb(old);
  n := to_jsonb(new);
  for i in 0 .. coalesce(tg_nargs, 0) - 1 loop
    immutable := immutable || tg_argv[i];
  end loop;
  foreach c in array immutable loop
    if (n -> c) is distinct from (o -> c) then
      raise exception 'lifeos: % is immutable on %', c, tg_table_name using errcode = 'LO400';
    end if;
  end loop;
  if (n - ignored) = (o - ignored) then
    new.version := old.version;
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
    return new;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  if old.archived_at is null and new.archived_at is not null then
    new.archived_at := now();
  end if;
  return new;
end;
$$;

-- One audit row per real change. Field NAMES only. tg_argv[0] is the contract name of the entity.
create or replace function lifeos_audit() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  entity text := tg_argv[0];
  n jsonb := to_jsonb(new);
  o jsonb;
  changed text[] := '{}';
  verb text;
  noise text[] := array['updated_by', 'updated_at', 'version', 'quadrant', 'active_key', 'personal_key'];
  kind text := coalesce(nullif(current_setting('lifeos.actor_kind', true), ''), 'system');
begin
  if tg_op = 'INSERT' then
    verb := 'created';
    select coalesce(array_agg(k order by k), '{}') into changed
      from jsonb_each(n) as e(k, v) where v <> 'null'::jsonb and k <> all (noise);
  else
    o := to_jsonb(old);
    select coalesce(array_agg(k order by k), '{}') into changed
      from jsonb_each(n) as e(k, v) where (o -> k) is distinct from v and k <> all (noise);
    if coalesce(array_length(changed, 1), 0) = 0 then
      return null;
    end if;
    verb := case
      when (o ->> 'archived_at') is null and (n ->> 'archived_at') is not null then 'archived'
      when (o ->> 'archived_at') is not null and (n ->> 'archived_at') is null then 'restored'
      when (o ->> 'status') is distinct from (n ->> 'status') then 'status_changed'
      else 'updated'
    end;
  end if;
  insert into lifeos_audit_event (
    event_type, workspace_id, owner_individual_id, entity_type, entity_id, changed_fields, from_status, to_status,
    actor_individual_id, actor_kind, trace_id, provenance_source, provenance_ref
  ) values (
    entity || '.' || verb,
    case when entity = 'workspace' then new.id else (n ->> 'workspace_id')::uuid end,
    coalesce((n ->> 'owner_individual_id')::uuid, (n ->> 'individual_id')::uuid),
    entity, new.id, changed, o ->> 'status', n ->> 'status',
    (n ->> 'updated_by')::uuid, kind, nullif(current_setting('lifeos.trace_id', true), ''),
    n ->> 'provenance_source', n ->> 'provenance_ref'
  );
  return null;
end;
$$;

-- A classification row for every change of importance or urgency, whichever writer made it.
create or replace function lifeos_log_quadrant() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.important is null or new.urgent is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.important is not distinct from new.important and old.urgent is not distinct from new.urgent then
    return null;
  end if;
  insert into lifeos_quadrant_classification (
    workspace_id, owner_individual_id, commitment_id, important, urgent, provenance_source, provenance_ref, created_by
  ) values (
    new.workspace_id, new.owner_individual_id, new.id, new.important, new.urgent, new.provenance_source, new.provenance_ref, new.updated_by
  );
  return null;
end;
$$;

-- Append-only, with the cascade allowance so a parent row can still be removed by a proper process.
create or replace function lifeos_refuse_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'lifeos: % is append-only', tg_table_name using errcode = 'LO400';
end;
$$;

create or replace function lifeos_guard_personal_membership() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  w_kind text;
  w_owner uuid;
begin
  select kind, owner_individual_id into w_kind, w_owner from lifeos_workspace where id = new.workspace_id;
  if w_kind = 'personal' and new.individual_id <> w_owner then
    raise exception 'lifeos: a personal workspace has one member, its owner' using errcode = 'LO400';
  end if;
  return new;
end;
$$;

create or replace trigger lifeos_stamp_individual before insert or update on lifeos_individual for each row execute function lifeos_stamp();
create or replace trigger lifeos_stamp_identity_link before insert or update on lifeos_identity_link for each row execute function lifeos_stamp('individual_id', 'issuer', 'subject');
create or replace trigger lifeos_stamp_tenant before insert or update on lifeos_tenant for each row execute function lifeos_stamp('kind');
create or replace trigger lifeos_stamp_workspace before insert or update on lifeos_workspace for each row execute function lifeos_stamp('kind', 'tenant_id');
create or replace trigger lifeos_stamp_entitlement before insert or update on lifeos_entitlement for each row execute function lifeos_stamp('individual_id', 'source', 'tenant_id');
create or replace trigger lifeos_stamp_membership before insert or update on lifeos_membership for each row execute function lifeos_stamp('individual_id');
create or replace trigger lifeos_stamp_world before insert or update on lifeos_world for each row execute function lifeos_stamp();
create or replace trigger lifeos_stamp_goal before insert or update on lifeos_goal for each row execute function lifeos_stamp();
create or replace trigger lifeos_stamp_project before insert or update on lifeos_project for each row execute function lifeos_stamp();
create or replace trigger lifeos_stamp_commitment before insert or update on lifeos_commitment for each row execute function lifeos_stamp();
create or replace trigger lifeos_stamp_delegation before insert or update on lifeos_delegation for each row execute function lifeos_stamp('commitment_id');
create or replace trigger lifeos_stamp_connection before insert or update on lifeos_integration_connection for each row execute function lifeos_stamp('provider');
create or replace trigger lifeos_stamp_calendar_event before insert or update on lifeos_calendar_event for each row execute function lifeos_stamp();
create or replace trigger lifeos_stamp_protected_block before insert or update on lifeos_protected_block for each row execute function lifeos_stamp();
create or replace trigger lifeos_stamp_weekly_plan before insert or update on lifeos_weekly_plan for each row execute function lifeos_stamp('week_start');
create or replace trigger lifeos_stamp_big_rock before insert or update on lifeos_big_rock for each row execute function lifeos_stamp('weekly_plan_id', 'commitment_id');
create or replace trigger lifeos_stamp_weekly_review before insert or update on lifeos_weekly_review for each row execute function lifeos_stamp('week_start');
create or replace trigger lifeos_stamp_grant before insert or update on lifeos_permission_grant for each row execute function lifeos_stamp('grantee_individual_id', 'resource_type', 'resource_id');
create or replace trigger lifeos_stamp_suggestion before insert or update on lifeos_suggestion for each row execute function lifeos_stamp('kind', 'generator', 'dedupe_key');

create or replace trigger lifeos_audit_individual after insert or update on lifeos_individual for each row execute function lifeos_audit('individual');
create or replace trigger lifeos_audit_identity_link after insert or update on lifeos_identity_link for each row execute function lifeos_audit('identity_link');
create or replace trigger lifeos_audit_tenant after insert or update on lifeos_tenant for each row execute function lifeos_audit('tenant');
create or replace trigger lifeos_audit_workspace after insert or update on lifeos_workspace for each row execute function lifeos_audit('workspace');
create or replace trigger lifeos_audit_entitlement after insert or update on lifeos_entitlement for each row execute function lifeos_audit('entitlement');
create or replace trigger lifeos_audit_membership after insert or update on lifeos_membership for each row execute function lifeos_audit('membership');
create or replace trigger lifeos_audit_world after insert or update on lifeos_world for each row execute function lifeos_audit('world');
create or replace trigger lifeos_audit_goal after insert or update on lifeos_goal for each row execute function lifeos_audit('goal');
create or replace trigger lifeos_audit_project after insert or update on lifeos_project for each row execute function lifeos_audit('project');
create or replace trigger lifeos_audit_commitment after insert or update on lifeos_commitment for each row execute function lifeos_audit('commitment');
create or replace trigger lifeos_audit_delegation after insert or update on lifeos_delegation for each row execute function lifeos_audit('delegation');
create or replace trigger lifeos_audit_connection after insert or update on lifeos_integration_connection for each row execute function lifeos_audit('integration_connection');
create or replace trigger lifeos_audit_calendar_event after insert or update on lifeos_calendar_event for each row execute function lifeos_audit('calendar_event');
create or replace trigger lifeos_audit_protected_block after insert or update on lifeos_protected_block for each row execute function lifeos_audit('protected_block');
create or replace trigger lifeos_audit_weekly_plan after insert or update on lifeos_weekly_plan for each row execute function lifeos_audit('weekly_plan');
create or replace trigger lifeos_audit_big_rock after insert or update on lifeos_big_rock for each row execute function lifeos_audit('big_rock');
create or replace trigger lifeos_audit_weekly_review after insert or update on lifeos_weekly_review for each row execute function lifeos_audit('weekly_review');
create or replace trigger lifeos_audit_grant after insert or update on lifeos_permission_grant for each row execute function lifeos_audit('permission_grant');
create or replace trigger lifeos_audit_suggestion after insert or update on lifeos_suggestion for each row execute function lifeos_audit('suggestion');

create or replace trigger lifeos_log_quadrant_commitment after insert or update of important, urgent on lifeos_commitment for each row execute function lifeos_log_quadrant();
create or replace trigger lifeos_append_only_audit before update or delete on lifeos_audit_event for each row execute function lifeos_refuse_change();
create or replace trigger lifeos_append_only_quadrant before update or delete on lifeos_quadrant_classification for each row execute function lifeos_refuse_change();
create or replace trigger lifeos_guard_membership before insert or update on lifeos_membership for each row execute function lifeos_guard_personal_membership();


-- ---- 15. the one writer ------------------------------------------------------------------------------------------
-- A batch of inserts and updates and its idempotency record commit together or not at all. Two concurrent
-- retries serialise on the primary key of lifeos_idempotency, so there is no pending state to get stuck in.
-- All business rules are in the service. This function only writes, and only to the tables named here.
--
-- Error codes: LO400 malformed, LO404 no such row, LO409 stale version, LO410 key reused with a new body.

create or replace function lifeos_mutate(
  p_actor uuid,
  p_actor_kind text,
  p_idempotency_key text,
  p_request_hash text,
  p_trace_id text,
  p_ops jsonb
) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  allowed text[] := array[
    'lifeos_individual', 'lifeos_identity_link', 'lifeos_tenant', 'lifeos_workspace', 'lifeos_membership',
    'lifeos_world', 'lifeos_goal', 'lifeos_project', 'lifeos_commitment', 'lifeos_delegation',
    'lifeos_integration_connection', 'lifeos_calendar_event', 'lifeos_protected_block', 'lifeos_weekly_plan',
    'lifeos_big_rock', 'lifeos_weekly_review', 'lifeos_permission_grant', 'lifeos_suggestion', 'lifeos_entitlement'
  ];
  no_workspace_column text[] := array['lifeos_individual', 'lifeos_identity_link', 'lifeos_tenant', 'lifeos_workspace', 'lifeos_entitlement'];
  protected_on_update text[] := array['id', 'workspace_id', 'created_at', 'created_by', 'version', 'updated_at', 'schema_version'];
  existing lifeos_idempotency%rowtype;
  op jsonb;
  t text;
  kind text;
  vals jsonb;
  keys text[];
  valid text[];
  cols text;
  sql_text text;
  row_out jsonb;
  rows_out jsonb := '[]'::jsonb;
  refs jsonb := '[]'::jsonb;
  op_id uuid;
  op_ws uuid;
  op_ver integer;
begin
  if p_actor_kind not in ('user', 'ai', 'integration', 'system') then
    raise exception 'lifeos: bad actor kind' using errcode = 'LO400';
  end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'lifeos: ops must be a non-empty array' using errcode = 'LO400';
  end if;
  perform set_config('lifeos.actor_kind', p_actor_kind, true);
  perform set_config('lifeos.trace_id', coalesce(p_trace_id, ''), true);

  if p_idempotency_key is not null then
    if p_actor is null or p_request_hash is null then
      raise exception 'lifeos: an idempotent write needs an actor and a request hash' using errcode = 'LO400';
    end if;
    insert into lifeos_idempotency (actor_individual_id, idempotency_key, request_hash)
      values (p_actor, p_idempotency_key, p_request_hash)
      on conflict (actor_individual_id, idempotency_key) do nothing;
    if not found then
      select * into existing from lifeos_idempotency
        where actor_individual_id = p_actor and idempotency_key = p_idempotency_key for update;
      if existing.expires_at > now() then
        if existing.request_hash <> p_request_hash then
          raise exception 'lifeos: idempotency key reused with a different request' using errcode = 'LO410';
        end if;
        return jsonb_build_object('replayed', true, 'refs', coalesce(existing.result, '[]'::jsonb), 'rows', '[]'::jsonb);
      end if;
      update lifeos_idempotency
        set request_hash = p_request_hash, result = null, created_at = now(), expires_at = now() + interval '24 hours'
        where actor_individual_id = p_actor and idempotency_key = p_idempotency_key;
    end if;
  end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    t := op ->> 't';
    kind := op ->> 'op';
    vals := coalesce(op -> 'values', '{}'::jsonb);
    if t is null or not (t = any (allowed)) then
      raise exception 'lifeos: table not writable' using errcode = 'LO400';
    end if;
    if kind = 'insert' then
      if p_actor is not null then
        vals := vals || jsonb_build_object('created_by', p_actor, 'updated_by', p_actor);
      end if;
    elsif kind = 'update' then
      if p_actor is not null then
        vals := vals || jsonb_build_object('updated_by', p_actor);
      end if;
    else
      raise exception 'lifeos: unknown op' using errcode = 'LO400';
    end if;

    select array_agg(k) into keys from jsonb_object_keys(vals) as k;
    select array_agg(column_name::text) into valid from information_schema.columns
      where table_schema = 'public' and table_name::text = t and is_generated = 'NEVER' and is_identity = 'NO'
        and column_name::text = any (keys)
        and (kind = 'insert' or not (column_name::text = any (protected_on_update)));
    if coalesce(array_length(valid, 1), 0) <> coalesce(array_length(keys, 1), 0) then
      raise exception 'lifeos: a column is unknown or protected on %', t using errcode = 'LO400';
    end if;
    select string_agg(quote_ident(c), ', ') into cols from unnest(valid) as c;

    if kind = 'insert' then
      sql_text := format(
        'insert into %1$I (%2$s) select %2$s from jsonb_populate_record(null::%1$I, $1) returning to_jsonb(%1$I.*)', t, cols
      );
      execute sql_text into row_out using vals;
    else
      op_id := (op ->> 'id')::uuid;
      op_ws := (op ->> 'workspace_id')::uuid;
      op_ver := (op ->> 'expected_version')::integer;
      if op_id is null then
        raise exception 'lifeos: an update needs an id' using errcode = 'LO400';
      end if;
      if t = any (no_workspace_column) then
        sql_text := format(
          'update %1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::%1$I, $1)) where id = $2 and ($4::integer is null or version = $4) returning to_jsonb(%1$I.*)',
          t, cols
        );
      else
        if op_ws is null then
          raise exception 'lifeos: an update on % needs a workspace', t using errcode = 'LO400';
        end if;
        sql_text := format(
          'update %1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::%1$I, $1)) where id = $2 and workspace_id = $3 and ($4::integer is null or version = $4) returning to_jsonb(%1$I.*)',
          t, cols
        );
      end if;
      row_out := null;
      execute sql_text into row_out using vals, op_id, op_ws, op_ver;
      if row_out is null then
        if op_ver is not null then
          execute format('select to_jsonb(%1$I.*) from %1$I where id = $1', t) into row_out using op_id;
          if row_out is not null then
            raise exception 'lifeos: the record has changed since it was read' using errcode = 'LO409';
          end if;
        end if;
        raise exception 'lifeos: no such record' using errcode = 'LO404';
      end if;
    end if;
    rows_out := rows_out || jsonb_build_array(row_out);
    refs := refs || jsonb_build_array(jsonb_build_object('t', t, 'id', row_out ->> 'id'));
  end loop;

  if p_idempotency_key is not null then
    update lifeos_idempotency set result = refs
      where actor_individual_id = p_actor and idempotency_key = p_idempotency_key;
  end if;
  return jsonb_build_object('replayed', false, 'refs', refs, 'rows', rows_out);
end;
$$;

-- Fixed window per subject and bucket, atomic, on the database clock. One row per pair, so it does not grow.
create or replace function lifeos_rate_take(p_subject text, p_bucket text, p_max integer, p_window_seconds integer) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  w_hits integer;
  w_start timestamptz;
begin
  insert into lifeos_rate_window as w (subject, bucket, window_start, hits)
    values (p_subject, p_bucket, now(), 1)
    on conflict (subject, bucket) do update set
      window_start = case when w.window_start + make_interval(secs => p_window_seconds) <= now() then now() else w.window_start end,
      hits = case when w.window_start + make_interval(secs => p_window_seconds) <= now() then 1 else w.hits + 1 end
    returning hits, window_start into w_hits, w_start;
  return jsonb_build_object(
    'allowed', w_hits <= p_max,
    'retry_after', greatest(1, ceil(extract(epoch from (w_start + make_interval(secs => p_window_seconds) - now())))::integer)
  );
end;
$$;


-- ---- 16. the door: RLS on, zero policies, service role only -----------------------------------------------------------

alter table lifeos_flag enable row level security;
alter table lifeos_individual enable row level security;
alter table lifeos_identity_link enable row level security;
alter table lifeos_entitlement enable row level security;
alter table lifeos_tenant enable row level security;
alter table lifeos_workspace enable row level security;
alter table lifeos_membership enable row level security;
alter table lifeos_world enable row level security;
alter table lifeos_goal enable row level security;
alter table lifeos_project enable row level security;
alter table lifeos_commitment enable row level security;
alter table lifeos_quadrant_classification enable row level security;
alter table lifeos_delegation enable row level security;
alter table lifeos_integration_connection enable row level security;
alter table lifeos_calendar_event enable row level security;
alter table lifeos_protected_block enable row level security;
alter table lifeos_weekly_plan enable row level security;
alter table lifeos_big_rock enable row level security;
alter table lifeos_weekly_review enable row level security;
alter table lifeos_permission_grant enable row level security;
alter table lifeos_suggestion enable row level security;
alter table lifeos_audit_event enable row level security;
alter table lifeos_idempotency enable row level security;
alter table lifeos_rate_window enable row level security;

revoke all on lifeos_flag, lifeos_individual, lifeos_identity_link, lifeos_entitlement, lifeos_live_entitlement, lifeos_tenant, lifeos_workspace, lifeos_membership,
  lifeos_world, lifeos_goal, lifeos_project, lifeos_commitment, lifeos_quadrant_classification, lifeos_delegation,
  lifeos_integration_connection, lifeos_calendar_event, lifeos_protected_block, lifeos_weekly_plan, lifeos_big_rock,
  lifeos_weekly_review, lifeos_permission_grant, lifeos_live_grant, lifeos_suggestion, lifeos_audit_event,
  lifeos_idempotency, lifeos_live_idempotency, lifeos_rate_window
  from anon, authenticated;

revoke all on function lifeos_mutate(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function lifeos_rate_take(text, text, integer, integer) from public, anon, authenticated;
grant execute on function lifeos_mutate(uuid, text, text, text, text, jsonb) to service_role;
grant execute on function lifeos_rate_take(text, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
