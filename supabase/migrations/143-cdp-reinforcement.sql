-- 143: CDP-004 Microlearning & Reinforcement — spaced-repetition review cards. One card per (learner,
-- competency): the SM-2 state (ease factor, interval, repetitions, next review) that schedules retrieval
-- practice so achieved competencies are retained, not decayed. Cards are generated from competency_decisions
-- (competencies a nurse has achieved) and reviewed by the learner (self-graded recall → SM-2 reschedules).
-- Plain, idempotent statements only. RLS = authenticated read; service-role writes.

create table if not exists cdp_reinforcement_cards (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid references hospitals(id) on delete cascade,
  nurse_id         uuid not null references profiles(id) on delete cascade,
  competency_id    uuid references framework_competencies(id) on delete set null,
  subject          text not null,                     -- competency/topic label
  prompt           text not null,                     -- what to recall (retrieval-practice front)
  ease_factor      real not null default 2.5,         -- SM-2 ease
  interval_days    int  not null default 0,           -- current interval
  repetitions      int  not null default 0,           -- consecutive successful recalls
  next_review_at   date not null default current_date,
  last_reviewed_at timestamptz,
  last_quality     int,                               -- 0..5 recall grade
  reviews          int  not null default 0,
  status           text not null default 'active' check (status in ('active','mastered','suspended')),
  source           text not null default 'manual',    -- decision | assessment_fail | expiry | manual
  created_at       timestamptz not null default now()
);
create index if not exists idx_cdp_reinf_due on cdp_reinforcement_cards(nurse_id, next_review_at);
create index if not exists idx_cdp_reinf_hospital on cdp_reinforcement_cards(hospital_id);
-- one card per (learner, competency); NULL competency_id rows are unrestricted (NULLs distinct in PG).
create unique index if not exists uq_cdp_reinf_nurse_comp on cdp_reinforcement_cards(nurse_id, competency_id);

alter table cdp_reinforcement_cards enable row level security;
drop policy if exists cdp_reinf_read on cdp_reinforcement_cards;
create policy cdp_reinf_read on cdp_reinforcement_cards for select to authenticated using (true);

notify pgrst, 'reload schema';
