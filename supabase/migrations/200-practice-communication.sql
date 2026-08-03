-- ============================================================
-- MIGRATION 200: COMMUNICATION AND DOCUMENT MANAGEMENT (CPR-320)
--
-- Three things: internal messages between members of a practice, a register of communication WITH
-- patients, and a register of documents that ARRIVE at the practice. The last of the operational spine.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- FIVE BOUNDARY DECISIONS.
--
-- 1. CPR-130 OWNS WHAT LEAVES; THIS OWNS WHAT ARRIVES. practice_clinical_document is the practice's own
--    issued artefact -- signed, versioned, immutable. An incoming lab result is none of those things:
--    the practice did not author it and cannot amend it. Merging the two registers would hang issued-
--    document machinery (signatures, supersession) on rows it cannot apply to.
--
-- 2. COMMUNICATION WITH A PATIENT IS RECORDED, NOT PERFORMED. CPR-340's no-sending rule stands: this
--    product has no email, SMS or patient-messaging channel. What a practice DOES have is a phone on the
--    desk -- and today "three calls, no answer" lives in nobody's record. practice_contact_log is
--    the register of calls that happened in the world, the same posture as CPR-130's release register.
--    There is no channel column that sends, and no sent_at.
--
-- 3. UNREAD IS DERIVED, NOT STORED. A message row never carries a per-recipient unread flag, and no
--    notification row is written for a posted message -- "you have unread messages" is computable from
--    a read cursor, and CPR-340 established that anything derivable must be derived or two sources of
--    truth will disagree. practice_thread_read holds one cursor per person per thread; everything else
--    is arithmetic at read time.
--
-- 4. NO FILE STORAGE, NAMED RATHER THAN FAKED. The incoming register records THAT a document exists,
--    what it is, and WHERE IT IS HELD ("paper file", "hospital portal"). Scanning and upload is an
--    infrastructure and retention-policy decision -- virus scanning, size limits, storage RLS, how long
--    a clinical scan is kept -- and half-doing it produces a shadow record system. where_held is the
--    honest column until that decision is made properly.
--
-- 5. THE UNREVIEWED INCOMING RESULT IS THE MISSED-RESULT HARM. A lab result that arrived and was never
--    looked at is the classic way a practice hurts somebody by omission. So REVIEWED is a clinical
--    stamp -- who and when -- gated to the practitioner at the API, and "received but not reviewed" is
--    derived onto the operations home where it ranks with the overdue follow-ups.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- NAMING NOTE, RECORDED BECAUSE IT FAILED ONCE. The contact register is practice_contact_log, not
-- practice_patient_contact -- migration 193 already owns that name for a patient's contact DETAILS
-- (phones and emails). The first draft of this file collided with it: `create table if not exists`
-- skipped silently and the occurred_at index then failed against 193's table. `if not exists` makes a
-- collision quieter, not safer -- check the name list in the build plan before coining one.
--
-- >>> APPLY THIS FILE AS A WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 5's trigger functions are plpgsql with internal semicolons inside $$ ... $$.
-- SAFE TO RE-RUN after the partial first attempt: every statement is idempotent, so the thread tables
-- that did apply are skipped and the rest lands.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. Threads and messages -------------------------------------------------------------------------

create table if not exists practice_thread (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 200),
  -- What the conversation is ABOUT, all optional and all mere references: reading a thread that
  -- mentions a patient is not reading the patient, and opening their record still needs patient.view.
  patient_id uuid references practice_patient(id) on delete set null,
  encounter_id uuid references practice_encounter(id) on delete set null,
  document_id uuid references practice_clinical_document(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid,
  -- Searchable by subject as well as by message body: the summary line is often the only place the
  -- key word appears.
  search_vector tsvector generated always as (to_tsvector('english', coalesce(subject, ''))) stored
);

create index if not exists idx_practice_thread_ws on practice_thread(workspace_id, last_message_at desc);
create index if not exists idx_practice_thread_patient on practice_thread(patient_id) where patient_id is not null;
create index if not exists idx_practice_thread_search on practice_thread using gin(search_vector);

create table if not exists practice_thread_message (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  thread_id uuid not null references practice_thread(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 8000),
  author_id uuid not null,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (to_tsvector('english', coalesce(body, ''))) stored
);

create index if not exists idx_practice_message_thread on practice_thread_message(thread_id, created_at);
create index if not exists idx_practice_message_search on practice_thread_message using gin(search_vector);

-- One cursor per person per thread. A FULL unique index, deliberately -- PostgREST upsert cannot
-- target a partial one, and that trap has bitten this codebase twice already.
create table if not exists practice_thread_read (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  thread_id uuid not null references practice_thread(id) on delete cascade,
  user_id uuid not null,
  last_read_at timestamptz not null default now()
);

create unique index if not exists ux_practice_thread_read on practice_thread_read(thread_id, user_id);

-- ---- 2. The patient contact register -----------------------------------------------------------------

