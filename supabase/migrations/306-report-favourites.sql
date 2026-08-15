-- 306 -- favourite report templates (CPR-PI-001 v2 s12, the Favourites row -- Conditional).
--
-- One jsonb list on the EXISTING per-user preference row. Migration 205's own doctrine: scalars as
-- columns, lists as jsonb where the members come from the application -- and template ids come from
-- the code catalogue (report-templates.ts). Ids are validated against that catalogue on read AND on
-- write, so a stale or tampered row cannot surface a template that no longer exists -- the same
-- lesson practice_cohort.segment_ids taught.
--
-- A favourite is the PRACTITIONER's own preference in this practice, which is exactly what
-- practice_user_preference already scopes (workspace_id + user_id). No new table, no new capability:
-- marking a favourite needs nothing beyond being able to see the reports surface at all.

alter table practice_user_preference add column if not exists favourite_report_templates jsonb;

notify pgrst, 'reload schema';
