-- ============================================================
-- MIGRATION 276: REGISTER AND BOOK IN ONE TRANSACTION
-- CP-SCHED-001 s9 "Register + book -- application orchestration/transaction", s10 concurrency
--
-- ----------------------------------------------------------------------------------------------------
-- WHY THIS EXISTS AT ALL
--
-- The registration desk offers "Register and book 10:20". Today that is two PostgREST calls: create the
-- patient, then create the appointment. Between the moment 10:20 was drawn on the screen and the moment
-- the button was pressed, somebody else can take it -- migration 255's exclusion constraint detects that
-- and refuses the second insert with SQLSTATE 23P01. The patient has already been created by then, so a
-- lost race leaves a half-registered person on the register and a desk that has to work out what
-- happened. With one transaction the whole thing rolls back and the screen can honestly say the time was
-- taken while they were typing, and offer the next free ones.
--
-- ----------------------------------------------------------------------------------------------------
-- WARNING: THIS FUNCTION MAKES NO DECISIONS. IT ONLY WRITES.
--
-- IF YOU FIND YOURSELF ADDING AN "IF" TO THIS FUNCTION, IT BELONGS IN TYPESCRIPT.
--
-- Every judgement stays where the harnesses can break it and a reviewer can read it:
--
--   the capability check          requirePracticeContext, in the API route
--   the minimum dataset           screenRegistration in patients.ts, over registration-config's
--                                 PROTECTED_FIELDS -- a floor that can be lowered is not a floor
--   exact identifier collision    screenRegistration, refused outright and naming the existing patient
--   demographic similarity        screenRegistration, candidates returned and refused until a human says
--   the practice status,          checkPlacement in scheduling.ts -- the one funnel all four booking
--   travel and booking rules      paths already pass through
--   which times may be offered    bookableTimes in patient-booking.ts, on the staff channel
--
-- The body below is therefore a single SQL statement with no branch in it: five data-modifying CTEs and
-- a row of json. It is written in LANGUAGE SQL rather than plpgsql for exactly that reason -- there is
-- no procedural block for a decision to hide in, and the body contains no statement terminator at all,
-- so a runner that splits on semicolons cannot shred it.
--
-- ----------------------------------------------------------------------------------------------------
-- WARNING: SECURITY. THE MOST DANGEROUS THING IN THIS FILE IS THE ONE THAT IS EASY TO FORGET.
--
--   1. SECURITY INVOKER, which is the default, spelt out anyway. RLS on the practice_ tables has no
--      policies at all and every gate in this product is in TypeScript. A SECURITY DEFINER function here
--      would be a door around every one of those capability checks, reachable by anybody who can reach
--      PostgREST.
--   2. REVOKE FROM public, anon AND authenticated. PostgREST publishes every function in the exposed
--      schema as an RPC endpoint, and a newly created function is executable by PUBLIC by default. Without
--      the revoke below, THIS FILE WOULD PUBLISH PATIENT CREATION TO ANY SIGNED-IN USER OF THE PLATFORM.
--      Only service_role may execute it, which is the client the API routes use after they have checked
--      a capability.
--
-- Applied by hand, once, in the Supabase SQL editor. Plain idempotent statements, ASCII only, no
-- anonymous do-blocks, and no semicolon anywhere except at the end of a statement.
-- ============================================================

-- ---- 1. RLS, restated ------------------------------------------------------------------------------
--
-- Idempotent and already true of all four tables. Restated here because a SECURITY INVOKER function
-- inherits the caller's row-level access, so "RLS is on and there are no policies" is part of why the
-- function is safe rather than an unrelated fact about the schema.
alter table practice_patient enable row level security;
alter table practice_patient_identifier enable row level security;
alter table practice_patient_contact enable row level security;
alter table practice_appointment enable row level security;

