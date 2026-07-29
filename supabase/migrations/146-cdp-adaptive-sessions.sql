-- 146: CDP-003 Adaptive Learning — delivery runtime sessions. Migration 136 authored adaptive-exam BLUEPRINTS
-- (item bank, min/max items, start difficulty, pass threshold, SE stop) and noted the real-time delivery
-- engine was the missing runtime. This adds it: a session per (learner, exam) tracking the live ability
-- estimate (theta), standard error, and administered items, so a computerised adaptive test can select the
-- next item by maximum information and stop on the SE rule. Plain, idempotent statements only.

create table if not exists cdp_adaptive_sessions (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete set null,
  exam_id       uuid references cst_adaptive_exams(id) on delete cascade,
  nurse_id      uuid not null references profiles(id) on delete cascade,
  theta         real not null default 0,             -- ability estimate (logit)
  se            real not null default 1,             -- standard error of theta
  administered  int  not null default 0,
  correct       int  not null default 0,
  items         jsonb not null default '[]'::jsonb,  -- [{question_id, b, u}] — enough to re-estimate theta
  status        text not null default 'in_progress' check (status in ('in_progress','complete','abandoned')),
  score_pct     int,
  passed        boolean,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index if not exists idx_cdp_adaptive_nurse on cdp_adaptive_sessions(nurse_id);
create index if not exists idx_cdp_adaptive_exam on cdp_adaptive_sessions(exam_id);

alter table cdp_adaptive_sessions enable row level security;
drop policy if exists cdp_adaptive_read on cdp_adaptive_sessions;
create policy cdp_adaptive_read on cdp_adaptive_sessions for select to authenticated using (true);

notify pgrst, 'reload schema';
