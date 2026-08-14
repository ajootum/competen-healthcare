-- ====================================================================================================
-- 296  TREATMENT SUBTYPE DETAIL  (CP-TREAT-002 s9)
-- ====================================================================================================
--
-- WHAT THIS DOES
--   s9's subtype storage: the structured fields each treatment type actually has -- site, body area,
--   parameters, targets -- get real columns in per-type tables, so a report can one day group wound
--   care by site or physiotherapy by body area. Until now every type funnelled its one detail into
--   practice_treatment.non_drug_category as free text, which displays fine and aggregates never.
--
-- WARNING: THE SUMMARY COLUMN IS NOT RETIRED. non_drug_category keeps holding the one-line summary the
--   Details column shows, composed by the engine from these fields. The subtype row is the STRUCTURE
--   and the summary is the DISPLAY. If this file is applied late, or a write to a subtype table fails,
--   the summary still carries what was typed -- structure can be lost gracefully, content cannot.
--
-- WARNING: treatment_id IS THE PRIMARY KEY of every subtype table. One treatment has at most one
--   detail row of its own type, the FK cascades with the parent, and no partial unique index is needed
--   to enforce any of it.
--
-- WARNING: FREQUENCY AND INSTRUCTIONS ARE NOT DUPLICATED HERE. s9's entity sketches list frequency on
--   several subtypes, but the parent row already carries frequency, duration and notes -- a second
--   frequency column per subtype would be two places for one answer, and the two would drift.
--
--   Also fixes the seeded ordering from 295: change_medication (sort 20) landed in the middle of the
--   six new clinical types (15..21). It moves to 25 so the clinical types sit together. Practices that
--   have already reordered their own list are untouched -- this is the platform default row only.
--
-- Apply in the Supabase SQL editor. Expected result: Success. No rows returned.
-- ====================================================================================================

-- ---- 1. Wound / dressing care ------------------------------------------------------------------------
create table if not exists practice_treatment_wound_care (
  treatment_id uuid primary key references practice_treatment(id) on delete cascade,
  site text,
  method text,
  created_at timestamptz not null default now()
);
alter table practice_treatment_wound_care enable row level security;

-- ---- 2. Physiotherapy ---------------------------------------------------------------------------------
create table if not exists practice_treatment_physiotherapy (
  treatment_id uuid primary key references practice_treatment(id) on delete cascade,
  intervention text,
  body_area text,
  created_at timestamptz not null default now()
);
alter table practice_treatment_physiotherapy enable row level security;

-- ---- 3. Nutrition / diet ------------------------------------------------------------------------------
create table if not exists practice_treatment_nutrition (
  treatment_id uuid primary key references practice_treatment(id) on delete cascade,
  plan text,
  targets text,
  created_at timestamptz not null default now()
);
alter table practice_treatment_nutrition enable row level security;

-- ---- 4. Respiratory therapy ---------------------------------------------------------------------------
create table if not exists practice_treatment_respiratory (
  treatment_id uuid primary key references practice_treatment(id) on delete cascade,
  modality text,
  parameters text,
  created_at timestamptz not null default now()
);
alter table practice_treatment_respiratory enable row level security;

-- ---- 5. Device / support ------------------------------------------------------------------------------
create table if not exists practice_treatment_device (
  treatment_id uuid primary key references practice_treatment(id) on delete cascade,
  device text,
  site text,
  created_at timestamptz not null default now()
);
alter table practice_treatment_device enable row level security;

-- ---- 6. Lifestyle intervention ------------------------------------------------------------------------
create table if not exists practice_treatment_lifestyle (
  treatment_id uuid primary key references practice_treatment(id) on delete cascade,
  intervention text,
  target text,
  review_interval text,
  created_at timestamptz not null default now()
);
alter table practice_treatment_lifestyle enable row level security;

-- ---- 7. The seeded ordering fix from 295 --------------------------------------------------------------
update practice_treatment_option set sort_order = 25
where workspace_id is null and field_key = 'treatment_type' and code = 'change_medication';

notify pgrst, 'reload schema';
