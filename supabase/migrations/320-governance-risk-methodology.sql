-- CPR-PD-010 phase 1 - the governance taxonomy and the risk methodology that makes a score explainable.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies.
--
-- WHY THIS COMES BEFORE THE RISK REGISTER
--
-- s26 sequences the build "governance taxonomy + risk methodology + capabilities -> Product Risk
-- Register -> Governance Overview -> ..." and the order is load-bearing rather than tidy. s4: "Risk
-- scoring methodology must be centrally configured and versioned. A RISK SCORE MUST NEVER BE A HIDDEN
-- ARBITRARY NUMBER." A register built first would need a score on day one, and the only place to put the
-- scale would be the code that renders it - which is the definition of hidden and arbitrary.
--
-- THE OWNER DECISION THIS ENCODES (2026-08-18)
--
-- The design comp leads with "Overall Risk Posture: Moderate". There is no approved methodology, so
-- there is no scale, no aggregation rule and no band - Moderate would be a word chosen by a developer.
-- The owner's ruling: where the comp conflicts with the specification's evidence rules the
-- SPECIFICATION WINS, and posture renders "Not Yet Determined" until a methodology is published.
--
-- !! SO THE ABSENCE IS MODELLED, NOT HARD-CODED. Nothing in the product says "show Not Yet Determined".
-- The resolver asks this schema for a published, currently-effective methodology and there is not one,
-- so it cannot answer. Publish one and the same resolver answers with a band, with no code change and
-- nothing to remember to switch on. An absence a developer types is an absence a developer can forget
-- to remove.
--
-- WHAT THIS IS NOT
--
-- gov_risks / gov_controls / gov_obligations (migrations 059-060) are NOT extended. They are a good
-- schema on the wrong tenancy: hospital_id nullable, "null = platform-wide". Putting Competen Practice's
-- own product risks in the same table as a customer hospital's clinical risks separates the two by a
-- nullable column, and one forgotten filter reads across it. All five gov_* tables hold zero rows, so
-- nothing is migrated. See docs/CPR-CORE-MOS-001-GAP-MATRIX.md for the recorded decision.

-- ---- 1. RISK CATEGORY (s4) --------------------------------------------------------------------------
--
-- s4 lists product, operational, privacy, security, clinical safety, commercial, third-party,
-- continuity and regulatory/compliance "or configured category" - so a table rather than a CHECK.
-- A CHECK would make adding a category a migration, and s10 forbids hard-coding one jurisdiction.

create table if not exists gov_risk_category (
  code          text primary key,
  label         text not null check (btrim(label) <> ''),
  description   text,
  sort_order    int not null default 100,
  is_active     boolean not null default true,
  created_at    timestamp with time zone not null default now()
);

comment on table gov_risk_category is
  'CPR-PD-010 s4 risk categories. A table rather than a CHECK because s4 permits configured categories.';

alter table gov_risk_category enable row level security;

insert into gov_risk_category (code, label, description, sort_order) values
  ('product',         'Product',              'Product capability, quality or fitness for purpose.', 10),
  ('operational',     'Operational',          'Running the product day to day.', 20),
  ('privacy',         'Privacy',              'Personal data, purpose, retention and sharing.', 30),
  ('security',        'Security',             'Confidentiality, integrity and availability of the product.', 40),
  ('clinical_safety', 'Clinical Safety',      'Product behaviour that could influence clinical care.', 50),
  ('commercial',      'Commercial',           'Pricing, revenue, contracts and commercial viability.', 60),
  ('third_party',     'Third Party',          'Providers and dependencies the product relies on.', 70),
  ('continuity',      'Continuity',           'Ability to keep operating through disruption.', 80),
  ('regulatory',      'Regulatory / Compliance', 'Law, regulation, standards and formal obligations.', 90)
on conflict (code) do nothing;

-- ---- 2. THE METHODOLOGY, VERSIONED (s4, s5) ---------------------------------------------------------
--
-- s5: "Changing methodology requires versioning/effective date and must not silently rewrite historical
-- assessments." An assessment records WHICH methodology version scored it (migration 321), so a new
-- version reprices nothing that has already been assessed.

