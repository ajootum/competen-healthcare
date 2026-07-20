-- RUN ME: Migration 048 - operational flow blockers (idempotent)
-- Adds op_flow_blockers so the Shift Supervisor can LOG + RESOLVE blockers on
-- patient movement that can't be auto-detected (transport, discharge meds,
-- family education, receiving unit not ready, ...). RLS enabled with NO policy =
-- service-role only. Paste all into the Supabase SQL editor, Run.

create table if not exists op_flow_blockers (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  patient_id  uuid references op_patients(id) on delete cascade,
  bed_id      uuid references op_beds(id) on delete set null,
  category    text not null
                check (category in ('no_bed','bed_cleaning','discharge_meds','family_education','transport','medical_review','documentation','receiving_unit','isolation_room','equipment','other')),
  detail      text,
  status      text not null default 'open' check (status in ('open','resolved')),
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_op_flow_blockers_hosp on op_flow_blockers(hospital_id, status);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_flow_blockers') then
    execute 'alter table public.op_flow_blockers enable row level security';
  end if;
end $$;
