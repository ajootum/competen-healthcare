-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- VERIFY 780 (SCHOLAR-COMPANION-01 study plan), read only in effect. Behaviour checks on rows planted for existing
-- profiles. It ALWAYS ends by raising its RESULT line, so the runner rolls everything back and nothing persists.
-- Run it after 780 is applied.
do $$
declare
  u uuid; other uuid;
  pass int := 0; fail int := 0; failed text := '';
  n int; v text;
begin
  select id into u from profiles order by created_at limit 1;
  if u is null then raise exception 'VERIFY 780: no profile to plant against'; end if;
  select id into other from profiles where id <> u limit 1;
  if exists (select 1 from individual_scholar_study_plan where user_id = u) then
    raise exception 'VERIFY 780: the first profile already has a plan row, refusing to plant over it';
  end if;

  -- A accepted
  begin
    insert into individual_scholar_study_plan (user_id, weekly_minutes, days_per_week) values (u, 300, 5);
    select coalesce(exam_date::text, 'null') || '/' || coalesce(exam_label, 'null') || '/' || coalesce(goal, 'null') || '/' || cardinality(priorities)
      into v from individual_scholar_study_plan where user_id = u;
    if v = 'null/null/null/0' then pass := pass + 1; else fail := fail + 1; failed := failed || ' A1:' || v; end if;
  exception when others then fail := fail + 1; failed := failed || ' A1:' || sqlerrm;
  end;
  begin
    update individual_scholar_study_plan set exam_date = date '2027-03-01', exam_label = repeat('x', 120), goal = repeat('g', 300),
      priorities = array['a','b','c','d','e','f','g','h','i','j'], weekly_minutes = 30, days_per_week = 1 where user_id = u;
    update individual_scholar_study_plan set weekly_minutes = 3000, days_per_week = 7 where user_id = u;
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' A2:' || sqlerrm;
  end;

  -- B refused
  begin update individual_scholar_study_plan set weekly_minutes = 29 where user_id = u; fail := fail + 1; failed := failed || ' B1:29-minutes';
  exception when check_violation then pass := pass + 1; end;
  begin update individual_scholar_study_plan set weekly_minutes = 3001 where user_id = u; fail := fail + 1; failed := failed || ' B2:3001-minutes';
  exception when check_violation then pass := pass + 1; end;
  begin update individual_scholar_study_plan set days_per_week = 0 where user_id = u; fail := fail + 1; failed := failed || ' B3:0-days';
  exception when check_violation then pass := pass + 1; end;
  begin update individual_scholar_study_plan set days_per_week = 8 where user_id = u; fail := fail + 1; failed := failed || ' B4:8-days';
  exception when check_violation then pass := pass + 1; end;
  begin update individual_scholar_study_plan set exam_label = repeat('x', 121) where user_id = u; fail := fail + 1; failed := failed || ' B5:long-label';
  exception when check_violation then pass := pass + 1; end;
  begin update individual_scholar_study_plan set exam_label = '  ' where user_id = u; fail := fail + 1; failed := failed || ' B6:blank-label';
  exception when check_violation then pass := pass + 1; end;
  begin update individual_scholar_study_plan set goal = repeat('g', 301) where user_id = u; fail := fail + 1; failed := failed || ' B7:long-goal';
  exception when check_violation then pass := pass + 1; end;
  begin update individual_scholar_study_plan set priorities = array['a','b','c','d','e','f','g','h','i','j','k'] where user_id = u; fail := fail + 1; failed := failed || ' B8:11-priorities';
  exception when check_violation then pass := pass + 1; end;
  begin update individual_scholar_study_plan set priorities = null where user_id = u; fail := fail + 1; failed := failed || ' B9:null-priorities';
  exception when not_null_violation then pass := pass + 1; end;
  begin update individual_scholar_study_plan set weekly_minutes = null where user_id = u; fail := fail + 1; failed := failed || ' B10:null-minutes';
  exception when not_null_violation then pass := pass + 1; end;
  begin insert into individual_scholar_study_plan (user_id, weekly_minutes, days_per_week) values (u, 120, 3); fail := fail + 1; failed := failed || ' B11:second-row';
  exception when unique_violation then pass := pass + 1; end;
  begin insert into individual_scholar_study_plan (user_id, weekly_minutes, days_per_week) values (gen_random_uuid(), 120, 3); fail := fail + 1; failed := failed || ' B12:no-profile';
  exception when foreign_key_violation then pass := pass + 1; end;

  -- C a second learner has their own row
  if other is not null then
    begin
      insert into individual_scholar_study_plan (user_id, weekly_minutes, days_per_week) values (other, 120, 3);
      select count(*) into n from individual_scholar_study_plan where user_id in (u, other);
      if n = 2 then pass := pass + 1; else fail := fail + 1; failed := failed || ' C1:rows=' || n; end if;
    exception when others then fail := fail + 1; failed := failed || ' C1:' || sqlerrm;
    end;
  else fail := fail + 1; failed := failed || ' C1:no-second-profile';
  end if;

  -- F schema posture
  if (select relrowsecurity from pg_class where oid = 'public.individual_scholar_study_plan'::regclass) then pass := pass + 1;
  else fail := fail + 1; failed := failed || ' F1:no-rls'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'individual_scholar_study_plan';
  if n = 1 and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'individual_scholar_study_plan'
                         and cmd = 'SELECT' and qual = '(auth.uid() = user_id)') then pass := pass + 1;
  else fail := fail + 1; failed := failed || ' F2:policies=' || n; end if;
  select count(*) into n from pg_constraint where conrelid = 'public.individual_scholar_study_plan'::regclass and contype = 'c';
  if n = 5 then pass := pass + 1; else fail := fail + 1; failed := failed || ' F3:checks=' || n; end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.individual_scholar_study_plan'::regclass and contype = 'f' and confdeltype = 'c'
               and confrelid = 'public.profiles'::regclass) then pass := pass + 1;
  else fail := fail + 1; failed := failed || ' F4:profiles-cascade'; end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.individual_scholar_study_plan'::regclass and contype = 'p') then pass := pass + 1;
  else fail := fail + 1; failed := failed || ' F5:no-pk'; end if;
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_study_plan';
  if n = 9 then pass := pass + 1; else fail := fail + 1; failed := failed || ' F6:columns=' || n; end if;

  raise exception 'VERIFY 780 RESULT pass=% fail=% %', pass, fail, case when failed = '' then '' else ' --' || failed end;
end;
$$;
