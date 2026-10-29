-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It replaces a sql function between dollar quotes. A runner that splits on the
-- statement separator would cut the function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 670: CFCA ASSESSMENT CRITERIA BY COMPONENT, AND THE DACUM 0-6 SOURCE WORDING
--
-- CFCA-STUDIO-P1 criteria import (owner GO 2026-10-29), over WORK-FRAMEWORK-RECONCILIATION.md.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Two nullable columns, one index, one function body widened, and the
-- wording of the seven DACUM 0-6 levels (660) set to the source. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (a function replaced), so it carries a staging rollback rehearsal.
-- Depends on 007 (competency_skills), 395 (competency_content_hash) and 660 (components, DACUM scale).
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--
-- 1. A CRITERION IS A SKILL ROW, CLASSIFIED. competency_skills.component_code (Clinical Skills, Knowledge,
--    Knowledge Application, or any other row of competency_assessment_component) and source_ref (where the
--    criterion came from, for example a workbook sheet and row). Both null on every existing row, so no
--    existing skill changes meaning. Each source criterion is kept as its own row, in its own words: the
--    20-outcome limit on learning outcomes does not apply to criteria.
--
-- 2. THE CLINICAL HASH COVERS THE CLASSIFICATION. competency_content_hash (395) now hashes each skill as its
--    name followed by its component tag in brackets WHEN ONE IS SET. A skill with no tag hashes exactly as
--    before, so every existing hash and every existing clinical approval is unchanged. Re-classifying a
--    criterion after approval makes the approval stale, like any other content change.
--
-- 3. THE DACUM 0-6 WORDING. The seven level labels seeded by 660 are replaced by the source descriptors
--    (Adapted from DACUM level of Achievement, Fearon 1998), only where a label is still the 660 seed, so a
--    wording already edited on the Scoring page is never overwritten. Scores, pass marks and the published
--    DACUM-to-stage mapping (660, version 1) are not touched.
--
-- NOT ACTIVATED. Nothing is approved, published or offered. No framework, competency or assessment record
-- is changed. Existing skills keep a null component.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CFCA-STUDIO-P1/ROLLBACK-670.sql.
-- ====================================================================================================

-- ---------- 1. CRITERIA CLASSIFIED BY COMPONENT ----------

alter table competency_skills add column if not exists component_code text
  references competency_assessment_component(code) on delete restrict;
alter table competency_skills add column if not exists source_ref text;

alter table competency_skills drop constraint if exists competency_skills_source_ref_check;
alter table competency_skills add constraint competency_skills_source_ref_check
  check (source_ref is null or char_length(source_ref) <= 300);

create index if not exists idx_competency_skills_component
  on competency_skills(competency_id, component_code);

-- ---------- 2. THE CLINICAL HASH COVERS THE CLASSIFICATION (unchanged for untagged skills) ----------

create or replace function public.competency_content_hash(p_competency uuid)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select md5(jsonb_build_object(
    'name', c.name,
    'description', c.description,
    'learning_outcomes', c.learning_outcomes,
    'expected_level_id', c.expected_level_id,
    'practice_id', c.practice_id,
    'cpu_id', c.cpu_id,
    'risk_category', c.risk_category,
    'skills', coalesce((select jsonb_agg(s.name || coalesce(' [' || s.component_code || ']', '') order by s.name, s.id)
                          from competency_skills s where s.competency_id = c.id), '[]'::jsonb)
  )::text)
  from framework_competencies c
  where c.id = p_competency
$$;

-- ---------- 3. THE DACUM 0-6 SOURCE WORDING ----------

update scoring_levels l
   set label = v.label,
       description = 'Adapted from DACUM level of Achievement (Fearon 1998).'
  from scoring_scales s,
       (values
         (0, 'Not yet demonstrated', 'Requires training to perform this activity satisfactorily to participate in the clinical environment'),
         (1, 'Performs parts with considerable assistance', 'Can perform this activity with constant supervision and some assistance'),
         (2, 'Performs with periodic assistance', 'Can perform this activity satisfactorily but requires some supervision and assistance'),
         (3, 'Performs without assistance', 'Can perform this activity satisfactorily without supervision and assistance'),
         (4, 'Performs to a high standard', 'Can perform this activity satisfactorily without supervision and assistance with more than acceptable speed and quality of work.'),
         (5, 'Performs with initiative and adaptability', 'Can perform this activity satisfactorily without supervision and assistance with more than acceptable speed and quality of work and with initiative and adaptability to special problem situations'),
         (6, 'Leads and guides others', 'Can perform this activity with more than acceptable speed and quality, with initiative and adaptability and can lead others in performing this activity')
       ) as v(score, seeded, label)
 where s.id = l.scale_id and s.name = 'DACUM 0-6' and l.score = v.score and l.label = v.seeded;

-- ---------- VERIFICATION ----------

select 'skills_component_col' as item, count(*)::text as value
  from information_schema.columns where table_name = 'competency_skills' and column_name in ('component_code', 'source_ref')
union all select 'tagged_skills', count(*)::text from competency_skills where component_code is not null
union all select 'dacum_source_wording', count(*)::text
  from scoring_levels l join scoring_scales s on s.id = l.scale_id
 where s.name = 'DACUM 0-6' and l.description = 'Adapted from DACUM level of Achievement (Fearon 1998).'
union all select 'dacum_mapping_v1', coalesce((select m.status || ' ' || m.content_hash from competency_stage_mapping m
  join scoring_scales s on s.id = m.scale_id where s.name = 'DACUM 0-6' and m.version = 1), 'missing');

notify pgrst, 'reload schema';