-- ---- 2. THE TRANSACTION ----------------------------------------------------------------------------
--
-- PostgREST wraps one request in one transaction, so this function IS the transaction. Every CTE below
-- either commits with the others or none of them does.
--
-- WHY CTEs AND NOT A PROCEDURAL BODY: data-modifying statements in WITH are executed exactly once and
-- always to completion, whether or not the final SELECT reads their output, and they all see the same
-- snapshot. So the identifiers and the contacts are written even though nothing reads them back, and the
-- appointment can name the patient the first CTE returned.
--
-- p_identifiers and p_contacts are arrays of objects. An empty array writes nothing, which is why there
-- is no branch for "this patient has no hospital number".
--
-- overlap_acknowledged IS WRITTEN false, AS A CONSTANT AND NOT AS AN ARGUMENT. Migration 255's exclusion
-- constraint carries "and not overlap_acknowledged", so a deliberate double-book is the one thing this
-- path cannot do -- and it should not be able to. A registration desk offering a free time has not
-- decided to double-book anybody, and an argument here would be a way for one to happen by accident.
-- s14's deliberate override remains where it is, on bookAppointment and rescheduleAppointment.
create or replace function practice_register_and_book(
  p_workspace_id uuid,
  p_display_name text,
  p_given_name text,
  p_middle_name text,
  p_family_name text,
  p_sex text,
  p_birth_date date,
  p_age_estimate_years integer,
  p_created_by uuid,
  p_practice_id text,
  p_identifiers jsonb,
  p_contacts jsonb,
  p_location_id uuid,
  p_patient_phone text,
  p_appointment_type text,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_status text,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with new_patient as (
    insert into practice_patient (
      workspace_id, display_name, sex, birth_date, age_estimate_years,
      given_name, middle_name, family_name, created_by
    )
    values (
      p_workspace_id, p_display_name, p_sex, p_birth_date, p_age_estimate_years,
      p_given_name, p_middle_name, p_family_name, p_created_by
    )
    returning id
  ),
  practice_number as (
    insert into practice_patient_identifier (
      workspace_id, patient_id, identifier_type, value, created_by
    )
    select p_workspace_id, np.id, 'practice_id', p_practice_id, p_created_by
    from new_patient np
    returning patient_id
  ),
  extra_identifiers as (
    insert into practice_patient_identifier (
      workspace_id, patient_id, identifier_type, value, issuer, created_by
    )
    select p_workspace_id, np.id, x.identifier_type, x.value, x.issuer, p_created_by
    from new_patient np,
         jsonb_to_recordset(coalesce(p_identifiers, '[]'::jsonb))
           as x(identifier_type text, value text, issuer text)
    returning patient_id
  ),
  new_contacts as (
    insert into practice_patient_contact (
      workspace_id, patient_id, contact_type, value, preferred, created_by
    )
    select p_workspace_id, np.id, x.contact_type, x.value, coalesce(x.preferred, false), p_created_by
    from new_patient np,
         jsonb_to_recordset(coalesce(p_contacts, '[]'::jsonb))
           as x(contact_type text, value text, preferred boolean)
    returning patient_id
  ),
  new_appointment as (
    insert into practice_appointment (
      workspace_id, location_id, patient_id, patient_name, patient_phone,
      appointment_type, scheduled_at, duration_minutes, status, reason,
      overlap_acknowledged, created_by
    )
    select
      p_workspace_id, p_location_id, np.id, p_display_name, p_patient_phone,
      p_appointment_type, p_scheduled_at, p_duration_minutes, p_status, p_reason,
      false, p_created_by
    from new_patient np
    returning id
  )
  select jsonb_build_object(
    'patient_id', (select id from new_patient),
    'appointment_id', (select id from new_appointment),
    'practice_id', p_practice_id,
    'identifiers_written', (select count(*) from extra_identifiers),
    'contacts_written', (select count(*) from new_contacts),
    'practice_number_written', (select count(*) from practice_number)
  )
$$;

-- ---- 3. WARNING: WHO MAY CALL IT. READ THE HEADER BEFORE CHANGING A WORD OF THIS. --------------------------
--
-- A function is executable by PUBLIC the moment it is created, and PostgREST publishes it as an RPC
-- endpoint. Every signed-in user of this platform holds the "authenticated" role. Without the revoke
-- below, any of them could create patients and appointments in ANY practice by naming its workspace id
-- -- the capability check lives in the API route, and an RPC call does not go through the API route.
revoke execute on function practice_register_and_book(
  uuid, text, text, text, text, text, date, integer, uuid, text, jsonb, jsonb,
  uuid, text, text, timestamptz, integer, text, text
) from public, anon, authenticated;

grant execute on function practice_register_and_book(
  uuid, text, text, text, text, text, date, integer, uuid, text, jsonb, jsonb,
  uuid, text, text, timestamptz, integer, text, text
) to service_role;

comment on function practice_register_and_book(
  uuid, text, text, text, text, text, date, integer, uuid, text, jsonb, jsonb,
  uuid, text, text, timestamptz, integer, text, text
) is 'CP-SCHED-001 register-and-book. This function makes no decisions, it only writes. If you find yourself adding an IF, it belongs in TypeScript. service_role only.';

notify pgrst, 'reload schema';
