-- ROLLBACK 450 (STAGING ONLY). COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1.
-- Removes what 450 added: the two tables (and their rows), the three trigger functions, the pointer
-- trigger, and the columns and CHECKs 450 added to individual_professional_profile. The 373 columns,
-- rows and constraints are untouched. Data written into the 450 columns or tables is LOST.
-- Plain statements only, so it is safe for a runner that splits on semicolons.

drop trigger if exists trg_individual_professional_profile_history on individual_professional_profile;
drop table if exists individual_professional_profile_item;
drop table if exists individual_professional_profile_context;
drop function if exists individual_professional_profile_history();
drop function if exists individual_professional_profile_context_append_only();
drop function if exists individual_professional_profile_item_supersede();
drop function if exists individual_professional_profile_item_append_only();

alter table individual_professional_profile drop constraint if exists individual_professional_profile_context_shape;
alter table individual_professional_profile drop constraint if exists individual_professional_profile_registration_step;
alter table individual_professional_profile drop constraint if exists individual_professional_profile_registration_complete;

alter table individual_professional_profile drop column if exists profession_code;
alter table individual_professional_profile drop column if exists practice_jurisdiction_code;
alter table individual_professional_profile drop column if exists self_declared_practice_jurisdiction;
alter table individual_professional_profile drop column if exists professional_status_code;
alter table individual_professional_profile drop column if exists self_declared_professional_status;
alter table individual_professional_profile drop column if exists professional_title_code;
alter table individual_professional_profile drop column if exists self_declared_professional_title;
alter table individual_professional_profile drop column if exists primary_specialty_code;
alter table individual_professional_profile drop column if exists self_declared_primary_specialty;
alter table individual_professional_profile drop column if exists practice_setting_code;
alter table individual_professional_profile drop column if exists self_declared_practice_setting;
alter table individual_professional_profile drop column if exists self_declared_current_role;
alter table individual_professional_profile drop column if exists self_declared_years_experience;
alter table individual_professional_profile drop column if exists self_declared_summary;
alter table individual_professional_profile drop column if exists registration_step;
alter table individual_professional_profile drop column if exists registration_completed_at;

notify pgrst, 'reload schema';
