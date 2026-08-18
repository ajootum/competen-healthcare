-- CPR-PD-010 phase 11 - cross-module governance event triggers, s17.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies.
--
-- s17 IS A TABLE OF EIGHT EVENTS AND THE GOVERNANCE ACTION EACH SHOULD CAUSE. Building it raises two
-- questions the other ten phases did not, and both are answered structurally here.
--
-- QUESTION 1: DOES THIS MODULE ACT, OR OBSERVE?
--
-- s1: "Governance and Risk OVERSEES the Practice product, IT DOES NOT OPERATE day-to-day product
-- workflows." s18 has Mission Control RECEIVING critical risk and Support SUPPLYING incident evidence.
-- So governance assesses. It does not reach into other modules and create their records.
--
-- But "does not act" cannot mean "may silently ignore". A SEV-1 that should have caused a risk
-- reassessment and did not is exactly the gap s17 exists to close. So a trigger event is RECORDED when
-- it fires, and it is closed either by naming the governance record that answered it or by an explicit
-- decline WITH A REASON. Eighth time this arc has refused to let an absence be silent.
--
-- QUESTION 2: WHAT COUNTS AS "REPEATED", "MATERIAL", "QUALIFYING" OR "APPROACHING"?
--
-- s17's own wording: "qualifying SEV-2", "material security/privacy event", "MATERIAL feature/release
-- ACCORDING TO CONFIGURED THRESHOLDS", "REPEATED control failure", "exception APPROACHING expiry".
--
-- Every one of those is a threshold, and NOT ONE OF THEM IS STATED ANYWHERE. Choosing "three failures in
-- ninety days" or "expiry within thirty days" here would manufacture the policy this module then
-- enforces - the invented-target failure, in the place it would be least visible, because a threshold
-- inside a trigger looks like plumbing rather than governance.
--
-- So the eight rules are seeded from s17's own vocabulary, DISABLED, with no thresholds. A rule that
-- needs a threshold cannot be enabled without one. Nothing fires until somebody configures it, and the
-- module says which rules are dark rather than reporting a quiet estate.

-- ---- 1. THE RULES (s17) -----------------------------------------------------------------------------

create table if not exists gov_trigger_rule (
  trigger_kind  text primary key
                check (trigger_kind in ('sev1_incident', 'qualifying_sev2', 'security_or_privacy_event',
                                        'clinical_safety_event', 'new_market', 'material_release',
                                        'repeated_control_failure', 'exception_expiry',
                                        'provider_change')),
  label         text not null check (btrim(label) <> ''),
  -- s17's "potential governance action" column, so a fired trigger says what it is asking for
  expected_action text not null check (btrim(expected_action) <> ''),

  -- whether this kind is meaningless without a number somebody chose
  requires_threshold boolean not null default false,
  threshold_value    numeric,
  threshold_unit     text
                     check (threshold_unit in ('count', 'days', 'percent', 'severity')),
  threshold_window_days int,

  is_enabled    boolean not null default false,
  configured_by text,
  configured_at timestamp with time zone,
  note          text,
  updated_at    timestamp with time zone not null default now(),

  -- a rule that needs a threshold cannot be switched on without one. This is the whole of question 2
  constraint gov_trigger_enabled_has_threshold
    check (not is_enabled or not requires_threshold
           or (threshold_value is not null and threshold_unit is not null)),
  -- enabling is a governance act, so it names who and when
  constraint gov_trigger_enabled_is_attributed
    check (not is_enabled or (configured_by is not null and configured_at is not null))
);

comment on table gov_trigger_rule is
  'CPR-PD-010 s17 governance trigger rules. Seeded from s17s own vocabulary, DISABLED and thresholdless - "repeated", "material" and "approaching" are policy numbers nobody has stated, and inventing one inside a trigger hides it as plumbing.';

alter table gov_trigger_rule enable row level security;

-- s17's eight events, verbatim from its table. This is the SPECIFICATION'S vocabulary, not a policy -
-- which is why seeding it is legitimate where seeding a threshold would not be.
insert into gov_trigger_rule (trigger_kind, label, expected_action, requires_threshold) values
  ('sev1_incident', 'SEV-1 incident',
   'Risk reassessment, postmortem review, control failure assessment, governance review.', false),
  ('qualifying_sev2', 'Qualifying SEV-2 incident',
   'Risk reassessment, postmortem review, control failure assessment, governance review.', true),
  ('security_or_privacy_event', 'Material security or privacy event',
   'Restricted escalation, risk and control reassessment, compliance review.', true),
  ('clinical_safety_event', 'High-risk clinical safety event',
   'Safety review, hazard and risk update, release constraints.', true),
  ('new_market', 'New market or jurisdiction',
   'Obligation applicability assessment, privacy and security assessment.', false),
  ('material_release', 'Material feature or release',
   'Risk, control, safety and privacy review according to configured thresholds.', true),
  ('repeated_control_failure', 'Repeated control failure',
   'Risk escalation, remediation and effectiveness review.', true),
  ('exception_expiry', 'Exception approaching expiry',
   'Reassess, close or formally renew.', true),
  ('provider_change', 'Major provider change',
   'Third-party risk and continuity reassessment.', false)
