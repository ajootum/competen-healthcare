-- ============================================================
-- MIGRATION 289: CP PATIENT NUMBERING - YY-NNNNNN
-- CPR-PID-001 v1.0, FROZEN: patient number YY-NNNNNN, sequential within Practice Workspace and
-- registration year, server generated, immutable, never reused, backed by the existing uuid primary
-- key as the technical identifier. Owner decision 2026-08-11: existing P-XXXXXX practice ids RETIRE to
-- searchable legacy aliases and stay in practice_patient_identifier untouched. New registrations stop
-- issuing them.
--
-- !! APPLY THIS FILE WHOLE IN THE SUPABASE SQL EDITOR. It contains function bodies, and a runner that
-- splits on semicolons would shred them. Same rule as migrations 195 and 276.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS FILE DOES, IN ORDER
--   1. Three columns on practice_patient: patient_number, registration_year, sequence_number.
--   2. Uniqueness: (workspace_id, patient_number) and (workspace_id, registration_year,
--      sequence_number). Both FULL unique indexes - nulls are distinct, so legacy rows do not collide
--      before the backfill below fills them.
--   3. practice_patient_number_counter + practice_next_patient_number(): the atomic allocator. The
--      spec forbids MAX(sequence_number) + 1, because two simultaneous registrations would both read
--      the same max. One upsert with RETURNING is atomic in Postgres - two concurrent callers serialise
--      on the row lock and get different numbers.
--   4. practice_register_and_book REPLACED: the patient insert now carries the three number columns,
--      and the practice_id identifier CTE is GONE - new patients do not get a P-XXXXXX. The old
--      19-argument signature is dropped so no caller can reach the numberless writer by accident.
--   5. BACKFILL (spec s15): every existing patient without a number gets one, ordered by created_at
--      then id within each workspace and registration year, year taken in the workspace timezone.
--      Idempotent - a re-run finds patient_number already set and touches nothing.
--   6. Counters seeded from the backfill maximum, so the next registration continues the sequence.
--   7. Immutability guard trigger: once assigned, the three columns refuse change (spec s6). BEFORE
--      UPDATE only - the migration 202 lesson about cascade deletes does not apply to update triggers.
--
-- ----------------------------------------------------------------------------------------------------
-- !! SECURITY, SAME SHAPE AS 276. Functions are SECURITY INVOKER and revoked from public, anon and
-- authenticated - PostgREST publishes every function as an RPC and a fresh function is executable by
-- PUBLIC. Only service_role may allocate numbers or run the transaction, and it does so behind the API
-- routes that checked a capability first.
--
-- !! GAPS ARE ACCEPTABLE AND REUSE IS NOT (spec s6). An allocation whose registration then fails
-- leaves a hole in the sequence. That is the correct trade: closing the hole would mean reusing a
-- number that may have been seen, written down or printed.
-- ============================================================

-- ---- 1. The columns --------------------------------------------------------------------------------

alter table practice_patient add column if not exists patient_number text;

alter table practice_patient add column if not exists registration_year smallint;

alter table practice_patient add column if not exists sequence_number integer;

-- Format held by a constraint so no writer can invent a different shape. Null stays allowed - the
-- columns are filled at registration for new rows and by the backfill below for old ones.
alter table practice_patient drop constraint if exists ck_practice_patient_number_format;

alter table practice_patient add constraint ck_practice_patient_number_format
  check (patient_number is null or patient_number ~ '^[0-9]{2}-[0-9]{6}$');

alter table practice_patient drop constraint if exists ck_practice_patient_sequence_positive;

alter table practice_patient add constraint ck_practice_patient_sequence_positive
  check (sequence_number is null or sequence_number >= 1);

-- ---- 2. Uniqueness (spec s5) -----------------------------------------------------------------------

create unique index if not exists ux_practice_patient_number
  on practice_patient (workspace_id, patient_number);

create unique index if not exists ux_practice_patient_year_sequence
  on practice_patient (workspace_id, registration_year, sequence_number);

create index if not exists ix_practice_patient_number_lookup
  on practice_patient (patient_number);

-- ---- 3. The counter and the allocator (spec s9) ----------------------------------------------------

create table if not exists practice_patient_number_counter (
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  registration_year smallint not null,
  last_sequence integer not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, registration_year)
);

alter table practice_patient_number_counter enable row level security;

