-- PRECHECK 720 (read only). Run BEFORE and AFTER applying 720. Changes nothing.
-- 1. The dependencies 720 needs. Every row must say present.
select 'profiles' as dependency, case when to_regclass('public.profiles') is not null then 'present' else 'MISSING' end as state
union all
select 'individual_scholar_material (372)', case when to_regclass('public.individual_scholar_material') is not null then 'present' else 'MISSING' end
union all
select 'individual_scholar_chunk (372)', case when to_regclass('public.individual_scholar_chunk') is not null then 'present' else 'MISSING' end
union all
select 'framework_competencies', case when to_regclass('public.framework_competencies') is not null then 'present' else 'MISSING' end
union all
select 'individual_scholar_revision_set (417)', case when to_regclass('public.individual_scholar_revision_set') is not null then 'present' else 'MISSING' end
union all
select 'individual_scholar_revision_session (417)', case when to_regclass('public.individual_scholar_revision_session') is not null then 'present' else 'MISSING' end
union all
select 'server_version_num >= 150000', case when current_setting('server_version_num')::int >= 150000 then 'present' else 'MISSING' end;

-- 2. Whether 720 is already applied (before the first run: both absent).
select 'individual_scholar_osce_station' as object, case when to_regclass('public.individual_scholar_osce_station') is not null then 'present' else 'absent' end as state
union all
select 'individual_scholar_osce_attempt', case when to_regclass('public.individual_scholar_osce_attempt') is not null then 'present' else 'absent' end;

-- 3. The two mode CHECKs 720 replaces (before: the 417 list, after: the same list with adaptive).
select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conname in ('individual_scholar_revision_set_check', 'individual_scholar_revision_session_check')
 order by conname;

-- 4. Existing rows by mode (each must already satisfy the wider CHECK, which it does by construction).
select 'set ' || mode as mode, count(*) as n from individual_scholar_revision_set group by mode
union all
select 'session ' || mode, count(*) from individual_scholar_revision_session group by mode
order by 1;
