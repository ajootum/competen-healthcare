-- CPR-PD-010 phase 6 - Decisions and Approvals, s11.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies.
--
-- THE FOURTH TABLE IN THIS MODULE TO OMIT THE OBVIOUS COLUMN
--
--   321  the risk carries no score        so completing an action cannot lower it
--   322  the control carries no verdict   so an untested control cannot read Effective
--   323  the exception carries no is_active
--   324  the decision carries no in_effect
--
-- s11 lists CONDITIONAL among the decision outcomes, and a conditional approval is the whole reason
-- this column must not exist. "Approved subject to a penetration test" is NOT an approval until the
-- test happens - and an in_effect boolean set at decision time says it is, for ever, because the person
-- who set it was recording the decision rather than tracking the condition.
--
-- So in-effect is DERIVED: the outcome is approved, or it is conditional AND every condition required
-- BEFORE effect has been met, and the effective window is current. A conditional decision comes into
-- force when its conditions are met, and not one moment earlier, without anybody remembering to flip
-- anything.
--
-- CONDITIONS ARE ROWS, NOT A TEXT FIELD, AND THAT IS WHY THE ABOVE IS POSSIBLE
--
-- s11: "Conditions - required conditions/actions before/after effect." Stored as prose, a condition is
-- something a reader must notice, interpret and remember. Stored as rows with a met/unmet state and a
-- before/after timing, it is something the database can refuse to ignore.
--
-- EMERGENCY APPROVALS
--
-- s11: "Emergency approvals must be clearly identified and MAY require retrospective governance
-- review." May, per decision - so requires_retrospective_review is a column somebody sets, not a rule
-- this migration invents. NOTE THERE IS NO DEADLINE COLUMN WITH A DEFAULT: inventing "within 30 days"
-- here would manufacture the very threshold s3's Needs Attention would then measure against, which is
-- the invented-target failure this codebase already has rules about. An outstanding retrospective
-- review is outstanding from the moment it is required, and stays that way until it is done.

-- ---- 1. THE DECISION (s11) --------------------------------------------------------------------------

create table if not exists gov_decision (
  decision_id   uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  title         text not null check (btrim(title) <> ''),
  request       text not null check (btrim(request) <> ''),

  -- s11: "Context - risk, release, exception, incident, commercial or governance context"
  context_kind  text not null default 'governance'
                check (context_kind in ('risk', 'release', 'exception', 'incident',
                                        'commercial', 'configuration', 'governance')),
  risk_id       uuid references gov_product_risk(risk_id) on delete set null,
  exception_id  uuid references gov_exception(exception_id) on delete set null,
  control_id    uuid references gov_control(control_id) on delete set null,
  -- incidents and releases live in other modules, so these are references by identifier rather than
  -- foreign keys. s18 says LINK rather than duplicate, and a hard FK across module boundaries would
  -- make a decision undeletable from here for reasons belonging to Support
  incident_ref  text,
  change_ref    text,

  submitted_by  text not null check (btrim(submitted_by) <> ''),
  submitted_at  timestamp with time zone not null default now(),

  outcome       text not null default 'pending'
                check (outcome in ('pending', 'approved', 'conditional', 'rejected',
                                   'deferred', 'withdrawn')),
  decided_by    text,
  decided_role  text,
  decided_at    timestamp with time zone,
  -- s11: "Rationale - concise accountable reasoning"
  rationale     text,

  -- s11: "Effective / expiry - when relevant"
  effective_from date,
  effective_to   date,

  -- s11: emergency approvals are clearly identified
  is_emergency  boolean not null default false,
  emergency_reason text,
  requires_retrospective_review boolean not null default false,
  retrospective_reviewed_at  timestamp with time zone,
  retrospective_reviewed_by  text,
  retrospective_outcome      text,

  -- s20: a changed decision is a NEW decision superseding the old one, never an edit
  supersedes_decision_id uuid references gov_decision(decision_id) on delete set null,

  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  -- a decision that has been made names who made it and when, or it has not been made
  constraint gov_decision_decided_is_attributed
    check ((outcome in ('approved', 'conditional', 'rejected'))
           = (decided_by is not null and decided_at is not null)),
  -- s11 requires accountable reasoning on a decision that goes against the request, and on a
  -- conditional one the reasoning is what the conditions are FOR
  constraint gov_decision_adverse_is_reasoned
    check (outcome not in ('rejected', 'conditional') or btrim(coalesce(rationale, '')) <> ''),
  -- s19 maker/checker: the submitter does not decide their own request
  constraint gov_decision_decider_is_not_submitter
    check (decided_by is null or btrim(lower(decided_by)) <> btrim(lower(submitted_by))),
  -- an emergency is identified as one, with a reason
  constraint gov_decision_emergency_is_explained
    check (not is_emergency or btrim(coalesce(emergency_reason, '')) <> ''),
  constraint gov_decision_retrospective_is_attributed
    check ((retrospective_reviewed_at is not null) = (retrospective_reviewed_by is not null)),
  constraint gov_decision_window_is_ordered
    check (effective_to is null or effective_from is null or effective_to > effective_from),
  constraint gov_decision_not_its_own_predecessor
    check (supersedes_decision_id is null or supersedes_decision_id <> decision_id)
);

