-- 160: Multidisciplinary Team (MDT) Coordination (SSW-CCR-005).
--
-- The last genuinely unbacked module in the Shift Supervisor Workspace. Every other SSW surface is a lens
-- over stores that already existed; MDT coordination had none, so it has been sitting in the sidebar as a
-- muted "soon" entry rather than a fabricated page.
--
-- Five tables, one per spec module that needs persistence:
--   1. op_mdt_referrals    - the Complex Case Register: patients identified as needing MDT review, with the
--                            reason and who raised it. A referral is the DEMAND signal; a meeting is supply.
--   2. op_mdt_meetings     - the Meeting Scheduler. meeting_type covers the spec's Family Conference
--                            Coordination module (family_conference) alongside clinical MDT formats, so a
--                            family meeting is the same object with a different type, not a parallel store.
--   3. op_mdt_participants - Participant & Attendance Manager. One row per INVITED service or person, so
--                            "invited but did not attend" is recordable - attendance is a status on an
--                            invitation, never inferred from silence. Carries the digital sign-off.
--   4. op_mdt_decisions    - Decision capture. A decision belongs to a meeting and (optionally) a patient.
--   5. op_mdt_actions      - Action Tracker. Separate from decisions because one decision routinely produces
--                            several actions with different owners and due dates. task_id optionally links
--                            an action to a real op_task so the Task Centre tracks it too.
--
-- Tenancy: rows carry hospital_id (referrals/meetings) or inherit it through their parent. Plain idempotent
-- statements only (no do-blocks). RLS = authenticated read; service-role writes.

