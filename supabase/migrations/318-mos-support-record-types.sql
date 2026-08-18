-- CPR-PD-009 - the five record types Support and Incidents defines and this schema did not have.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies, on the pattern
-- migration 247 established. A runner that splits on semicolons would cut a function body in half.
--
-- WHAT THIS IS FOR
--
-- Support and Incidents shipped three grounded pages on the phase 4 incident model. Eight submodules
-- remained placeholders, and NOT because nobody had written the queries: s1 defines six objects and only
-- one of them existed. A support case, an escalation, a problem, a postmortem and a corrective action
-- are each a record with a lifecycle, an owner and an audit trail. This adds the five.
--
-- THE RULES THEY ALL FOLLOW
--
--   Subject scope comes from the phase 1 vocabulary, so nothing can name a scope that is not canonical.
--   A journey reference comes from the phase 2 list, so nothing can blame a journey that does not exist.
--   Lifecycle vocabularies are the specification's own, not a shorter sketch of them - migration 317
--   was needed because the incident model took a sketch, and that lesson is applied here first time.
--
-- NOTE  AND NOT ONE OF THEM HAS A PATIENT COLUMN. s1: "Do not treat individual clinical concerns or
-- patient records as product support data." s10 repeats it for affected scope. A support case names the
-- practice and the practitioner who reported it and nothing about the person they were treating. Free
-- text cannot be constrained by a database, so the schema removes the temptation rather than relying on
-- a reviewer catching it: there is nowhere for a patient id to go.

-- ---- 1. SUPPORT CASE (s4) ---------------------------------------------------------------------------

create table if not exists mos_support_case (
  case_id       uuid primary key default gen_random_uuid(),
  product_code  text not null default 'competen_practice',
  -- who reported it. A practice and a practitioner, never a patient
  practice_id   uuid references practice_workspace(id) on delete set null,
  reporter_id   uuid,
  reporter_name text,
  source        text not null default 'practitioner'
                check (source in ('practitioner', 'practice_owner', 'internal', 'health_rule', 'other')),
  title         text not null check (btrim(title) <> ''),
  description   text,
  category      text,
  product_area  text,
  -- s4: "Priority and incident severity are separate concepts." Different column, different vocabulary
  priority      text not null default 'p3' check (priority in ('p1', 'p2', 'p3', 'p4')),
  status        text not null default 'new'
                check (status in ('new', 'triage', 'in_progress', 'waiting_user',
                                  'waiting_internal', 'resolved', 'closed')),
  owner_id      uuid,
  owner_name    text,
  -- s4: a case may LINK to an incident without being merged into it
  incident_id   uuid references mos_incident(incident_id) on delete set null,
  problem_id    uuid,
  duplicate_of  uuid references mos_support_case(case_id) on delete set null,
  journey_key   text references mos_journey(key),
  first_response_at timestamp with time zone,
  resolved_at   timestamp with time zone,
  resolution_category text,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),
  constraint mos_support_case_resolved_matches_status
    check ((status in ('resolved', 'closed')) = (resolved_at is not null)),
  constraint mos_support_case_not_its_own_duplicate
    check (duplicate_of is null or duplicate_of <> case_id)
);

comment on table mos_support_case is
  'CPR-PD-009 s4 support case. Names the practice and practitioner who reported it and holds no patient reference by design.';

alter table mos_support_case enable row level security;

create index if not exists idx_mos_case_open on mos_support_case (status, priority, created_at desc);
create index if not exists idx_mos_case_practice on mos_support_case (practice_id, created_at desc);
create index if not exists idx_mos_case_incident on mos_support_case (incident_id);

-- ---- 2. PROBLEM (s12) -------------------------------------------------------------------------------

