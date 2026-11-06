-- VERIFY-1001-prod. For the owner, after applying migration 1001 to production (1000 first). Structure only: catalogue reads, one call of a marker
-- that reads nothing. No learner row is read, no data is changed. Paste into the SQL editor. Every line should say true.
select 'topic column' as what, (select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_note' and column_name = 'topic') as ok
union all select 'marker answers true', public.individual_scholar_notebook_1001()
union all select 'target check allows topic', (select pg_get_constraintdef(oid) like '%topic%' from pg_constraint where conname = 'individual_scholar_note_target_check')
union all select 'topic index', (select count(*) = 1 from pg_indexes where indexname = 'idx_individual_scholar_note_topic')
union all select 'notebook search reads the topic', (select prosrc like '%n.topic%' from pg_proc where proname = 'individual_scholar_notebook_search')
union all select 'still one read policy', (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'individual_scholar_note')
union all select 'anon cannot call the marker', (select not has_function_privilege('anon', 'public.individual_scholar_notebook_1001()', 'execute'))
union all select 'authenticated cannot call search', (select not has_function_privilege('authenticated', 'public.individual_scholar_notebook_search(uuid, text, integer, integer)', 'execute'));
