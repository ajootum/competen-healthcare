-- Migration 338: column-parity reconciliation (COMP-ENG-002G sections 7 and 8)
--
-- ============================ WHY THIS EXISTS ============================
--
-- The first column-parity run compared production against a canonical staging build through
-- plat_column_registry() on both sides. Table parity was ALREADY PERFECT, 663 against 663, and 32
-- columns still differed. 7853 matched exactly.
--
-- Every definition below was generated from the live production registry rather than transcribed, and
-- the foreign key targets were read from the PostgREST schema document. Nothing here is remembered.
--
-- ============================ WHAT IT CHANGES, AND WHERE ============================
--
-- Sections 1 and 2 are no-ops on production and repairs on a clean build. Sections 3 and 4 are the
-- only statements that change production, and both are deliberate.
--
--   1. 26 columns production has that no migration creates. Add-if-not-exists, so production is
--      unaffected and a clean build stops being short of them.
--   2. Four definitions where the CLEAN BUILD IS WEAKER than production. Restated, so the build stops
--      being the more permissive of the two.
--   3. frameworks.pub_status default. OWNER RULING, 2026-08-19: draft. This one changes PRODUCTION.
--   4. cap_asset_translations.cap_asset_id. A genuine production gap. This one changes PRODUCTION.
--
-- ============================ REPRODUCING IS NOT ENDORSING ============================
--
-- The 26 columns in section 1 sit on scoring and framework tables and several may be unused. They are
-- reproduced anyway, on the ruling already made for the competencies table in COMP-ENG-002F section 9.4
-- and for the eleven orphan tables in 188a: retiring schema is not what a reproducibility fix is for.
-- Whether they should exist at all is a separate question with a separate owner.
--
-- ============================ WHAT IS NOT REPRODUCED ============================
--
-- !! ON DELETE AND ON UPDATE ACTIONS. The registry does not expose them and this estate has no foreign
-- key registry, the same recorded gap as 188a. The references below therefore default to NO ACTION,
-- which may differ from production. Recorded rather than guessed.


-- ---- 1. Columns production has that no migration creates -----------------------------------------
-- Add-if-not-exists throughout: every one of these already exists in production, so this section is a
-- no-op there and only a clean build is changed.

-- frameworks
alter table frameworks add column if not exists owner_id uuid;
alter table frameworks add column if not exists owner_type text;
alter table frameworks add column if not exists parent_framework_id uuid references frameworks(id);
alter table frameworks add column if not exists scope text default 'master'::text;
alter table frameworks add column if not exists version_num integer default 0;

-- competency_cycles
alter table competency_cycles add column if not exists clinical_readiness_score numeric(4,2);
alter table competency_cycles add column if not exists completed_at timestamp with time zone;
alter table competency_cycles add column if not exists consensus_rule text default 'any'::text;
alter table competency_cycles add column if not exists min_assessors integer default 1;

-- competency_scores
alter table competency_scores add column if not exists assessed_at timestamp with time zone;
alter table competency_scores add column if not exists educator_id uuid references profiles(id);
alter table competency_scores add column if not exists educator_notes text;
alter table competency_scores add column if not exists educator_validated boolean not null default false;
alter table competency_scores add column if not exists label text;
alter table competency_scores add column if not exists nurse_id uuid references profiles(id);
alter table competency_scores add column if not exists score integer;

-- domain_scores
alter table domain_scores add column if not exists assessed_at timestamp with time zone;
alter table domain_scores add column if not exists label text;
alter table domain_scores add column if not exists nurse_id uuid references profiles(id);
alter table domain_scores add column if not exists score numeric(4,2);

-- framework_scores
alter table framework_scores add column if not exists assessed_at timestamp with time zone;
alter table framework_scores add column if not exists label text;
alter table framework_scores add column if not exists nurse_id uuid references profiles(id);
alter table framework_scores add column if not exists score numeric(4,2);

-- hospitals
alter table hospitals add column if not exists accent_color text default '#0d9488'::text;
alter table hospitals add column if not exists logo_url text;


-- ---- 2. Four places where the CLEAN BUILD was weaker than production ------------------------------
--
-- These are restatements of what production already enforces, so production sees no change. A clean
-- build was the permissive one in all four cases, which is the wrong direction for a build meant to
-- reproduce an approved security posture.
--
-- audit_log: a build that accepts an audit row with no action and no entity type records an event
-- nobody can interpret. NOT NULL is what production has and what an append-only trail needs.
--
-- !! IF EITHER SET NOT NULL FAILS, THAT IS EVIDENCE, NOT AN OBSTACLE. It would mean rows already exist
-- with a null action or entity type, and those rows are unreadable audit entries that need looking at
-- before the constraint goes on. Do not work around it by filling them in.

alter table audit_log alter column action set not null;

alter table audit_log alter column entity_type set not null;

-- profiles.roles and org_roles are AUTHORIZATION columns, and null is not the same as an empty array.
-- Migration 249's profile_authority_unchanged compares them with `is not distinct from` precisely
-- because they are null on most existing rows, so this difference does not throw -- it changes what
-- compares equal. Application code calling array methods on a null does throw. Production defaults
-- both to an empty array and a clean build defaulted neither.
--
-- ONLY THE DEFAULT IS SET. Existing rows are untouched, deliberately: backfilling null to empty array
-- across profiles would rewrite authority columns on every row, which is not a parity fix.

alter table profiles alter column roles set default '{}'::text[];

alter table profiles alter column org_roles set default '{}'::text[];


-- ---- 3. frameworks.pub_status -- OWNER RULING, AND THIS ONE CHANGES PRODUCTION --------------------
--
-- Production defaults new frameworks to 'published'. The repository says 'draft'. Owner ruling
-- 2026-08-19: draft is correct, so production moves to the repository rather than the reverse.
--
-- Defaulting to published means a framework becomes visible the moment it is created, before anyone
-- has reviewed it. Draft is the safer posture and the one the numbered chain already declares.
--
-- ONLY NEW ROWS ARE AFFECTED. A default is not a constraint and does not touch existing frameworks --
-- anything already published stays published.

alter table frameworks alter column pub_status set default 'draft';


-- ---- 4. cap_asset_translations.cap_asset_id -- A PRODUCTION GAP -----------------------------------
--
-- Migration 140 adds cap_asset_id to FOUR tables under `alter table if exists`. Measured in production:
-- object_tags has it, competency_package_items has it, knowledge_embeddings has it, and
-- cap_asset_translations does NOT.
--
-- All four tables exist today, so the guard is not the cause now -- it was at the time. `alter table if
-- exists` is a silent no-op against an absent table, migrations in this repository are applied by hand,
-- and it is already recorded that they are sometimes applied out of order. 140 running before the table
-- existed produces exactly this: no error, no record, one column that was never added.
--
-- The definition is copied from 140 so the two agree, including the on-delete behaviour that file
-- states explicitly.

alter table cap_asset_translations
  add column if not exists cap_asset_id uuid references cap_assets(id) on delete set null;

notify pgrst, 'reload schema';
