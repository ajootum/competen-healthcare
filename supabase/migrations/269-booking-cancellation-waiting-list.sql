-- MIGRATION 269: THE WAITING LIST, THE QUEUE PRIORITY AND WHAT A CANCELLATION RECORDS
-- CPR-V5-007 s7.2, s7.7
-- ============================================================

-- ---- 1. s7.7's QUEUE ORDERING ---------------------------------------------------------------
--
-- WARNING: ONE ORDERING, NOT TWO. Every queue read in this product orders by priority then arrival, and
-- under the default policy every row is 0, so that order IS arrival order and nothing changed. The
-- policy on the rule decides whether the desk may set a priority at all -- it never decides how a
-- queue is sorted, because two sort orders for one waiting room is two answers to one question.
alter table practice_queue_entry add column if not exists priority integer not null default 0;
alter table practice_queue_entry drop constraint if exists practice_queue_entry_priority_range;
alter table practice_queue_entry add constraint practice_queue_entry_priority_range
  check (priority between 0 and 3);

-- WARNING: A QUEUE JUMP NOBODY EXPLAINED CANNOT BE ANSWERED FOR. Above routine, a reason is not optional,
-- and the check is btrim so the space bar does not satisfy it.
alter table practice_queue_entry add column if not exists priority_reason text;
alter table practice_queue_entry drop constraint if exists practice_queue_entry_priority_reason;
alter table practice_queue_entry add constraint practice_queue_entry_priority_reason
  check ((priority = 0 and (priority_reason is null or btrim(priority_reason) <> ''))
      or (priority > 0 and priority_reason is not null and btrim(priority_reason) <> ''
          and char_length(priority_reason) <= 300));

create index if not exists idx_practice_queue_entry_order
  on practice_queue_entry(workspace_id, priority desc, entered_at);

-- ---- 2. WHAT A CANCELLATION RECORDS ---------------------------------------------------------
--
-- practice_appointment has held a status and nothing else about a cancellation. "Who cancelled this
-- and why" was answerable only from the audit trail, which is a log and not a column a report can
-- group by. cancelManagedBooking already said out loud that a patient's reason had nowhere to go.
alter table practice_appointment add column if not exists cancellation_reason text;
alter table practice_appointment drop constraint if exists practice_appointment_cancellation_reason_len;
alter table practice_appointment add constraint practice_appointment_cancellation_reason_len
  check (cancellation_reason is null or (btrim(cancellation_reason) <> '' and char_length(cancellation_reason) <= 500));

alter table practice_appointment add column if not exists cancelled_by_kind text;
alter table practice_appointment drop constraint if exists practice_appointment_cancelled_by_kind_known;
alter table practice_appointment add constraint practice_appointment_cancelled_by_kind_known
  check (cancelled_by_kind is null or cancelled_by_kind in ('patient', 'practice'));

-- WARNING: THREE STATES AND NULL IS ONE OF THEM. True means inside the notice period, false means outside,
-- and null means this appointment was never cancelled OR was cancelled before this column existed.
alter table practice_appointment add column if not exists cancelled_within_notice boolean;
alter table practice_appointment add column if not exists cancelled_at timestamptz;

-- ---- 3. s7.2's WAITING LIST -----------------------------------------------------------------
--
-- WARNING: IT HOLDS NO SLOT AND RESERVES NOTHING, exactly as practice_booking_request holds no slot. An
-- offer is a record that somebody was told about a time, and the time stays bookable by anybody
-- until an appointment row takes it -- migration 255's exclusion constraint has the last word.
create table if not exists practice_waiting_list_entry (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  location_id uuid references practice_location(id) on delete set null,
  appointment_type text not null default 'new_consultation'
    check (appointment_type in ('new_consultation', 'scheduled_followup', 'walk_in', 'emergency',
                               'hospital_consultation', 'teleconsultation', 'home_visit')),

  -- Nullable, because somebody may be on a list before they are a patient record.
  patient_id uuid references practice_patient(id) on delete set null,
  patient_name text not null check (btrim(patient_name) <> '' and char_length(patient_name) <= 160),
  contact_phone text check (contact_phone is null or (btrim(contact_phone) <> '' and char_length(contact_phone) <= 40)),
  contact_email text check (contact_email is null or (btrim(contact_email) <> '' and char_length(contact_email) <= 160)),

  -- The window they can actually be seen in. Both nullable: "any time" is a real answer.
  earliest_date date,
  latest_date date,
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 500)),

  status text not null default 'waiting'
    check (status in ('waiting', 'offered', 'booked', 'withdrawn', 'expired')),
  offered_at timestamptz,
  offered_start timestamptz,
  offer_note text check (offer_note is null or (btrim(offer_note) <> '' and char_length(offer_note) <= 500)),
  appointment_id uuid references practice_appointment(id) on delete set null,

  -- Who put them on it. 'patient' exists so the column can tell the truth the day a patient screen
  -- can add to it. Nothing patient-facing writes this row today.
  source text not null default 'practice' check (source in ('practice', 'patient')),

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table practice_waiting_list_entry drop constraint if exists practice_waiting_list_window_order;
alter table practice_waiting_list_entry add constraint practice_waiting_list_window_order
  check (earliest_date is null or latest_date is null or latest_date >= earliest_date);

-- An offered row that names no time, and a booked row that names no appointment, are both records
-- that claim something happened without saying what.
alter table practice_waiting_list_entry drop constraint if exists practice_waiting_list_offer_complete;
alter table practice_waiting_list_entry add constraint practice_waiting_list_offer_complete
  check (status <> 'offered' or (offered_at is not null and offered_start is not null));
alter table practice_waiting_list_entry drop constraint if exists practice_waiting_list_booked_complete;
alter table practice_waiting_list_entry add constraint practice_waiting_list_booked_complete
  check (status <> 'booked' or appointment_id is not null);

create index if not exists idx_practice_waiting_list_ws
  on practice_waiting_list_entry(workspace_id, status, appointment_type);

alter table practice_waiting_list_entry enable row level security;

notify pgrst, 'reload schema';
