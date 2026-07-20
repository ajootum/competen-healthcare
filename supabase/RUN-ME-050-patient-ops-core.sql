-- RUN ME: Migration 050 - Patient Operations core / Patient Card foundation (idempotent)
-- Adds operational (not EMR) fields + tables for the 8-module Patient Operations:
--   op_patients.consultant, op_patients.current_stage
--   op_movement_events   (movement timeline)
--   op_operational_notes (short coordination notes)
-- RLS enabled with NO policy = service-role only. Paste all into Supabase SQL editor, Run.

alter table op_patients add column if not exists consultant text;
alter table op_patients add column if not exists current_stage text
  check (current_stage is null or current_stage in (
    'expected_admission','awaiting_bed','admitted','in_care','assessment',
    'treatment','theatre','recovery','transfer_pending','discharge_ready','discharged'));

create table if not exists op_movement_events (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  patient_id  uuid not null references op_patients(id) on delete cascade,
  event_type  text not null check (event_type in (
                'admission','bed_change','transfer','theatre','recovery',
                'stage_change','status_change','escalation','note','discharge')),
  detail      text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_op_movement_patient on op_movement_events(patient_id, created_at desc);
create index if not exists idx_op_movement_hosp on op_movement_events(hospital_id);

create table if not exists op_operational_notes (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  patient_id  uuid not null references op_patients(id) on delete cascade,
  note        text not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_op_notes_patient on op_operational_notes(patient_id, created_at desc);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_movement_events') then
    execute 'alter table public.op_movement_events enable row level security';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_operational_notes') then
    execute 'alter table public.op_operational_notes enable row level security';
  end if;
end $$;
