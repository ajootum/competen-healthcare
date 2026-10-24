-- ====================================================================================================
-- ROLLBACK FOR MIGRATIONS 388 THEN 387 (COMPETEN-SCHOLAR-01). USED FOR THE STAGING REHEARSAL. IT IS ALSO
-- THE PRODUCTION ROLLBACK, IF EITHER MIGRATION IS EVER APPLIED THERE UNDER ITS OWN GO.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb) these objects exist after
-- 387 and 388. Every statement is IF EXISTS, so it does nothing where they are absent.
--
-- !! IT DISCARDS DATA. Concepts, proposed mappings and their decisions are dropped, and the four question
-- columns lose their values. The questions themselves, the materials, attempts and cards (372) are kept.
-- Count first: select count(*) from individual_scholar_competency_map, and the same for the decision
-- and analysis tables, and record the counts.
--
-- 388 first (its tables reference 387), then 387. ASCII only. No semicolons inside comments.
-- ====================================================================================================

-- 388
drop table if exists individual_scholar_competency_decision;
drop table if exists individual_scholar_competency_map;
drop table if exists individual_scholar_chunk_analysis;
drop function if exists public.individual_scholar_decision_append_only();
drop index if exists idx_individual_scholar_question_competency;
drop index if exists idx_individual_scholar_question_case;
alter table individual_scholar_question drop constraint if exists individual_scholar_question_case_check;
alter table individual_scholar_question drop column if exists competency_id;
alter table individual_scholar_question drop column if exists case_id;
alter table individual_scholar_question drop column if exists case_step;
alter table individual_scholar_question drop column if exists case_title;

-- 387
drop table if exists individual_scholar_learner;
drop table if exists individual_scholar_programme_framework;
drop table if exists individual_scholar_programme;

notify pgrst, 'reload schema';
