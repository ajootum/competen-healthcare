-- ============================================================
-- MIGRATION 366: THE BOOKING FUNNEL (CPR-BOOK-FLOW-002 s19)
--
-- s19 asks for step-to-step conversion, abandonment by step, slot-unavailable-at-commit frequency,
-- OTP failure and resend rates, time to complete, and mobile versus desktop.
--
-- ---- WHY NOT practice_activation_event -----------------------------------------------------------
--
-- Migration 283's table carries a UNIQUE INDEX on (workspace_id, event_key), deliberately: it records
-- MILESTONES, one per practice, so an emitter may fire on every booking and only the first lands. A
-- funnel needs many rows per practice per day. Same shape, opposite requirement.
--
-- ---- THERE IS NO METADATA COLUMN, AND THAT IS THE POINT ----------------------------------------
--
-- s16: "Patient-entered clinical/free-text content must not be sent to general analytics telemetry."
-- s19: "Measure abandonment by step and field-validation friction without collecting sensitive field
-- values."
--
-- A jsonb metadata column would satisfy both today and neither in a year. It is exactly where somebody
-- adds a reason for the visit, a refusal message quoting a patient's answer, or an email address, in a
-- hurry, and nothing refuses it. So this table has no free-text column at all: a step from a closed
-- list, a coarse device class, one integer, and a time. A patient's words CANNOT be written here,
-- rather than merely being forbidden.
--
-- ---- AND NO JOURNEY IDENTIFIER ------------------------------------------------------------------
--
-- Linking a patient's steps into one session would make true per-person funnels possible, and at this
-- product's scale it would also make them re-identifying: a practice taking three bookings a day, plus
-- a journey id and a timestamp, is a patient. Conversion is computed from COUNTS instead -- the ratio
-- of one step to the next answers s19's question without holding anything that points at a person.
--
-- The cost is stated rather than hidden: without linkage, "time to complete" can only be measured on
-- journeys that COMPLETE, as an elapsed figure the client reports on the final step. Abandoned journeys
-- contribute their steps and no duration. `measure` holds that figure and nothing else.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

create table if not exists practice_booking_funnel_event (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- A CLOSED LIST. A step nobody added is a step nobody can chart, and a free-text step name is how a
  -- funnel acquires forty spellings of the same thing.
  step text not null check (step in (
    'profile_viewed',
    'booking_started',
    'availability_viewed',
    'details_started',
    'verification_started',
    'verification_failed',
    'verification_resent',
    'slot_taken_at_commit',
    'booking_confirmed',
    'request_submitted'
  )),

  -- s19's mobile-versus-desktop, at the only resolution that is not a fingerprint.
  device text check (device is null or device in ('mobile', 'desktop', 'unknown')),

  -- ONE INTEGER, AND ITS MEANING IS FIXED BY THE STEP. Seconds to complete on booking_confirmed,
  -- attempt number on verification_failed. Never an identifier, never a count of anything about a
  -- person. Bounded so a bad caller cannot store an epoch here and call it a duration.
  measure integer check (measure is null or (measure >= 0 and measure <= 86400)),

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_practice_funnel_ws_step
  on practice_booking_funnel_event(workspace_id, step, occurred_at desc);

create index if not exists idx_practice_funnel_occurred
  on practice_booking_funnel_event(occurred_at desc);

alter table practice_booking_funnel_event enable row level security;

-- Verification: the table exists with no free-text column beyond the constrained step and device, and
-- both constraints are present. Expect five columns of interest and two constraint rows.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'practice_booking_funnel_event'
 order by ordinal_position;

select conname
  from pg_constraint
 where conrelid = 'practice_booking_funnel_event'::regclass
   and contype = 'c'
 order by conname;

notify pgrst, 'reload schema';
