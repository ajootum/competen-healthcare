-- CPR-PD-010 phase 10 - Governance Reviews, s14, with s17's event triggers.
--
-- APPLY THIS FILE WHOLE. It defines a plpgsql trigger function with a dollar-quoted body.
--
-- THE SENTENCE THIS MIGRATION IS BUILT AROUND
--
-- s14: "GOVERNANCE REVIEW IS NOT MERELY MEETING MINUTES, decisions/actions must create LINKED
-- STRUCTURED RECORDS."
--
-- A minutes table satisfies the letter of s14 and none of its point: attendees, a date, a wall of prose
-- and nothing anybody can chase. The failure is not that minutes are useless - it is that a review
-- which decided something important and a review which decided nothing produce IDENTICAL ARTEFACTS,
-- and six months later nobody can tell which was which.
--
-- So a review's outputs are FOREIGN KEYS into the records that already exist - decisions, risk actions,
-- audit findings, exceptions. Not a copy of them, and not free text about them.
--
-- THE SEVENTH TIME THIS MODULE MAKES AN ABSENCE UNAMBIGUOUS
--
-- An empty output list is ambiguous in exactly the way this whole arc keeps refusing: it means either
-- "this review produced nothing" or "nobody recorded what it produced", and those need different
-- responses from whoever reads it next. So a review cannot be CLOSED with no outputs unless it
-- explicitly declares NO ACTIONS ARISING, with a reason. Concluding nothing is a legitimate outcome of
-- a governance review. Concluding nothing SILENTLY is not.

-- ---- 1. THE REVIEW (s14, s17) -----------------------------------------------------------------------

create table if not exists gov_review (
  review_id     uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  title         text not null check (btrim(title) <> ''),

  -- s14: recurring OR event-triggered
  review_kind   text not null default 'recurring'
                check (review_kind in ('recurring', 'event_triggered')),
  cadence       text
                check (cadence in ('monthly', 'quarterly', 'biannual', 'annual', 'ad_hoc')),
  -- s17's trigger vocabulary, as a closed list so triggered reviews can be counted by cause. s17 asks
  -- which events SHOULD cause a governance action, and a free-text reason cannot answer that later
  trigger_kind  text
                check (trigger_kind in ('sev1_incident', 'qualifying_sev2', 'security_or_privacy_event',
                                        'clinical_safety_event', 'new_market', 'material_release',
                                        'repeated_control_failure', 'exception_expiry',
                                        'provider_change')),
  trigger_ref   text,

  period_start  date,
  period_end    date,
  held_on       date,
  chaired_by    text,

  state         text not null default 'scheduled'
                check (state in ('scheduled', 'in_progress', 'held', 'closed', 'cancelled')),

  -- s14: "next review"
  next_review_on date,

  -- the explicit declaration that nothing arose. See the header
  no_actions_arising boolean not null default false,
  no_actions_rationale text,

  summary       text,
  closed_at     timestamp with time zone,
  cancelled_reason text,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  -- a recurring review has a cadence, a triggered one has a trigger. Neither borrows the other's shape
  constraint gov_review_kind_matches_its_reason
    check ((review_kind = 'recurring' and cadence is not null and trigger_kind is null)
        or (review_kind = 'event_triggered' and trigger_kind is not null and cadence is null)),
  constraint gov_review_held_is_dated
    check (state not in ('held', 'closed') or held_on is not null),
  constraint gov_review_closed_is_dated
    check ((state = 'closed') = (closed_at is not null)),
  constraint gov_review_cancelled_is_reasoned
    check (state <> 'cancelled' or btrim(coalesce(cancelled_reason, '')) <> ''),
  -- declaring that nothing arose is a conclusion, so it carries reasoning
  constraint gov_review_no_actions_is_reasoned
    check (not no_actions_arising or btrim(coalesce(no_actions_rationale, '')) <> ''),
  constraint gov_review_period_is_ordered
    check (period_end is null or period_start is null or period_end >= period_start)
);

comment on table gov_review is
  'CPR-PD-010 s14 governance review. Cannot be closed with no outputs unless it declares no actions arising with a reason - concluding nothing is legitimate, concluding nothing silently is not.';

alter table gov_review enable row level security;

create index if not exists idx_gov_review_state on gov_review (state, held_on desc);
create index if not exists idx_gov_review_trigger on gov_review (trigger_kind);

-- ---- 2. ATTENDEES AND ROLES (s14) -------------------------------------------------------------------
--
-- s14: "Record attendees/roles". The role matters more than the name for a governance record: whether
-- the security owner was in the room is a different question from whether a particular person was.

create table if not exists gov_review_attendee (
  attendee_id   uuid primary key default gen_random_uuid(),
  review_id     uuid not null references gov_review(review_id) on delete cascade,
  person_name   text not null check (btrim(person_name) <> ''),
  role          text,
  attended      boolean not null default true,
  apology       boolean not null default false,
  created_at    timestamp with time zone not null default now(),

  -- somebody cannot both attend and send apologies
  constraint gov_review_attendee_not_both
    check (not (attended and apology))
);

