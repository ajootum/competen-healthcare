-- VERIFY-992-prod (SCHOLAR-SEARCH-HISTORY-01, My Search History). STRUCTURE ONLY: reads the catalogue, writes nothing,
-- reads no learner row, changes no table or trigger. For the owner to run in the production SQL editor AFTER applying 992
-- (separate owner GO). APPLY THIS FILE WHOLE (it holds a DO block). Passing = "Success. No rows returned" with the notice
-- VERIFY-992-prod: PASS. Any failure raises with what is wrong.
do $$
declare
  fn text := 'public.individual_scholar_search_history_list(uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, integer, integer)';
  fc text := 'public.individual_scholar_search_history_clear(uuid)';
  def text;
begin
  if to_regclass('public.individual_scholar_search_history') is null then
    raise exception 'VERIFY-992-prod: table individual_scholar_search_history is missing';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_search_history'
       and column_name in ('id', 'user_id', 'origin', 'activity', 'query', 'topic', 'material_id', 'chunk_id', 'artefact_id', 'session_id',
                           'step', 'result_count', 'request_key', 'pinned_at', 'hidden_at', 'created_at', 'tsv')) <> 17 then
    raise exception 'VERIFY-992-prod: expected the 17 columns of 992';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.individual_scholar_search_history'::regclass) then
    raise exception 'VERIFY-992-prod: RLS is not enabled';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.individual_scholar_search_history'::regclass) <> 1
     or not exists (select 1 from pg_policy where polrelid = 'public.individual_scholar_search_history'::regclass
                    and polname = 'individual_scholar_search_history_read_own' and polcmd = 'r'
                    and pg_get_expr(polqual, polrelid) like '%auth.uid()%user_id%') then
    raise exception 'VERIFY-992-prod: expected exactly one policy, read own';
  end if;
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'individual_scholar_search_history_entry_check');
  if def is null or def not like '%captured%' or def not like '%recovered%' or def not like '%material_search%'
     or def not like '%library_search%' or def not like '%300%' or def not like '%[[:cntrl:]]%' then
    raise exception 'VERIFY-992-prod: the entry CHECK is missing or not the 992 text';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_scholar_search_history'::regclass and contype = 'c') <> 1 then
    raise exception 'VERIFY-992-prod: expected exactly one CHECK constraint';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_scholar_search_history'::regclass and contype = 'f') <> 4 then
    raise exception 'VERIFY-992-prod: expected four foreign keys (profiles, material, artefact, session)';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'ux_individual_scholar_search_history_key'
                 and indexdef like 'CREATE UNIQUE INDEX%(user_id, request_key)') then
    raise exception 'VERIFY-992-prod: the plain unique index on (user_id, request_key) is missing or partial';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_individual_scholar_search_history_recent')
     or not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_individual_scholar_search_history_tsv') then
    raise exception 'VERIFY-992-prod: an index is missing';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.individual_scholar_search_history'::regclass and not tgisinternal) then
    raise exception 'VERIFY-992-prod: 992 adds no trigger, one is present';
  end if;
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname in ('individual_scholar_search_history_list', 'individual_scholar_search_history_clear') and not p.prosecdef) <> 2 then
    raise exception 'VERIFY-992-prod: both functions must exist and be SECURITY INVOKER';
  end if;
  if not has_function_privilege('service_role', fn, 'execute') or has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute')
     or not has_function_privilege('service_role', fc, 'execute') or has_function_privilege('anon', fc, 'execute') or has_function_privilege('authenticated', fc, 'execute') then
    raise exception 'VERIFY-992-prod: function execute must be service_role only';
  end if;
  raise notice 'VERIFY-992-prod: PASS (table, 17 columns, RLS read own, one CHECK, four foreign keys, plain unique key, indexes, no trigger, two invoker functions for service_role only)';
end $$;
