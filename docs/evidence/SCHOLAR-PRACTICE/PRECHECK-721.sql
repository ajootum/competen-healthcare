-- PRECHECK 721 (read only). Run BEFORE and AFTER applying 721. Changes nothing.
-- 1. The dependencies 721 needs. Every row must say present (720 first, then 721).
select 'individual_scholar_osce_station (720)' as dependency, case when to_regclass('public.individual_scholar_osce_station') is not null then 'present' else 'MISSING' end as state
union all
select 'individual_scholar_osce_attempt (720)', case when to_regclass('public.individual_scholar_osce_attempt') is not null then 'present' else 'MISSING' end
union all
select 'ckri_knowledge_resource (442)', case when to_regclass('public.ckri_knowledge_resource') is not null then 'present' else 'MISSING' end
union all
select 'ckri_knowledge_version (442)', case when to_regclass('public.ckri_knowledge_version') is not null then 'present' else 'MISSING' end
union all
select 'ckri_knowledge_approved (442)', case when exists (select 1 from pg_proc where proname = 'ckri_knowledge_approved') then 'present' else 'MISSING' end
union all
select 'ckri_knowledge_content_ok (442)', case when exists (select 1 from pg_proc where proname = 'ckri_knowledge_content_ok') then 'present' else 'MISSING' end;

-- 2. Whether 721 is already applied (before the first run: absent, absent, 0).
select 'station.version (721)' as object, case when exists (select 1 from information_schema.columns where table_name = 'individual_scholar_osce_station' and column_name = 'version') then 'present' else 'absent' end as state
union all
select 'attempt.station_snapshot (721)', case when exists (select 1 from information_schema.columns where table_name = 'individual_scholar_osce_attempt' and column_name = 'station_snapshot') then 'present' else 'absent' end
union all
select 'trigger individual_scholar_osce_station_library_guard (721)', case when exists (select 1 from pg_trigger where tgname = 'individual_scholar_osce_station_library_guard') then 'present' else 'absent' end;

-- 3. The constraints 721 replaces or adds (before: the 720 and 442 text, after: the 721 text).
select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conname in ('individual_scholar_osce_station_checklist_check', 'individual_scholar_osce_station_source_check',
                   'individual_scholar_osce_station_definition_check', 'individual_scholar_osce_attempt_marking_check',
                   'individual_scholar_osce_attempt_progress_check', 'ckri_knowledge_resource_check')
 order by conname;

-- 4. Whether the 442 content function answers osce_station (before: false, after: true).
select 'content_ok osce_station' as probe, ckri_knowledge_content_ok('osce_station',
  '{"scenario": "A simulated person needs an assessment from you.", "candidate_instructions": "Assess and say what you would do.", "duration_minutes": 8, "checklist": [{"id": "a", "text": "Gains consent", "critical": true}]}'::jsonb) as answer
union all
select 'content_ok revision_question (unchanged)', ckri_knowledge_content_ok('revision_question',
  '{"stem": "Which of these is a question stem?", "options": ["a", "b", "c", "d"], "correct_index": 1, "rationale": "Because it is the rationale."}'::jsonb);

-- 5. Rows (each already satisfies every 721 CHECK by construction).
select 'stations' as what, count(*) as n from individual_scholar_osce_station
union all
select 'attempts', count(*) from individual_scholar_osce_attempt
union all
select 'attempts finished', count(*) from individual_scholar_osce_attempt where finished_at is not null
union all
select 'knowledge resources ' || kind, count(*) from ckri_knowledge_resource group by kind
order by 1;
