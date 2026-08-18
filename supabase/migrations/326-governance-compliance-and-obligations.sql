-- CPR-PD-010 phase 8 - Compliance and Obligations, s10.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies.
--
-- THE SIXTH TABLE IN THIS MODULE TO OMIT THE OBVIOUS COLUMN
--
--   321  risk       no score        322  control  no verdict      323  exception  no is_active
--   324  decision   no in_effect    325  evidence no is_valid     326  obligation no compliance_state
--
-- s10: "Compliance state must distinguish Compliant, At Risk, Non-compliant, NOT ASSESSED and NOT
-- APPLICABLE." Five states, and the last two are DIFFERENT KINDS OF ABSENCE:
--
--   NOT ASSESSED    nobody has looked. The absence of a judgement.
--   NOT APPLICABLE  somebody looked and determined this obligation does not bind us here. A judgement,
--                   with a person and a reason behind it.
--
-- They are epistemic opposites and a compliance_state column makes them one keystroke apart. Worse, it
-- makes NOT ASSESSED a value somebody TYPES - and a default of 'not_assessed' on a column is
-- indistinguishable from an assessment that concluded nothing, which is how an unexamined obligation
-- comes to look reviewed.
--
-- So the obligation carries no state. State DERIVES from the newest assessment, and no assessment
-- resolves to Not Assessed. Not Applicable is storable only as an explicit assessment WITH A RATIONALE,
-- because deciding a regulation does not apply to you is exactly the kind of conclusion that should
-- carry a name.
--
-- APPLICABILITY IS SUBJECT-SCOPED, BECAUSE s10 FORBIDS ONE JURISDICTION
--
-- s10: "DO NOT HARD-CODE ONE JURISDICTION, applicability must be market/product scoped." An obligation
-- binding in Uganda and irrelevant in Kenya is the ordinary case, not an edge one - so an assessment is
-- made against a SUBJECT from the phase 1 canonical registry, and the same obligation can be Compliant
-- for one market and Not Applicable for another without either overwriting the other.

-- ---- 1. THE OBLIGATION (s10) ------------------------------------------------------------------------

create table if not exists gov_obligation (
  obligation_id uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  title         text not null check (btrim(title) <> ''),
  -- s10: "requirement" - what must actually be done, as distinct from the title
  requirement   text not null check (btrim(requirement) <> ''),

  -- s10's sources
  source_kind   text not null default 'regulation'
                check (source_kind in ('law_regulation', 'regulation', 'contract', 'standard',
                                       'accreditation', 'corporate_policy', 'governance_decision')),
  source_authority text,
  source_ref    text,

  domain        text,
  owner_id      uuid,
  owner_name    text,

  -- s10: "review frequency"
  review_frequency text not null default 'annual'
                   check (review_frequency in ('monthly', 'quarterly', 'biannual', 'annual', 'once', 'on_change')),
  next_review_on date,
  effective_from date,
  expires_on     date,

  is_active     boolean not null default true,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  constraint gov_obligation_window_is_ordered
    check (expires_on is null or effective_from is null or expires_on > effective_from)
);

comment on table gov_obligation is
  'CPR-PD-010 s10 obligation. Carries NO compliance_state column - state derives from the newest assessment, so Not Assessed is the absence of a judgement rather than a value somebody typed.';

alter table gov_obligation enable row level security;

create index if not exists idx_gov_obligation_active on gov_obligation (is_active, next_review_on);

-- ---- 2. THE ASSESSMENT, APPEND ONLY AND SUBJECT-SCOPED (s10) ----------------------------------------
--
-- One table carries both halves deliberately. Applicability and compliance are asked in one act - you
-- cannot judge whether you comply with something you have not first decided binds you - and splitting
-- them into two tables would allow a compliance verdict against an obligation nobody had established
-- applies.

