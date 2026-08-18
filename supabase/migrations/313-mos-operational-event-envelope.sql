-- CPR-CORE-MOS-001 phase 2 - the common Practice operational event envelope and the s6 event catalogue.
--
-- This is the store every remaining Product Director module is waiting on. It is what gives Product
-- Health an attempt count to divide by, Workflow Health its eight journeys, Product Intelligence any
-- usage evidence at all, and Adoption an outcome to measure an intervention against.
--
-- THREE THINGS THIS DELIBERATELY DOES NOT STORE, EACH FOR THE SAME REASON
--
--   1. journey_name. s5 lists it, and it is DERIVED here from the catalogue rather than written on
--      every row. The nine-versus-eight journey mistake earlier in this build is exactly what a
--      per-row journey name invites: one surface writes "Save Encounter", another writes
--      "encounter.save", and no aggregation can ever put them together again. The catalogue maps an
--      event name to its journey once. The event carries only the STEP, which the catalogue cannot know.
--
--   2. market and plan cohort. s5 says "derived or attached where safe". They are derivable from the
--      practice through the phase 1 subject chain, and a copy on a hundred thousand event rows would be
--      wrong the moment a practice changes country - which phase 1 acceptance proved happens live.
--
--   3. Anything patient-identifiable. s5 requires strict allowlisted non-PHI operational metadata, and
--      the metadata check below ENFORCES that rather than trusting every future emitter to remember.
--
-- WHY event_name IS A FOREIGN KEY AND NOT FREE TEXT
--
-- s6 calls it a catalogue and the whole value of this table is aggregation across surfaces. Free text
-- drifts: a typo becomes a permanent second series that no query will ever notice is a duplicate. The
-- cost is that a genuinely new event needs a catalogue row, which is a deliberate act rather than a
-- side effect - and that is the intended trade.

create table if not exists mos_journey (
  key         text primary key,
  name        text not null,
  -- the s7 minimum measurable outcome for this journey, so an instrumentation gap is legible from the row
  outcome_req text not null,
  sort_order  int not null,
  created_at  timestamptz not null default now()
);

comment on table mos_journey is
  'CPR-CORE-MOS-001 s7 critical journeys. ONE list, referenced by the event catalogue, so two surfaces cannot name the same journey differently.';

alter table mos_journey enable row level security;

insert into mos_journey (key, name, outcome_req, sort_order) values
  ('sign_in',          'Sign in to Practice', 'attempt, completion or failure, duration', 1),
  ('open_planner',     'Open Planner',        'attempt, usable render or failure, duration', 2),
  ('patient_booking',  'Patient Booking',     'start, completion or failure, duration and reason', 3),
  ('start_encounter',  'Start Encounter',     'attempt, completion or failure', 4),
  ('save_encounter',   'Save Encounter',      'attempt, success or failure, latency, correlation', 5),
  ('create_follow_up', 'Create Follow-up',    'attempt, success or failure', 6),
  ('issue_document',   'Issue Document',      'attempt, success or failure', 7),
  ('generate_invoice', 'Generate Invoice',    'attempt, success or failure', 8)
on conflict (key) do update
  set name = excluded.name, outcome_req = excluded.outcome_req, sort_order = excluded.sort_order;

create table if not exists mos_event_name (
  name        text primary key,
  domain      text not null,
  -- null for events that belong to no critical journey, such as a deployment
  journey_key text references mos_journey(key),
  description text not null,
  created_at  timestamptz not null default now()
);

comment on table mos_event_name is
  'CPR-CORE-MOS-001 s6 minimum event catalogue. A new event name is a deliberate catalogue row, not a typo that becomes a permanent second series.';

alter table mos_event_name enable row level security;

