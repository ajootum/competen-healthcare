-- 090: LDS-005 Education Planning Centre — core operational stores. Education Planning is a NEW domain
-- (formal education plans, milestones, study leave, sponsorship) with no existing tables. This adds the
-- bounded core the Overview dashboard + create surface need; the fuller domain (programme applications,
-- institutional partnerships, qualification verification, pipeline analytics) is a later phase.
--
--   • education_plans      — a staff member's formal education plan (programme, institution, mode, dates,
--     objective, status, progress). LDS-004 alignment via the owner's career readiness.
--   • education_milestones — planned academic milestones per plan (name, planned date, status).
--   • study_leave_requests — study-leave request per plan/staff (type, days, dates, decision).
--   • sponsorship_requests — funding/sponsorship per plan/staff (source, amount, decision, disbursement).
--
-- Business rules baked in (LDS-005 §9): sponsorship approval is separate from disbursement (status
-- has both); study leave carries a workforce-impact decision; server timestamps; every decision audited
-- via the API. Idempotent; RLS enabled, service-role only — reads/writes via the audited education API.

create table if not exists education_plans (
  id                  uuid primary key default gen_random_uuid(),
  hospital_id         uuid not null references hospitals(id) on delete cascade,
  user_id             uuid not null references profiles(id) on delete cascade,
  programme_title     text not null,
  institution         text,
  study_mode          text check (study_mode is null or study_mode in ('full_time','part_time','blended','online','distance')),
  start_date          date,
  expected_completion date,
  objective           text,
  adviser             text,
  status              text not null default 'active' check (status in ('draft','active','on_hold','completed','withdrawn')),
  progress_pct        integer not null default 0 check (progress_pct >= 0 and progress_pct <= 100),
  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_edu_plans_hosp on education_plans(hospital_id, status);
create index if not exists idx_edu_plans_user on education_plans(user_id);

create table if not exists education_milestones (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  plan_id       uuid not null references education_plans(id) on delete cascade,
  name          text not null,
  planned_date  date,
  status        text not null default 'pending' check (status in ('pending','in_progress','completed','overdue')),
  sort_order    integer not null default 0,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_edu_milestones_plan on education_milestones(plan_id, sort_order);

create table if not exists study_leave_requests (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  plan_id      uuid references education_plans(id) on delete set null,
  user_id      uuid not null references profiles(id) on delete cascade,
  leave_type   text not null default 'study' check (leave_type in ('study','exam','placement','research','conference','other')),
  days         numeric(4,1) not null default 0,
  start_date   date,
  end_date     date,
  reason       text,
  status       text not null default 'requested' check (status in ('requested','approved','rejected','cancelled')),
  created_by   uuid references profiles(id) on delete set null,
  decided_by   uuid references profiles(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_study_leave_hosp on study_leave_requests(hospital_id, status);

create table if not exists sponsorship_requests (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  plan_id      uuid references education_plans(id) on delete set null,
  user_id      uuid not null references profiles(id) on delete cascade,
  source       text not null default 'employer' check (source in ('employer','scholarship','self','external','partner')),
  amount       numeric(14,2) not null default 0,
  currency     text not null default 'UGX',
  notes        text,
  status       text not null default 'requested' check (status in ('requested','approved','rejected','disbursed')),
  amount_disbursed numeric(14,2) not null default 0,
  created_by   uuid references profiles(id) on delete set null,
  decided_by   uuid references profiles(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_sponsorship_hosp on sponsorship_requests(hospital_id, status);

do $$
begin
  perform 1;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='education_plans') then execute 'alter table public.education_plans enable row level security'; end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='education_milestones') then execute 'alter table public.education_milestones enable row level security'; end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='study_leave_requests') then execute 'alter table public.study_leave_requests enable row level security'; end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='sponsorship_requests') then execute 'alter table public.sponsorship_requests enable row level security'; end if;
end $$;
