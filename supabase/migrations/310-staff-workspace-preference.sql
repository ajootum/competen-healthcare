-- ============================================================
-- 310: COMP-HQ-ACCESS-001 s7 -- WHERE A MULTI-ASSIGNMENT STAFF MEMBER WAS LAST WORKING
--
-- The Default Context Resolver needs two facts this platform has never stored:
--
--   Returning + multiple assignments -> last valid workspace
--   First login + multiple assignments -> primary assignment if configured, otherwise the chooser
--
-- Single-assignment staff need neither, and they are already served: the gateway resolves DIRECT
-- from what the account holds. This table exists only for people who genuinely hold several.
--
-- WARNING: A CONVENIENCE, NEVER AN AUTHORITY. s10 of the neutral-routing spec states the same rule
-- for products and it holds here: a remembered destination is checked against CURRENT permissions
-- before it is used, and a workspace that is no longer held is ignored rather than opened. Nothing
-- in this table grants anything -- every destination re-authorises itself on arrival, and the row
-- is a hint the resolver may discard.
--
-- WARNING: HREFS, NOT IDS, and deliberately unconstrained. Workspace destinations come from
-- workspaceLinksForUser, which composes role config, catalogue entries and the HQ door -- there is
-- no single table of workspaces to point a foreign key at. A stale href is harmless by the rule
-- above: it is validated against what the account holds today, and dropped when it does not match.
--
-- primary_workspace_href is the ADMINISTERED one (s6's "primary assignment"), last_workspace_href
-- the OBSERVED one. Two columns because they answer different questions and a single column would
-- let the last visit silently overwrite a deliberate assignment.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

create table if not exists plat_staff_workspace_preference (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- Where they were last working, written by the resolver on a successful landing.
  last_workspace_href text,
  last_workspace_at timestamptz,

  -- The assignment an administrator nominated as primary. Never written by ordinary navigation.
  primary_workspace_href text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Both hrefs must look like internal paths. An absolute URL in either column would be an open
-- redirect waiting for a caller careless enough to trust it, and the check costs nothing here.
alter table plat_staff_workspace_preference
  drop constraint if exists ck_staff_pref_last_href;
alter table plat_staff_workspace_preference
  add constraint ck_staff_pref_last_href
  check (last_workspace_href is null
    or (last_workspace_href like '/%' and last_workspace_href not like '//%'));

alter table plat_staff_workspace_preference
  drop constraint if exists ck_staff_pref_primary_href;
alter table plat_staff_workspace_preference
  add constraint ck_staff_pref_primary_href
  check (primary_workspace_href is null
    or (primary_workspace_href like '/%' and primary_workspace_href not like '//%'));

-- ---- Row level security -----------------------------------------------------------------------
-- A staff member may read and write their OWN hint and nobody else's. The service role bypasses
-- RLS as everywhere else in this estate, which is how the resolver writes during a server render.
alter table plat_staff_workspace_preference enable row level security;

drop policy if exists staff_pref_select_own on plat_staff_workspace_preference;
create policy staff_pref_select_own on plat_staff_workspace_preference
  for select using (auth.uid() = user_id);

drop policy if exists staff_pref_insert_own on plat_staff_workspace_preference;
create policy staff_pref_insert_own on plat_staff_workspace_preference
  for insert with check (auth.uid() = user_id);

drop policy if exists staff_pref_update_own on plat_staff_workspace_preference;
create policy staff_pref_update_own on plat_staff_workspace_preference
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
