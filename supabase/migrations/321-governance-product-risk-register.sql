-- CPR-PD-010 phase 2 - the Product Risk Register, s4's canonical model.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies.
--
-- THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS FROM
--
-- gov_product_risk HAS NO SCORE COLUMNS. No likelihood, no impact, no inherent, no residual. Every
-- score lives in gov_risk_assessment, which is append only.
--
-- s15: "Completion of an action does not automatically reduce residual risk, reassessment/effectiveness
-- evidence is required." s24 restates it as an acceptance criterion. The usual way to build that is a
-- rule in the service layer saying "do not lower residual_risk when closing an action" - and the usual
-- way it fails is the second writer, six months later, who does not know the rule exists.
--
-- With no score on the risk row there is nothing for a completing action to write. Lowering residual
-- risk requires INSERTING A NEW ASSESSMENT, which stamps a methodology version, a date and an assessor.
-- The rule is not enforced, it is UNEXPRESSIBLE.
--
-- WHAT THAT COSTS, STATED PLAINLY: "the current residual score" becomes a read-time lookup of the
-- newest residual assessment rather than a column. That is a join the register pays on every read. It
-- is the right trade - the alternative is a number anybody can set to anything with no evidence and no
-- history, which is the thing s4 and s20 both exist to prevent.
--
-- AND TODAY NO RISK CAN BE SCORED AT ALL
--
-- gov_risk_assessment.methodology_id is NOT NULL, and migration 320 published no methodology. So a risk
-- can be REGISTERED right now - title, statement, category, owner, review date - and cannot be SCORED
-- until somebody publishes a methodology. That is not a gap in this migration. It is s4 holding: a score
-- with no published scale behind it is the hidden arbitrary number, and the schema will not store one.

-- ---- 1. THE RISK (s4) -------------------------------------------------------------------------------

create table if not exists gov_product_risk (
  risk_id       uuid primary key default gen_random_uuid(),
  -- s4 "Stable ID". A human-quotable reference that survives a retitle, because a risk is cited in
  -- decisions and minutes by its number and a uuid is not something anybody reads out
  reference     text not null unique,
  title         text not null check (btrim(title) <> ''),
  -- s4: "Cause/event/consequence structure where practical" - three columns rather than one blob, so
  -- the structure survives being typed and a reader can see which part is missing
  cause         text,
  event         text,
  consequence   text,
  category_code text not null references gov_risk_category(code),

  -- subject scoping, from the phase 1 canonical registry. NOT hospital_id: gov_risks (migration 060)
  -- keys on hospitals and means "null = platform-wide", which cannot separate this product from the
  -- platform from a market
  subject_type  text not null default 'product' references mos_subject_type(code),
  subject_id    text,

  owner_id      uuid,
  owner_name    text,

  -- s4 treatment vocabulary, exactly the four s15 names
  treatment     text not null default 'mitigate'
                check (treatment in ('avoid', 'mitigate', 'transfer', 'accept')),
  status        text not null default 'open'
                check (status in ('open', 'monitoring', 'treatment', 'accepted', 'closed')),

  -- s4: "Trend - Improving, Stable, Worsening or Unknown WITH RATIONALE/SOURCE"
  trend         text not null default 'unknown'
                check (trend in ('improving', 'stable', 'worsening', 'unknown')),
  trend_rationale text,

  -- s4: "Review date - next required reassessment"
  next_review_on date,

  -- s4: "Escalation - governance/escalation state and destination"
  escalation_state text not null default 'none'
                   check (escalation_state in ('none', 'requested', 'escalated', 'accepted_above', 'returned')),
  escalation_to   text,
  escalation_reason text,

  closed_at     timestamp with time zone,
  closure_reason text,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  -- a stated direction is a claim, so it carries its reasoning or it stays unknown
  constraint gov_risk_trend_is_reasoned
    check (trend = 'unknown' or btrim(coalesce(trend_rationale, '')) <> ''),
  -- escalating names where it went, or it is not an escalation
  constraint gov_risk_escalation_has_destination
    check (escalation_state in ('none', 'returned') or btrim(coalesce(escalation_to, '')) <> ''),
  constraint gov_risk_closed_is_explained
    check ((status = 'closed') = (closed_at is not null))
);

comment on table gov_product_risk is
  'CPR-PD-010 s4 product risk. Carries NO score columns by design - every score is an append-only assessment, so completing an action cannot reduce residual risk without a reassessment.';

alter table gov_product_risk enable row level security;

create index if not exists idx_gov_risk_open on gov_product_risk (status, next_review_on);
create index if not exists idx_gov_risk_owner on gov_product_risk (owner_id);
create index if not exists idx_gov_risk_subject on gov_product_risk (subject_type, subject_id);

-- ---- 2. THE ASSESSMENT, APPEND ONLY AND METHODOLOGY-STAMPED (s4, s5, s20) ---------------------------
--
-- s5: "Changing methodology requires versioning/effective date and MUST NOT SILENTLY REWRITE HISTORICAL
-- ASSESSMENTS." Each row stamps the methodology and the scale points it used, so publishing version 2
-- reprices nothing - the old rows still say what they meant under version 1.
--
-- s21: "Show inherent and residual risk clearly, NEVER MAKE USERS GUESS WHICH SCORE THEY ARE VIEWING."
-- `basis` is on the row rather than implied by column names, so a score cannot be rendered without
-- saying which of the two it is.

-- composite target so an assessment cannot borrow a scale point from a DIFFERENT methodology
alter table gov_risk_scale drop constraint if exists gov_risk_scale_methodology_scale_key;
alter table gov_risk_scale add constraint gov_risk_scale_methodology_scale_key unique (methodology_id, scale_id);

