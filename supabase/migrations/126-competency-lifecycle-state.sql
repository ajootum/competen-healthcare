-- 126: COMP-017 Competency Lifecycle state machine — the persisted current state per worker×competency plus
-- an immutable transition log, so the lifecycle is a real record (not inferred on read). Plain, idempotent
-- statements only (no do-blocks). RLS = authenticated read; service-role writes. SEEDS the current state from
-- the latest competency_decision per (nurse, competency) so it carries real data the moment it is applied.

create table if not exists competency_lifecycle_state (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete cascade,
  nurse_id        uuid not null references profiles(id) on delete cascade,
  competency_id   uuid not null references framework_competencies(id) on delete cascade,
  state           text not null default 'assigned',
  entered_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (nurse_id, competency_id)
);
create index if not exists idx_cls_hospital on competency_lifecycle_state(hospital_id);
create index if not exists idx_cls_state on competency_lifecycle_state(state);
alter table competency_lifecycle_state enable row level security;
drop policy if exists cls_read on competency_lifecycle_state;
create policy cls_read on competency_lifecycle_state for select to authenticated using (true);

create table if not exists lifecycle_events (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid references hospitals(id) on delete cascade,
  nurse_id        uuid references profiles(id) on delete set null,
  competency_id   uuid references framework_competencies(id) on delete set null,
  from_state      text,
  to_state        text not null,
  reason          text,
  actor_id        uuid references profiles(id) on delete set null,
  actor_name      text,
  occurred_at     timestamptz default now()
);
create index if not exists idx_lce_hospital on lifecycle_events(hospital_id);
create index if not exists idx_lce_pair on lifecycle_events(nurse_id, competency_id);
alter table lifecycle_events enable row level security;
drop policy if exists lce_read on lifecycle_events;
create policy lce_read on lifecycle_events for select to authenticated using (true);

-- Seed current state from the latest decision per (nurse, competency) — idempotent.
insert into competency_lifecycle_state (hospital_id, nurse_id, competency_id, state, entered_at, updated_at)
select distinct on (d.nurse_id, d.competency_id)
  d.hospital_id, d.nurse_id, d.competency_id,
  case
    when d.outcome = 'expired' or (d.expiry_date is not null and d.expiry_date < current_date) then 'expired'
    when d.outcome in ('requires_remediation', 'not_yet_competent') then 'remediation_required'
    when d.outcome = 'suspended' then 'suspended'
    when d.outcome = 'competent_with_conditions' then 'competent_conditions'
    when d.outcome = 'competent' then 'competent'
    when d.outcome = 'provisionally_competent' then 'under_review'
    else 'under_review'
  end,
  d.created_at, now()
from competency_decisions d
where d.nurse_id is not null and d.competency_id is not null
order by d.nurse_id, d.competency_id, d.created_at desc
on conflict (nurse_id, competency_id) do nothing;

-- Record the constituting transition for each seeded state — idempotent.
insert into lifecycle_events (hospital_id, nurse_id, competency_id, from_state, to_state, reason, actor_name, occurred_at)
select s.hospital_id, s.nurse_id, s.competency_id, null, s.state, 'Seeded from latest competency decision', 'System', s.entered_at
from competency_lifecycle_state s
where not exists (select 1 from lifecycle_events e where e.nurse_id = s.nurse_id and e.competency_id = s.competency_id);