create table if not exists mos_problem (
  problem_id    uuid primary key default gen_random_uuid(),
  title         text not null check (btrim(title) <> ''),
  owner_id      uuid,
  owner_name    text,
  status        text not null default 'identified'
                check (status in ('identified', 'investigating', 'cause_confirmed', 'fix_planned',
                                  'fix_in_progress', 'monitoring', 'resolved', 'closed')),
  priority      text not null default 'p3' check (priority in ('p1', 'p2', 'p3', 'p4')),
  pattern_evidence text,
  -- s13 asks the same distinction of a postmortem, and it belongs here too: a suspected cause and a
  -- confirmed one are different claims and must not share a column
  suspected_cause text,
  confirmed_cause text,
  workaround    text,
  target_outcome text,
  journey_key   text references mos_journey(key),
  subject_type  text references mos_subject_type(code),
  subject_id    text,
  resolved_at   timestamp with time zone,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),
  constraint mos_problem_resolved_matches_status
    check ((status in ('resolved', 'closed')) = (resolved_at is not null)),
  -- a cause is confirmed only once the status says it is, so the two cannot disagree
  constraint mos_problem_confirmed_cause_needs_status
    check (confirmed_cause is null
           or status in ('cause_confirmed', 'fix_planned', 'fix_in_progress', 'monitoring', 'resolved', 'closed'))
);

comment on table mos_problem is
  'CPR-PD-009 s12 problem. The underlying recurring cause that GENERATES incidents, which is why it cannot be derived from them.';

alter table mos_problem enable row level security;

create index if not exists idx_mos_problem_open on mos_problem (status, priority, created_at desc);

-- s12: multiple incidents may link to one problem. A link table rather than a column on the incident,
-- because the relationship is many to one in the direction that matters and one to many in the other.
create table if not exists mos_problem_incident (
  problem_id  uuid not null references mos_problem(problem_id) on delete cascade,
  incident_id uuid not null references mos_incident(incident_id) on delete cascade,
  linked_at   timestamp with time zone not null default now(),
  primary key (problem_id, incident_id)
);

alter table mos_problem_incident enable row level security;

-- ---- 3. ESCALATION (s9) -----------------------------------------------------------------------------

create table if not exists mos_escalation (
  escalation_id uuid primary key default gen_random_uuid(),
  -- s9's triggers, as a vocabulary rather than free text, so they can be counted
  trigger       text not null
                check (trigger in ('severity', 'response_target_breach', 'communication_target_breach',
                                   'unresolved_blocker', 'recurring_failure', 'wide_scope',
                                   'security_or_data', 'governance_threshold')),
  incident_id   uuid references mos_incident(incident_id) on delete cascade,
  case_id       uuid references mos_support_case(case_id) on delete cascade,
  source_name   text,
  target_team   text not null,
  reason        text not null check (btrim(reason) <> ''),
  requested_action text,
  due_at        timestamp with time zone,
  status        text not null default 'open'
                check (status in ('open', 'acknowledged', 'actioned', 'withdrawn', 'closed')),
  resolved_at   timestamp with time zone,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),
  -- s9: "Escalation does not transfer incident ownership unless explicitly reassigned", so there is no
  -- owner column here at all - an escalation asks somebody to act, it does not hand them the incident
  constraint mos_escalation_has_a_subject
    check (incident_id is not null or case_id is not null),
  constraint mos_escalation_resolved_matches_status
    check ((status in ('actioned', 'withdrawn', 'closed')) = (resolved_at is not null))
);

comment on table mos_escalation is
  'CPR-PD-009 s9 escalation. Deliberately carries no owner: escalating asks somebody to act and does not transfer incident ownership.';

alter table mos_escalation enable row level security;

create index if not exists idx_mos_escalation_open on mos_escalation (status, due_at);

-- ---- 4. POSTMORTEM (s13) ----------------------------------------------------------------------------

create table if not exists mos_postmortem (
  postmortem_id uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references mos_incident(incident_id) on delete cascade,
  status        text not null default 'draft'
                check (status in ('draft', 'in_review', 'approved', 'published')),
  executive_summary text,
  impact        text,
  detection     text,
  response      text,
  -- s13: "Distinguish confirmed root cause from contributing factor and unresolved hypothesis." Three
  -- columns rather than one, because collapsing them is how a hypothesis becomes a finding by retelling
  root_cause    text,
  contributing_factors text,
  open_hypotheses text,
  what_worked   text,
  what_did_not  text,
  recovery      text,
  learning      text,
  approved_by   text,
  approved_at   timestamp with time zone,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),
  -- s13: approval and publication state is auditable, so an approved postmortem must say who and when
  constraint mos_postmortem_approval_recorded
    check ((status in ('approved', 'published')) = (approved_by is not null and approved_at is not null)),
  -- one postmortem per incident
  unique (incident_id)
);

