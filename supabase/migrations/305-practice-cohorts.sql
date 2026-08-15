-- 305 -- practice cohorts (CPR-PI-001 v2 s6): saved, reusable patient populations.
--
-- A SAVED COHORT STORES THE DEFINITION, NEVER THE MEMBERS. segment_ids reference the CODE registry
-- (segment-registry.ts) -- a registered vocabulary, so every saved filter stays human-readable and
-- a cohort can never become a query nobody can read back. Membership is computed at read time by
-- cohort-engine.ts, because a materialised member list is stale the day after it is written and
-- nobody can see that it is.
--
-- Cohorts are FILTERS, not destinations (v2 s3). Deleting one loses only a saved shortcut, which is
-- why retire is a status rather than a delete -- the audit trail keeps pointing at something real.
--
-- Splitter-safe throughout: plain statements, no functions, no do-blocks.

create table if not exists practice_cohort (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  -- Registered segment ids only. The engine validates against the registry on every read and
  -- refuses ids it does not know, so a stale row cannot quietly widen a population.
  segment_ids text[] not null,
  -- The one parameter the registry declares (no-recent-visit interval). Null = the default.
  no_visit_days integer check (no_visit_days is null or (no_visit_days between 1 and 3650)),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_cohort_ws on practice_cohort(workspace_id, status);

-- One ACTIVE cohort per name per practice. No partial unique index (house rule) -- the sentinel
-- expression keys active rows on the constant and retired rows on their own id, so a retired
-- cohort frees its name without a second index.
create unique index if not exists ux_practice_cohort_name
  on practice_cohort (workspace_id, lower(name), (case when status = 'active' then 'active' else id::text end));

alter table practice_cohort enable row level security;

-- Saving and retiring a cohort is its own permission. Reading segment counts stays under
-- report.view like every other intelligence figure.
insert into practice_role_capabilities (role_code, capability_code) values
  ('practice_owner', 'cohort.manage'),
  ('practitioner', 'cohort.manage')
on conflict (role_code, capability_code) do nothing;

notify pgrst, 'reload schema';
