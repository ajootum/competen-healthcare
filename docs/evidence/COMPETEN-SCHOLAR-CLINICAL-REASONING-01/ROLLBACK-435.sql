-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 435 (COMPETEN-SCHOLAR-CLINICAL-REASONING-01). Removes private clinical cases, case
-- sessions and their decisions.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! Every private case, every case session and every decision recorded in one is lost. Materials, questions,
-- !! revision, the library cases (422) and their versions are untouched.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

drop table if exists individual_scholar_case_answer;
drop function if exists public.individual_scholar_case_answer_append_only();
drop table if exists individual_scholar_case_session;
drop table if exists individual_scholar_case_competency;
drop table if exists individual_scholar_case_source;
drop table if exists individual_scholar_case;

notify pgrst, 'reload schema';
