-- VERIFY 955 (strict): raises on any failure. APPLY THIS FILE WHOLE. Read-only apart from the DO block's own checks.
do $$
declare
  n integer;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_session' and column_name = 'lesson_titles' and data_type = 'jsonb') then
    raise exception 'VERIFY-955: lesson_titles column missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_learning_event' and column_name = 'detached_at') then
    raise exception 'VERIFY-955: detached_at column missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'individual_scholar_learning_session_lesson_titles_check') then
    raise exception 'VERIFY-955: lesson_titles check missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'individual_scholar_learning_event_session_step_idx') then
    raise exception 'VERIFY-955: event (user, session, step) index missing';
  end if;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'individual_scholar_learning_session_recut'
     and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_session_id uuid, p_steps jsonb, p_titles jsonb';
  if n <> 1 then
    raise exception 'VERIFY-955: recut function missing or wrong signature (found %)', n;
  end if;
  if not has_function_privilege('service_role', 'public.individual_scholar_learning_session_recut(uuid, uuid, jsonb, jsonb)', 'execute') then
    raise exception 'VERIFY-955: service_role cannot execute the recut function';
  end if;
  if has_function_privilege('anon', 'public.individual_scholar_learning_session_recut(uuid, uuid, jsonb, jsonb)', 'execute') then
    raise exception 'VERIFY-955: anon can execute the recut function';
  end if;
  if has_function_privilege('authenticated', 'public.individual_scholar_learning_session_recut(uuid, uuid, jsonb, jsonb)', 'execute') then
    raise exception 'VERIFY-955: authenticated can execute the recut function';
  end if;
  -- The function refuses a session that is not the caller's (no row is touched).
  begin
    perform public.individual_scholar_learning_session_recut('00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000002'::uuid, '[["00000000-0000-4000-8000-000000000003"]]'::jsonb, null);
    raise exception 'VERIFY-955: the function accepted a session that is not the caller''s';
  exception when no_data_found then
    null;
  end;
  raise notice 'VERIFY-955: PASS';
end $$;
