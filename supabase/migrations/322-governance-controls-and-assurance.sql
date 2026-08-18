-- CPR-PD-010 phase 4 - Controls and Assurance, s6.
--
-- APPLY THIS FILE WHOLE. It defines a plpgsql trigger function with a dollar-quoted body.
--
-- THE SAME STRUCTURAL DECISION AS MIGRATION 321, FOR THE SAME REASON
--
-- gov_control HAS NO EFFECTIVENESS COLUMNS. Not design, not operating. Both are derived at read time
-- from the newest test of each kind, and a control with no test of that kind resolves to NOT ASSESSED
-- or NOT TESTED.
--
-- s6: "CONTROL EXISTENCE IS NOT PROOF OF EFFECTIVENESS." s22: "Control not tested - render Not Tested,
-- NEVER Effective." s24 makes both acceptance criteria.
--
-- An operating_effectiveness column would let any writer set 'effective' on a control nobody has ever
-- tested, and the rule would then live in whichever service layer remembered it. With no column there
-- is nothing to set: claiming a control works requires INSERTING A TEST, which names a tester, a date
-- and what was examined. "Not tested is never effective" is not enforced here - it is unsayable.
--
-- WHAT IT COSTS, STATED: every read of a control's effectiveness is a lookup of its newest test rather
-- than a column read. The alternative is a green tick anybody can set with no evidence and no history,
-- which is precisely the assurance theatre s6 exists to prevent.
--
-- WHY DESIGN AND OPERATING ARE THE SAME TABLE WITH A `basis` COLUMN
--
-- They are two questions - would this work if it ran as described, and did it actually run and work -
-- and s6 keeps them apart. But they are the same SHAPE of evidence: a tester, a date, a method, a
-- result. One table with a basis column keeps them distinguishable while making it impossible to build
-- a test history for one and forget it for the other, which is how the two drift.

-- ---- 1. THE CONTROL (s6) ----------------------------------------------------------------------------

create table if not exists gov_control (
  control_id    uuid primary key default gen_random_uuid(),
  -- a human-quotable reference, on the same reasoning as the risk register: controls are cited in
  -- audit findings and minutes by their number
  reference     text not null unique,
  name          text not null check (btrim(name) <> ''),
  -- s6 "clear objective". What this control is FOR, which is the thing a test is judged against
  objective     text,

  control_type  text not null default 'preventive'
                check (control_type in ('preventive', 'detective', 'corrective')),
  execution     text not null default 'manual'
                check (execution in ('automated', 'manual', 'hybrid')),
  frequency     text not null default 'continuous'
                check (frequency in ('continuous', 'event_driven', 'daily', 'weekly',
                                     'monthly', 'quarterly', 'annual', 'ad_hoc')),

  owner_id      uuid,
  owner_name    text,

  -- s6: "Evidence requirement - what proves operation/effectiveness". Stated when the control is
  -- written, so a tester is not left deciding for themselves what would count
  evidence_requirement text,

  -- s6: "Testing independence/approver requirements should be configurable" - per control, because a
  -- payments control and a naming-convention control do not need the same independence
  requires_independent_test boolean not null default false,
  requires_approval         boolean not null default false,

  subject_type  text not null default 'product' references mos_subject_type(code),
  subject_id    text,

  next_test_due date,
  is_active     boolean not null default true,
  retired_at    timestamp with time zone,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  constraint gov_control_retired_matches_active
    check (is_active = (retired_at is null))
);

comment on table gov_control is
  'CPR-PD-010 s6 control. Carries NO effectiveness columns by design - s6 says control existence is not proof of effectiveness, so effectiveness is derived from tests and a control with none is Not Tested.';

alter table gov_control enable row level security;

create index if not exists idx_gov_control_active on gov_control (is_active, next_test_due);
create index if not exists idx_gov_control_owner on gov_control (owner_id);

-- ---- 2. THE TEST, APPEND ONLY (s6, s20) -------------------------------------------------------------
--
-- NOTE  result has THREE values and neither absence state is among them. "Not assessed" and "not tested"
-- describe a control with no test row of that basis - they are the ABSENCE of evidence, and storing
-- them as results would make "we looked and found nothing wrong" indistinguishable from "nobody looked".

