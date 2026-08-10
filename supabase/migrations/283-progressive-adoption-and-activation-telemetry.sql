-- 283 - CPR-ADOPT-001 (Capture Later, Close My Day) + CPR-GROWTH-001 (activation telemetry)
--
-- THE SUBSTRATE ALREADY EXISTS AND THIS MIGRATION IS DELIBERATELY SMALL BECAUSE OF IT. practice_encounter
-- already carries a DRAFT status, an appointment_id, a location_id, a patient_id and a clinical `outcome`
-- of improved/stable/worsened/resolved/recurring/other. Capture Later is not a new record type - it is an
-- encounter shell that a practitioner has not finished, which DRAFT already describes.
--
-- !! BUT A ONE-TAP SEEN IS NOT AN ORDINARY DRAFT, AND SECTION 7 IS EXPLICIT ABOUT WHY. "A Seen status must
-- not imply that diagnoses, medications or investigations were reviewed unless explicitly confirmed", and
-- "system-derived data must be distinguishable from practitioner-confirmed clinical data". A draft started
-- by a practitioner working through a consultation and a shell created by one tap look identical in the
-- status column and mean completely different things about what has been reviewed. So the distinction is
-- recorded rather than inferred.

alter table practice_encounter add column if not exists capture_mode text not null default 'full';
alter table practice_encounter drop constraint if exists practice_encounter_capture_mode_known;
alter table practice_encounter add constraint practice_encounter_capture_mode_known
  check (capture_mode in ('full', 'capture_later'));

-- When the one tap happened, and who tapped. Separate from started_at, which is when clinical work began -
-- for a capture-later shell those are not the same moment and may be hours apart.
alter table practice_encounter add column if not exists seen_at timestamptz;
alter table practice_encounter add column if not exists seen_by uuid references profiles(id);

-- Section 3: "allows defer with reason, never silently marks incomplete clinical information as complete".
-- A deferral is a decision a practitioner made and is recorded as one.
alter table practice_encounter add column if not exists deferred_reason text;
alter table practice_encounter drop constraint if exists practice_encounter_defer_reason_present;
alter table practice_encounter add constraint practice_encounter_defer_reason_present
  check (deferred_reason is null or btrim(deferred_reason) <> '');

create index if not exists idx_practice_encounter_capture_later
  on practice_encounter(workspace_id, capture_mode, status);

