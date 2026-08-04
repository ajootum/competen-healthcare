-- ============================================================
-- MIGRATION 230: LOCATIONS, CLINICS, AVAILABILITY & BOOKING RULES (CPR-SET-002 v4)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THE SPECIFICATION'S EIGHT DATA ENTITIES, AND THE THREE THAT ALREADY EXISTED.
--
--   Practice Location       191 (+ facility_id and travel_buffer_minutes in 228)
--   Appointment Type        192, as a CHECK constraint -- seven of them
--   Generated Slot          192 practice_availability_slot (+ slot_kind in 227)
--   Audit Log               191 practice_audit_event
--
-- So this migration adds the five that are new: Clinic, Availability Template, Availability Exception,
-- Booking Rule, and the link from a generated slot back to the template that made it.
--
-- ---- THE ONE DECISION THE WHOLE MIGRATION TURNS ON --------------------------------------------------
--
-- "Recurring schedules generate slots automatically" means a template can WRITE slots, and therefore
-- that regenerating can DELETE them. A regeneration that removed a slot somebody had already been
-- booked into would cancel a patient's appointment without anybody deciding to.
--
-- So a generated slot carries generated_from_template_id, and regeneration only ever removes slots that
-- (a) it generated itself and (b) nothing is booked into. A hand-made slot is never touched by a
-- template, and a booked slot is never removed by anything except a person. The engine enforces both
-- and the harness proves both; this column is what makes the first one expressible at all.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

-- ---- 1. Clinic: "multiple clinics per hospital" -------------------------------------------------
--
-- A clinic is a NAMED SERVICE INSIDE A LOCATION -- "Neurology Clinic" at Mulago, "Paediatrics" at the
-- same building on a different afternoon. Not a second location: the travel rule in 228 is about
-- getting to the BUILDING, and two clinics in one hospital need no travel between them. Modelling a
-- clinic as a location would therefore invent an impossible-hop refusal between two rooms on one
-- corridor.

