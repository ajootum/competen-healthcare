-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- PRECHECK 740 (read only). Reports by raising, so the runner rolls back and nothing changes.
-- Run before and after applying 740. SCHOLAR-SESSION-AI-02.
-- sessions_414_hash is a digest of every 414 column of every existing session: it must be the same before and after.
do $$
declare
  r text;
  h text;
begin
  if to_regclass('public.individual_scholar_learning_session') is not null then
    execute $q$select coalesce(md5(string_agg(concat_ws('|', id, user_id, scope_kind, title, topic, competency_id, current_step, status, created_at, last_active_at), ',' order by id)), 'none')
      from individual_scholar_learning_session$q$ into h;
  end if;
  select concat_ws(' | ',
    'session_table_414=' || (to_regclass('public.individual_scholar_learning_session') is not null),
    'ux_id_user_414=' || (to_regclass('public.ux_individual_scholar_learning_session_id_user') is not null),
    'col_competency_id_414=' || exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'competency_id'),
    'col_connected_740=' || exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'connected'),
    'col_last_space_740=' || exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'last_space'),
    'col_objective_outcome_740=' || exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'objective_outcome'),
    'col_objective_text_740=' || exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'objective_text'),
    'check_study_740=' || exists(select 1 from pg_constraint where conname = 'individual_scholar_learning_session_study_check'),
    'trigger_outcome_follows_740=' || exists(select 1 from pg_trigger where tgname = 'individual_scholar_learning_session_outcome_follows'),
    'function_outcome_follows_740=' || exists(select 1 from pg_proc where proname = 'individual_scholar_learning_session_outcome_follows'),
    'link_table_740=' || (to_regclass('public.individual_scholar_study_link') is not null),
    'session_columns=' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session'),
    'sessions=' || (select count(*) from individual_scholar_learning_session),
    'sessions_with_competency=' || (select count(*) from individual_scholar_learning_session where competency_id is not null),
    'sessions_414_hash=' || coalesce(h, 'absent')
  ) into r;
  raise exception 'PRECHECK 740: %', r;
end;
$$;
