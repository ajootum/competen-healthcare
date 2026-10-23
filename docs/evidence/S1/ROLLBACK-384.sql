-- ROLLBACK FOR MIGRATION 384 (competency layers, profession, outcomes, expected level). STAGING only, via
-- run-staging-sql.mjs. Drops only what 384 added. Values held in these columns (staging seed) are lost.
alter table framework_competencies drop constraint if exists framework_competencies_learning_outcomes_check;
alter table framework_competencies drop column if exists expected_level_id;
alter table framework_competencies drop column if exists learning_outcomes;
drop index if exists idx_frameworks_competency_layer;
alter table frameworks drop constraint if exists frameworks_layer_profession_check;
alter table frameworks drop constraint if exists frameworks_competency_layer_check;
alter table frameworks drop column if exists profession_term_id;
alter table frameworks drop column if exists competency_layer;

notify pgrst, 'reload schema';
