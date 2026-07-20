-- RUN ME: Migration 051 - patient shift updates (idempotent)
-- Adds op_patient_shift_updates so each shift keeps a per-patient operational
-- record: review, update status (due/updated/overdue), handover + snapshot.
-- RLS enabled with NO policy = service-role only. Paste all into Supabase SQL editor, Run.

create table if not exists op_patient_shift_updates (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  patient_id      uuid not null references op_patients(id) on delete cascade,
  shift_id        uuid references op_shifts(id) on delete set null,
  reviewed        boolean not null default false,
  update_status   text not null default 'due' check (update_status in ('due','updated','overdue')),
  handover_status text not null default 'pending' check (handover_status in ('pending','completed')),
  snapshot        text,
  receiving_nurse uuid references profiles(id) on delete set null,
  updated_by      uuid references profiles(id) on delete set null,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (patient_id, shift_id)
);
create index if not exists idx_op_psu_hosp on op_patient_shift_updates(hospital_id);
create index if not exists idx_op_psu_shift on op_patient_shift_updates(shift_id);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_patient_shift_updates') then
    execute 'alter table public.op_patient_shift_updates enable row level security';
  end if;
end $$;
