-- VERIFY-950 (strict): raises on any failure. Read-only.
do $$
declare def text; n int;
begin
  if not exists (select 1 from pg_indexes where tablename = 'individual_scholar_attempt' and indexname = 'ux_individual_scholar_attempt_id_user') then raise exception 'VERIFY-950: unique index missing'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'individual_scholar_attempt' and column_name = 'content_version') then raise exception 'VERIFY-950: content_version missing'; end if;
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'individual_scholar_attempt_marking_check';
  if def is null or position('unmarked' in def) = 0 then raise exception 'VERIFY-950: marking rule lacks unmarked'; end if;
  if position('ai_evaluation' in def) = 0 or position('self_graded' in def) = 0 then raise exception 'VERIFY-950: marking rule lost a 416 value'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'individual_scholar_learning_event' and column_name = 'attempt_id') then raise exception 'VERIFY-950: attempt_id missing'; end if;
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'individual_scholar_learning_event_attempt_fk';
  if def is null or position('SET NULL (attempt_id)' in def) = 0 then raise exception 'VERIFY-950: attempt fk missing or not column-list set null: %', def; end if;
  select count(*) into n from pg_constraint where conrelid = 'individual_scholar_learning_event'::regclass and contype = 'c';
  if n <> 1 then raise exception 'VERIFY-950: event check constraints = %', n; end if;
  raise notice 'VERIFY-950 pass';
end $$;
