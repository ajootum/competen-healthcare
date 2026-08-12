-- 292 - THE BOOKING TAXONOMY (CP-BOOKING-TAXONOMY-001)
--
-- Core rule of the spec: do not mix the REASON for the visit, the MODE of consultation and the SOURCE
-- of the booking in one dropdown. They are three independent dimensions. practice_appointment carried
-- all three squashed into one appointment_type string - new_consultation and teleconsultation sat in
-- the same list, so a teleconsultation had no recorded clinical purpose and a follow-up had no recorded
-- mode. This migration gives the first two their own configurable tables and the third a provenance
-- column, and leaves appointment_type in place unread so nothing breaks mid-arc.
--
-- WHAT IS DELIBERATELY NOT DONE HERE: appointment_type is NOT dropped. The engines still write it this
-- commit, the new columns are populated beside it, and it is retired only once every reader is moved.
-- A column dropped in the same migration that adds its replacement leaves no way back if a reader was
-- missed, and there is no rollback in this project.
--
-- ONE DEFAULT PER DIMENSION, ENFORCED BY A PRIMARY KEY rather than a partial unique index. The spec
-- says only one default Visit Type and one default Consultation Mode may exist at a time. The obvious
-- shape - is_default boolean with a unique index WHERE is_default - is the partial-unique trap the
-- house rules ban outright, and ON CONFLICT cannot target it through PostgREST anyway. A tiny
-- practice_taxonomy_default table keyed on workspace and dimension says the same thing with a full key.
--
-- SEEDING IS FOR EXISTING WORKSPACES ONLY. A workspace created tomorrow gets nothing from this file -
-- provisioning must seed the same defaults in code, the way the booking fallback contact had to after
-- migration 291 seeded once and the next new practice came up blank.
--
-- House rules obeyed: ASCII only, plain idempotent statements, no plpgsql, no do blocks, no functions,
-- no partial unique indexes, notify pgrst last, and NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT -
-- INCLUDING INSIDE A COMMENT, because the runner splits the file on semicolons and one inside a comment
-- silently drops the statements around it while still reporting Success. No rows returned.

-- ============================================================================================
-- 1. VISIT TYPE - WHY the patient is being seen
-- ============================================================================================

