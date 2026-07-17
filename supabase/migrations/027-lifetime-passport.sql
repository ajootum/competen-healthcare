-- 027 — Lifetime Competency Passport spine (Lifetime Passport spec §2–§6, §8)
-- Layer 2: employment passports — one row per employment, never deleted on exit.
-- Decisions gain an employer stamp so validated competencies keep their
-- provenance (who employed the nurse when the decision was made) for life.
-- Idempotent: safe to re-run.

create table if not exists employment_records (
  id              uuid primary key default gen_random_uuid(),
  nurse_id        uuid not null references profiles(id) on delete cascade,
  organisation_id uuid references organisations(id) on delete set null,
  hospital_id     uuid references hospitals(id) on delete set null,
  department_id   uuid references departments(id) on delete set null,
  role_title      text not null default 'Healthcare Worker',
  status          text not null default 'confirmed' check (status in (
                    'orientation','probation','confirmed','secondment','temporary_assignment',
                    'resigned','contract_ended','retired','suspended','terminated')),
  start_date      date not null default current_date,
  end_date        date,
  notes           text,
  created_at      timestamptz default now()
);

create index if not exists idx_employment_nurse on employment_records(nurse_id, start_date desc);

-- Employer stamp on the governed record (immutable provenance)
alter table competency_decisions add column if not exists hospital_id     uuid references hospitals(id);
alter table competency_decisions add column if not exists organisation_id uuid references organisations(id);

-- Backfill: stamp existing decisions from the nurse's current placement
update competency_decisions d
set hospital_id = p.hospital_id, organisation_id = p.organisation_id
from profiles p
where p.id = d.nurse_id and d.hospital_id is null;

-- Backfill: one current employment per staffed profile (idempotent)
insert into employment_records (nurse_id, organisation_id, hospital_id, department_id, role_title, status, start_date)
select p.id, p.organisation_id, p.hospital_id, p.department_id,
  case p.role
    when 'nurse' then 'Healthcare Worker'
    when 'assessor' then 'Assessor'
    when 'educator' then 'Educator'
    when 'hospital_admin' then 'Administrator'
    else 'Staff' end,
  'confirmed',
  coalesce(p.created_at::date, current_date)
from profiles p
where p.hospital_id is not null
  and not exists (select 1 from employment_records e where e.nurse_id = p.id);

-- RLS: clinicians read their own lifetime record; admins manage via service role
alter table employment_records enable row level security;

do $$ begin
  create policy employment_read_own on employment_records
    for select using (nurse_id = auth.uid() or current_user_is_super_admin());
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
