-- !! APPLY THIS FILE WHOLE. Part B is one DO block. Paste the entire file into the SQL editor and run it.
--
-- VERIFY 490. Part A is read-only. Part B runs inside a transaction that ends in ROLLBACK, so it leaves nothing behind.
-- Every line should read true or PASS.

-- A. Structure
select 'hours optional' as check, (select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'individual_professional_cpd' and column_name = 'hours') as ok
union all select 'credits take a decimal', (select data_type = 'numeric' and numeric_scale = 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_professional_cpd' and column_name = 'cpd_points')
union all select 'history table, RLS on, own-row read only', (select relrowsecurity from pg_class where oid = 'public.individual_professional_cpd_history'::regclass)
  and (select count(*) = 1 and bool_and(cmd = 'SELECT') from pg_policies where tablename = 'individual_professional_cpd_history')
union all select 'setting table, RLS on, own-row read only', (select relrowsecurity from pg_class where oid = 'public.individual_professional_cpd_setting'::regclass)
  and (select count(*) = 1 and bool_and(cmd = 'SELECT') from pg_policies where tablename = 'individual_professional_cpd_setting')
union all select 'no scope column on the new tables', not exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name in ('individual_professional_cpd_history', 'individual_professional_cpd_setting') and column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id'))
union all select 'both triggers present', (select count(*) = 2 from pg_trigger where tgname in ('trg_individual_professional_cpd_keep_history', 'trg_individual_professional_cpd_history_guard') and not tgisinternal);

-- B. Behaviour, rolled back
begin;
do $$
declare
  uid uuid := (select id from profiles order by created_at limit 1);
  cid uuid := gen_random_uuid();
  ok boolean;
  n integer;
begin
  if uid is null then raise notice 'SKIP behaviour: no profile on this environment'; return; end if;

  insert into individual_professional_cpd (id, user_id, experience_code, activity_type, title, activity_date)
    values (cid, uid, 'professional', 'mentorship', 'VERIFY-490 mentorship session', current_date - 30);
  raise notice 'PASS only a description and a date: a configured type with no hours is accepted';

  ok := false;
  begin insert into individual_professional_cpd (user_id, experience_code, activity_type, title, activity_date) values (uid, 'professional', 'Not A Code', 'VERIFY-490 bad', current_date);
  exception when check_violation then ok := true; end;
  raise notice '% an activity type that is not a code is refused', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin update individual_professional_cpd set hours = 0 where id = cid;
  exception when check_violation then ok := true; end;
  raise notice '% hours, when given, are above zero', case when ok then 'PASS' else 'FAIL' end;

  update individual_professional_cpd set cpd_points = 0.5, hours = 1.5 where id = cid;
  update individual_professional_cpd set title = 'VERIFY-490 mentorship session, corrected' where id = cid;
  select count(*) into n from individual_professional_cpd_history where cpd_id = cid;
  raise notice '% two material corrections keep two history rows (n=%)', case when n = 2 then 'PASS' else 'FAIL' end, n;

  update individual_professional_cpd set updated_at = now() where id = cid;
  select count(*) into n from individual_professional_cpd_history where cpd_id = cid;
  raise notice '% a change that alters no content keeps no history (n=%)', case when n = 2 then 'PASS' else 'FAIL' end, n;

  ok := (select title from individual_professional_cpd_history where cpd_id = cid order by corrected_at desc, title limit 1) like 'VERIFY-490 mentorship session';
  raise notice '% history holds the entry as it was before the correction', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin update individual_professional_cpd_history set title = 'x' where cpd_id = cid;
  exception when others then ok := true; end;
  raise notice '% history cannot be changed', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin delete from individual_professional_cpd_history where cpd_id = cid;
  exception when others then ok := true; end;
  raise notice '% history cannot be deleted directly', case when ok then 'PASS' else 'FAIL' end;

  delete from individual_professional_cpd where id = cid;
  select count(*) into n from individual_professional_cpd_history where cpd_id = cid;
  raise notice '% history goes only with its entry (n=%)', case when n = 0 then 'PASS' else 'FAIL' end, n;

  ok := false;
  begin insert into individual_professional_cpd_setting (user_id, requirement_code, cycle_start) values (uid, null, current_date);
  exception when check_violation then ok := true; end;
  raise notice '% a cycle start needs a requirement', case when ok then 'PASS' else 'FAIL' end;
end
$$;
rollback;