comment on table mos_postmortem is
  'CPR-PD-009 s13 postmortem. Root cause, contributing factor and open hypothesis are three columns because collapsing them is how a hypothesis becomes a finding by retelling.';

alter table mos_postmortem enable row level security;

-- ---- 5. CORRECTIVE ACTION (s14) ---------------------------------------------------------------------

create table if not exists mos_corrective_action (
  action_id     uuid primary key default gen_random_uuid(),
  action        text not null check (btrim(action) <> ''),
  source        text not null
                check (source in ('incident', 'problem', 'postmortem', 'governance_review')),
  incident_id   uuid references mos_incident(incident_id) on delete set null,
  problem_id    uuid references mos_problem(problem_id) on delete set null,
  postmortem_id uuid references mos_postmortem(postmortem_id) on delete set null,
  owner_id      uuid,
  owner_name    text not null check (btrim(owner_name) <> ''),
  priority      text not null default 'p3' check (priority in ('p1', 'p2', 'p3', 'p4')),
  due_on        date,
  state         text not null default 'open'
                check (state in ('open', 'in_progress', 'blocked', 'done', 'accepted_risk', 'cancelled')),
  blocker       text,
  evidence      text,
  effectiveness text,
  -- s14: accepted risk requires an authorized governance decision and a rationale
  accepted_by   text,
  accepted_rationale text,
  change_ref    text,
  completed_at  timestamp with time zone,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),
  constraint mos_action_accepted_risk_is_authorized
    check (state <> 'accepted_risk'
           or (accepted_by is not null and btrim(coalesce(accepted_rationale, '')) <> '')),
  constraint mos_action_done_is_evidenced
    check (state <> 'done' or completed_at is not null),
  -- s14 requires an explicit due date where required, and the two highest priorities are where
  constraint mos_action_high_priority_has_due_date
    check (priority not in ('p1', 'p2') or due_on is not null)
);

comment on table mos_corrective_action is
  'CPR-PD-009 s14 corrective action. Accepted risk requires a named authority and a rationale, so it cannot be used as a quiet way to close something.';

alter table mos_corrective_action enable row level security;

create index if not exists idx_mos_action_overdue on mos_corrective_action (state, due_on);
create index if not exists idx_mos_action_source on mos_corrective_action (source, created_at desc);

-- ---- 6. ONE APPEND-ONLY TRAIL FOR ALL FIVE ----------------------------------------------------------
--
-- s5 requires state transitions to carry actor, time and audit, and s26 of the substrate specification
-- requires governed records never to be silently mutated. Rather than five trail tables, one - keyed by
-- record type and id, on the phase 1 typed-subject idea applied to the module's own records.
--
-- NOTE  THE DELETE RULE IS THE ONE FROM MIGRATION 316, LEARNED THE HARD WAY. A trigger refusing every DELETE also
-- refuses the cascade, which left an incident with a trail impossible to remove by anybody. A DELETE at
-- trigger depth greater than one comes from the cascade and is allowed, and a direct one is refused.

create table if not exists mos_support_event (
  id            uuid primary key default gen_random_uuid(),
  record_type   text not null
                check (record_type in ('case', 'problem', 'escalation', 'postmortem', 'corrective_action')),
  record_id     uuid not null,
  at            timestamp with time zone not null default now(),
  actor_id      uuid,
  actor_name    text,
  from_state    text,
  to_state      text,
  reason        text,
  note          text,
  created_at    timestamp with time zone not null default now()
);

comment on table mos_support_event is
  'CPR-PD-009 s5 lifecycle trail for all five support record types. Append only, on the pattern of migration 247 with the cascade allowance migration 316 established.';

alter table mos_support_event enable row level security;

create index if not exists idx_mos_support_event_record on mos_support_event (record_type, record_id, at);

create or replace function mos_support_event_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'mos_support_event is append only. % refused on support event %', tg_op, old.id;
end;
$$;

drop trigger if exists trg_mos_support_event_immutable on mos_support_event;
create trigger trg_mos_support_event_immutable
  before update or delete on mos_support_event
  for each row execute function mos_support_event_immutable();

notify pgrst, 'reload schema';