create table if not exists gov_obligation_assessment (
  assessment_id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references gov_obligation(obligation_id) on delete cascade,

  -- s10's market/product scoping, from the phase 1 canonical registry
  subject_type  text not null default 'product' references mos_subject_type(code),
  subject_id    text,

  applicability text not null check (applicability in ('applicable', 'not_applicable')),
  -- NULL exactly when the obligation does not apply. A compliance verdict against something that does
  -- not bind you is not a verdict, and 'compliant' would be the most misleading way to record it
  compliance_state text
                   check (compliance_state in ('compliant', 'at_risk', 'non_compliant')),

  rationale     text,
  gap_summary   text,
  assessed_by   text not null check (btrim(assessed_by) <> ''),
  assessed_at   timestamp with time zone not null default now(),
  next_review_on date,
  created_at    timestamp with time zone not null default now(),

  -- the two halves cannot disagree
  constraint gov_obl_state_matches_applicability
    check ((applicability = 'applicable') = (compliance_state is not null)),
  -- deciding a regulation does not bind you is a conclusion that carries a name and a reason
  constraint gov_obl_not_applicable_is_reasoned
    check (applicability <> 'not_applicable' or btrim(coalesce(rationale, '')) <> ''),
  -- so is declaring yourself non-compliant or at risk: the gap is the actionable part
  constraint gov_obl_adverse_states_the_gap
    check (compliance_state is null or compliance_state = 'compliant'
           or btrim(coalesce(gap_summary, '')) <> '')
);

comment on table gov_obligation_assessment is
  'CPR-PD-010 s10 applicability and compliance assessment. Append only and subject-scoped, so the same obligation can be Compliant in one market and Not Applicable in another without either overwriting the other.';

alter table gov_obligation_assessment enable row level security;

create index if not exists idx_gov_obl_assessment_current
  on gov_obligation_assessment (obligation_id, subject_type, subject_id, assessed_at desc);

-- s20: assessments are not silently rewritten. A changed conclusion is a NEW assessment, which is what
-- makes "we used to think this did not apply to us" recoverable.
--
-- NOTE  THE CASCADE ALLOWANCE, on the pattern migrations 316, 319, 321 and 322 arrived at.

create or replace function gov_obligation_assessment_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception
    'CPR-PD-010 s20: gov_obligation_assessment is append only. % refused on assessment %. Record a NEW assessment - a changed conclusion is a reassessment, not an edit.',
    tg_op, old.assessment_id;
end;
$$;

drop trigger if exists trg_gov_obl_assessment_immutable on gov_obligation_assessment;
create trigger trg_gov_obl_assessment_immutable
  before update or delete on gov_obligation_assessment
  for each row execute function gov_obligation_assessment_immutable();

-- ---- 3. OBLIGATION TO CONTROL, MANY TO MANY (s6, s10) -----------------------------------------------
--
-- s6 asked for many-to-many linkage to risks AND obligations. Migration 322 built the risk half and
-- deliberately left this one until obligations existed rather than adding a nullable second column.

create table if not exists gov_obligation_control (
  obligation_id uuid not null references gov_obligation(obligation_id) on delete cascade,
  control_id    uuid not null references gov_control(control_id) on delete cascade,
  linked_at     timestamp with time zone not null default now(),
  linked_by     text,
  primary key (obligation_id, control_id)
);

alter table gov_obligation_control enable row level security;

create index if not exists idx_gov_obligation_control_control on gov_obligation_control (control_id);

-- ---- 4. THE DERIVED VIEW (s10) ----------------------------------------------------------------------
--
-- The five states in one place, so no caller invents a sixth or collapses two. NOT ASSESSED is what a
-- LEFT JOIN finding nothing produces - it is the absence, rendered, rather than a stored value.

create or replace view gov_obligation_state as
select
  o.obligation_id,
  o.reference,
  o.title,
  o.source_kind,
  o.owner_name,
  o.is_active,
  o.next_review_on,
  a.subject_type,
  a.subject_id,
  a.assessed_at,
  a.assessed_by,
  a.rationale,
  a.gap_summary,
  coalesce(
    case
      when a.assessment_id is null then 'not_assessed'
      when a.applicability = 'not_applicable' then 'not_applicable'
      else a.compliance_state
    end,
    'not_assessed'
  ) as state,
  (a.assessment_id is null) as never_assessed,
  (o.next_review_on is not null and o.next_review_on < current_date) as review_overdue
from gov_obligation o
left join lateral (
  select *
  from gov_obligation_assessment x
  where x.obligation_id = o.obligation_id
  order by x.assessed_at desc
  limit 1
) a on true;

comment on view gov_obligation_state is
  'CPR-PD-010 s10 five-state compliance. not_assessed is produced by a LEFT JOIN finding nothing - the absence of a judgement rather than a stored value that looks like one.';

-- ---- 5. NOTHING IS SEEDED ---------------------------------------------------------------------------
--
-- s10 forbids hard-coding one jurisdiction, and seeding a plausible obligation register would do
-- exactly that: whichever regulations I chose would become the ones this product believes bind it.

notify pgrst, 'reload schema';
