-- !! APPLY THIS FILE WHOLE. Part B is one DO block. Paste the entire file into the SQL editor and run it.
--
-- VERIFY 491. Part A is read-only. Part B runs inside a transaction that ends in ROLLBACK, so it leaves nothing behind.
-- Every line should read true or PASS.

-- A. Structure
select 'both tables exist' as check, to_regclass('public.individual_professional_learning_reflection') is not null and to_regclass('public.individual_professional_share_learning') is not null as ok
union all select 'RLS on, own-row read only, on both', (select bool_and(relrowsecurity) from pg_class where relname in ('individual_professional_learning_reflection', 'individual_professional_share_learning'))
  and (select count(*) = 2 and bool_and(cmd = 'SELECT') from pg_policies where tablename in ('individual_professional_learning_reflection', 'individual_professional_share_learning'))
union all select 'no scope column', not exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name in ('individual_professional_learning_reflection', 'individual_professional_share_learning') and column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id'))
union all select 'impact cannot be verified', (select pg_get_constraintdef(oid) not like '%verified%' from pg_constraint where conname = 'individual_professional_learning_reflection_impact');

-- B. Behaviour, rolled back
begin;
do $$
declare
  uid uuid := (select id from profiles order by created_at limit 1);
  other uuid := (select id from profiles order by created_at offset 1 limit 1);
  rid uuid; cid uuid := gen_random_uuid(); ok boolean;
begin
  if uid is null then raise notice 'SKIP behaviour: no profile on this environment'; return; end if;
  insert into individual_professional_reflection (user_id, experience_code, template_code, template_label, body)
    values (uid, 'professional', 'quick', 'Quick reflection', 'VERIFY-491 reflection') returning id into rid;
  insert into individual_professional_cpd (id, user_id, experience_code, activity_type, title, hours, activity_date)
    values (cid, uid, 'professional', 'course', 'VERIFY-491 course', 1, current_date);

  insert into individual_professional_learning_reflection (user_id, reflection_id, cpd_id, impact) values (uid, rid, cid, 'applied');
  raise notice 'PASS a reflection on one CPD entry, impact applied';

  ok := false;
  begin update individual_professional_learning_reflection set impact = 'verified' where reflection_id = rid;
  exception when check_violation then ok := true; end;
  raise notice '% verified impact cannot be self-reported', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin update individual_professional_learning_reflection set learning_record_id = gen_random_uuid() where reflection_id = rid;
  exception when check_violation or foreign_key_violation then ok := true; end;
  raise notice '% one subject only, never both', case when ok then 'PASS' else 'FAIL' end;

  if other is not null then
    ok := false;
    begin insert into individual_professional_learning_reflection (user_id, reflection_id, cpd_id) values (other, rid, cid);
    exception when foreign_key_violation or unique_violation then ok := true; end;
    raise notice '% another person cannot attach to this reflection or entry', case when ok then 'PASS' else 'FAIL' end;
  end if;

  delete from individual_professional_cpd where id = cid;
  raise notice '% the link goes with its CPD entry', case when not exists (select 1 from individual_professional_learning_reflection where reflection_id = rid) then 'PASS' else 'FAIL' end;
  raise notice '% the reflection itself stays', case when exists (select 1 from individual_professional_reflection where id = rid) then 'PASS' else 'FAIL' end;

  ok := false;
  begin insert into individual_professional_share_learning (share_token_id, user_id, learning_record_id) values (gen_random_uuid(), uid, gen_random_uuid());
  exception when foreign_key_violation then ok := true; end;
  raise notice '% a shared learning item needs the person own link and record', case when ok then 'PASS' else 'FAIL' end;
end
$$;
rollback;
