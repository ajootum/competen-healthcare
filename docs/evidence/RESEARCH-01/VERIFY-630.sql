-- VERIFY-630 (read only). Every row must be true.
select 'capability exists, platform space' as check, exists (select 1 from hq_capability where code = 'hq.platform.research.manage' and space = 'platform') as ok
union all select 'granted to no position', not exists (select 1 from hq_position_capability where capability_code = 'hq.platform.research.manage')
union all select 'table exists', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'plat_research_requests')
union all select 'rls on', (select relrowsecurity from pg_class where oid = 'public.plat_research_requests'::regclass)
union all select 'no rls policy', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'plat_research_requests')
union all select 'no person or query column', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plat_research_requests' and column_name in ('user_id', 'actor_id', 'person_id', 'query', 'query_text', 'question'))
union all select 'outcome check present', exists (select 1 from pg_constraint where conrelid = 'public.plat_research_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%outcome%')
union all select 'both indexes', (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'plat_research_requests' and indexname in ('idx_plat_research_requests_created', 'idx_plat_research_requests_provider')) = 2;