create table if not exists practice_contact_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid not null references practice_patient(id) on delete cascade,
  -- The commitment this call was chasing, where there is one -- "three calls, no answer" then sits
  -- beside the follow-up it evidences.
  follow_up_id uuid references practice_follow_up(id) on delete set null,
  encounter_id uuid references practice_encounter(id) on delete set null,
  -- HOW the contact happened IN THE WORLD. sms_external and whatsapp_external mean a personal or
  -- practice phone outside this product; nothing here sends anything.
  channel text not null default 'phone'
    check (channel in ('phone', 'in_person', 'sms_external', 'whatsapp_external', 'letter', 'other')),
  direction text not null default 'outgoing' check (direction in ('outgoing', 'incoming')),
  outcome text not null default 'reached'
    check (outcome in ('reached', 'no_answer', 'left_message', 'spoke_to_relative', 'number_unreachable')),
  summary text not null check (char_length(summary) between 1 and 1000),
  occurred_at timestamptz not null default now(),
  recorded_by uuid,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (to_tsvector('english', coalesce(summary, ''))) stored
);

create index if not exists idx_practice_contactlog_patient on practice_contact_log(patient_id, occurred_at desc);
create index if not exists idx_practice_contactlog_followup on practice_contact_log(follow_up_id) where follow_up_id is not null;
create index if not exists idx_practice_contactlog_search on practice_contact_log using gin(search_vector);

-- ---- 3. The incoming document register ---------------------------------------------------------------

create table if not exists practice_incoming_document (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- Nullable, and NOT required to be active: a result can arrive for a patient who has since been
  -- archived, and refusing to register it would lose the fact that it arrived.
  patient_id uuid references practice_patient(id) on delete set null,
  doc_type text not null default 'letter'
    check (doc_type in ('lab_result', 'imaging_report', 'discharge_summary', 'referral_response', 'letter', 'other')),
  source text not null check (char_length(source) between 1 and 200),
  title text not null check (char_length(title) between 1 and 240),
  summary text,
  received_on date not null default current_date,
  -- Boundary decision 4: where the artefact actually is, since this product does not hold it.
  where_held text,
  priority text not null default 'routine' check (priority in ('routine', 'urgent')),
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'REVIEWED', 'ACTIONED')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  actioned_by uuid,
  actioned_at timestamptz,
  action_note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  search_vector tsvector generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(source, ''))) stored
);

create index if not exists idx_practice_incoming_ws on practice_incoming_document(workspace_id, status, received_on desc);
create index if not exists idx_practice_incoming_patient on practice_incoming_document(patient_id) where patient_id is not null;
create index if not exists idx_practice_incoming_search on practice_incoming_document using gin(search_vector);

-- ---- 4. Capabilities + backfill ----------------------------------------------------------------------
--
-- message.use for everyone who works here: internal discussion is the whole team's.
-- comm.record for the people who phone patients -- the practitioner and the assistant whose job the
--   chasing actually is. Not the owner: the contact register is patient-facing clinical admin.
-- inbox.record for practitioner and assistant: logging what the post brought is desk work.
-- inbox.review for the PRACTITIONER ONLY: deciding a lab result needs nothing is a clinical judgement,
--   and the register exists so that judgement is stamped with a name.

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'message.use'),
  ('practice_assistant', 'message.use'),
  ('practice_owner', 'message.use'),
  ('practitioner', 'comm.record'),
  ('practice_assistant', 'comm.record'),
  ('practitioner', 'inbox.record'),
  ('practice_assistant', 'inbox.record'),
  ('practitioner', 'inbox.review')
on conflict (role_code, capability_code) do nothing;

insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
  );

-- ---- 5. What was said cannot be unsaid ---------------------------------------------------------------
--
-- A message that has been read, and a record of a phone call that happened, are historical facts --
-- the same rule as note versions (195), follow-up events (196), procedure outcomes (197) and task
-- events (198). The INCOMING register is deliberately NOT triggered: its status flows forward and its
-- stamps are engine-enforced, and a register row is not a record of what somebody said.

create or replace function practice_thread_message_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'message % has been seen and cannot be changed', old.id;
end;
$$;

drop trigger if exists trg_practice_thread_message_immutable on practice_thread_message;
create trigger trg_practice_thread_message_immutable
  before update on practice_thread_message
  for each row execute function practice_thread_message_immutable();

create or replace function practice_contact_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'contact record % is part of the record and cannot be changed', old.id;
end;
$$;

drop trigger if exists trg_practice_contact_log_immutable on practice_contact_log;
create trigger trg_practice_contact_log_immutable
  before update on practice_contact_log
  for each row execute function practice_contact_log_immutable();

-- ---- 6. RLS: deny-by-default -------------------------------------------------------------------------

alter table practice_thread enable row level security;
alter table practice_thread_message enable row level security;
alter table practice_thread_read enable row level security;
alter table practice_contact_log enable row level security;
alter table practice_incoming_document enable row level security;

notify pgrst, 'reload schema';
