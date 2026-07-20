-- ============================================================
-- RUN ME: Migration 046 - Ward configuration
-- Apply in the Supabase SQL editor (paste all, Run). Idempotent.
-- Adds two config tables the Director of Nursing owns:
--   op_staffing_standards - required staff per unit/shift/role
--   op_round_schedule      - planned clinical rounds per unit/shift
-- Beds already exist (op_beds, migration 038) so no new bed table.
-- RLS is enabled with NO policy: the app uses the service-role client
-- (which bypasses RLS); anon/authenticated get deny-by-default.
-- ============================================================

create table if not exists op_staffing_standards (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  shift_type    text not null default 'any'
                  check (shift_type in ('day','evening','night','long_day','on_call','any')),
  role          text not null
                  check (role in ('charge','nurse','support','float','educator','assessor','doctor','therapist')),
  min_count     int not null default 0 check (min_count >= 0),
  target_ratio  numeric check (target_ratio is null or target_ratio > 0),
  created_by    uuid references profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (hospital_id, department_id, shift_type, role)
);
create index if not exists idx_op_staffing_std_hosp on op_staffing_standards(hospital_id);

create table if not exists op_round_schedule (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  shift_type    text not null default 'any'
                  check (shift_type in ('day','evening','night','long_day','on_call','any')),
  at_time       text not null,
  label         text not null,
  sort          int not null default 0,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_op_round_sched_hosp on op_round_schedule(hospital_id);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_staffing_standards') then
    execute 'alter table public.op_staffing_standards enable row level security';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_round_schedule') then
    execute 'alter table public.op_round_schedule enable row level security';
  end if;
end $$;
