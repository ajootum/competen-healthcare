-- CPR-PD-010 phase 12 - HQ governance integration, s18. Owner policy, 2026-08-18.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies.
--
-- THE GOVERNING PRINCIPLE, IN THE OWNER'S WORDS
--
--   Product by default -> HQ by defined corporate-impact trigger -> human review where the boundary
--   is uncertain.
--
-- s18 says product risks and decisions escalate "according to corporate governance architecture" and
-- never says which ones. That is a twelfth unstated threshold, and the owner has ruled it must NOT be
-- answered with a number:
--
--   "Do not implement rules such as risk_score > 70 -> HQ or High/Critical -> HQ until an approved,
--    versioned methodology defines what those values mean. RISK CLASSIFICATION AND ESCALATION AUTHORITY
--    ARE RELATED BUT SEPARATE CONCEPTS."
--
-- That distinction is why no score would work even if one existed. A risk may be operationally severe
-- and fall wholly within the Product Director's authority. A small issue may require HQ because it sets
-- a regulatory precedent or affects a second product. Severity measures the harm. Escalation measures
-- WHOSE DECISION IT IS. A schema that derived the second from the first would be wrong in both
-- directions at once, and would look principled while doing it.
--
-- SO ESCALATION IS TRIGGER-BASED, AND THE NINTH TIME THIS ARC REFUSES A SILENT ABSENCE
--
-- gov_product_risk and gov_decision carry NO escalation column. A matter's escalation state derives
-- from whether somebody has DETERMINED it, and a matter nobody has determined reads:
--
--   ESCALATION REVIEW REQUIRED
--
-- never "no escalation required". The owner's uncertainty rule is explicit: "If the system cannot
-- determine whether a matter crosses an escalation boundary, IT MUST NOT SILENTLY CLASSIFY IT AS 'No
-- escalation required'." A boolean defaulting to false does exactly that, for every matter, for ever.
--
-- "No escalation required" is therefore a JUDGEMENT somebody made, with a name and a rationale on it -
-- the same shape as migration 326's Not Applicable, and for the same reason.

-- ---- 1. THE TRIGGER CATALOGUE (owner policy) --------------------------------------------------------
--
-- The owner: "make the trigger catalogue and escalation destinations CONFIGURATION/GOVERNANCE-POLICY
-- DRIVEN, not hard-coded permanently into application logic." So a table, not a TypeScript union.
--
-- These eleven ARE seeded, and that is legitimate where a threshold would not be: the owner stated them
-- as the mandatory baseline policy in the instruction this migration implements. is_baseline marks them
-- as such, so when the Delegation and Escalation Matrix is published its triggers are distinguishable
-- from the interim set rather than silently merged with it.

create table if not exists gov_escalation_trigger (
  trigger_code  text primary key,
  label         text not null check (btrim(label) <> ''),
  description   text not null check (btrim(description) <> ''),
  -- baseline policy pending the published matrix, versus a trigger the matrix later defines
  is_baseline   boolean not null default true,
  matrix_version int,
  is_active     boolean not null default true,
  sort_order    int not null default 100,
  created_at    timestamp with time zone not null default now()
);

comment on table gov_escalation_trigger is
  'CPR-PD-010 s18 corporate-impact escalation triggers. A table rather than application logic, per owner policy - the catalogue is governance configuration and will be superseded by the published Delegation and Escalation Matrix.';

alter table gov_escalation_trigger enable row level security;

insert into gov_escalation_trigger (trigger_code, label, description, sort_order) values
  ('multi_product_impact', 'Multi-product or shared service impact',
   'Could materially affect more than one Competen product or a shared platform or core service.', 10),
  ('clinical_safety_beyond_authority', 'Clinical safety beyond delegated authority',
   'Creates or may create a patient or clinical safety risk beyond the Product Director delegated authority.', 20),
  ('security_privacy_corporate', 'Material security, privacy or data protection exposure',
   'Creates a material security, privacy or data-protection risk with corporate implications.', 30),
  ('legal_regulatory_exposure', 'Material legal, regulatory or compliance exposure',
   'Creates a material legal, regulatory or compliance exposure.', 40),
  ('outside_delegated_authority', 'Decision outside delegated authority',
   'Requires a decision outside the Product Director formally delegated authority.', 50),
  ('unbudgeted_commitment', 'Unbudgeted corporate commitment or resource allocation',
   'Requires a material unbudgeted corporate commitment, financial exposure or resource allocation beyond the product delegated authority.', 60),
  ('reputation_or_trust', 'Reputation, brand or public trust',
   'May materially affect Competen reputation, brand or public trust.', 70),
  ('availability_or_continuity', 'Availability, continuity or shared critical service',
   'Threatens material product availability, business continuity or a shared critical service.', 80),
  ('cross_authority_conflict', 'Conflict between products, policies or authorities',
   'Creates a conflict between products, corporate policies or governance authorities that cannot be resolved at product level.', 90),
  ('residual_risk_beyond_authority', 'Residual risk acceptance beyond authority',
   'Requires acceptance of a residual risk that the Product Director is not authorised to accept.', 100),
  ('referred_upward', 'Referred upward for uncertain but significant impact',
   'Explicitly referred upward by an authorised Product Governance role because the potential corporate impact is uncertain but reasonably significant.', 110)
