-- 136: CST-036 Adaptive Examination Designer — adaptive exam blueprints. Each blueprint configures the
-- item-pool bank, exam length (min/max items), starting difficulty, mastery threshold and a standard-
-- error stopping rule. The adaptive delivery engine (real-time item selection) is the runtime layer that
-- consumes these blueprints. Plain, idempotent statements only. RLS = authenticated read; service-role writes.

create table if not exists cst_adaptive_exams (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  name              text not null,
  description       text,
  bank_id           uuid references question_banks(id) on delete set null,
  min_items         int not null default 20,
  max_items         int not null default 60,
  start_difficulty  text not null default 'medium' check (start_difficulty in ('easy','medium','hard')),
  pass_threshold    int not null default 70,
  se_stop           numeric not null default 0.30,
  status            text not null default 'draft' check (status in ('draft','active','archived')),
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_cstadapt_hospital on cst_adaptive_exams(hospital_id);
create index if not exists idx_cstadapt_status on cst_adaptive_exams(status);
alter table cst_adaptive_exams enable row level security;
drop policy if exists cst_adaptive_exams_read on cst_adaptive_exams;
create policy cst_adaptive_exams_read on cst_adaptive_exams for select to authenticated using (true);

notify pgrst, 'reload schema';