create or replace function practice_next_patient_number(
  p_workspace_id uuid,
  p_registration_year smallint
)
returns integer
language sql
security invoker
set search_path = pg_catalog, public
as $$
  insert into practice_patient_number_counter (workspace_id, registration_year, last_sequence)
  values (p_workspace_id, p_registration_year, 1)
  on conflict (workspace_id, registration_year)
  do update set last_sequence = practice_patient_number_counter.last_sequence + 1, updated_at = now()
  returning last_sequence
$$;

revoke execute on function practice_next_patient_number(uuid, smallint) from public, anon, authenticated;

grant execute on function practice_next_patient_number(uuid, smallint) to service_role;

comment on function practice_next_patient_number(uuid, smallint) is 'CPR-PID-001 s9 atomic patient number allocator. Never derive a number from MAX plus one. service_role only.';

-- ---- 4. The transaction, replaced ------------------------------------------------------------------
--
-- The old signature is DROPPED, not left as an overload: a surviving numberless writer would be a path
-- to a patient without a number, discovered only when a register sorts by it.

drop function if exists practice_register_and_book(
  uuid, text, text, text, text, text, date, integer, uuid, text, jsonb, jsonb,
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
    'patient_number', p_patient_number,
    'identifiers_written', (select count(*) from extra_identifiers),
    'contacts_written', (select count(*) from new_contacts)
  )
$$;

revoke execute on function practice_register_and_book(
  uuid, text, text, text, text, text, date, integer, uuid, text, smallint, integer, jsonb, jsonb,
  uuid, text, text, timestamptz, integer, text, text
) from public, anon, authenticated;

grant execute on function practice_register_and_book(
  uuid, text, text, text, text, text, date, integer, uuid, text, smallint, integer, jsonb, jsonb,
  uuid, text, text, timestamptz, integer, text, text
) to service_role;

comment on function practice_register_and_book(
  uuid, text, text, text, text, text, date, integer, uuid, text, smallint, integer, jsonb, jsonb,
  uuid, text, text, timestamptz, integer, text, text
) is 'CP-SCHED-001 register-and-book carrying the CPR-PID-001 patient number. This function makes no decisions, it only writes. service_role only.';

-- ---- 5. Backfill (spec s15) ------------------------------------------------------------------------
--
-- Ordered by created_at then id within each workspace and registration year, the year read in the
-- workspace timezone. Runs before the counters are seeded so the seed can read the maxima. The where
-- clause makes a re-run a no-op.

update practice_patient p
set registration_year = x.reg_year,
    sequence_number = x.seq,
    patient_number = lpad((x.reg_year % 100)::text, 2, '0') || '-' || lpad(x.seq::text, 6, '0')
from (
  select p2.id,
         extract(year from (p2.created_at at time zone coalesce(nullif(btrim(w.timezone), ''), 'UTC')))::smallint as reg_year,
         (row_number() over (
           partition by p2.workspace_id,
                        extract(year from (p2.created_at at time zone coalesce(nullif(btrim(w.timezone), ''), 'UTC')))
           order by p2.created_at, p2.id
         ))::integer as seq
  from practice_patient p2
  join practice_workspace w on w.id = p2.workspace_id
  where p2.patient_number is null
) x
where p.id = x.id;

-- ---- 6. Seed the counters from what the backfill assigned ------------------------------------------

insert into practice_patient_number_counter (workspace_id, registration_year, last_sequence)
select workspace_id, registration_year, max(sequence_number)
from practice_patient
where registration_year is not null and sequence_number is not null
group by workspace_id, registration_year
on conflict (workspace_id, registration_year)
do update set last_sequence = greatest(practice_patient_number_counter.last_sequence, excluded.last_sequence);

-- ---- 7. Immutability (spec s6) ---------------------------------------------------------------------
--
-- Null to value is the assignment and is allowed. Value to anything else is refused, whoever asks.

create or replace function practice_patient_number_guard()
returns trigger
language plpgsql
as $$
begin
  if old.patient_number is not null and new.patient_number is distinct from old.patient_number then
    raise exception 'patient_number is immutable once assigned (CPR-PID-001 s6)';
  end if;
  if old.registration_year is not null and new.registration_year is distinct from old.registration_year then
    raise exception 'registration_year is immutable once assigned (CPR-PID-001 s6)';
  end if;
  if old.sequence_number is not null and new.sequence_number is distinct from old.sequence_number then
    raise exception 'sequence_number is immutable once assigned (CPR-PID-001 s6)';
  end if;
  return new;
end
$$;

drop trigger if exists trg_practice_patient_number_guard on practice_patient;

create trigger trg_practice_patient_number_guard
  before update on practice_patient
  for each row execute function practice_patient_number_guard();

notify pgrst, 'reload schema';