-- 1. Complex Case Register -----------------------------------------------------------------------------
create table if not exists op_mdt_referrals (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  patient_id     uuid not null references op_patients(id) on delete cascade,
  unit_id        uuid references units(id) on delete set null,
  department_id  uuid references departments(id) on delete set null,
  reason         text not null,
  complexity     text not null default 'standard' check (complexity in
                   ('standard','complex','highly_complex')),
  priority       text not null default 'routine' check (priority in
                   ('routine','this_week','urgent','immediate')),
  services_requested text[],
  status         text not null default 'awaiting_review' check (status in
                   ('awaiting_review','scheduled','reviewed','deferred','withdrawn')),
  meeting_id     uuid,
  raised_by      uuid references profiles(id) on delete set null,
  raised_by_name text,
  raised_at      timestamptz not null default now(),
  reviewed_at    timestamptz,
  outcome_note   text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_op_mdt_referrals_h on op_mdt_referrals(hospital_id, status, priority);
create index if not exists idx_op_mdt_referrals_p on op_mdt_referrals(patient_id, raised_at desc);

-- 2. MDT Meeting Scheduler -----------------------------------------------------------------------------
create table if not exists op_mdt_meetings (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid references hospitals(id) on delete cascade,
  unit_id        uuid references units(id) on delete set null,
  department_id  uuid references departments(id) on delete set null,
  patient_id     uuid references op_patients(id) on delete set null,
  shift_id       uuid references op_shifts(id) on delete set null,
  title          text not null,
  meeting_type   text not null default 'ward_mdt' check (meeting_type in
                   ('ward_mdt','complex_case','discharge_planning','family_conference','ethics',
                    'specialty_review','safeguarding','other')),
  scheduled_at   timestamptz not null,
  duration_min   int,
  location       text,
  virtual_link   text,
  status         text not null default 'scheduled' check (status in
                   ('scheduled','in_progress','completed','cancelled','no_quorum')),
  chaired_by     uuid references profiles(id) on delete set null,
  chaired_by_name text,
  agenda         text,
  ai_summary     text,
  summary        text,
  started_at     timestamptz,
  completed_at   timestamptz,
  cancel_reason  text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_op_mdt_meetings_h on op_mdt_meetings(hospital_id, scheduled_at desc);
create index if not exists idx_op_mdt_meetings_s on op_mdt_meetings(status, scheduled_at);

-- 3. Participant & Attendance Manager ------------------------------------------------------------------
-- service is the spec's Participating Services list. An invitation always exists first; attendance is a
-- status ON that invitation, so "invited, did not attend" is a recorded fact rather than a missing row.
create table if not exists op_mdt_participants (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references op_mdt_meetings(id) on delete cascade,
  service        text not null check (service in
                   ('medical','surgery','anaesthesia','nursing','physiotherapy','nutrition','pharmacy',
                    'laboratory','radiology','social_work','biomedical','spiritual_care','case_management',
                    'quality','family','other')),
  staff_id       uuid references profiles(id) on delete set null,
  participant_name text,
  role_at_meeting text,
  required       boolean not null default true,
  attendance     text not null default 'invited' check (attendance in
                   ('invited','confirmed','attended','apologies','absent','delegated')),
  delegated_to   text,
  signed_off     boolean not null default false,
  signed_off_at  timestamptz,
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (meeting_id, service, staff_id)
);

create index if not exists idx_op_mdt_participants_m on op_mdt_participants(meeting_id, attendance);
create index if not exists idx_op_mdt_participants_s on op_mdt_participants(staff_id);

-- 4. Decision capture ----------------------------------------------------------------------------------
create table if not exists op_mdt_decisions (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references op_mdt_meetings(id) on delete cascade,
  patient_id     uuid references op_patients(id) on delete set null,
  category       text not null default 'care_plan' check (category in
                   ('care_plan','treatment','discharge','escalation','referral','investigation',
                    'goals_of_care','family_communication','safeguarding','other')),
  decision       text not null,
  rationale      text,
  status         text not null default 'active' check (status in
                   ('active','superseded','reversed','deferred')),
  decided_by     uuid references profiles(id) on delete set null,
  decided_by_name text,
  decided_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists idx_op_mdt_decisions_m on op_mdt_decisions(meeting_id, decided_at desc);
create index if not exists idx_op_mdt_decisions_p on op_mdt_decisions(patient_id, decided_at desc);

-- 5. Action Tracker ------------------------------------------------------------------------------------
create table if not exists op_mdt_actions (
  id             uuid primary key default gen_random_uuid(),
  decision_id    uuid references op_mdt_decisions(id) on delete cascade,
  meeting_id     uuid not null references op_mdt_meetings(id) on delete cascade,
  patient_id     uuid references op_patients(id) on delete set null,
  action         text not null,
  service        text,
  owner_id       uuid references profiles(id) on delete set null,
  owner_name     text,
  due_at         timestamptz,
  priority       text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status         text not null default 'open' check (status in
                   ('open','in_progress','completed','blocked','cancelled','escalated')),
  task_id        uuid references op_tasks(id) on delete set null,
  completed_at   timestamptz,
  completed_by   uuid references profiles(id) on delete set null,
  outcome_note   text,
  escalated_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_op_mdt_actions_m on op_mdt_actions(meeting_id, status);
create index if not exists idx_op_mdt_actions_d on op_mdt_actions(status, due_at);
create index if not exists idx_op_mdt_actions_o on op_mdt_actions(owner_id, status);

-- Referral -> meeting link, added after both tables exist so the file re-runs in any order.
alter table op_mdt_referrals drop constraint if exists op_mdt_referrals_meeting_fk;
alter table op_mdt_referrals add constraint op_mdt_referrals_meeting_fk
  foreign key (meeting_id) references op_mdt_meetings(id) on delete set null;

alter table op_mdt_referrals enable row level security;
alter table op_mdt_meetings enable row level security;
alter table op_mdt_participants enable row level security;
alter table op_mdt_decisions enable row level security;
alter table op_mdt_actions enable row level security;

drop policy if exists op_mdt_referrals_read on op_mdt_referrals;
create policy op_mdt_referrals_read on op_mdt_referrals for select to authenticated using (true);
drop policy if exists op_mdt_meetings_read on op_mdt_meetings;
create policy op_mdt_meetings_read on op_mdt_meetings for select to authenticated using (true);
drop policy if exists op_mdt_participants_read on op_mdt_participants;
create policy op_mdt_participants_read on op_mdt_participants for select to authenticated using (true);
drop policy if exists op_mdt_decisions_read on op_mdt_decisions;
create policy op_mdt_decisions_read on op_mdt_decisions for select to authenticated using (true);
drop policy if exists op_mdt_actions_read on op_mdt_actions;
create policy op_mdt_actions_read on op_mdt_actions for select to authenticated using (true);

notify pgrst, 'reload schema';
