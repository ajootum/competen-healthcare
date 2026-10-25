-- ROLLBACK 480 (STAGING ONLY). COMPETEN-PROFESSIONAL-PLAN-01, Professional Stage 3.
-- Removes what 480 added: the goal reviews, evidence links, plan competency links, milestones, activity
-- history, activity goal links, activities and goal history (and every row in them), the five trigger
-- functions and the goal history trigger, and the Stage 3 columns and CHECKs on individual_professional_goal.
-- Restores the 373 status CHECK and target_date NOT NULL. Before that, a deferred goal goes back to planned and
-- a goal with no target date takes its creation date, so the 373 rules can return.
-- The 393 (id, user_id) indexes on the CPD and evidence tables belong to 393 and are left in place.
-- The 373 title, detail, need link and completion of every goal are untouched. Plain statements only.

drop trigger if exists trg_individual_professional_goal_history on individual_professional_goal;
drop table if exists individual_professional_goal_review;
drop table if exists individual_professional_goal_evidence;
drop table if exists individual_professional_plan_competency;
drop table if exists individual_professional_milestone;
drop table if exists individual_professional_activity_history;
drop table if exists individual_professional_activity_goal;
drop table if exists individual_professional_activity;
drop table if exists individual_professional_goal_history;
drop function if exists public.individual_professional_goal_history_write();
drop function if exists public.individual_professional_activity_history_write();
drop function if exists public.individual_professional_activity_record_cleared();
drop function if exists public.individual_professional_stage3_link_guard();
drop function if exists public.individual_professional_stage3_append_only();

alter table individual_professional_goal drop constraint if exists individual_professional_goal_reflection_fk;
alter table individual_professional_goal drop constraint if exists individual_professional_goal_aspiration_fk;
alter table individual_professional_goal drop constraint if exists individual_professional_goal_stage3_shape;
alter table individual_professional_goal drop constraint if exists individual_professional_goal_status_check;
update individual_professional_goal set status = 'planned' where status not in ('planned', 'in_progress', 'done', 'dropped');
alter table individual_professional_goal add constraint individual_professional_goal_status_check
  check (status in ('planned', 'in_progress', 'done', 'dropped'));
update individual_professional_goal set target_date = created_at::date where target_date is null;
alter table individual_professional_goal alter column target_date set not null;

alter table individual_professional_goal drop column if exists goal_type_code;
alter table individual_professional_goal drop column if exists goal_type_label;
alter table individual_professional_goal drop column if exists motivation;
alter table individual_professional_goal drop column if exists intended_outcome;
alter table individual_professional_goal drop column if exists priority_code;
alter table individual_professional_goal drop column if exists priority_label;
alter table individual_professional_goal drop column if exists expected_evidence;
alter table individual_professional_goal drop column if exists start_date;
alter table individual_professional_goal drop column if exists review_date;
alter table individual_professional_goal drop column if exists template_code;
alter table individual_professional_goal drop column if exists template_label;
alter table individual_professional_goal drop column if exists template_answers;
alter table individual_professional_goal drop column if exists created_from;
alter table individual_professional_goal drop column if exists source_framework_competency_id;
alter table individual_professional_goal drop column if exists source_learning_offering_id;
alter table individual_professional_goal drop column if exists aspiration_item_id;
alter table individual_professional_goal drop column if exists reflection_id;
alter table individual_professional_goal drop column if exists reviewed_at;

notify pgrst, 'reload schema';