create table if not exists practice_visit_type (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  label text not null check (btrim(label) <> ''),
  active boolean not null default true,
  self_bookable boolean not null default false,
  default_duration_minutes integer,
  sort_order integer not null default 100,
  system_seeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table practice_visit_type enable row level security;

-- The code is the stable identifier the spec requires and is immutable after creation.
-- The label is what a practice may rename.
create unique index if not exists uq_practice_visit_type_code
  on practice_visit_type (workspace_id, code);

create index if not exists idx_practice_visit_type_ws_active
  on practice_visit_type (workspace_id, active, sort_order);

alter table practice_visit_type drop constraint if exists ck_practice_visit_type_duration;

alter table practice_visit_type add constraint ck_practice_visit_type_duration
  check (default_duration_minutes is null or (default_duration_minutes >= 5 and default_duration_minutes <= 480));

-- ============================================================================================
-- 2. CONSULTATION MODE - HOW the consultation happens
-- ============================================================================================

create table if not exists practice_consultation_mode (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  label text not null check (btrim(label) <> ''),
  active boolean not null default true,
  self_bookable boolean not null default false,
  -- Home visit needs no clinic room and a teleconsultation may use a virtual one, so a mode may say
  -- that a location is not required of it.
  requires_location boolean not null default true,
  sort_order integer not null default 100,
  system_seeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table practice_consultation_mode enable row level security;

create unique index if not exists uq_practice_consultation_mode_code
  on practice_consultation_mode (workspace_id, code);

create index if not exists idx_practice_consultation_mode_ws_active
  on practice_consultation_mode (workspace_id, active, sort_order);

-- ============================================================================================
-- 3. THE PRACTICE DEFAULT FOR EACH DIMENSION
-- ============================================================================================

create table if not exists practice_taxonomy_default (
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  dimension text not null,
  item_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, dimension)
);

alter table practice_taxonomy_default enable row level security;

alter table practice_taxonomy_default drop constraint if exists ck_practice_taxonomy_default_dimension;

alter table practice_taxonomy_default add constraint ck_practice_taxonomy_default_dimension
  check (dimension in ('visit_type', 'consultation_mode'));

-- ============================================================================================
-- 4. THE APPOINTMENT COLUMNS
-- ============================================================================================

alter table practice_appointment add column if not exists visit_type_id uuid references practice_visit_type(id);

alter table practice_appointment add column if not exists consultation_mode_id uuid references practice_consultation_mode(id);

alter table practice_appointment add column if not exists booking_source text;

-- !! TRUE MEANS A HUMAN MUST LOOK AT THIS ROW. Section 8 of the spec forbids inventing a clinical Visit
-- Type for a legacy teleconsultation or home visit, because the old value recorded the MODE and said
-- nothing about why the patient was being seen. Those rows finish this migration with a mode, no visit
-- type, and this flag raised - rather than a plausible guess nobody made.
alter table practice_appointment add column if not exists taxonomy_review_needed boolean not null default false;

alter table practice_appointment drop constraint if exists ck_practice_appointment_booking_source;

-- `unknown` exists for legacy rows ONLY. Every new booking derives its source from the workflow and the
-- authenticated actor, so nothing written after this migration may use it.
alter table practice_appointment add constraint ck_practice_appointment_booking_source
  check (booking_source is null or booking_source in ('practitioner_created', 'staff_created', 'self_booked', 'walk_in', 'system', 'unknown'));

create index if not exists idx_practice_appointment_visit_type on practice_appointment (visit_type_id);

create index if not exists idx_practice_appointment_consultation_mode on practice_appointment (consultation_mode_id);

-- ============================================================================================
-- 5. THE FROZEN DEFAULT TAXONOMY, for every workspace that already exists
-- ============================================================================================

insert into practice_visit_type (workspace_id, code, label, active, self_bookable, default_duration_minutes, sort_order, system_seeded)
select w.id, v.code, v.label, true, v.self_bookable, v.mins, v.sort_order, true
from practice_workspace w
cross join (values
  ('new_consultation', 'New consultation', true, 30, 10),
  ('follow_up', 'Follow-up', true, 15, 20),
  ('urgent_review', 'Urgent review', false, 20, 30),
  ('procedure', 'Procedure', false, 30, 40),
  ('results_review', 'Results review', true, 15, 50),
  ('other', 'Other', false, null, 60)
) as v(code, label, self_bookable, mins, sort_order)
on conflict (workspace_id, code) do nothing;

-- The spec is explicit that Follow-up is NOT called Scheduled follow-up - scheduling is not the
-- clinical purpose of the visit.
insert into practice_consultation_mode (workspace_id, code, label, active, self_bookable, requires_location, sort_order, system_seeded)
select w.id, m.code, m.label, true, true, m.requires_location, m.sort_order, true
from practice_workspace w
cross join (values
  ('in_person', 'In-person', true, 10),
  ('teleconsultation', 'Teleconsultation', false, 20),
  ('home_visit', 'Home visit', false, 30)
) as m(code, label, requires_location, sort_order)
on conflict (workspace_id, code) do nothing;

insert into practice_taxonomy_default (workspace_id, dimension, item_id)
select vt.workspace_id, 'visit_type', vt.id
from practice_visit_type vt
where vt.code = 'new_consultation'
on conflict (workspace_id, dimension) do nothing;

insert into practice_taxonomy_default (workspace_id, dimension, item_id)
select cm.workspace_id, 'consultation_mode', cm.id
from practice_consultation_mode cm
where cm.code = 'in_person'
on conflict (workspace_id, dimension) do nothing;

-- ============================================================================================
-- 6. MIGRATING THE EXISTING appointment_type VALUES - section 8 of the spec
-- ============================================================================================

-- 6a. The two values that carry a clinical purpose and nothing else. Mode is in-person unless another
-- mode is known, which for these it is not.
update practice_appointment a
set visit_type_id = vt.id
from practice_visit_type vt
where vt.workspace_id = a.workspace_id
  and vt.code = 'new_consultation'
  and a.appointment_type in ('new_consultation', 'hospital_consultation')
  and a.visit_type_id is null;

update practice_appointment a
set visit_type_id = vt.id
from practice_visit_type vt
where vt.workspace_id = a.workspace_id
  and vt.code = 'follow_up'
  and a.appointment_type = 'scheduled_followup'
  and a.visit_type_id is null;

-- 6b. Emergency is the one legacy value whose clinical purpose IS reliably derivable.
update practice_appointment a
set visit_type_id = vt.id
from practice_visit_type vt
where vt.workspace_id = a.workspace_id
  and vt.code = 'urgent_review'
  and a.appointment_type = 'emergency'
  and a.visit_type_id is null;

-- 6c. Modes. Everything that is not explicitly remote happened in person, which is safe to state
-- because the old value would have said otherwise if it had been either of the other two.
update practice_appointment a
set consultation_mode_id = cm.id
from practice_consultation_mode cm
where cm.workspace_id = a.workspace_id
  and cm.code = 'in_person'
  and a.appointment_type in ('new_consultation', 'scheduled_followup', 'hospital_consultation', 'walk_in', 'emergency')
  and a.consultation_mode_id is null;

update practice_appointment a
set consultation_mode_id = cm.id
from practice_consultation_mode cm
where cm.workspace_id = a.workspace_id
  and cm.code = 'teleconsultation'
  and a.appointment_type = 'teleconsultation'
  and a.consultation_mode_id is null;

update practice_appointment a
set consultation_mode_id = cm.id
from practice_consultation_mode cm
where cm.workspace_id = a.workspace_id
  and cm.code = 'home_visit'
  and a.appointment_type = 'home_visit'
  and a.consultation_mode_id is null;

-- 6d. Booking source. Provenance, derived only where it is genuinely knowable.
-- A row carrying applied_rule_id came through the patient-facing booking engine, which is self-booking
-- by definition. A walk_in said so in its own type.
update practice_appointment
set booking_source = 'self_booked'
where booking_source is null and applied_rule_id is not null;

update practice_appointment
set booking_source = 'walk_in'
where booking_source is null and appointment_type = 'walk_in';

-- !! EVERYTHING ELSE IS `unknown`, NOT `practitioner_created`. We know an authenticated user created
-- these in-house, but not whether that user was the practitioner or delegated staff, and the spec makes
-- booking_source a provenance field. A provenance field is precisely where a plausible guess does
-- damage - somebody auditing this later must be able to tell a recorded fact from a backfilled one.
update practice_appointment
set booking_source = 'unknown'
where booking_source is null;

-- 6e. Raise the review flag on every row whose clinical purpose could not be derived. These are the
-- legacy teleconsultation and home visit rows the spec names, plus any type this file did not map.
update practice_appointment
set taxonomy_review_needed = true
where visit_type_id is null;

notify pgrst, 'reload schema';
