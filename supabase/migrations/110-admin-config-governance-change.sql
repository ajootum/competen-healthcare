-- Migration 110: UMW Administration & Configuration — Forms, Config, Governance, Change & AI (ADM-005..009).
-- Part 2 of 2 (see 109 for structure/docs/assets). Reuses break_glass (104) for emergency access + profiles.roles.
-- Plain statements only (no do-block). RLS = authenticated read + service-role write.

-- ── Forms / registers / checklists (metadata-driven documentation templates)
create table if not exists adm_forms (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete cascade,
  name          text not null,
  form_type     text not null default 'form' check (form_type in ('form','register','checklist','log')),
  category      text,
  status        text not null default 'draft' check (status in ('active','draft','published','archived')),
  submissions   int not null default 0,
  compliance_pct numeric,
  review_date   date,
  created_at    timestamptz not null default now()
);

-- ── Configuration items (workspace/dashboard/workflow/terminology/notification/integration/branding)
create table if not exists adm_config_items (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  name        text not null,
  config_type text not null default 'workspace' check (config_type in ('workspace','dashboard','workflow','terminology','notification','integration','branding','other')),
  status      text not null default 'active' check (status in ('active','draft','in_review','published','inactive')),
  source      text not null default 'local' check (source in ('inherited','local')),
  runs        int not null default 0,
  created_at  timestamptz not null default now()
);

-- ── Delegations (acting managers / temporary authority / approval delegation)
create table if not exists adm_delegations (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid references hospitals(id) on delete cascade,
  position     text not null,
  delegate_id  uuid references profiles(id) on delete set null,
  delegated_by uuid references profiles(id) on delete set null,
  valid_from   date,
  valid_to     date,
  status       text not null default 'active' check (status in ('active','scheduled','expired','revoked')),
  created_at   timestamptz not null default now()
);

-- ── Change requests + versions (change/release/rollback governance)
create table if not exists adm_changes (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  change_code    text,
  title          text not null,
  change_type    text not null default 'config' check (change_type in ('config','workflow','dashboard','policy','permission','form','asset','rule','ai')),
  author_id      uuid references profiles(id) on delete set null,
  approver       text,
  status         text not null default 'draft' check (status in ('draft','in_review','pending_approval','approved','published','rolled_back','cancelled')),
  risk           text not null default 'low' check (risk in ('low','medium','high')),
  version        text,
  affected_users int not null default 0,
  created_at     timestamptz not null default now()
);

-- ── AI administration recommendations
create table if not exists adm_ai_recommendations (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  title       text not null,
  detail      text,
  category    text not null default 'optimization' check (category in ('governance','configuration','document','asset','optimization','compliance')),
  confidence  numeric,
  impact      text not null default 'medium' check (impact in ('low','medium','high')),
  status      text not null default 'open' check (status in ('open','accepted','dismissed')),
  created_at  timestamptz not null default now()
);

-- ── AI automations
create table if not exists adm_automations (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete cascade,
  name            text not null,
  automation_type text,
  status          text not null default 'active' check (status in ('active','paused','draft')),
  runs            int not null default 0,
  created_at      timestamptz not null default now()
);

-- ── Indexes
create index if not exists idx_adm_forms_hosp on adm_forms(hospital_id, status);
create index if not exists idx_adm_config_hosp on adm_config_items(hospital_id, config_type);
create index if not exists idx_adm_deleg_hosp on adm_delegations(hospital_id, status);
create index if not exists idx_adm_changes_hosp on adm_changes(hospital_id, status);
create index if not exists idx_adm_airec_hosp on adm_ai_recommendations(hospital_id, status);
create index if not exists idx_adm_auto_hosp on adm_automations(hospital_id, status);

-- ── RLS (plain statements)
alter table adm_forms              enable row level security;
alter table adm_config_items       enable row level security;
alter table adm_delegations        enable row level security;
alter table adm_changes            enable row level security;
alter table adm_ai_recommendations enable row level security;
alter table adm_automations        enable row level security;

drop policy if exists adm_forms_read on adm_forms;
create policy adm_forms_read on adm_forms for select to authenticated using (true);
drop policy if exists adm_config_read on adm_config_items;
create policy adm_config_read on adm_config_items for select to authenticated using (true);
drop policy if exists adm_deleg_read on adm_delegations;
create policy adm_deleg_read on adm_delegations for select to authenticated using (true);
drop policy if exists adm_changes_read on adm_changes;
create policy adm_changes_read on adm_changes for select to authenticated using (true);
drop policy if exists adm_airec_read on adm_ai_recommendations;
create policy adm_airec_read on adm_ai_recommendations for select to authenticated using (true);
drop policy if exists adm_auto_read on adm_automations;
create policy adm_auto_read on adm_automations for select to authenticated using (true);