-- -- Close My Day - section 3 -------------------------------------------------------------------------
--
-- !! A SESSION ROW EXISTS BECAUSE SECTION 6 REQUIRES RESUMPTION: "end-of-day batch workflow must resume
-- safely after interruption". Without a row there is nothing to resume - the queue could be recomputed, but
-- what the practitioner had already worked through could not, and a batch that silently restarts is how a
-- clinician closes the same six encounters twice and trusts the screen less each time.
--
-- There is no item table. An item IS an encounter, and its per-item state (deferred with a reason, closed)
-- lives on the encounter where the rest of its truth already is.
create table if not exists practice_day_close (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references practice_workspace(id) on delete cascade,
  practitioner_id uuid references profiles(id),
  close_date     date not null,
  status         text not null default 'open',
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table practice_day_close drop constraint if exists practice_day_close_status_known;
alter table practice_day_close add constraint practice_day_close_status_known
  check (status in ('open', 'completed', 'abandoned'));

-- One open session per practitioner per day. A second would split the queue in two and each half would
-- look complete.
--
-- !! THIS IS A PARTIAL INDEX AND MUST NEVER BE USED AS AN UPSERT CONFLICT TARGET. PostgREST resolves
-- on_conflict against a matching unique constraint, and a PARTIAL index does not qualify - the upsert then
-- writes NOTHING and returns no error. That exact trap has produced two silent write failures in this
-- codebase already. The Close My Day engine opens a session with select-then-insert and never discards the
-- insert error. If a full unique constraint is ever wanted here, note that a completed session and a new
-- one for the same day must both be allowed, which is precisely why the index is partial.
create unique index if not exists ux_practice_day_close_open
  on practice_day_close(workspace_id, practitioner_id, close_date)
  where status = 'open';

alter table practice_day_close enable row level security;

alter table practice_encounter add column if not exists day_close_id uuid references practice_day_close(id) on delete set null;
create index if not exists idx_practice_encounter_day_close on practice_encounter(day_close_id);

-- -- CPR-GROWTH-001 - activation telemetry ------------------------------------------------------------
--
-- !! NO CLINICAL CONTENT MAY BE WRITTEN HERE, AND THAT IS THE POINT OF A SEPARATE TABLE. Section 7:
-- "commercial telemetry must avoid exposing unnecessary patient clinical content", "use event metadata and
-- aggregate counts wherever possible", and "customer success users must not receive clinical record access
-- merely because they can view activation status". A milestone row records THAT something happened to a
-- practice, never what was wrong with a patient. The metadata column is deliberately not a place to put a
-- diagnosis, and the harness asserts no seeded emitter writes patient-identifying keys into it.
--
-- Every one of section 2s nine milestones happens once per practice, including the tenth booking, so the
-- unique index makes emission idempotent: an emitter may fire on every booking and only the first will
-- land. That is what makes "reliable event" (section 8) achievable without a scheduler.
create table if not exists practice_activation_event (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references practice_workspace(id) on delete cascade,
  event_key     text not null,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid references profiles(id),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

alter table practice_activation_event drop constraint if exists practice_activation_event_key_present;
alter table practice_activation_event add constraint practice_activation_event_key_present
  check (btrim(event_key) <> '');

create unique index if not exists ux_practice_activation_event
  on practice_activation_event(workspace_id, event_key);

create index if not exists idx_practice_activation_event_key on practice_activation_event(event_key, occurred_at);

alter table practice_activation_event enable row level security;

-- Section 8: "churn/deactivation reasons are captured in structured configurable categories". Configurable
-- means rows, not a TypeScript union - a reason nobody anticipated is the one worth capturing.
create table if not exists practice_churn_reason (
  code       text primary key,
  label      text not null,
  category   text not null default 'other',
  is_active  boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

alter table practice_churn_reason drop constraint if exists practice_churn_reason_label_present;
alter table practice_churn_reason add constraint practice_churn_reason_label_present check (btrim(label) <> '');

alter table practice_churn_reason drop constraint if exists practice_churn_reason_category_known;
alter table practice_churn_reason add constraint practice_churn_reason_category_known
  check (category in ('price', 'fit', 'usability', 'competition', 'circumstance', 'support', 'other'));

alter table practice_churn_reason enable row level security;

-- A starting set, not a closed one. Categories come from section 4s friction language and section 8s
-- requirement that they be structured.
insert into practice_churn_reason (code, label, category, sort) values
  ('too_expensive',        'Too expensive for the practice',              'price',        10),
  ('not_enough_patients',  'Not enough patients booking to justify it',   'fit',          20),
  ('too_hard_to_use',      'Too hard to use during clinic',               'usability',    30),
  ('missing_capability',   'A capability the practice needed is missing', 'fit',          40),
  ('using_another_tool',   'Using another tool instead',                  'competition',  50),
  ('practice_closed',      'Practice closed or practitioner moved',       'circumstance', 60),
  ('no_support',           'Could not get help when needed',              'support',      70),
  ('unstated',             'No reason given',                             'other',        90)
on conflict (code) do update set
  label = excluded.label, category = excluded.category, sort = excluded.sort;

-- !! THE ADOPTION LADDER IS NOT A TABLE. Section 1s seven stages are each defined by an activation SIGNAL
-- - first booking, recurring calendar use, repeat patient, first follow-up, first quick encounter, first
-- Close My Day, repeated insight use - so a practices stage is derived from the events above and stored
-- nowhere. A stored stage is a second source of truth that drifts from the events the moment one is
-- backfilled, and the screen would then show a ladder the data does not support.

notify pgrst, 'reload schema';