create table if not exists gov_control_test (
  test_id       uuid primary key default gen_random_uuid(),
  control_id    uuid not null references gov_control(control_id) on delete cascade,
  basis         text not null check (basis in ('design', 'operating')),
  result        text not null check (result in ('effective', 'partial', 'ineffective')),

  method        text,
  sample_note   text,
  evidence      text,
  finding       text,

  tested_by     text not null check (btrim(tested_by) <> ''),
  -- s6's configurable independence, recorded per test so a later audit can see whether it was met
  tester_independent boolean not null default false,
  approved_by   text,
  approved_at   timestamp with time zone,

  tested_at     timestamp with time zone not null default now(),
  created_at    timestamp with time zone not null default now(),

  -- an ineffective or partial result is a finding, or the test says something went wrong and nothing
  -- about what. s13 links findings to corrective actions, and this is where that link starts
  constraint gov_control_test_adverse_has_finding
    check (result = 'effective' or btrim(coalesce(finding, '')) <> ''),
  constraint gov_control_test_approval_is_dated
    check ((approved_by is not null) = (approved_at is not null))
);

comment on table gov_control_test is
  'CPR-PD-010 s6 control test. Append only. result holds no absence value - Not Assessed and Not Tested describe a control with no test of that basis, never a stored outcome.';

alter table gov_control_test enable row level security;

create index if not exists idx_gov_control_test_current on gov_control_test (control_id, basis, tested_at desc);

-- s20: assurance results are not silently rewritten. A retest is a NEW row, which is what makes an
-- improving or degrading control visible instead of just currently-green.
--
-- NOTE  THE CASCADE ALLOWANCE FROM MIGRATIONS 316, 319 AND 321. A trigger refusing every DELETE also
-- refuses the cascade, leaving the parent impossible to remove by anybody.

create or replace function gov_control_test_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception
    'CPR-PD-010 s20: gov_control_test is append only. % refused on test %. Record a NEW test instead - a retest is evidence, an edit is not.',
    tg_op, old.test_id;
end;
$$;

drop trigger if exists trg_gov_control_test_immutable on gov_control_test;
create trigger trg_gov_control_test_immutable
  before update or delete on gov_control_test
  for each row execute function gov_control_test_immutable();

-- an independence requirement that is not met at test time is refused, rather than recorded and hoped
-- about. s6 makes independence configurable, and a configurable rule nothing checks is documentation
create or replace function gov_control_test_meets_independence()
returns trigger
language plpgsql
as $$
declare
  needs_independent boolean;
  needs_approval    boolean;
begin
  select requires_independent_test, requires_approval
    into needs_independent, needs_approval
  from gov_control where control_id = new.control_id;

  if needs_independent and not new.tester_independent then
    raise exception
      'CPR-PD-010 s6: control % requires an independent tester and this test is not marked independent.',
      new.control_id;
  end if;

  if needs_approval and new.approved_by is null then
    raise exception
      'CPR-PD-010 s6: control % requires an approved test result and this test names no approver.',
      new.control_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_gov_control_test_independence on gov_control_test;
create trigger trg_gov_control_test_independence
  before insert on gov_control_test
  for each row execute function gov_control_test_meets_independence();

-- ---- 3. CONTROL TO RISK, MANY TO MANY (s6) ----------------------------------------------------------
--
-- s6: "Many-to-many linkage to risks and obligations." One control mitigates several risks and one risk
-- is mitigated by several controls, so neither side can hold a column. Obligations arrive with s10 and
-- get their own link table then rather than a nullable second column here.

create table if not exists gov_control_risk (
  control_id  uuid not null references gov_control(control_id) on delete cascade,
  risk_id     uuid not null references gov_product_risk(risk_id) on delete cascade,
  -- s4: "Linked control records, DO NOT DUPLICATE CONTROL DESCRIPTIONS AS FREE TEXT ONLY". This link is
  -- the relationship, and there is deliberately no place here to retype what the control does
  linked_at   timestamp with time zone not null default now(),
  linked_by   text,
  primary key (control_id, risk_id)
);

comment on table gov_control_risk is
  'CPR-PD-010 s6 control-to-risk linkage, many to many. Holds no copy of the control description - s4 forbids duplicating it as free text.';

alter table gov_control_risk enable row level security;

create index if not exists idx_gov_control_risk_risk on gov_control_risk (risk_id);

-- ---- 4. NOTHING IS SEEDED ---------------------------------------------------------------------------
--
-- The comp shows 132 controls, 85 of them effective. Seeding any control at all would put a row on the
-- assurance screen that nobody wrote, owns or tests - and because effectiveness is derived, a seeded
-- control would correctly render as Not Tested, which reads as a governance failure rather than as an
-- empty product. An empty table says the true thing.

notify pgrst, 'reload schema';
