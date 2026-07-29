-- 144: CDP-008 Competency Assignment & Campaign Manager — learning campaigns. A campaign is a named,
-- time-boxed competency initiative targeting a cohort (role/department/hospital). Launching it materialises a
-- target-based cmo_assignments row (method='campaign') and its compliance is measured live against
-- competency_decisions (who in the cohort has achieved the competency). Complements COMP-018 assignment RULES
-- (standing) with campaign BROADCASTS (one-off, deadline-driven). Plain, idempotent statements only.

create table if not exists cdp_campaigns (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid references hospitals(id) on delete cascade,
  name             text not null,
  description      text,
  competency_id    uuid references framework_competencies(id) on delete set null,
  competency_name  text,
  target_type      text not null default 'role' check (target_type in ('role','department','hospital','enterprise')),
  target_role      text,                              -- matched against profiles.role / roles[]
  target_label     text,                              -- human label, e.g. "ICU Nurses"
  mandatory        boolean not null default false,
  starts_on        date default current_date,
  due_on           date,
  status           text not null default 'draft' check (status in ('draft','active','closed')),
  owner_id         uuid references profiles(id) on delete set null,
  owner_name       text,
  launched_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_cdp_campaigns_hospital on cdp_campaigns(hospital_id);
create index if not exists idx_cdp_campaigns_status on cdp_campaigns(status);

alter table cdp_campaigns enable row level security;
drop policy if exists cdp_campaigns_read on cdp_campaigns;
create policy cdp_campaigns_read on cdp_campaigns for select to authenticated using (true);

notify pgrst, 'reload schema';
