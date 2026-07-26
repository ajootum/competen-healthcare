-- Migration 107: Platform Priority & Execution Framework (PPE-000..008)
-- The strategic orchestration layer for Competen — organisational objectives, strategic themes, cascading
-- priorities with hierarchy inheritance, key results, campaigns/initiatives, goal-to-action generated work,
-- governance approvals and an immutable audit trail. The scope model is (scope_type, scope_ref) mirroring the
-- workspace-config hierarchy: platform < enterprise < hospital < department < team < user. Super-admins author
-- platform/enterprise strategy; it cascades and resolves per context at runtime (src/lib/priorities/engine.ts).
-- Writes go through the service-role API layer with in-code role enforcement; RLS is defence-in-depth — priorities
-- are meant to cascade so authenticated users may READ, and only the service role writes.

-- ── Strategic themes (top-level strategic pillars, e.g. "Quality First", "Patient Safety")
create table if not exists ppe_strategic_themes (
  id          uuid primary key default gen_random_uuid(),
  scope_type  text not null default 'platform' check (scope_type in ('platform','enterprise','hospital','department','team','user')),
  scope_ref   uuid,
  name        text not null,
  description text,
  color       text not null default '#0ea5e9',
  icon        text,
  status      text not null default 'active' check (status in ('active','archived')),
  sort_order  int not null default 0,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ── Objectives / OKRs (strategic goals; cascade via parent_id to lower-level objectives)
create table if not exists ppe_objectives (
  id              uuid primary key default gen_random_uuid(),
  scope_type      text not null default 'platform' check (scope_type in ('platform','enterprise','hospital','department','team','user')),
  scope_ref       uuid,
  theme_id        uuid references ppe_strategic_themes(id) on delete set null,
  parent_id       uuid references ppe_objectives(id) on delete set null,
  framework       text not null default 'okr' check (framework in ('okr','bsc','custom')),
  title           text not null,
  description     text,
  owner_id        uuid references profiles(id) on delete set null,
  timeframe_start date,
  timeframe_end   date,
  target_pct      numeric,
  progress_pct    numeric not null default 0,
  status          text not null default 'draft' check (status in ('draft','pending','published','archived')),
  version         int not null default 1,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ── Key results (measurable outcomes under an objective)
create table if not exists ppe_key_results (
  id           uuid primary key default gen_random_uuid(),
  objective_id uuid not null references ppe_objectives(id) on delete cascade,
  title        text not null,
  metric       text,
  unit         text,
  baseline     numeric,
  target       numeric,
  current      numeric,
  status       text not null default 'on_track' check (status in ('on_track','at_risk','off_track','achieved')),
  created_at   timestamptz not null default now()
);

-- ── Priorities (the cascading strategic priorities resolved into every workspace)
create table if not exists ppe_priorities (
  id                uuid primary key default gen_random_uuid(),
  scope_type        text not null default 'platform' check (scope_type in ('platform','enterprise','hospital','department','team','user')),
  scope_ref         uuid,
  theme_id          uuid references ppe_strategic_themes(id) on delete set null,
  objective_id      uuid references ppe_objectives(id) on delete set null,
  title             text not null,
  description       text,
  category          text,
  mandatory         boolean not null default false,
  base_weight       int not null default 50,
  urgency           text not null default 'medium' check (urgency in ('low','medium','high','critical')),
  inheritance_mode  text not null default 'cascade' check (inheritance_mode in ('cascade','reference','local','block')),
  audience          jsonb not null default '{}'::jsonb,   -- {roles:[],workspaces:[],specialties:[]}
  valid_from        date,
  valid_to          date,
  status            text not null default 'draft' check (status in ('draft','pending','published','archived')),
  source_scope_type text,
  source_scope_ref  uuid,
  version           int not null default 1,
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ── Priority acknowledgements (per-user, for mandatory priorities)
create table if not exists ppe_priority_ack (
  id              uuid primary key default gen_random_uuid(),
  priority_id     uuid not null references ppe_priorities(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (priority_id, user_id)
);

-- ── Campaigns / initiatives (time-bound programmes advancing objectives)
create table if not exists ppe_campaigns (
  id           uuid primary key default gen_random_uuid(),
  scope_type   text not null default 'platform' check (scope_type in ('platform','enterprise','hospital','department','team','user')),
  scope_ref    uuid,
  theme_id     uuid references ppe_strategic_themes(id) on delete set null,
  objective_id uuid references ppe_objectives(id) on delete set null,
  name         text not null,
  description  text,
  status       text not null default 'planned' check (status in ('planned','active','paused','completed','cancelled')),
  start_date   date,
  end_date     date,
  progress_pct numeric not null default 0,
  budget       numeric,
  sponsor_id   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ── Generated actions (goal-to-action translation output; the execution bridge)
create table if not exists ppe_actions (
  id                uuid primary key default gen_random_uuid(),
  priority_id       uuid references ppe_priorities(id) on delete cascade,
  objective_id      uuid references ppe_objectives(id) on delete set null,
  campaign_id       uuid references ppe_campaigns(id) on delete set null,
  action_type       text not null default 'task' check (action_type in ('task','learning','audit','competency','notification','dashboard','report')),
  title             text not null,
  target_scope_type text,
  target_scope_ref  uuid,
  status            text not null default 'generated' check (status in ('generated','assigned','in_progress','completed','cancelled')),
  created_at        timestamptz not null default now()
);

-- ── Governance approvals (workflow steps for objectives / priorities / campaigns / themes)
create table if not exists ppe_approvals (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null check (entity_type in ('objective','priority','campaign','theme')),
  entity_id       uuid not null,
  entity_title    text,
  scope_type      text,
  scope_ref       uuid,
  workflow        text not null default 'standard',
  step            int not null default 1,
  total_steps     int not null default 1,
  state           text not null default 'pending' check (state in ('pending','approved','rejected','changes_requested')),
  requested_by    uuid references profiles(id) on delete set null,
  decided_by      uuid references profiles(id) on delete set null,
  decision_reason text,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz
);

-- ── Immutable audit trail (every strategic change)
create table if not exists ppe_audit (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  actor_id    uuid references profiles(id) on delete set null,
  detail      text,
  scope_type  text,
  scope_ref   uuid,
  created_at  timestamptz not null default now()
);

-- ── Indexes
create index if not exists idx_ppe_themes_scope on ppe_strategic_themes(scope_type, scope_ref);
create index if not exists idx_ppe_obj_scope on ppe_objectives(scope_type, scope_ref, status);
create index if not exists idx_ppe_obj_theme on ppe_objectives(theme_id);
create index if not exists idx_ppe_obj_parent on ppe_objectives(parent_id);
create index if not exists idx_ppe_kr_obj on ppe_key_results(objective_id);
create index if not exists idx_ppe_prio_scope on ppe_priorities(scope_type, scope_ref, status);
create index if not exists idx_ppe_prio_theme on ppe_priorities(theme_id);
create index if not exists idx_ppe_ack_prio on ppe_priority_ack(priority_id);
create index if not exists idx_ppe_camp_scope on ppe_campaigns(scope_type, scope_ref, status);
create index if not exists idx_ppe_actions_prio on ppe_actions(priority_id);
create index if not exists idx_ppe_appr_state on ppe_approvals(state, entity_type);
create index if not exists idx_ppe_audit_entity on ppe_audit(entity_type, entity_id, created_at desc);

-- ── RLS (defence-in-depth). Priorities cascade platform-wide, so authenticated users may READ; only the
-- service-role API layer writes (it bypasses RLS). Tenant scoping on reads is applied in the resolution engine.
-- Explicit per-table statements (no PL/pgSQL block) so any SQL runner / statement splitter applies them cleanly.
alter table ppe_strategic_themes enable row level security;
alter table ppe_objectives       enable row level security;
alter table ppe_key_results      enable row level security;
alter table ppe_priorities       enable row level security;
alter table ppe_priority_ack     enable row level security;
alter table ppe_campaigns        enable row level security;
alter table ppe_actions          enable row level security;
alter table ppe_approvals        enable row level security;
alter table ppe_audit            enable row level security;

drop policy if exists ppe_themes_read on ppe_strategic_themes;
create policy ppe_themes_read on ppe_strategic_themes for select to authenticated using (true);
drop policy if exists ppe_objectives_read on ppe_objectives;
create policy ppe_objectives_read on ppe_objectives for select to authenticated using (true);
drop policy if exists ppe_kr_read on ppe_key_results;
create policy ppe_kr_read on ppe_key_results for select to authenticated using (true);
drop policy if exists ppe_priorities_read on ppe_priorities;
create policy ppe_priorities_read on ppe_priorities for select to authenticated using (true);
drop policy if exists ppe_ack_read on ppe_priority_ack;
create policy ppe_ack_read on ppe_priority_ack for select to authenticated using (true);
drop policy if exists ppe_campaigns_read on ppe_campaigns;
create policy ppe_campaigns_read on ppe_campaigns for select to authenticated using (true);
drop policy if exists ppe_actions_read on ppe_actions;
create policy ppe_actions_read on ppe_actions for select to authenticated using (true);
drop policy if exists ppe_approvals_read on ppe_approvals;
create policy ppe_approvals_read on ppe_approvals for select to authenticated using (true);
drop policy if exists ppe_audit_read on ppe_audit;
create policy ppe_audit_read on ppe_audit for select to authenticated using (true);