on conflict (trigger_code) do nothing;

-- ---- 2. THE DELEGATION AND ESCALATION MATRIX (owner policy) -----------------------------------------
--
-- The owner: "We will ultimately maintain a published, VERSIONED Product Governance Delegation and
-- Escalation Matrix that defines: matter type -> product authority -> escalation trigger -> HQ
-- receiving authority -> required response/approval."
--
-- Versioned on the pattern migration 320 established for the risk methodology, and EMPTY for the same
-- reason: "Until that matrix is formally populated, the mandatory triggers above are the baseline
-- policy." Seeding rows would publish an authority map nobody approved.

create table if not exists gov_delegation_matrix (
  matrix_id     uuid primary key default gen_random_uuid(),
  version       int not null,
  matter_type   text not null check (btrim(matter_type) <> ''),
  product_authority text not null check (btrim(product_authority) <> ''),
  trigger_code  text references gov_escalation_trigger(trigger_code),
  hq_receiving_authority text not null check (btrim(hq_receiving_authority) <> ''),
  required_response text,
  status        text not null default 'draft'
                check (status in ('draft', 'published', 'superseded')),
  published_by  text,
  published_at  timestamp with time zone,
  effective_from date,
  effective_to  date,
  created_at    timestamp with time zone not null default now(),

  unique (version, matter_type, trigger_code),
  constraint gov_matrix_published_is_attributed
    check ((status in ('published', 'superseded'))
           = (published_by is not null and published_at is not null and effective_from is not null))
);

comment on table gov_delegation_matrix is
  'CPR-PD-010 s18 Product Governance Delegation and Escalation Matrix, versioned and EMPTY until formally populated - seeding an authority map nobody approved is the same error as seeding a risk methodology.';

alter table gov_delegation_matrix enable row level security;

create index if not exists idx_gov_matrix_live on gov_delegation_matrix (status, effective_from desc);

-- ---- 3. THE DETERMINATION (owner uncertainty rule) --------------------------------------------------
--
-- Whether a matter crosses the boundary. Append-only, because changing your mind about whether HQ needed
-- to be told is precisely the history a governance review would ask for.

create table if not exists gov_escalation_determination (
  determination_id uuid primary key default gen_random_uuid(),

  -- exactly one originating record. Typed parents, on the pattern 319 established
  risk_id       uuid references gov_product_risk(risk_id) on delete cascade,
  decision_id   uuid references gov_decision(decision_id) on delete cascade,

  outcome       text not null
                check (outcome in ('escalate', 'no_escalation_required', 'review_required')),
  -- "No escalation required" is a JUDGEMENT, so it names who made it and why
  determined_by text,
  determined_at timestamp with time zone,
  rationale     text,
  -- when the boundary is uncertain, this is what routes it to a person
  review_note   text,

  matrix_version int,
  created_at    timestamp with time zone not null default now(),

  constraint gov_determination_one_subject
    check ((case when risk_id is not null then 1 else 0 end)
         + (case when decision_id is not null then 1 else 0 end) = 1),
  -- a concluded determination is attributed. review_required is the un-concluded state and is not
  constraint gov_determination_concluded_is_attributed
    check ((outcome = 'review_required')
           or (determined_by is not null and determined_at is not null)),
  -- the owner's rule, as a constraint: deciding NOT to escalate carries reasoning
  constraint gov_determination_no_escalation_is_reasoned
    check (outcome <> 'no_escalation_required' or btrim(coalesce(rationale, '')) <> '')
);

comment on table gov_escalation_determination is
  'CPR-PD-010 s18. "No escalation required" is a judgement with a name and a rationale on it, never a default - a boolean defaulting to false silently classifies every undetermined matter, for ever.';

alter table gov_escalation_determination enable row level security;

create index if not exists idx_gov_determination_risk on gov_escalation_determination (risk_id, created_at desc);
create index if not exists idx_gov_determination_decision on gov_escalation_determination (decision_id, created_at desc);

create or replace function gov_escalation_determination_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception
    'CPR-PD-010 s20: gov_escalation_determination is append only. % refused on determination %.',
    tg_op, old.determination_id;
end;
$$;

drop trigger if exists trg_gov_determination_immutable on gov_escalation_determination;
create trigger trg_gov_determination_immutable
  before update or delete on gov_escalation_determination
  for each row execute function gov_escalation_determination_immutable();

-- ---- 4. THE ESCALATION RECORD (owner field list) ----------------------------------------------------
--
-- The owner: "The Product record remains the originating source. Escalation should LINK it to the HQ
-- governance process rather than DUPLICATE it into an unrelated HQ record with no traceability."
--
-- So this table holds no copy of the risk statement or the decision request. It holds the link, the
-- triggers, the ask and the answer.

