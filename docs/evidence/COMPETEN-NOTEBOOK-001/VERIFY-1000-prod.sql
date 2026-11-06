-- VERIFY-1000-prod. For the owner, after applying migration 1000 to production. Structure only: catalogue reads, one call of a marker that
-- reads nothing. No learner row is read, no data is changed. Paste into the SQL editor. Every line should say true.
select 'twelve new columns' as what, (select count(*) = 12 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_note' and column_name in ('title','tags','pinned_at','client_key','revision','section_label','section_anchor','captured_in','competency_id','study_id','was_on','search_tsv')) as ok
union all select 'marker answers true', public.individual_scholar_notebook_1000()
union all select 'notebook search exists', (select count(*) = 1 from pg_proc where proname = 'individual_scholar_notebook_search')
union all select 'search document function exists', (select count(*) = 1 from pg_proc where proname = 'individual_scholar_note_search_doc')
union all select 'two detach triggers', (select count(*) = 2 from pg_trigger where tgname in ('individual_scholar_note_detach_material', 'individual_scholar_note_detach_session') and not tgisinternal)
union all select 'target check allows free', (select pg_get_constraintdef(oid) like '%free%' from pg_constraint where conname = 'individual_scholar_note_target_check')
union all select 'kind check allows 50000', (select pg_get_constraintdef(oid) like '%50000%' from pg_constraint where conname = 'individual_scholar_note_kind_check')
union all select 'notebook check present', (select count(*) = 1 from pg_constraint where conname = 'individual_scholar_note_notebook_check')
union all select 'client key index', (select count(*) = 1 from pg_indexes where indexname = 'ux_individual_scholar_note_client_key')
union all select 'search index', (select count(*) = 1 from pg_indexes where indexname = 'idx_individual_scholar_note_search_tsv')
union all select 'library search reads search_tsv', (select prosrc like '%search_tsv%' from pg_proc where proname = 'individual_scholar_library_search')
union all select 'touch trigger raises the revision', (select prosrc like '%revision%' from pg_proc where proname = 'individual_scholar_note_touch')
union all select 'row security still on', (select relrowsecurity from pg_class where oid = 'public.individual_scholar_note'::regclass)
union all select 'still one read policy', (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'individual_scholar_note')
union all select 'anon cannot call search', (select not has_function_privilege('anon', 'public.individual_scholar_notebook_search(uuid, text, integer, integer)', 'execute'))
union all select 'authenticated cannot call search', (select not has_function_privilege('authenticated', 'public.individual_scholar_notebook_search(uuid, text, integer, integer)', 'execute'));
