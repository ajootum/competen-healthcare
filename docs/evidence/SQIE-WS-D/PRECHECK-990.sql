-- PRECHECK-990 (SQIE WS-D). READ ONLY. APPLY THIS FILE WHOLE (it holds a DO block).
-- It always ends by raising PRECHECK-990 with what it found, so the runner rolls back and prints the line. Nothing is written.
do $$
declare
  r text;
begin
  select concat_ws(' | ',
    'snapshot_table=' || (to_regclass('public.individual_scholar_attempt_snapshot') is not null),
    'provenance_col=' || exists (select 1 from information_schema.columns where table_name = 'individual_scholar_attempt_snapshot' and column_name = 'competency_provenance'),
    'shape_has_unmarked=' || coalesce((select pg_get_constraintdef(oid) like '%unmarked%' from pg_constraint where conname = 'individual_scholar_attempt_snapshot_shape_check'), false),
    'provenance_check=' || exists (select 1 from pg_constraint where conname = 'individual_scholar_attempt_snapshot_provenance_check'),
    'attempt_marking_950=' || coalesce((select pg_get_constraintdef(oid) like '%unmarked%' from pg_constraint where conname = 'individual_scholar_attempt_marking_check'), false),
    'hash_fn=' || (to_regprocedure('public.competency_content_hashes(uuid[])') is not null),
    'fw_version_cols=' || (select count(*) from information_schema.columns where table_name = 'frameworks' and column_name in ('version_major', 'version_minor', 'version_revision')),
    'snapshots=' || (select count(*) from individual_scholar_attempt_snapshot),
    'attempts=' || (select count(*) from individual_scholar_attempt),
    'unmarked_attempts=' || (select count(*) from individual_scholar_attempt where marking = 'unmarked'),
    'attempts_without_snapshot=' || (select count(*) from individual_scholar_attempt a where not exists (select 1 from individual_scholar_attempt_snapshot s where s.attempt_id = a.id)))
  into r;
  raise exception 'PRECHECK-990 %', r;
end $$;