create table if not exists gov_risk_methodology (
  methodology_id  uuid primary key default gen_random_uuid(),
  version         int not null check (version >= 1),
  name            text not null check (btrim(name) <> ''),
  -- s5: "Overall impact methodology must be explicit." This is where explicit lives - prose a reader
  -- can check, not a formula buried in a renderer
  aggregation_rule text,
  scoring_note    text,
  status          text not null default 'draft'
                  check (status in ('draft', 'published', 'superseded', 'retired')),
  published_at    timestamp with time zone,
  published_by    text,
  effective_from  timestamp with time zone,
  effective_to    timestamp with time zone,
  created_at      timestamp with time zone not null default now(),
  updated_at      timestamp with time zone not null default now(),
  unique (version),
  -- publishing is an accountable act, so it names who and when or it is not published
  constraint gov_method_published_is_attributed
    check ((status in ('published', 'superseded'))
           = (published_at is not null and published_by is not null and effective_from is not null)),
  constraint gov_method_window_is_ordered
    check (effective_to is null or effective_from is null or effective_to > effective_from)
);

comment on table gov_risk_methodology is
  'CPR-PD-010 s4/s5 risk scoring methodology, versioned. A risk score must never be a hidden arbitrary number, so the scale lives here and not in a renderer.';

alter table gov_risk_methodology enable row level security;

create index if not exists idx_gov_method_status on gov_risk_methodology (status, effective_from desc);

-- ---- 3. THE SCALES, WITH PUBLISHED DEFINITIONS (s5) -------------------------------------------------
--
-- s5: "Support configurable likelihood and impact scales WITH PUBLISHED DEFINITIONS."
--
-- !! definition IS NOT NULL AND MUST NOT BE BLANK, AND THAT IS THE POINT OF THE TABLE. A five-point scale
-- whose points are called 1 to 5 is exactly the hidden arbitrary number s4 forbids - two assessors mean
-- different things by "4" and the register cannot tell. The definition is what makes a score checkable
-- by somebody who did not make it.

create table if not exists gov_risk_scale (
  scale_id        uuid primary key default gen_random_uuid(),
  methodology_id  uuid not null references gov_risk_methodology(methodology_id) on delete cascade,
  dimension       text not null check (dimension in ('likelihood', 'impact')),
  ordinal         int not null check (ordinal between 1 and 10),
  code            text not null check (btrim(code) <> ''),
  label           text not null check (btrim(label) <> ''),
  definition      text not null check (btrim(definition) <> ''),
  created_at      timestamp with time zone not null default now(),
  unique (methodology_id, dimension, ordinal),
  unique (methodology_id, dimension, code)
);

comment on table gov_risk_scale is
  'CPR-PD-010 s5 likelihood and impact scale points. definition is NOT NULL because a scale whose points are only numbers is the hidden arbitrary number s4 forbids.';

alter table gov_risk_scale enable row level security;

-- ---- 4. IMPACT DIMENSIONS (s5) ----------------------------------------------------------------------
--
-- s5: impact "may include patient/clinical safety, privacy, security, availability/operations,
-- financial/commercial, legal/regulatory and reputation dimensions. Overall impact methodology must be
-- explicit." Named per methodology so a version can add one without rewriting the last version's scores.

create table if not exists gov_impact_dimension (
  dimension_id    uuid primary key default gen_random_uuid(),
  methodology_id  uuid not null references gov_risk_methodology(methodology_id) on delete cascade,
  code            text not null check (btrim(code) <> ''),
  label           text not null check (btrim(label) <> ''),
  definition      text,
  -- how this dimension folds into the overall impact. s5 requires the method to be explicit
  contribution    text not null default 'highest'
                  check (contribution in ('highest', 'weighted', 'informational')),
  weight          numeric,
  sort_order      int not null default 100,
  unique (methodology_id, code),
  -- a weighted dimension without a weight is an unstated method, which is what s5 rules out
  constraint gov_impact_weighted_has_weight
    check (contribution <> 'weighted' or weight is not null)
);

comment on table gov_impact_dimension is
  'CPR-PD-010 s5 impact dimensions per methodology version. contribution states HOW a dimension folds into overall impact, because s5 requires that method to be explicit.';

alter table gov_impact_dimension enable row level security;

-- ---- 5. POSTURE BANDS (s3) --------------------------------------------------------------------------
--
-- s3 asks for "Overall risk posture with trend and definition". A posture is a BAND over an aggregate,
-- and without the band there is no posture - which is precisely why the overview cannot say "Moderate"
-- today. definition is NOT NULL for the same reason as the scale points.