create table if not exists gov_risk_assessment (
  assessment_id  uuid primary key default gen_random_uuid(),
  risk_id        uuid not null references gov_product_risk(risk_id) on delete cascade,
  -- NOT NULL, and this is the whole of s4's "never a hidden arbitrary number" in one word
  methodology_id uuid not null references gov_risk_methodology(methodology_id),
  basis          text not null check (basis in ('inherent', 'residual')),

  likelihood_scale_id uuid not null,
  impact_scale_id     uuid not null,
  -- the resolved number, kept so history survives a scale being edited, alongside the ordinals it came
  -- from. s20: "Historical risk scores/assessments remain recoverable"
  likelihood_ordinal  int not null,
  impact_ordinal      int not null,
  score               int not null,

  rationale      text,
  assessed_by    text,
  assessed_at    timestamp with time zone not null default now(),
  created_at     timestamp with time zone not null default now(),

  constraint gov_assessment_likelihood_fk
    foreign key (methodology_id, likelihood_scale_id) references gov_risk_scale (methodology_id, scale_id),
  constraint gov_assessment_impact_fk
    foreign key (methodology_id, impact_scale_id) references gov_risk_scale (methodology_id, scale_id)
);

comment on table gov_risk_assessment is
  'CPR-PD-010 s4/s5 risk assessment. Append only and methodology-stamped, so a new methodology version reprices nothing already assessed.';

alter table gov_risk_assessment enable row level security;

create index if not exists idx_gov_assessment_current on gov_risk_assessment (risk_id, basis, assessed_at desc);

-- s20: "Do not silently rewrite prior decisions or approvals, corrections should be versioned/append
-- only where feasible." A correction is a NEW assessment, which is what makes the history readable.
--
-- NOTE  THE DELETE RULE IS THE ONE MIGRATIONS 316 AND 319 ARRIVED AT THE HARD WAY. A trigger refusing
-- every DELETE also refuses the CASCADE, which leaves a parent row impossible to remove by anybody. A
-- DELETE arriving at trigger depth greater than one comes from the cascade and is allowed.

create or replace function gov_risk_assessment_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception
    'CPR-PD-010 s20: gov_risk_assessment is append only. % refused on assessment %. Record a NEW assessment instead - a correction is a reassessment, not an edit.',
    tg_op, old.assessment_id;
end;
$$;

drop trigger if exists trg_gov_risk_assessment_immutable on gov_risk_assessment;
create trigger trg_gov_risk_assessment_immutable
  before update or delete on gov_risk_assessment
  for each row execute function gov_risk_assessment_immutable();

-- an assessment may only be scored under a methodology that was actually published
create or replace function gov_risk_assessment_methodology_published()
returns trigger
language plpgsql
as $$
declare
  st text;
begin
  select status into st from gov_risk_methodology where methodology_id = new.methodology_id;
  if st is null or st = 'draft' then
    raise exception
      'CPR-PD-010 s4: a risk cannot be scored under a methodology that has not been published. A score with no published scale behind it is the hidden arbitrary number s4 forbids.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gov_assessment_methodology_published on gov_risk_assessment;
create trigger trg_gov_assessment_methodology_published
  before insert on gov_risk_assessment
  for each row execute function gov_risk_assessment_methodology_published();

-- ---- 3. TREATMENT ACTIONS (s15) ---------------------------------------------------------------------
--
-- s15: "Each mitigation action has owner, due date, status, evidence and linked risk/control."
--
-- verified_by_assessment_id IS THE POINT OF THIS TABLE. s15 and s24 both require that completing an
-- action does not by itself reduce risk. The schema cannot let it (there is no score to write), and this
-- column makes the follow-through VISIBLE: a done action with no reassessment behind it is a promise
-- kept with no evidence that it worked, and the register can list exactly those.

create table if not exists gov_risk_action (
  action_id     uuid primary key default gen_random_uuid(),
  risk_id       uuid not null references gov_product_risk(risk_id) on delete cascade,
  action        text not null check (btrim(action) <> ''),
  owner_id      uuid,
  owner_name    text not null check (btrim(owner_name) <> ''),
  due_on        date,
  state         text not null default 'open'
                check (state in ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  blocker       text,
  evidence      text,
  -- the reassessment that followed this action, if one has been made
  verified_by_assessment_id uuid references gov_risk_assessment(assessment_id) on delete set null,
  completed_at  timestamp with time zone,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  constraint gov_risk_action_done_is_dated
    check ((state = 'done') = (completed_at is not null)),
  -- a verification cannot exist before the work it verifies
  constraint gov_risk_action_verified_implies_done
    check (verified_by_assessment_id is null or state = 'done')
);

comment on table gov_risk_action is
  'CPR-PD-010 s15 risk treatment action. verified_by_assessment_id exposes the actions that were completed and never followed by a reassessment.';

alter table gov_risk_action enable row level security;

create index if not exists idx_gov_risk_action_open on gov_risk_action (state, due_on);
create index if not exists idx_gov_risk_action_risk on gov_risk_action (risk_id);

-- ---- 4. NOTHING IS SEEDED ---------------------------------------------------------------------------
--
-- No risk, no assessment, no action. The comp shows a register of five with scores of 21, 16, 15, 12 and
-- 9 - and every one of those numbers would need a methodology that does not exist, so seeding them would
-- require publishing a scale nobody approved in order to make illustrative data storable. The register
-- opens empty, which is what an unassessed estate looks like.

notify pgrst, 'reload schema';
