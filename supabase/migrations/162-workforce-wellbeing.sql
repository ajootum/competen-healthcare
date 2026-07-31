-- 162: Workforce Wellbeing & Fatigue Management (UMW-WFM-003).
--
-- WHAT ALREADY EXISTS, and is NOT duplicated here: fatigue exposure is COMPUTED from rostered shifts
-- (op_shifts + op_shift_staff) by src/lib/workforce/fatigue.ts; overtime and rest come from
-- op_roster_actuals and op_attendance_events; break compliance from op_staff_breaks; sick leave from
-- op_leave_records. All five stores are live. This migration adds only the four things with NO store at
-- all: wellbeing check-ins, burnout assessments, occupational health referrals and wellbeing action plans.
--
-- PRIVACY IS THE LOAD-BEARING DESIGN DECISION HERE.
--
-- A wellbeing check-in is a person telling their employer how they are coping. A unit-manager dashboard
-- listing named staff by mood score would be surveillance, not care, and would stop people answering
-- honestly - which destroys the data as well as the trust. So:
--
--   * every check-in carries an explicit `visibility` chosen BY THE STAFF MEMBER
--   * 'private' means aggregate-only: it counts toward unit averages and distributions, and the manager
--     surface must never show who it belongs to
--   * only 'manager' or 'occupational_health' rows may be attributed to a person on a manager surface
--   * the default is 'private' - consent is opt-IN, never assumed by omission
--
-- Burnout assessments and occupational-health referrals are clinical/HR records rather than self-reports,
-- so they are attributable by nature; access is limited by role at the query layer.
--
-- Plain idempotent statements only (no do-blocks). RLS = a user reads their OWN rows; service-role writes.

-- 1. Wellbeing check-ins (self-reported) --------------------------------------------------------------
create table if not exists op_wellbeing_checkins (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  unit_id        uuid references units(id) on delete set null,
  staff_id       uuid not null references profiles(id) on delete cascade,
  checkin_date   date not null default current_date,
  -- Five 1-5 dimensions. 1 is worst, 5 is best, so a LOW score means someone needs support.
  energy         int check (energy between 1 and 5),
  workload       int check (workload between 1 and 5),
  support        int check (support between 1 and 5),
  sleep_quality  int check (sleep_quality between 1 and 5),
  mood           int check (mood between 1 and 5),
  comment        text,
  visibility     text not null default 'private'
                   check (visibility in ('private','manager','occupational_health')),
  created_at     timestamptz not null default now(),
  -- One check-in per person per day; a re-submission updates rather than stacking.
  unique (staff_id, checkin_date)
);

create index if not exists idx_wellbeing_checkins_unit on op_wellbeing_checkins(hospital_id, checkin_date desc);
create index if not exists idx_wellbeing_checkins_staff on op_wellbeing_checkins(staff_id, checkin_date desc);

-- 2. Burnout assessments -------------------------------------------------------------------------------
create table if not exists op_burnout_assessments (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  unit_id        uuid references units(id) on delete set null,
  staff_id       uuid not null references profiles(id) on delete cascade,
  -- The instrument is recorded so a score is never compared across incompatible scales.
  instrument     text not null default 'custom'
                   check (instrument in ('cbi','mbi','ovbi','custom')),
  scores         jsonb,                        -- per-subscale, shape depends on the instrument
  total_score    numeric,
  risk_band      text not null default 'low'
                   check (risk_band in ('low','moderate','high','severe')),
  assessed_at    timestamptz not null default now(),
  assessed_by    uuid references profiles(id) on delete set null,
  assessed_by_name text,
  follow_up_required boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_burnout_staff on op_burnout_assessments(staff_id, assessed_at desc);
create index if not exists idx_burnout_unit on op_burnout_assessments(hospital_id, risk_band, assessed_at desc);

-- 3. Occupational health referrals ---------------------------------------------------------------------
create table if not exists op_occupational_referrals (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  unit_id        uuid references units(id) on delete set null,
  staff_id       uuid not null references profiles(id) on delete cascade,
  reason         text not null,
  category       text not null default 'other'
                   check (category in ('fatigue','burnout','musculoskeletal','psychological',
                                       'infection_exposure','sharps_injury','workplace_stress','other')),
  urgency        text not null default 'routine'
                   check (urgency in ('routine','soon','urgent','immediate')),
  status         text not null default 'referred'
                   check (status in ('referred','acknowledged','in_assessment','plan_agreed','closed','declined')),
  referred_by    uuid references profiles(id) on delete set null,
  referred_by_name text,
  referred_at    timestamptz not null default now(),
  -- Self-referral matters clinically and is recorded rather than inferred from who created the row.
  self_referred  boolean not null default false,
  outcome        text,
  closed_at      timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_occ_referrals_unit on op_occupational_referrals(hospital_id, status, referred_at desc);
create index if not exists idx_occ_referrals_staff on op_occupational_referrals(staff_id, referred_at desc);

-- 4. Wellbeing action plans ----------------------------------------------------------------------------
-- May belong to a PERSON or to a whole unit/team, so staff_id is nullable and scope says which.
create table if not exists op_wellbeing_plans (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  unit_id        uuid references units(id) on delete set null,
  staff_id       uuid references profiles(id) on delete cascade,
  scope          text not null default 'individual' check (scope in ('individual','team','unit')),
  trigger        text not null default 'other'
                   check (trigger in ('fatigue_flag','burnout_assessment','checkin_trend','sick_leave',
                                      'occupational_referral','manager_concern','self_requested','other')),
  goal           text not null,
  actions        text,
  owner_id       uuid references profiles(id) on delete set null,
  owner_name     text,
  status         text not null default 'open'
                   check (status in ('open','in_progress','review_due','completed','cancelled')),
  review_date    date,
  outcome        text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists idx_wellbeing_plans_unit on op_wellbeing_plans(hospital_id, status, review_date);
create index if not exists idx_wellbeing_plans_staff on op_wellbeing_plans(staff_id, status);

alter table op_wellbeing_checkins enable row level security;
alter table op_burnout_assessments enable row level security;
alter table op_occupational_referrals enable row level security;
alter table op_wellbeing_plans enable row level security;

-- A person may always read their OWN wellbeing record. Everything else goes through the service role,
-- where the manager-facing queries apply the visibility rule described at the top of this file.
drop policy if exists op_wellbeing_checkins_own on op_wellbeing_checkins;
create policy op_wellbeing_checkins_own on op_wellbeing_checkins for select to authenticated
  using (staff_id = auth.uid());
drop policy if exists op_burnout_assessments_own on op_burnout_assessments;
create policy op_burnout_assessments_own on op_burnout_assessments for select to authenticated
  using (staff_id = auth.uid());
drop policy if exists op_occupational_referrals_own on op_occupational_referrals;
create policy op_occupational_referrals_own on op_occupational_referrals for select to authenticated
  using (staff_id = auth.uid());
drop policy if exists op_wellbeing_plans_own on op_wellbeing_plans;
create policy op_wellbeing_plans_own on op_wellbeing_plans for select to authenticated
  using (staff_id = auth.uid());

notify pgrst, 'reload schema';
