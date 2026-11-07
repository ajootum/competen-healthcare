-- ====================================================================================================
-- MIGRATION 907: LIFEOS PUBLIC API, A TOKEN IS BOUND TO ONE WORKSPACE
--
-- LIFEOS-API-001 delivery step 9, owner decision 7 Nov 2026 after the independent security review. ADR-018.
--
-- APPLY ON STAGING FIRST. It adds one nullable column, two constraints and one view column, and replaces one trigger. It
-- writes no row. With no approved client and no lifeos_public_api flag, no third party can reach anything.
--
-- DEPENDS ON: 901-lifeos-core.sql, 906-lifeos-public-api.sql.
-- ----------------------------------------------------------------------------------------------------
-- A person approves an app for one workspace they choose, so an app connected for work cannot read what they keep in their
-- personal workspace, or the other way round. The binding cannot change after approval. Approving another workspace is a new
-- grant that the person sees and can end separately.
--
-- The column is not called workspace_id, because lifeos_mutate and the audit trigger give that name its own meaning.
--
-- The two rules below hold every new row. The active-needs-a-workspace rule is NOT VALID so that this file writes nothing and
-- never fails on an existing row. Production has no grants when this applies, and the application refuses a token whose grant
-- has no workspace.
-- ====================================================================================================

alter table lifeos_oauth_grant add column if not exists bound_workspace_id uuid;

-- A grant can only be bound to a workspace the person has a membership record in.
alter table lifeos_oauth_grant drop constraint if exists lifeos_oauth_grant_bound_member;
alter table lifeos_oauth_grant add constraint lifeos_oauth_grant_bound_member
  foreign key (bound_workspace_id, individual_id) references lifeos_membership (workspace_id, individual_id);

alter table lifeos_oauth_grant drop constraint if exists lifeos_oauth_grant_active_is_bound;
alter table lifeos_oauth_grant add constraint lifeos_oauth_grant_active_is_bound
  check (status <> 'active' or bound_workspace_id is not null) not valid;

-- The binding joins the fields that cannot change after approval.
create or replace trigger lifeos_stamp_oauth_grant before insert or update on lifeos_oauth_grant
  for each row execute function lifeos_stamp('client_id', 'individual_id', 'bound_workspace_id');

-- The new column is added at the end, so this replaces the view in place and keeps its privileges.
create or replace view lifeos_live_oauth_token with (security_invoker = true) as
  select t.*, g.client_id, g.individual_id, g.scopes,
    (t.access_expires_at > now()) as access_live, (t.refresh_expires_at > now()) as refresh_live,
    g.bound_workspace_id
  from lifeos_oauth_token t join lifeos_oauth_grant g on g.id = t.grant_id
  where t.status = 'active' and g.status = 'active';

revoke all on lifeos_live_oauth_token from anon, authenticated;

notify pgrst, 'reload schema';
