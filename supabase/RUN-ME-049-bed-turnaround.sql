-- RUN ME: Migration 049 - bed turnaround tracking (idempotent)
-- Adds op_bed_turnaround so the supervisor can track a bed cycle through
-- vacated -> cleaning requested -> cleaning -> inspection -> ready and free the
-- bed on completion. RLS enabled with NO policy = service-role only.
-- Paste all into the Supabase SQL editor, Run.

create table if not exists op_bed_turnaround (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  bed_id        uuid not null references op_beds(id) on delete cascade,
  patient_label text,
  stage         text not null default 'vacated'
                  check (stage in ('vacated','cleaning_requested','cleaning','inspection','ready')),
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index if not exists idx_op_bed_turnaround_hosp on op_bed_turnaround(hospital_id, stage);
create unique index if not exists uq_op_bed_turnaround_active on op_bed_turnaround(bed_id) where stage <> 'ready';

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_bed_turnaround') then
    execute 'alter table public.op_bed_turnaround enable row level security';
  end if;
end $$;
