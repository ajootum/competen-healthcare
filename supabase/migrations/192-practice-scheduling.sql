-- ============================================================
-- MIGRATION 192: PRACTICE SCHEDULING (CPR-DM-001 section 7, PEN-001, CPR-003 V3)
--
-- Phase 1 of CPR-BUILD-000: the diary. Four entities from DM-001 section 7 -- availability, appointment,
-- arrival, queue -- with their state vocabularies in CHECK constraints exactly as listed there. Every
-- table is workspace-scoped to practice_workspace and RLS-deny-by-default like migration 191.
--
-- PATIENT IDENTITY DOES NOT EXIST YET, AND THIS SCHEMA SAYS SO HONESTLY. Phase 2 (PEN-002, CPR-004/005)
-- brings practice_patient; until then an appointment carries patient_name/patient_phone as plain text --
-- which is what a paper diary holds, and is exactly the "capture the minimum safely now, complete the
-- detail later" principle (ARCH s3). patient_id exists as a NULLABLE uuid WITH NO FOREIGN KEY, because
-- the table it will reference is not there to reference; Phase 2 adds the constraint and backfills
-- linkage. A fake FK to a placeholder table would be worse than a documented gap.
--
-- APPOINTMENT TYPES are PEN-001's seven, verbatim. States are DM-001 s7's, verbatim. Transition
-- LEGALITY (which state may follow which) lives in src/lib/practice/scheduling.ts; the constraints here
-- make illegal VALUES unwritable even by a buggy service.
--
-- THE CAPABILITY CATALOG GROWS (appointment.manage, queue.manage) AND THE BACKFILL IS PART OF THE
-- MIGRATION. Capability resolution reads practice_role_assignment per membership, not the catalog, so a
-- new catalog row alone would never reach an already-provisioned workspace -- the insert..select below
-- grants the new capabilities to every existing ACTIVE membership whose role carries them. Without it,
-- pilot workspaces provisioned before this migration would silently lack the calendar.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_availability_slot -----------------------------------------------------------------

create table if not exists practice_availability_slot (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  location_id uuid references practice_location(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'RESERVED', 'BLOCKED', 'CLOSED')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_practice_avail_ws on practice_availability_slot(workspace_id, starts_at);

-- ---- 2. practice_appointment -----------------------------------------------------------------------

create table if not exists practice_appointment (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  location_id uuid references practice_location(id) on delete set null,
  slot_id uuid references practice_availability_slot(id) on delete set null,
  patient_id uuid,
  patient_name text not null check (char_length(patient_name) between 1 and 160),
  patient_phone text,
  appointment_type text not null default 'new_consultation'
    check (appointment_type in ('new_consultation', 'scheduled_followup', 'walk_in', 'emergency',
                                'hospital_consultation', 'teleconsultation', 'home_visit')),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 20 check (duration_minutes between 5 and 480),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'CONFIRMED', 'CANCELLED', 'NO_SHOW', 'ARRIVED', 'COMPLETED')),
  reason text,
  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists idx_practice_appt_ws_day on practice_appointment(workspace_id, scheduled_at, status);
create index if not exists idx_practice_appt_ws_status on practice_appointment(workspace_id, status);

-- ---- 3. practice_arrival ---------------------------------------------------------------------------

create table if not exists practice_arrival (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  appointment_id uuid not null references practice_appointment(id) on delete cascade,
  status text not null default 'ARRIVED'
    check (status in ('ARRIVED', 'VERIFIED', 'CANCELLED')),
  arrived_at timestamptz not null default now(),
  created_by uuid
);

-- One live arrival per appointment: checking in twice is a duplicate, not a second visit.
create unique index if not exists ux_practice_arrival_appt
  on practice_arrival(appointment_id) where status <> 'CANCELLED';

-- ---- 4. practice_queue_entry -----------------------------------------------------------------------

create table if not exists practice_queue_entry (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  appointment_id uuid references practice_appointment(id) on delete set null,
  patient_name text not null,
  status text not null default 'WAITING'
    check (status in ('WAITING', 'READY', 'IN_CONSULTATION', 'PAUSED', 'COMPLETED', 'LEFT')),
  entered_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_queue_ws on practice_queue_entry(workspace_id, status, entered_at);

-- ---- 5. Capability catalog additions + BACKFILL to existing memberships ----------------------------

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'appointment.manage'),
  ('practitioner', 'queue.manage'),
  ('practice_assistant', 'appointment.manage'),
  ('practice_assistant', 'queue.manage')
on conflict (role_code, capability_code) do nothing;

-- Reach every ACTIVE membership already provisioned under the old catalog. Idempotent: the partial
-- unique index on (membership_id, capability_code) where effective_to is null makes re-runs no-ops via
-- the not-exists guard.
insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
  );

-- ---- 6. RLS: deny-by-default, same doctrine as 191 -------------------------------------------------

alter table practice_availability_slot enable row level security;
alter table practice_appointment enable row level security;
alter table practice_arrival enable row level security;
alter table practice_queue_entry enable row level security;

notify pgrst, 'reload schema';
