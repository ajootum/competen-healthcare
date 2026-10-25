-- !! APPLY THIS FILE WHOLE. Part B is one DO block. Paste the entire file into the SQL editor and run it.
--
-- VERIFY 437. Part A is read-only. Part B runs inside a transaction that ends in ROLLBACK, so it leaves
-- nothing behind. Every line of output should read true or PASS.

-- A. Structure
select 'table exists' as check, to_regclass('public.individual_notification') is not null as ok
union all select 'no scope column', not exists (
  select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_notification'
    and column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id'))
union all select 'rls on', (select relrowsecurity from pg_class where oid = 'public.individual_notification'::regclass)
union all select 'own-row select is the only policy', (
  select count(*) = 1 and bool_and(cmd = 'SELECT') from pg_policies where tablename = 'individual_notification')
union all select 'once-only unique index', exists (
  select 1 from pg_indexes where tablename = 'individual_notification' and indexname = 'ux_individual_notification_once')
union all select 'guard trigger', exists (
  select 1 from pg_trigger where tgname = 'trg_individual_notification_guard' and not tgisinternal);

-- B. Behaviour, rolled back
begin;
do $$
declare
  uid uuid := (select id from profiles order by created_at limit 1);
  nid uuid;
  ok boolean;
begin
  if uid is null then raise notice 'SKIP behaviour: no profile on this environment'; return; end if;
  insert into individual_notification(user_id, kind, body, href, dedupe_key)
    values (uid, 'verify_437', 'Verification notice.', '/individual', 'verify-437') returning id into nid;

  ok := false;
  begin insert into individual_notification(user_id, kind, body, dedupe_key) values (uid, 'verify_437', 'Again.', 'verify-437');
  exception when unique_violation then ok := true; end;
  raise notice '% a second notice with the same key is refused', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin update individual_notification set body = 'changed' where id = nid;
  exception when others then ok := true; end;
  raise notice '% the body cannot change', case when ok then 'PASS' else 'FAIL' end;

  update individual_notification set read_at = now() where id = nid;
  raise notice 'PASS read_at can be set';

  ok := false;
  begin update individual_notification set read_at = now() + interval '1 hour' where id = nid;
  exception when others then ok := true; end;
  raise notice '% read_at is set once', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin delete from individual_notification where id = nid;
  exception when others then ok := true; end;
  raise notice '% a notice cannot be deleted directly', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin insert into individual_notification(user_id, kind, body, href, dedupe_key) values (uid, 'verify_437', 'x', '//evil.example', 'verify-437-b');
  exception when check_violation then ok := true; end;
  raise notice '% an off-site link is refused', case when ok then 'PASS' else 'FAIL' end;
end
$$;
rollback;