on conflict (trigger_kind) do nothing;

-- ---- 2. FIRED TRIGGERS, AND WHAT ANSWERED THEM (s17) ------------------------------------------------

create table if not exists gov_trigger_event (
  event_id      uuid primary key default gen_random_uuid(),
  trigger_kind  text not null references gov_trigger_rule(trigger_kind),

  -- what fired it, in the module that owns the source. References by identifier rather than foreign
  -- key across module boundaries, on the reasoning migration 324 used for incidents and releases
  source_module text not null
                check (source_module in ('support', 'health', 'releases', 'commercial',
                                         'configuration', 'governance', 'manual')),
  source_ref    text,
  source_summary text not null check (btrim(source_summary) <> ''),

  detected_at   timestamp with time zone not null default now(),
  raised_by     text,

  -- how governance answered
  response_state text not null default 'pending'
                 check (response_state in ('pending', 'actioned', 'declined', 'superseded')),
  responded_by  text,
  responded_at  timestamp with time zone,
  decline_reason text,

  -- the governance record that answered it, typed rather than polymorphic
  decision_id   uuid references gov_decision(decision_id) on delete set null,
  review_id     uuid references gov_review(review_id) on delete set null,
  risk_id       uuid references gov_product_risk(risk_id) on delete set null,
  risk_action_id uuid references gov_risk_action(action_id) on delete set null,
  hazard_id     uuid references gov_safety_hazard(hazard_id) on delete set null,

  created_at    timestamp with time zone not null default now(),

  constraint gov_trigger_event_responded_is_attributed
    check ((response_state = 'pending') = (responded_at is null and responded_by is null)),
  -- declining to act on a governance trigger is a decision, so it carries a reason
  constraint gov_trigger_event_decline_is_reasoned
    check (response_state <> 'declined' or btrim(coalesce(decline_reason, '')) <> '')
);

comment on table gov_trigger_event is
  'CPR-PD-010 s17 fired trigger. Closed either by naming the governance record that answered it or by an explicit decline with a reason - governance does not act inside other modules, but it does not silently ignore either.';

alter table gov_trigger_event enable row level security;

create index if not exists idx_gov_trigger_event_open on gov_trigger_event (response_state, detected_at desc);
create index if not exists idx_gov_trigger_event_kind on gov_trigger_event (trigger_kind, detected_at desc);

-- ---- 3. AN ACTIONED TRIGGER NAMES WHAT ANSWERED IT --------------------------------------------------
--
-- Without this, "actioned" is a word somebody typed, which is the same failure as a control marked
-- effective with no test behind it.

create or replace function gov_trigger_actioned_names_its_answer()
returns trigger
language plpgsql
as $$
begin
  if new.response_state <> 'actioned' then
    return new;
  end if;

  if new.decision_id is null and new.review_id is null and new.risk_id is null
     and new.risk_action_id is null and new.hazard_id is null then
    raise exception
      'CPR-PD-010 s17: a trigger marked actioned must name the governance record that answered it - a decision, review, risk, risk action or safety hazard. Otherwise "actioned" is a word rather than a link.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_gov_trigger_actioned_names_answer on gov_trigger_event;
create trigger trg_gov_trigger_actioned_names_answer
  before insert or update on gov_trigger_event
  for each row execute function gov_trigger_actioned_names_its_answer();

-- a trigger cannot fire from a rule nobody has switched on
create or replace function gov_trigger_event_rule_is_enabled()
returns trigger
language plpgsql
as $$
declare
  enabled boolean;
begin
  select is_enabled into enabled from gov_trigger_rule where trigger_kind = new.trigger_kind;
  if not coalesce(enabled, false) then
    raise exception
      'CPR-PD-010 s17: trigger rule % is not enabled. Configure and enable it - with its threshold where one is required - before recording events against it.',
      new.trigger_kind;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gov_trigger_event_rule_enabled on gov_trigger_event;
create trigger trg_gov_trigger_event_rule_enabled
  before insert on gov_trigger_event
  for each row execute function gov_trigger_event_rule_is_enabled();

-- ---- 4. THE DERIVED VIEW ----------------------------------------------------------------------------

create or replace view gov_trigger_posture as
select
  r.trigger_kind,
  r.label,
  r.expected_action,
  r.requires_threshold,
  r.is_enabled,
  (r.requires_threshold and (r.threshold_value is null or r.threshold_unit is null)) as awaiting_threshold,
  (select count(*) from gov_trigger_event e
    where e.trigger_kind = r.trigger_kind and e.response_state = 'pending') as pending_events,
  (select count(*) from gov_trigger_event e
    where e.trigger_kind = r.trigger_kind) as total_events
from gov_trigger_rule r;

comment on view gov_trigger_posture is
  'CPR-PD-010 s17. awaiting_threshold names the rules that cannot fire because nobody has stated the number they turn on - so a quiet trigger list is legible as unconfigured rather than as an untroubled estate.';

-- ---- 5. NO THRESHOLD IS SEEDED ----------------------------------------------------------------------
--
-- The eight rules above are s17's own vocabulary. Their thresholds are policy, every rule ships
-- disabled, and awaiting_threshold reports which ones are waiting on a decision rather than on code.

notify pgrst, 'reload schema';