alter table gov_review_attendee enable row level security;

create index if not exists idx_gov_review_attendee on gov_review_attendee (review_id);

-- ---- 3. AGENDA AND WHAT WAS ACTUALLY REVIEWED (s14) -------------------------------------------------
--
-- s14 lists the agenda material: "risk posture, high risks, control effectiveness, obligations,
-- incidents, releases, exceptions, audit findings and overdue actions."
--
-- NOTE  `was_reviewed` IS SEPARATE FROM THE ITEM EXISTING. An agenda is a plan and a review is what
-- happened, and the gap between them is the useful record: an item that was tabled three times running
-- and never reached is a governance signal, and one a merged field would erase.

create table if not exists gov_review_agenda_item (
  item_id       uuid primary key default gen_random_uuid(),
  review_id     uuid not null references gov_review(review_id) on delete cascade,
  topic         text not null
                check (topic in ('risk_posture', 'high_risks', 'control_effectiveness', 'obligations',
                                 'incidents', 'releases', 'exceptions', 'audit_findings',
                                 'overdue_actions', 'privacy', 'security', 'clinical_safety', 'other')),
  note          text,
  was_reviewed  boolean not null default false,
  not_reached_reason text,
  sort_order    int not null default 100,

  constraint gov_agenda_not_reached_is_reasoned
    check (was_reviewed or not_reached_reason is null or btrim(not_reached_reason) <> '')
);

alter table gov_review_agenda_item enable row level security;

create index if not exists idx_gov_agenda_review on gov_review_agenda_item (review_id, sort_order);

-- ---- 4. EVIDENCE REVIEWED (s14) ---------------------------------------------------------------------

create table if not exists gov_review_evidence (
  review_id   uuid not null references gov_review(review_id) on delete cascade,
  evidence_id uuid not null references gov_evidence(evidence_id) on delete cascade,
  note        text,
  primary key (review_id, evidence_id)
);

alter table gov_review_evidence enable row level security;

-- ---- 5. THE OUTPUTS - LINKED STRUCTURED RECORDS (s14) -----------------------------------------------
--
-- The whole point of the section. An output is a FOREIGN KEY into a record that already exists, so a
-- review's conclusions are chaseable through the same registers everything else uses.
--
-- Typed nullable parents with an exactly-one CHECK, on the pattern migration 319 had to introduce and
-- 325 adopted from the start.

create table if not exists gov_review_output (
  output_id     uuid primary key default gen_random_uuid(),
  review_id     uuid not null references gov_review(review_id) on delete cascade,

  decision_id   uuid references gov_decision(decision_id) on delete cascade,
  risk_action_id uuid references gov_risk_action(action_id) on delete cascade,
  finding_id    uuid references gov_audit_finding(finding_id) on delete cascade,
  exception_id  uuid references gov_exception(exception_id) on delete cascade,
  risk_id       uuid references gov_product_risk(risk_id) on delete cascade,

  note          text,
  created_at    timestamp with time zone not null default now(),

  constraint gov_review_output_one_parent
    check (
      (case when decision_id is not null then 1 else 0 end)
      + (case when risk_action_id is not null then 1 else 0 end)
      + (case when finding_id is not null then 1 else 0 end)
      + (case when exception_id is not null then 1 else 0 end)
      + (case when risk_id is not null then 1 else 0 end) = 1
    )
);

comment on table gov_review_output is
  'CPR-PD-010 s14 review output. A foreign key into a record that already exists, never a copy or a note about one - which is what "linked structured records" means and what minutes cannot do.';

alter table gov_review_output enable row level security;

create index if not exists idx_gov_review_output on gov_review_output (review_id);

-- ---- 6. A REVIEW CANNOT CLOSE SILENTLY (s14) --------------------------------------------------------

create or replace function gov_review_close_requires_outcome()
returns trigger
language plpgsql
as $$
declare
  n int;
begin
  if new.state <> 'closed' then
    return new;
  end if;

  select count(*) into n from gov_review_output where review_id = new.review_id;

  if n = 0 and not new.no_actions_arising then
    raise exception
      'CPR-PD-010 s14: review % cannot be closed with no linked outputs. Either link the decisions, actions, findings or exceptions it produced, or set no_actions_arising with a rationale. A review that decided nothing and a review whose outputs nobody recorded must not look identical.',
      new.reference;
  end if;

  -- and the declaration must be true when it is made
  if n > 0 and new.no_actions_arising then
    raise exception
      'CPR-PD-010 s14: review % declares no actions arising but has % linked output(s).',
      new.reference, n;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_gov_review_close_requires_outcome on gov_review;
create trigger trg_gov_review_close_requires_outcome
  before insert or update on gov_review
  for each row execute function gov_review_close_requires_outcome();

-- ---- 7. NOTHING IS SEEDED ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
