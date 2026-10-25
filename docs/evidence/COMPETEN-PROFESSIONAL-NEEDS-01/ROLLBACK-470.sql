-- ROLLBACK 470 (STAGING ONLY). COMPETEN-PROFESSIONAL-NEEDS-01, Professional Stage 2.
-- Removes what 470 added: the suggestions, goal links, competency links, need history and reflections (and
-- every row in them), the four trigger functions and two triggers on individual_professional_need, the
-- Stage 2 columns and CHECKs on individual_professional_need, and restores the 373 origin CHECK. Needs whose
-- origin is one of the 470 sources are set back to self_identified first, so the 373 CHECK can return.
-- The 373 title, detail, status and links of every need are untouched. Plain statements only.

drop trigger if exists trg_individual_professional_need_stage_sync on individual_professional_need;
drop trigger if exists trg_individual_professional_need_history on individual_professional_need;
drop table if exists individual_professional_need_suggestion;
drop table if exists individual_professional_goal_need;
drop table if exists individual_professional_need_competency;
drop table if exists individual_professional_need_history;
drop function if exists public.individual_professional_need_stage_sync();
drop function if exists public.individual_professional_need_history_write();
drop function if exists public.individual_professional_stage2_append_only();
drop function if exists public.individual_professional_need_competency_guard();

alter table individual_professional_need drop constraint if exists individual_professional_need_reflection_fk;
alter table individual_professional_need drop constraint if exists individual_professional_need_aspiration_fk;
alter table individual_professional_need drop constraint if exists individual_professional_need_stage_status;
alter table individual_professional_need drop constraint if exists individual_professional_need_stage2_shape;
alter table individual_professional_need drop constraint if exists individual_professional_need_origin_check;
update individual_professional_need set origin = 'self_identified' where origin not in ('self_identified', 'passport_gap');
alter table individual_professional_need add constraint individual_professional_need_origin_check
  check (origin in ('self_identified', 'passport_gap'));

alter table individual_professional_need drop column if exists stage_code;
alter table individual_professional_need drop column if exists priority_code;
alter table individual_professional_need drop column if exists priority_label;
alter table individual_professional_need drop column if exists category_code;
alter table individual_professional_need drop column if exists category_label;
alter table individual_professional_need drop column if exists motivation_code;
alter table individual_professional_need drop column if exists motivation_label;
alter table individual_professional_need drop column if exists why_it_matters;
alter table individual_professional_need drop column if exists professional_context;
alter table individual_professional_need drop column if exists development_interests;
alter table individual_professional_need drop column if exists source_note;
alter table individual_professional_need drop column if exists created_via;
alter table individual_professional_need drop column if exists reflection_id;
alter table individual_professional_need drop column if exists aspiration_item_id;
alter table individual_professional_need drop column if exists reviewed_at;

drop table if exists individual_professional_reflection;

notify pgrst, 'reload schema';