create table if not exists practice_clinic (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  location_id uuid not null references practice_location(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- What kind of consultation happens here. Constrained to the encounter modes migration 194 already
  -- knows, so a clinic cannot promise a mode the clinical record cannot store.
  consultation_mode text not null default 'in_person'
    check (consultation_mode in ('in_person', 'teleconsultation', 'outreach', 'home_visit', 'hospital')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_clinic_ws on practice_clinic(workspace_id, active);
create index if not exists idx_practice_clinic_location on practice_clinic(location_id);

-- One name per location. Two "Neurology Clinic" rows at one hospital is a duplicate, not a second
-- clinic, and the timetable below would offer both with no way to tell them apart.
create unique index if not exists ux_practice_clinic_name
  on practice_clinic(location_id, lower(trim(name))) where active;

-- ---- 2. Availability Template: the regular week -------------------------------------------------
--
-- STORED AS A WEEKDAY AND LOCAL MINUTES, NOT AS TIMESTAMPS. "Tuesday, 09:00 to 13:00" is true every
-- week; an instant is true once. Migration 229 made the same decision for clinic opening hours, and for
-- the same reason: the practice's timezone turns it into instants at generation time.

create table if not exists practice_availability_template (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  location_id uuid references practice_location(id) on delete cascade,
  clinic_id uuid references practice_clinic(id) on delete set null,

  -- ISO weekday: 1 = Monday .. 7 = Sunday.
  weekday integer not null check (weekday between 1 and 7),
  starts_minute integer not null check (starts_minute between 0 and 1439),
  ends_minute integer not null check (ends_minute between 1 and 1440),

  -- What the session IS, matching migration 227's slot kinds so a template and the slots it generates
  -- can never disagree about what kind of time this is.
  slot_kind text not null default 'clinic'
    check (slot_kind in ('clinic', 'telemedicine', 'emergency_reserve', 'leave', 'blocked', 'admin')),

  -- How long one appointment in this session runs. Null means "use the practice default", which
  -- migration 203 already made configurable -- a per-session copy of it would drift.
  appointment_minutes integer check (appointment_minutes between 5 and 480),

  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- A session that ends before it starts is a typo, not an overnight clinic. Overnight work is
-- representable as two sessions; a wrapped window would generate a slot of negative length.
alter table practice_availability_template drop constraint if exists practice_availability_template_window_check;
alter table practice_availability_template add constraint practice_availability_template_window_check
  check (ends_minute > starts_minute);

create index if not exists idx_practice_avail_template_ws
  on practice_availability_template(workspace_id, weekday) where active;

-- ---- 3. Availability Exception: dates that are not like the regular week -------------------------
--
-- FOUR KINDS, AND THE DIFFERENCE BETWEEN THEM MATTERS. `leave` and `closure` REMOVE time; `extra` and
-- `extended` ADD it. Collapsing them into one "override" row would leave the generator unable to tell
-- "I am away" from "I am working late", which are opposite instructions about the same afternoon.

create table if not exists practice_availability_exception (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  location_id uuid references practice_location(id) on delete cascade,
  clinic_id uuid references practice_clinic(id) on delete set null,

  kind text not null
    check (kind in ('leave', 'closure', 'extra_session', 'extended_hours')),

  -- Half-open, and a single date is expressed as from = to. A closed range cannot say "the whole of
  -- Friday" without naming a last millisecond.
  from_date date not null,
  to_date date not null,

  -- Only meaningful for the two kinds that ADD time. Null on leave and closure, which take the day.
  starts_minute integer check (starts_minute between 0 and 1439),
  ends_minute integer check (ends_minute between 1 and 1440),

  slot_kind text not null default 'clinic'
    check (slot_kind in ('clinic', 'telemedicine', 'emergency_reserve', 'leave', 'blocked', 'admin')),
  appointment_minutes integer check (appointment_minutes between 5 and 480),

  reason text,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table practice_availability_exception drop constraint if exists practice_availability_exception_range_check;
alter table practice_availability_exception add constraint practice_availability_exception_range_check
  check (to_date >= from_date);

-- Adding time requires saying when. Removing it does not -- leave takes the day.
alter table practice_availability_exception drop constraint if exists practice_availability_exception_window_check;
alter table practice_availability_exception add constraint practice_availability_exception_window_check
  check (
    (kind in ('leave', 'closure'))
    or (starts_minute is not null and ends_minute is not null and ends_minute > starts_minute)
  );

create index if not exists idx_practice_avail_exception_ws
  on practice_availability_exception(workspace_id, from_date, to_date);

-- ---- 4. Booking Rule ----------------------------------------------------------------------------
--
-- ONE ROW PER PRACTICE, OR PER LOCATION, OR PER APPOINTMENT TYPE -- most specific wins, resolved in the
-- engine. A rule table that only worked practice-wide would not survive a practitioner whose hospital
-- session needs a day's notice while their own room takes walk-ins.
--
-- EVERY COLUMN HERE IS READ BY checkPlacement(). This project has twice shipped a table nobody read
-- (practice_configuration inert from 191 to CPR-360; effective_from ignored until CPR-310), and a
-- booking rule that does not refuse a booking is worse than an absent one, because the practice
-- believes the rule is holding.

create table if not exists practice_booking_rule (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- Null on both = the practice-wide default.
  location_id uuid references practice_location(id) on delete cascade,
  appointment_type text
    check (appointment_type is null or appointment_type in (
      'new_consultation', 'scheduled_followup', 'walk_in', 'emergency',
      'hospital_consultation', 'teleconsultation', 'home_visit')),

  -- How much notice a booking needs. 0 means "book me now".
  lead_time_minutes integer not null default 0 check (lead_time_minutes between 0 and 43200),
  -- How far ahead the diary is open. Null = no horizon.
  booking_horizon_days integer check (booking_horizon_days between 1 and 730),
  -- How late somebody may cancel without it counting as a late cancellation. Recorded, and the engine
  -- reports it; it does NOT refuse the cancellation -- a practice that cannot cancel a booking because
  -- of a policy setting is a practice with a wrong diary.
  cancellation_notice_minutes integer not null default 0 check (cancellation_notice_minutes between 0 and 43200),
  -- Walk-ins per day at this location. Null = no limit. Zero MEANS ZERO, which is why it is nullable
  -- rather than defaulting to 0: "no limit" and "none allowed" are different instructions.
  walk_in_daily_limit integer check (walk_in_daily_limit >= 0),
  -- Minutes of each session held back for emergencies. Advisory: reported, never used to refuse.
  emergency_reserve_minutes integer not null default 0 check (emergency_reserve_minutes between 0 and 480),

  -- CPR-SET-002 asks for public / link-only / internal. NOTHING READS THIS YET -- there is no
  -- patient-facing booking page, so it is stored, surfaced as unread, and NOT offered as an input.
  -- See the note in availability-config.ts.
  visibility text not null default 'internal'
    check (visibility in ('public', 'link_only', 'internal')),

  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- One live rule per scope. Two rules for the same location and type would make "most specific wins"
-- ambiguous, and the tie would be broken by row order -- which is to say, arbitrarily.
create unique index if not exists ux_practice_booking_rule_scope
  on practice_booking_rule(
    workspace_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(appointment_type, '*')
  ) where active;

-- ---- 5. Generated slots point back at what generated them ---------------------------------------

alter table practice_availability_slot add column if not exists generated_from_template_id uuid
  references practice_availability_template(id) on delete set null;
alter table practice_availability_slot add column if not exists clinic_id uuid
  references practice_clinic(id) on delete set null;
-- The date the generator produced this slot for, so regeneration can find its own output for a day
-- without recomputing the practice's timezone to ask.
alter table practice_availability_slot add column if not exists generated_for_date date;

create index if not exists idx_practice_slot_generated
  on practice_availability_slot(workspace_id, generated_for_date)
  where generated_from_template_id is not null;

notify pgrst, 'reload schema';
