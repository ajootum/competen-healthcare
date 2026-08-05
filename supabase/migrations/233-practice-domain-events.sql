-- ============================================================
-- MIGRATION 233: DOMAIN EVENT OUTBOX (CPR-CORE-001 s3 "Event-driven", s9/s9.1, backlog CORE-09)
--
-- CPR-CORE-001 s3: "Dashboard summaries update from domain events rather than direct widget-to-database
-- queries." Today every card on the Command Centre asks the database its own question, which is why two
-- cards can disagree about the same number and why nothing on the page knows that anything changed. This
-- table is the one place a state change is announced, and s9's catalogue is the vocabulary it is
-- announced in.
--
-- NOT practice_audit_event (migration 191). That table answers "who did what, and can we prove it" -- it
-- is append-only, retained for compliance, free-text in its event_type, and has NO consumer. This one
-- answers "what changed, so which read model must be rebuilt" -- it has a CLOSED type catalogue that a
-- projection can exhaustively switch on, typed context columns a projection can filter on without
-- opening a jsonb blob, and a published_at that says whether the change has reached the stream yet.
-- Writing one and calling it the other would mean either an audit log that gets pruned once a widget has
-- consumed it, or a dashboard feed whose event names nobody can rely on. Both are kept, and section 13's
-- "all state-changing actions require actor, timestamp, source and audit entry" is satisfied by the
-- audit table. This table exists for delivery, not for proof.
--
-- THE OUTBOX IS NOT THE SOURCE OF TRUTH AND MUST NEVER BE TREATED AS ONE. practice_activity's
-- started_at/ended_at remain the record of what happened. A lost event costs freshness (the s12 polling
-- fallback still repaints the card within a minute), and a lost state change costs a clinic. That asymmetry
-- is why src/lib/practice/events.ts never lets a failed emit fail the write it describes, and why the
-- log stays reconcilable against state rather than replacing it.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_domain_event ----------------------------------------------------------------------

