-- ROLLBACK 550 (STAGING ONLY). COMPETEN-PROFESSIONAL-PROGRESS-01, Professional Stage 8.
-- Removes what 550 added: export metadata, document drafts, requested progress snapshots, recommendation
-- decisions, saved views and preferences (and every row in them), and the append-only function. No Stage 1
-- to 7, Learning, C5 or Passport table is touched. Plain statements only.

drop table if exists individual_professional_document_export;
drop table if exists individual_professional_document;
drop table if exists individual_professional_progress_snapshot;
drop table if exists individual_professional_progress_decision;
drop table if exists individual_professional_progress_view;
drop table if exists individual_professional_progress_preference;
drop function if exists public.individual_professional_stage8_append_only();

notify pgrst, 'reload schema';