comment on table gov_decision is
  'CPR-PD-010 s11 governed decision. Carries NO in_effect column - a CONDITIONAL approval is not in force until its before-effect conditions are met, and a flag set at decision time would say it is for ever.';

alter table gov_decision enable row level security;

create index if not exists idx_gov_decision_pending on gov_decision (outcome, submitted_at desc);
create index if not exists idx_gov_decision_emergency on gov_decision (is_emergency, requires_retrospective_review);
create index if not exists idx_gov_decision_risk on gov_decision (risk_id);

-- ---- 2. CONDITIONS AS ROWS (s11) --------------------------------------------------------------------

create table if not exists gov_decision_condition (
  condition_id  uuid primary key default gen_random_uuid(),
  decision_id   uuid not null references gov_decision(decision_id) on delete cascade,
  requirement   text not null check (btrim(requirement) <> ''),
  -- s11: "required conditions/actions BEFORE/AFTER effect". A before-effect condition gates the
  -- decision coming into force. An after-effect condition does not, and is tracked as an obligation
  timing        text not null default 'before_effect'
                check (timing in ('before_effect', 'after_effect')),
  owner_name    text,
  due_on        date,
  is_met        boolean not null default false,
  met_at        timestamp with time zone,
  met_by        text,
  evidence      text,
  created_at    timestamp with time zone not null default now(),

  constraint gov_condition_met_is_attributed
    check (is_met = (met_at is not null and met_by is not null))
);

comment on table gov_decision_condition is
  'CPR-PD-010 s11 decision condition. Rows rather than prose, so a condition is something the database can refuse to ignore rather than something a reader must remember.';

alter table gov_decision_condition enable row level security;

create index if not exists idx_gov_condition_open on gov_decision_condition (decision_id, is_met, timing);

-- ---- 3. OPTIONS CONSIDERED (s11) --------------------------------------------------------------------
--
-- s11: "Options - material options considered where appropriate." As rows, because the question a
-- governance review asks months later is "what else did you look at", and a paragraph answers it only
-- if somebody wrote a good paragraph.

create table if not exists gov_decision_option (
  option_id     uuid primary key default gen_random_uuid(),
  decision_id   uuid not null references gov_decision(decision_id) on delete cascade,
  label         text not null check (btrim(label) <> ''),
  summary       text,
  is_chosen     boolean not null default false,
  not_chosen_reason text,
  sort_order    int not null default 100,

  -- an option that was rejected says why, or the record of "options considered" is decoration
  constraint gov_option_rejection_is_reasoned
    check (is_chosen or btrim(coalesce(not_chosen_reason, '')) <> '')
);

alter table gov_decision_option enable row level security;

create index if not exists idx_gov_option_decision on gov_decision_option (decision_id, sort_order);

-- ---- 4. THE AUDIT TRAIL (s11, s20) ------------------------------------------------------------------
--
-- s11: "Audit - submitted, reviewed, changed and decided timestamps/actors."