insert into mos_event_name (name, domain, journey_key, description) values
  ('practice.access.started',            'access',        'sign_in',          'A sign-in attempt began'),
  ('practice.access.succeeded',          'access',        'sign_in',          'A practitioner reached an authenticated session'),
  ('practice.access.failed',             'access',        'sign_in',          'A sign-in attempt failed'),
  ('practice.planner.opened',            'planner',       'open_planner',     'The Planner reached a usable state'),
  ('practice.planner.open_failed',       'planner',       'open_planner',     'The Planner failed to reach a usable state'),
  ('practice.booking.started',           'booking',       'patient_booking',  'A booking was begun'),
  ('practice.booking.created',           'booking',       'patient_booking',  'A booking was accepted and created'),
  ('practice.booking.failed',            'booking',       'patient_booking',  'A booking failed validation or availability'),
  ('practice.booking.cancelled',         'booking',       'patient_booking',  'A booking was cancelled'),
  ('practice.encounter.started',         'encounter',     'start_encounter',  'An encounter was opened'),
  ('practice.encounter.save_attempted',  'encounter',     'save_encounter',   'A save of clinical content was attempted'),
  ('practice.encounter.saved',           'encounter',     'save_encounter',   'Clinical content was persisted'),
  ('practice.encounter.save_failed',     'encounter',     'save_encounter',   'A save of clinical content failed'),
  ('practice.encounter.completed',       'encounter',     'save_encounter',   'An encounter was completed and locked'),
  ('practice.followup.created',          'follow_up',     'create_follow_up', 'A follow-up was raised'),
  ('practice.followup.failed',           'follow_up',     'create_follow_up', 'A follow-up could not be raised'),
  ('practice.followup.completed',        'follow_up',     'create_follow_up', 'A follow-up was completed'),
  ('practice.document.generated',        'documents',     'issue_document',   'A document was rendered'),
  ('practice.document.issued',           'documents',     'issue_document',   'A document was issued to the patient record'),
  ('practice.document.issue_failed',     'documents',     'issue_document',   'A document failed to issue'),
  ('practice.invoice.generated',         'commercial',    'generate_invoice', 'An invoice was generated'),
  ('practice.invoice.generate_failed',   'commercial',    'generate_invoice', 'An invoice failed to generate'),
  ('practice.sync.started',              'sync',          null,               'A device sync began'),
  ('practice.sync.completed',            'sync',          null,               'A device sync completed'),
  ('practice.sync.failed',               'sync',          null,               'A device sync failed'),
  ('practice.sync.conflict_detected',    'sync',          null,               'A sync conflict was detected'),
  ('practice.communication.queued',      'communication', null,               'A message was queued'),
  ('practice.communication.sent',        'communication', null,               'A message was handed to a provider'),
  ('practice.communication.delivered',   'communication', null,               'A message was confirmed delivered'),
  ('practice.communication.failed',      'communication', null,               'A message failed to deliver'),
  ('practice.ai.requested',              'ai',            null,               'An AI request was made'),
  ('practice.ai.completed',              'ai',            null,               'An AI request completed'),
  ('practice.ai.failed',                 'ai',            null,               'An AI request errored'),
  ('practice.ai.timed_out',              'ai',            null,               'An AI request timed out'),
  ('practice.ai.rate_limited',           'ai',            null,               'An AI request was rate limited'),
  ('practice.trial.started',             'commercial',    null,               'A trial began'),
  ('practice.trial.ended',               'commercial',    null,               'A trial ended'),
  ('practice.entitlement.changed',       'commercial',    null,               'An entitlement was granted, changed or withdrawn'),
  ('practice.configuration.proposed',    'configuration', null,               'A configuration change was proposed'),
  ('practice.configuration.approved',    'configuration', null,               'A configuration change was approved'),
  ('practice.configuration.activated',   'configuration', null,               'A configuration change became effective'),
  ('practice.configuration.failed',      'configuration', null,               'A configuration activation failed'),
  ('practice.configuration.rolled_back', 'configuration', null,               'A configuration change was reverted'),
  ('practice.release.deployed',          'release',       null,               'A release was deployed')
on conflict (name) do update
  set domain = excluded.domain, journey_key = excluded.journey_key, description = excluded.description;

create table if not exists mos_event (
  event_id       uuid primary key default gen_random_uuid(),
  event_name     text not null references mos_event_name(name),
  occurred_at    timestamptz not null default now(),
  product_code   text not null default 'competen_practice',
  -- null for an event that is not attributable to one Practice, such as a platform-wide deployment
  practice_id    uuid references practice_workspace(id) on delete cascade,
  practitioner_id uuid,
  session_id     text,
  -- s14 requires correlation across workflow events, configuration activation, incidents and jobs, so
  -- this is NOT NULL - an event that cannot be joined to the transaction it belongs to cannot
  -- reconstruct a journey, which is the one thing this table exists to make possible
  correlation_id uuid not null,
  -- the step WITHIN a journey. The journey itself is derived from the catalogue, never written here
  journey_step   text,
  component      text not null,
  outcome        text not null
                 check (outcome in ('started', 'success', 'failure', 'timeout', 'cancelled')),
  duration_ms    integer check (duration_ms is null or duration_ms >= 0),
  failure_code   text,
  release_version text,
  subject_type   text not null default 'practice' references mos_subject_type(code),
  subject_id     text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  -- a failure code belongs only to a failed outcome, so a success cannot carry a stale one
  constraint mos_event_failure_code_scope
    check (failure_code is null or outcome in ('failure', 'timeout')),
  -- the typed subject and the Practice reference cannot disagree about which Practice this is
  constraint mos_event_subject_agrees
    check (subject_type <> 'practice' or subject_id is null or practice_id is null
           or subject_id = practice_id::text),
  -- s5 privacy, ENFORCED. A future emitter cannot put a patient reference in operational metadata by
  -- forgetting, because the row is rejected. This is a floor and not a substitute for review
  constraint mos_event_metadata_is_not_phi
    check (not (metadata ?| array['patient_id', 'patient_name', 'patient_ref', 'mrn', 'nhs_number',
                                  'date_of_birth', 'dob', 'diagnosis', 'medication', 'clinical_note',
                                  'notes', 'symptoms', 'allergy']))
);

comment on table mos_event is
  'CPR-CORE-MOS-001 s5 common operational event envelope. The single Practice-attributed evidence store the Product Director modules read. journey_name is derived from mos_event_name and market from the phase 1 subject chain - neither is copied onto a row.';

alter table mos_event enable row level security;

create index if not exists idx_mos_event_practice_time on mos_event (practice_id, occurred_at desc);
create index if not exists idx_mos_event_name_time on mos_event (event_name, occurred_at desc);
create index if not exists idx_mos_event_correlation on mos_event (correlation_id);
create index if not exists idx_mos_event_outcome_time on mos_event (outcome, occurred_at desc);

-- The journey view every workflow-health surface reads, so no caller re-implements the join from event
-- name to journey and none of them can disagree about which events belong to which journey.
create or replace view mos_journey_event as
  select
    j.key         as journey_key,
    j.name        as journey_name,
    j.sort_order  as journey_order,
    e.event_id,
    e.event_name,
    e.occurred_at,
    e.practice_id,
    e.correlation_id,
    e.journey_step,
    e.outcome,
    e.duration_ms,
    e.failure_code,
    e.release_version
  from mos_event e
  join mos_event_name n on n.name = e.event_name
  join mos_journey j on j.key = n.journey_key;

comment on view mos_journey_event is
  'CPR-CORE-MOS-001 s7 - events that belong to a critical journey, with the journey resolved from the catalogue. One join, written once.';

notify pgrst, 'reload schema';
