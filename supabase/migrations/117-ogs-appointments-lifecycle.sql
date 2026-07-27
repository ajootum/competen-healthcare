-- 117: OGS appointments + immutable lifecycle transitions (OGS-002 / OGS-001 §lifecycle).
-- Plain, idempotent statements only (no do-blocks). RLS = authenticated read; service-role writes.
-- Appointment = a person holding an office role for a term (authority ≠ membership ≠ technical-admin).
-- Seeds appointments from committee_members so the office model carries its chairs/members immediately.

create table if not exists ogs_office_appointments (
  id            uuid primary key default gen_random_uuid(),
  office_id     uuid not null references ogs_offices(id) on delete cascade,
  person_id     uuid references profiles(id) on delete set null,
  person_name   text,
  role          text not null default 'member',   -- chair|deputy_chair|secretary|governance_lead|member|reviewer|observer|external_adviser
  term_start    date,
  term_end      date,
  scope         text,
  appointed_by  text,
  status        text not null default 'active',    -- nominated|active|suspended|expired|removed
  created_at    timestamptz default now()
);
create index if not exists idx_ogs_appt_office on ogs_office_appointments(office_id);
create index if not exists idx_ogs_appt_person on ogs_office_appointments(person_id);
alter table ogs_office_appointments enable row level security;
drop policy if exists ogs_appt_read on ogs_office_appointments;
create policy ogs_appt_read on ogs_office_appointments for select to authenticated using (true);

create table if not exists ogs_lifecycle_transitions (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references ogs_offices(id) on delete cascade,
  from_state   text,
  to_state     text not null,
  reason       text,
  actor_name   text,
  occurred_at  timestamptz default now()
);
create index if not exists idx_ogs_trans_office on ogs_lifecycle_transitions(office_id);
alter table ogs_lifecycle_transitions enable row level security;
drop policy if exists ogs_trans_read on ogs_lifecycle_transitions;
create policy ogs_trans_read on ogs_lifecycle_transitions for select to authenticated using (true);

-- Seed appointments from committee members (idempotent — one appointment per office+person).
insert into ogs_office_appointments (office_id, person_id, role, term_start, status, created_at)
select o.id, cm.profile_id, cm.role, cm.created_at::date, 'active', cm.created_at
from committee_members cm
join ogs_offices o on o.source_committee_id = cm.committee_id
where not exists (
  select 1 from ogs_office_appointments a where a.office_id = o.id and a.person_id = cm.profile_id
);

-- Record the constituting transition for each seeded office (idempotent).
insert into ogs_lifecycle_transitions (office_id, from_state, to_state, reason, actor_name, occurred_at)
select o.id, null, o.status, 'Office constituted from governance committee (OGS migration)', 'System', o.created_at
from ogs_offices o
where not exists (select 1 from ogs_lifecycle_transitions t where t.office_id = o.id);

-- Backfill the office chair from its chair appointment (idempotent — only when not already set).
update ogs_offices o
set chair_id = a.person_id
from ogs_office_appointments a
where a.office_id = o.id and a.role = 'chair' and o.chair_id is null;
