-- 036: Learner Support stores — coaching/meeting sessions, interventions and
-- referrals (Educator Workspace Learner Support spec; replaces the last four
-- soon-rows). One sessions table powers both Coaching Sessions and
-- Meetings & Follow-ups via session_type.
create table if not exists support_sessions (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete set null,
  nurse_id       uuid not null references profiles(id) on delete cascade,
  educator_id    uuid references profiles(id) on delete set null,
  educator_name  text,
  session_type   text not null default 'coaching'
                   check (session_type in ('coaching','progress_review','validation_meeting','other')),
  scheduled_for  timestamptz not null,
  focus          text,
  goals          text,
  notes          text,
  follow_up_date date,
  status         text not null default 'scheduled'
                   check (status in ('scheduled','completed','cancelled')),
  created_at     timestamptz not null default now()
);
create index if not exists idx_support_sessions on support_sessions(hospital_id, status, scheduled_for);

create table if not exists interventions (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete set null,
  nurse_id        uuid not null references profiles(id) on delete cascade,
  competency_name text,
  reason          text not null,
  objectives      text,
  activities      text,
  review_date     date,
  status          text not null default 'planned'
                    check (status in ('planned','in_progress','review','completed')),
  outcome         text check (outcome in ('successful','partially_successful','unsuccessful')),
  outcome_note    text,
  created_by      uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index if not exists idx_interventions on interventions(hospital_id, status, review_date);

create table if not exists referrals (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid references hospitals(id) on delete set null,
  nurse_id         uuid not null references profiles(id) on delete cascade,
  referred_to_id   uuid references profiles(id) on delete set null,
  referred_to_text text,
  reason           text not null,
  urgency          text not null default 'medium' check (urgency in ('low','medium','high')),
  status           text not null default 'open'
                     check (status in ('open','accepted','resolved','declined')),
  resolution_note  text,
  created_by       uuid references profiles(id) on delete set null,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create index if not exists idx_referrals on referrals(hospital_id, status, created_at desc);

alter table support_sessions enable row level security;
alter table interventions    enable row level security;
alter table referrals        enable row level security;

do $$ begin
  create policy support_sessions_select_involved on support_sessions
    for select using (nurse_id = auth.uid() or educator_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy interventions_select_involved on interventions
    for select using (nurse_id = auth.uid() or created_by = auth.uid());
exception when duplicate_object then null; end $$;
-- Referrals stay off-limits to the learner by design (sensitive): only the
-- referrer and the referee can read their row directly.
do $$ begin
  create policy referrals_select_involved on referrals
    for select using (created_by = auth.uid() or referred_to_id = auth.uid());
exception when duplicate_object then null; end $$;
-- No client insert/update policies: writes go through /api/support/* (service role).
