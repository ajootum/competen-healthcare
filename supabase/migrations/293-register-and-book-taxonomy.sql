-- ============================================================
-- MIGRATION 293: practice_register_and_book LEARNS THE BOOKING TAXONOMY
--
-- !! APPLY THIS FILE WHOLE IN THE SUPABASE SQL EDITOR. It contains a function body, and a runner that
-- splits on semicolons would shred it. Same rule as migrations 195, 276 and 289.
--
-- Migration 292 gave practice_appointment its visit_type_id, consultation_mode_id and booking_source.
-- Both TypeScript engines now write all three. This function is the third writer - the one-statement
-- register-and-book path - and it was still inserting an appointment with none of them, so a patient
-- registered and booked in a single action produced exactly the row the whole arc exists to prevent.
--
-- !! IT IS DROPPED AND RECREATED, NOT REPLACED. create or replace with a different parameter list does
-- not replace anything - it creates an OVERLOAD, and PostgREST would then have two candidates for the
-- same call and no way to choose. The drop names the full old signature so it cannot remove something
-- else by accident, and the two statements are in one file so a half-applied state is not reachable
-- through the SQL editor.
--
-- WHAT DOES NOT CHANGE: the CTE order, the appointment insert staying inside the same statement as the
-- patient insert, and the revoke. A patient created without their booking is the failure this function
-- exists to make impossible, and nothing here loosens that.
--
-- House rules: ASCII only, no partial unique indexes, notify pgrst last, and no semicolon inside any
-- comment - the function body is exempt only because this file is applied whole.
-- ============================================================

drop function if exists practice_register_and_book(
  uuid, text, text, text, text, text, date, integer, uuid, text, smallint, integer, jsonb, jsonb,
  uuid, text, text, timestamptz, integer, text, text
);

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
  p_patient_number text,
  p_registration_year smallint,
  p_sequence_number integer,
  p_identifiers jsonb,
  p_contacts jsonb,
  p_location_id uuid,
  p_patient_phone text,
  p_appointment_type text,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_status text,
  p_reason text,
  p_visit_type_id uuid,
  p_consultation_mode_id uuid,
  p_booking_source text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with new_patient as (
    insert into practice_patient (
      workspace_id, display_name, sex, birth_date, age_estimate_years,
      given_name, middle_name, family_name, created_by,
      patient_number, registration_year, sequence_number
    )
    values (
      p_workspace_id, p_display_name, p_sex, p_birth_date, p_age_estimate_years,
      p_given_name, p_middle_name, p_family_name, p_created_by,
      p_patient_number, p_registration_year, p_sequence_number
    )
    returning id
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
      overlap_acknowledged, created_by,
      visit_type_id, consultation_mode_id, booking_source
    )
    select
      p_workspace_id, p_location_id, np.id, p_display_name, p_patient_phone,
      p_appointment_type, p_scheduled_at, p_duration_minutes, p_status, p_reason,
      false, p_created_by,
      p_visit_type_id, p_consultation_mode_id, p_booking_source
    from new_patient np
    returning id
  )
  select jsonb_build_object(
    'patient_id', (select id from new_patient),
    'appointment_id', (select id from new_appointment),
    'patient_number', p_patient_number,
    'identifiers_written', (select count(*) from extra_identifiers),
    'contacts_written', (select count(*) from new_contacts)
  )
$$;

revoke execute on function practice_register_and_book(
  uuid, text, text, text, text, text, date, integer, uuid, text, smallint, integer, jsonb, jsonb,
  uuid, text, text, timestamptz, integer, text, text, uuid, uuid, text
) from public, anon, authenticated;

notify pgrst, 'reload schema';