create table if not exists practice_domain_event (
  -- s9.1's event_id. Named `id` because every other key in this schema is named `id`, and a table whose
  -- primary key is spelled differently is a table every generic helper has to special-case.
  id uuid primary key default gen_random_uuid(),

  -- s9.1's practice_id. Named workspace_id because practice_workspace is the row it points at and every
  -- other practice table spells the tenancy column that way, and renaming it here would put this table
  -- outside the tenancy-drift checks that sweep for exactly this column.
  --
  -- CASCADE, deliberately. A deleted practice must not leave a trail of events describing its patients'
  -- movements. The compliance record of the deletion itself lives in practice_audit_event.
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- s9's catalogue, complete and closed. A CHECK rather than a comment because a consumer that switches
  -- exhaustively on the type is only safe if the database refuses a type nobody wrote a branch for.
  -- The mirror of this list is PRACTICE_EVENT_TYPES in src/lib/practice/events.ts, and the harness asserts
  -- every entry there is accepted here, because a name that exists in TypeScript and not in this
  -- constraint does not fail loudly -- it fails on every emit, forever, in a swallowed error.
  event_type text not null check (event_type in (
    'activity.planned', 'activity.confirmed', 'activity.started', 'activity.paused',
    'activity.completed',
    'session.started', 'session.paused', 'session.resumed', 'session.closed',
    'appointment.created', 'appointment.cancelled',
    'patient.checked_in',
    'queue.entry_created', 'queue.entry_status_changed',
    'encounter.created', 'encounter.started', 'encounter.paused', 'encounter.completed',
    'encounter.reopened',
    'followup.created', 'followup.booked', 'followup.due', 'followup.completed',
    'result.received', 'result.reviewed',
    'task.created', 'task.completed',
    'document.created', 'document.signed', 'document.issued',
    'message.received',
    'alert.created', 'alert.resolved',
    'metric.snapshot_created')),

  -- s9.1's version. The envelope's shape is a contract with consumers that will outlive this migration --
  -- a payload that changes meaning without changing this number is a silent break in every projection.
  version integer not null default 1 check (version >= 1),

  -- WHEN IT HAPPENED and WHEN IT WAS WRITTEN, kept apart. They differ whenever an emit is retried or an
  -- integration replays a backlog, and a stream cursor that orders by occurred_at would then skip events
  -- it had already passed. occurred_at is what a timeline draws, and recorded_at is what a reader paginates.
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),

  -- ---- WHO ---------------------------------------------------------------------------------------
  --
  -- TWO PEOPLE, NEVER COLLAPSED INTO ONE. practitioner_id is whose work the event is about. actor_id is
  -- who caused it. They are the same person today because nothing in V3 is delegated yet, and they stop
  -- being the same the first time a receptionist checks a patient in -- at which point an events table
  -- that had only kept one of them cannot say which one it kept. s13 requires the actor specifically.
  practitioner_id uuid not null,
  actor_id uuid not null,

  -- s9.1's source, and s13's requirement that every state-changing action records the channel it came
  -- through. Not nullable and not defaulted: "we do not know how this happened" is not a channel, and a
  -- default would quietly file a cron job's writes as though a person had made them in a browser.
  source text not null check (source in ('web', 'mobile', 'integration', 'system')),

  -- ---- WHAT IT WAS ABOUT -------------------------------------------------------------------------
  --
  -- s9.1's optional context, as columns rather than as payload keys, because these are what a consumer
  -- FILTERS on: "the events for this session", "the events for this patient". Buried in jsonb they
  -- would each cost a scan.
  --
  -- NO FOREIGN KEYS ON ANY OF THEM, and this is a decision rather than an omission. An event is a
  -- statement about the past. `on delete set null` would rewrite "encounter completed for patient X"
  -- into "encounter completed for nobody" and a projection replaying the log would then produce
  -- different numbers than it did yesterday, with nothing anywhere recording that the history changed.
  -- `on delete cascade` would delete the history outright. A dangling id in an event log is honest: it
  -- says the thing existed when this happened. Referential integrity for LIVE data belongs on the live
  -- tables, which have it. Tenancy is still enforced -- workspace_id above is a real foreign key.
  location_id uuid,

  -- s9.1's activity_instance_id: practice_activity.id (migration 232).
  activity_instance_id uuid,

  -- s9.1's session_id. There is no practice_session table in this build: CPR-CORE-001 s5 models Session
  -- as a container inside an activity instance, and V3 collapsed the two, so the session IS the running
  -- activity and this column carries the same id as activity_instance_id today. Kept as its own column
  -- anyway, because s6's two state models are genuinely different (an activity is planned/active/
  -- completed, a session is draft/ready/active/paused/closing/closed) and the day sessions become rows
  -- of their own, consumers that filtered on session_id keep working unchanged.
  session_id uuid,

  patient_id uuid,
  encounter_id uuid,

  -- s9.1's payload. Everything type-specific goes here, and nothing a consumer filters on does.
  payload jsonb not null default '{}'::jsonb,

  -- ---- DELIVERY ----------------------------------------------------------------------------------
  --
  -- What makes this an OUTBOX rather than a second log. s18's definition of done requires that "event
  -- propagation is observable and retryable", and neither is possible unless a row can say whether it
  -- has been dispatched. Null means the dashboard stream has not carried it yet.
  --
  -- Nothing writes this column yet -- the stream half of CORE-09 is not built -- and it is left null
  -- rather than defaulted to now(), because a column that claims everything was delivered the moment it
  -- was written would make the first real dispatcher believe its backlog was empty.
  published_at timestamptz
);

-- ---- 2. Indexes for the two reads this table has ---------------------------------------------------

-- The dashboard feed: one practice, newest first. Every stream read and every "what changed since"
-- query is this shape.
create index if not exists idx_practice_domain_event_practice
  on practice_domain_event(workspace_id, occurred_at desc);

-- A single consumer's slice: one practice, one event type, newest first. The follow-up card does not
-- want the encounter events and the timeline does not want the metric snapshots.
create index if not exists idx_practice_domain_event_type
  on practice_domain_event(workspace_id, event_type, occurred_at desc);

-- The dispatcher's backlog. Partial, so it stays small: in a healthy system almost every row is
-- published and none of them belong in this index.
--
-- WARNING: A PARTIAL INDEX CANNOT BE A POSTGREST UPSERT TARGET -- the same trap migration 232 documents.
-- Nothing here needs one (an outbox only ever inserts), but a future dispatcher must UPDATE these rows
-- by id and never `onConflict` its way onto this index.
create index if not exists idx_practice_domain_event_unpublished
  on practice_domain_event(workspace_id, recorded_at)
  where published_at is null;

-- ---- 3. RLS: deny-by-default -----------------------------------------------------------------------
--
-- No policies. This table is written by engines and read by the dashboard assembler, both through the
-- service role. A browser has no business reading another practitioner's event stream directly, and an
-- events table is precisely where a too-generous policy leaks the shape of a whole clinic's day.

alter table practice_domain_event enable row level security;

notify pgrst, 'reload schema';