create table if not exists gov_hq_escalation (
  escalation_id uuid primary key default gen_random_uuid(),
  reference     text not null unique,
  determination_id uuid references gov_escalation_determination(determination_id) on delete set null,

  -- originating product and record
  originating_product text not null default 'competen_practice',
  risk_id       uuid references gov_product_risk(risk_id) on delete restrict,
  decision_id   uuid references gov_decision(decision_id) on delete restrict,

  reason        text not null check (btrim(reason) <> ''),
  originating_owner text not null check (btrim(originating_owner) <> ''),
  escalated_at  timestamp with time zone not null default now(),

  hq_receiving_authority text not null check (btrim(hq_receiving_authority) <> ''),
  requested_action text not null check (btrim(requested_action) <> ''),

  status        text not null default 'raised'
                check (status in ('raised', 'acknowledged', 'under_review', 'decided',
                                  'returned', 'withdrawn')),
  outcome       text,
  returned_conditions text,
  decided_by    text,
  decided_at    timestamp with time zone,
  -- the HQ-side record, where one exists. A LINK, not a copy
  hq_decision_ref text,

  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),

  -- an escalation originates in exactly one product record, and that record is the source of truth
  constraint gov_hq_escalation_one_origin
    check ((case when risk_id is not null then 1 else 0 end)
         + (case when decision_id is not null then 1 else 0 end) = 1),
  constraint gov_hq_escalation_decided_is_attributed
    check ((status = 'decided') = (decided_by is not null and decided_at is not null)),
  constraint gov_hq_escalation_decided_states_outcome
    check (status <> 'decided' or btrim(coalesce(outcome, '')) <> ''),
  constraint gov_hq_escalation_returned_states_conditions
    check (status <> 'returned' or btrim(coalesce(returned_conditions, '')) <> '')
);

comment on table gov_hq_escalation is
  'CPR-PD-010 s18 HQ escalation. Holds no copy of the risk statement or decision request - the product record remains the originating source and this links to it, so the two cannot drift.';

alter table gov_hq_escalation enable row level security;

create index if not exists idx_gov_hq_escalation_open on gov_hq_escalation (status, escalated_at desc);

-- which triggers applied. Many-to-many, because a matter usually crosses more than one
create table if not exists gov_hq_escalation_trigger (
  escalation_id uuid not null references gov_hq_escalation(escalation_id) on delete cascade,
  trigger_code  text not null references gov_escalation_trigger(trigger_code),
  note          text,
  primary key (escalation_id, trigger_code)
);

alter table gov_hq_escalation_trigger enable row level security;

-- ---- 5. AN ESCALATION NAMES ITS TRIGGERS ------------------------------------------------------------
--
-- Without this, "escalated" carries no corporate-impact reason and the baseline policy is decorative.

create or replace function gov_hq_escalation_names_triggers()
returns trigger
language plpgsql
as $$
declare
  n int;
begin
  if new.status = 'withdrawn' then
    return new;
  end if;
  select count(*) into n from gov_hq_escalation_trigger where escalation_id = new.escalation_id;
  if n = 0 and tg_op = 'UPDATE' then
    raise exception
      'CPR-PD-010 s18: escalation % names no corporate-impact trigger. Escalation is trigger-based - without one there is no stated reason this left product governance.',
      new.reference;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gov_hq_escalation_names_triggers on gov_hq_escalation;
create trigger trg_gov_hq_escalation_names_triggers
  before update on gov_hq_escalation
  for each row execute function gov_hq_escalation_names_triggers();

-- ---- 6. THE DERIVED STATE (owner uncertainty rule) --------------------------------------------------
--
-- A risk with no determination reads ESCALATION REVIEW REQUIRED. That is the whole rule, expressed once
-- so no caller can express it differently.

create or replace view gov_risk_escalation_state as
select
  r.risk_id,
  r.reference,
  r.title,
  coalesce(d.outcome, 'review_required') as escalation_state,
  (d.determination_id is null) as never_determined,
  d.determined_by,
  d.determined_at,
  d.rationale,
  e.escalation_id,
  e.status as hq_status
from gov_product_risk r
left join lateral (
  select * from gov_escalation_determination x
  where x.risk_id = r.risk_id order by x.created_at desc limit 1
) d on true
left join lateral (
  select * from gov_hq_escalation y
  where y.risk_id = r.risk_id order by y.escalated_at desc limit 1
) e on true;

comment on view gov_risk_escalation_state is
  'CPR-PD-010 s18 owner uncertainty rule. A risk nobody has determined reads review_required, never no_escalation_required - the system must not silently classify a matter it has not assessed.';

-- ---- 7. NO SCORE, ANYWHERE --------------------------------------------------------------------------
--
-- There is no risk_score, severity or threshold column in this migration and no rule anywhere that
-- derives escalation from one. Escalation authority is not a function of severity, and the moment a
-- number appears here it becomes the policy nobody approved.

notify pgrst, 'reload schema';
