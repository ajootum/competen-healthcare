-- ====================================================================================================
-- MIGRATION 384: COMPETENCY LAYERS, PROFESSION, LEARNING OUTCOMES AND EXPECTED PROFICIENCY
--
-- COMPETEN-SCHOLAR-01 S1, the Shared Competency Foundation (owner GO 2026-10-23). Reserved range 384-386.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Four nullable or defaulted columns and their checks on two existing
-- tables. No row is changed, no policy is touched, no function is created. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (new columns on existing shared tables), so it carries a staging rollback
-- rehearsal.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets the existing competency library say which of five layers a catalogue belongs to and, for a
-- profession catalogue, which profession, and lets each competency carry its learning outcomes and the
-- proficiency expected on the platform scoring scale -- so the layering is configuration, not a second
-- competency system, and Nursing is one profession among several rather than the root.
--
-- ----------------------------------------------------------------------------------------------------
-- THE COLUMNS.
--
--   frameworks.competency_layer      foundational, profession, advanced, specialty or context. Null means
--                                    not yet classified, which is every existing framework until HQ says
--                                    otherwise. Nothing is reclassified here.
--   frameworks.profession_term_id    the profession, as a term of the governed taxonomy (kind profession,
--                                    migration 013). Required for a profession catalogue and forbidden for
--                                    a foundational one, by check, so neither wrong state can be written.
--   framework_competencies.learning_outcomes   a json array of outcome statements. Empty means none
--                                    recorded, which is the true state of every existing competency.
--   framework_competencies.expected_level_id   the proficiency expected, as a scoring_levels row (the
--                                    existing scales). Null means not set.
--
-- Composition reuses what exists: frameworks.parent_framework_id for extension, and the Holdings-scope
-- (hospital_id null) rows of competency_dependencies and competency_equivalencies, which migrations 123
-- and 128 already allow, for prerequisites, inheritance and competencies shared across layers.
--
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   ASCII only. No semicolons inside any comment or string literal. No plpgsql, no do-blocks, no
--   functions, so no APPLY-WHOLE banner is required. No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): drop the four constraints, the index and the four columns (docs/evidence/S1). The
--   columns hold nothing until a catalogue is classified, so the rollback loses only staging seed values.
-- ====================================================================================================

alter table frameworks add column if not exists competency_layer text;
alter table frameworks add column if not exists profession_term_id uuid references taxonomy_terms(id) on delete restrict;

alter table frameworks drop constraint if exists frameworks_competency_layer_check;
alter table frameworks add constraint frameworks_competency_layer_check
  check (competency_layer is null or competency_layer in ('foundational', 'profession', 'advanced', 'specialty', 'context'));

alter table frameworks drop constraint if exists frameworks_layer_profession_check;
alter table frameworks add constraint frameworks_layer_profession_check
  check ((competency_layer is distinct from 'profession' or profession_term_id is not null)
     and (competency_layer is distinct from 'foundational' or profession_term_id is null));

create index if not exists idx_frameworks_competency_layer on frameworks(competency_layer);

alter table framework_competencies add column if not exists learning_outcomes jsonb not null default '[]'::jsonb;
alter table framework_competencies add column if not exists expected_level_id uuid references scoring_levels(id) on delete set null;

alter table framework_competencies drop constraint if exists framework_competencies_learning_outcomes_check;
alter table framework_competencies add constraint framework_competencies_learning_outcomes_check
  check (jsonb_typeof(learning_outcomes) = 'array');

comment on column frameworks.competency_layer is
  'S1: foundational, profession, advanced, specialty or context. Null = not yet classified by HQ.';
comment on column frameworks.profession_term_id is
  'S1: the profession (taxonomy_terms, kind profession). Required for a profession catalogue, forbidden for a foundational one.';
comment on column framework_competencies.learning_outcomes is
  'S1: json array of learning-outcome statements. Empty = none recorded.';
comment on column framework_competencies.expected_level_id is
  'S1: the proficiency expected, on the platform scoring scale. Null = not set.';


-- Verification: the four columns, the three checks, and no framework classified yet.
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'frameworks' and column_name in ('competency_layer', 'profession_term_id'))
     or (table_name = 'framework_competencies' and column_name in ('learning_outcomes', 'expected_level_id')))
 order by table_name, column_name;

select conname from pg_constraint
 where conname in ('frameworks_competency_layer_check', 'frameworks_layer_profession_check', 'framework_competencies_learning_outcomes_check')
 order by conname;

select count(*) as classified_frameworks from frameworks where competency_layer is not null;

notify pgrst, 'reload schema';