create table if not exists gov_posture_band (
  band_id         uuid primary key default gen_random_uuid(),
  methodology_id  uuid not null references gov_risk_methodology(methodology_id) on delete cascade,
  code            text not null check (btrim(code) <> ''),
  label           text not null check (btrim(label) <> ''),
  definition      text not null check (btrim(definition) <> ''),
  sort_order      int not null default 100,
  unique (methodology_id, code)
);

comment on table gov_posture_band is
  'CPR-PD-010 s3 overall risk posture bands. Without a published band set there is no posture, which is why the overview renders Not Yet Determined rather than Moderate.';

alter table gov_posture_band enable row level security;

-- ---- 6. WHAT MAY BE PUBLISHED, AND HOW MANY ---------------------------------------------------------
--
-- Two rules a CHECK constraint cannot express, so they are triggers.
--
-- !! AND NOT A PARTIAL UNIQUE INDEX FOR THE SECOND ONE. A partial unique index is banned by this repo's
-- migration house rules, and it would in any case only cover "one published row" rather than the real
-- rule, which is about overlapping EFFECTIVE WINDOWS.

create or replace function gov_methodology_publish_guard()
returns trigger
language plpgsql
as $$
declare
  n_likelihood int;
  n_impact     int;
  n_band       int;
begin
  if new.status not in ('published', 'superseded') then
    return new;
  end if;

  -- a methodology with no scale is not a methodology. Publishing one would put a register into
  -- production with nothing to score against, which is the state this whole table exists to prevent
  select count(*) into n_likelihood from gov_risk_scale
    where methodology_id = new.methodology_id and dimension = 'likelihood';
  select count(*) into n_impact from gov_risk_scale
    where methodology_id = new.methodology_id and dimension = 'impact';
  select count(*) into n_band from gov_posture_band
    where methodology_id = new.methodology_id;

  if n_likelihood < 2 or n_impact < 2 then
    raise exception
      'CPR-PD-010 s5: a methodology needs at least two likelihood and two impact scale points before it can be published. Found % and %.',
      n_likelihood, n_impact;
  end if;

  if n_band < 1 then
    raise exception
      'CPR-PD-010 s3: a methodology needs at least one posture band before it can be published, or posture stays undeterminable after publishing.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_gov_methodology_publish_guard on gov_risk_methodology;
create trigger trg_gov_methodology_publish_guard
  before insert or update on gov_risk_methodology
  for each row execute function gov_methodology_publish_guard();

create or replace function gov_methodology_single_effective()
returns trigger
language plpgsql
as $$
declare
  clash int;
begin
  if new.status <> 'published' or new.effective_from is null then
    return new;
  end if;

  -- two methodologies effective over the same instant means a risk has two scores and no answer
  select count(*) into clash
  from gov_risk_methodology m
  where m.methodology_id <> new.methodology_id
    and m.status = 'published'
    and m.effective_from is not null
    and (m.effective_to is null or m.effective_to > new.effective_from)
    and (new.effective_to is null or new.effective_to > m.effective_from);

  if clash > 0 then
    raise exception
      'CPR-PD-010 s5: another published methodology is already effective over that window. Supersede it with an effective_to before publishing this one.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_gov_methodology_single_effective on gov_risk_methodology;
create trigger trg_gov_methodology_single_effective
  before insert or update on gov_risk_methodology
  for each row execute function gov_methodology_single_effective();

-- ---- 7. NO METHODOLOGY IS SEEDED, DELIBERATELY ------------------------------------------------------
--
-- !! THIS MIGRATION CREATES THE SHAPE OF A METHODOLOGY AND PUBLISHES NONE.
--
-- Seeding a plausible 5x5 here would be the whole defect in one statement: the product would show a
-- risk posture within a minute of this file being applied, derived from a scale nobody approved, whose
-- definitions a developer wrote to fill a NOT NULL column. It would look exactly like a governed number.
--
-- s4 requires the methodology to be "centrally configured", and configuring it is a governance act with
-- an owner and an approval - not a default. Until somebody performs it, the overview says Not Yet
-- Determined and says why, which is the true state of this estate.

notify pgrst, 'reload schema';