create table if not exists gov_decision_event (
  event_id      uuid primary key default gen_random_uuid(),
  decision_id   uuid not null references gov_decision(decision_id) on delete cascade,
  at            timestamp with time zone not null default now(),
  actor_name    text,
  action        text not null
                check (action in ('submitted', 'reviewed', 'amended', 'decided',
                                  'condition_met', 'superseded', 'retrospectively_reviewed')),
  from_outcome  text,
  to_outcome    text,
  note          text
);

alter table gov_decision_event enable row level security;

create index if not exists idx_gov_decision_event on gov_decision_event (decision_id, at desc);

create or replace function gov_decision_event_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception
    'CPR-PD-010 s20: gov_decision_event is append only. % refused on event %.', tg_op, old.event_id;
end;
$$;

drop trigger if exists trg_gov_decision_event_immutable on gov_decision_event;
create trigger trg_gov_decision_event_immutable
  before update or delete on gov_decision_event
  for each row execute function gov_decision_event_immutable();

-- ---- 5. A DECIDED DECISION IS NOT RE-DECIDED IN PLACE (s20) -----------------------------------------
--
-- s20: "Do not silently rewrite prior decisions or approvals." Changing the outcome of a decision that
-- has already been made is precisely that. A reversal is a NEW decision naming the one it supersedes,
-- which is what leaves the original reasoning readable afterwards.

create or replace function gov_decision_no_silent_rewrite()
returns trigger
language plpgsql
as $$
begin
  if old.outcome in ('approved', 'conditional', 'rejected')
     and new.outcome is distinct from old.outcome then
    raise exception
      'CPR-PD-010 s20: decision % has already been decided as %. Record a NEW decision with supersedes_decision_id set, so the original decision and its rationale survive.',
      old.reference, old.outcome;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gov_decision_no_silent_rewrite on gov_decision;
create trigger trg_gov_decision_no_silent_rewrite
  before update on gov_decision
  for each row execute function gov_decision_no_silent_rewrite();

-- a conditional decision without conditions is an approval wearing a safer word
create or replace function gov_decision_conditional_has_conditions()
returns trigger
language plpgsql
as $$
declare
  n int;
begin
  if new.outcome <> 'conditional' then
    return new;
  end if;
  select count(*) into n from gov_decision_condition where decision_id = new.decision_id;
  if n = 0 then
    raise exception
      'CPR-PD-010 s11: a CONDITIONAL decision must record at least one condition. Without one it is an approval described with a safer word.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gov_decision_conditional_has_conditions on gov_decision;
create trigger trg_gov_decision_conditional_has_conditions
  before insert or update on gov_decision
  for each row execute function gov_decision_conditional_has_conditions();

-- ---- 6. THE DERIVED VIEW (s11, s3) ------------------------------------------------------------------
--
-- One definition of in-force, in the database. is_in_effect is FALSE for a conditional decision whose
-- before-effect conditions are outstanding, and becomes true the moment the last one is met.

create or replace view gov_decision_live as
select
  d.*,
  (select count(*) from gov_decision_condition c
    where c.decision_id = d.decision_id and c.timing = 'before_effect' and not c.is_met) as unmet_before_effect,
  (select count(*) from gov_decision_condition c
    where c.decision_id = d.decision_id and c.timing = 'after_effect' and not c.is_met) as unmet_after_effect,
  (
    (d.outcome = 'approved'
     or (d.outcome = 'conditional'
         and not exists (select 1 from gov_decision_condition c
                          where c.decision_id = d.decision_id
                            and c.timing = 'before_effect' and not c.is_met)))
    and (d.effective_from is null or d.effective_from <= current_date)
    and (d.effective_to is null or d.effective_to >= current_date)
  ) as is_in_effect,
  -- s3: "emergency decisions requiring retrospective review"
  (d.is_emergency and d.requires_retrospective_review and d.retrospective_reviewed_at is null)
    as retrospective_review_outstanding
from gov_decision d;

comment on view gov_decision_live is
  'CPR-PD-010 s11/s3. is_in_effect is computed at read time - a conditional approval is not in force while a before-effect condition is unmet, and comes into force when the last one is met with nothing to update.';

-- ---- 7. NOTHING IS SEEDED ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
