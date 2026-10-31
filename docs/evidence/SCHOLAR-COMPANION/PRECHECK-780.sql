-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- PRECHECK 780 (read only). Reports by raising, so the runner rolls back and nothing changes.
-- Run before and after applying 780. SCHOLAR-COMPANION-01 study plan.
-- Before: study_plan_table_780=false (or true with the identical shape below, if 780 was already applied).
-- After: every field below present, plans=0 until a learner saves one.
do $$
declare
  r text;
  n bigint := 0;
begin
  if to_regclass('public.individual_scholar_study_plan') is not null then
    execute 'select count(*) from individual_scholar_study_plan' into n;
  end if;
  select concat_ws(' | ',
    'profiles_table=' || (to_regclass('public.profiles') is not null),
    'study_plan_table_780=' || (to_regclass('public.individual_scholar_study_plan') is not null),
    'columns=' || coalesce((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
        from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_study_plan'), 'absent'),
    'checks=' || (select count(*) from pg_constraint where conrelid = to_regclass('public.individual_scholar_study_plan') and contype = 'c'),
    'rls=' || coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.individual_scholar_study_plan')), false),
    'policies=' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'individual_scholar_study_plan'),
    'plans=' || n
  ) into r;
  raise exception 'PRECHECK 780: %', r;
end;
$$;
