-- CPR-CORE-MOS-001 phase 4 - the Practice-native incident model.
--
-- APPLY THIS FILE WHOLE. It defines a plpgsql trigger function with a dollar-quoted body, on the pattern
-- migration 247 established for practice_audit_event. A runner that splits on semicolons would cut the
-- function body in half, so paste this into the SQL editor in one piece rather than statement by
-- statement. Nothing else in the file needs special handling.
--
-- WHY THIS IS A NEW MODEL AND NOT A WIDENING OF op_incidents
--
-- s8 permits generalising the existing table "only if hospital semantics can be cleanly separated from
-- subject scope". They cannot. op_incidents keys on hospital_id, carries shift_id, and carries
-- patient_id with a clinical description - it records a CLINICAL SAFETY INCIDENT in a ward. A product
-- incident is a different object that happens to share a word: it has no patient, no shift, and its
-- subject may be the product as a whole, one market, one Practice, a service or an integration.
--
-- Bolting a subject column onto that table would make a product incident expressible in a row whose
-- every other column means something else, and would put patient-identifiable clinical data one join
-- away from a Product Director surface. The gap matrix records this as the decision it is.
--
-- WHAT IT BUILDS ON
--
-- The phase 1 subject vocabulary and the phase 2 journey list, by foreign key. An incident cannot name a
-- scope that is not a canonical subject, and cannot blame a journey that is not one of the eight. Those
-- two constraints are why this model can be aggregated with health evidence at all - the alternative is
-- free text that agrees with the rest of the estate only by luck.
--
-- WHAT IT DELIBERATELY DOES NOT HOLD
--
-- No impact FIGURE, only a sentence. s8 asks for "quantified sessions/attempts/Practices where
-- possible", and the honest place to compute that is the event store at read time: an incident row
-- carrying a number frozen at creation would be wrong within the hour and would look authoritative.
-- The correlation id is stored instead, so the count can be derived from mos_event whenever it is asked
-- for, against whatever the window is then.

create table if not exists mos_incident (
  incident_id   uuid primary key default gen_random_uuid(),
  product_code  text not null default 'competen_practice',

  -- s8 subject scope, from the phase 1 vocabulary. A product-wide incident carries subject_id null
  subject_type  text not null references mos_subject_type(code),
  subject_id    text,

  title         text not null check (btrim(title) <> ''),
  -- s9 severity. informational is a signal worth surfacing that is not yet a degradation
  severity      text not null
                check (severity in ('informational', 'degraded', 'major', 'critical')),
  status        text not null default 'open'
                check (status in ('open', 'acknowledged', 'investigating', 'monitoring', 'resolved')),

  started_at    timestamptz not null default now(),
  resolved_at   timestamptz,

  -- what it affects, from the phase 2 journey list where a journey is implicated
  journey_key   text references mos_journey(key),
  component     text,
  affected_scope text,

  -- s8 asks for quantified impact WHERE POSSIBLE. This is the sentence a responder writes, and the
  -- count is derived from the event store through the correlation id below rather than frozen here
  impact_note   text,

  owner_name    text,
  owner_id      uuid,

  -- s14 correlation - the thread back to the telemetry that evidences this incident
  evidence_correlation_id uuid,
  -- s13 change attribution - the release or configuration change this is suspected to follow
  change_ref    text,

  -- s8 - an incident may be raised by a person or by a configured health rule
  detection     text not null default 'manual'
                check (detection in ('manual', 'health_rule')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- a resolved incident has a resolution time and an unresolved one does not, so neither can be implied
  constraint mos_incident_resolved_at_matches_status
    check ((status = 'resolved') = (resolved_at is not null)),

  -- every subject except the two singletons must say WHICH one it is
  constraint mos_incident_subject_id_present
    check (subject_type in ('platform', 'product') or subject_id is not null),

  -- an incident cannot end before it began
  constraint mos_incident_resolved_after_started
    check (resolved_at is null or resolved_at >= started_at)
);

comment on table mos_incident is
  'CPR-CORE-MOS-001 s8 Practice-native product incident. Separate from op_incidents, which is a clinical ward incident keyed on hospital and patient and cannot carry a product subject without meaning something else.';

-- RLS on and no policy, so it fails closed. Management-plane loaders read through the service-role
-- client. A later phase that gives an authenticated client a reason to read this adds the narrowest
-- policy with that reason recorded.
alter table mos_incident enable row level security;

create index if not exists idx_mos_incident_open on mos_incident (status, severity, started_at desc);
create index if not exists idx_mos_incident_subject on mos_incident (subject_type, subject_id);
create index if not exists idx_mos_incident_journey on mos_incident (journey_key, started_at desc);

-- ---- THE LIFECYCLE TRAIL, APPEND ONLY ---------------------------------------------------------------
--
-- s8 requires an immutable lifecycle history and s26 requires that governed records are never silently
-- mutated. The pattern is the one in migration 247, which does the same for practice_audit_event and
-- practice_lifecycle_transition - a trigger that refuses UPDATE and DELETE outright, rather than a
-- convention that holds until somebody writes a repair script.

create table if not exists mos_incident_event (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references mos_incident(incident_id) on delete cascade,
  at            timestamptz not null default now(),
  actor_id      uuid,
  actor_name    text,
  from_status   text,
  to_status     text,
  note          text,
  created_at    timestamptz not null default now()
);

comment on table mos_incident_event is
  'CPR-CORE-MOS-001 s8 immutable incident lifecycle history. Append only, enforced by trigger on the pattern of migration 247.';

alter table mos_incident_event enable row level security;

create index if not exists idx_mos_incident_event_incident on mos_incident_event (incident_id, at);

create or replace function mos_incident_event_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'mos_incident_event is append only. % refused on incident event %', tg_op, old.id;
end;
$$;

drop trigger if exists trg_mos_incident_event_immutable on mos_incident_event;
create trigger trg_mos_incident_event_immutable
  before update or delete on mos_incident_event
  for each row execute function mos_incident_event_immutable();

-- ---- THE READ SURFACE -------------------------------------------------------------------------------
--
-- One view, so no caller re-implements the join from an incident to the subject it is about. The subject
-- label comes from the phase 1 registry, which is derived from practice_workspace - so a renamed
-- Practice is renamed here too, with nothing to refresh.

create or replace view mos_incident_open as
  select
    i.incident_id,
    i.title,
    i.severity,
    i.status,
    i.started_at,
    i.subject_type,
    i.subject_id,
    s.label            as subject_label,
    i.journey_key,
    j.name             as journey_name,
    i.component,
    i.affected_scope,
    i.impact_note,
    i.owner_name,
    i.evidence_correlation_id,
    i.change_ref,
    i.detection
  from mos_incident i
  left join mos_subject s
    on s.subject_type = i.subject_type and s.subject_id = i.subject_id
  left join mos_journey j
    on j.key = i.journey_key
  where i.status <> 'resolved';

comment on view mos_incident_open is
  'CPR-CORE-MOS-001 s8 - unresolved incidents with their subject label resolved through the phase 1 registry, so a renamed Practice needs no refresh here.';

notify pgrst, 'reload schema';
