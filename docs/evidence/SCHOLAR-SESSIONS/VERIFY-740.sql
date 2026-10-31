-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one DO block between dollar quotes.
-- ====================================================================================================
-- VERIFY 740 (SCHOLAR-SESSION-AI-02), staging only. Behaviour checks on rows planted for an existing learner.
-- It ALWAYS ends by raising its result, so the runner rolls everything back.
do $$
declare
  u uuid; other uuid; comp uuid; dom uuid; tmp_comp uuid;
  s1 uuid; s2 uuid; s3 uuid; s_other uuid; s4 uuid; ref uuid := gen_random_uuid();
  pass int := 0; fail int := 0; failed text := '';
  n int; v text;
begin
  select user_id into u from individual_scholar_learning_session order by created_at limit 1;
  if u is null then select user_id into u from individual_scholar_material limit 1; end if;
  if u is null then raise exception 'VERIFY 740: no learner on staging to plant against'; end if;
  select id into other from profiles where id <> u limit 1;
  select id into comp from framework_competencies limit 1;

  -- E1 every existing session reads as an ordinary Learn session: not connected, no space, no objective
  select count(*) into n from individual_scholar_learning_session
   where connected or last_space is not null or objective_outcome is not null or objective_text is not null;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failed := failed || ' E1:' || n || '-changed'; end if;

  -- A1 a connected topic session with a free-text objective and a last space
  begin
    insert into individual_scholar_learning_session (user_id, scope_kind, title, topic, connected, last_space, objective_text)
    values (u, 'topic', 'Renal physiology', 'renal physiology', true, 'learn', 'Explain how the kidney concentrates urine')
    returning id into s1;
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' A1:' || sqlerrm;
  end;

  -- A2 a connected competency session with an outcome of that competency
  if comp is not null then
    begin
      insert into individual_scholar_learning_session (user_id, scope_kind, title, competency_id, connected, objective_outcome)
      values (u, 'competency', 'Fluid balance', comp, true, 'Assess fluid balance and act on the findings')
      returning id into s2;
      pass := pass + 1;
    exception when others then fail := fail + 1; failed := failed || ' A2:' || sqlerrm;
    end;
  else fail := fail + 1; failed := failed || ' A2:no-competency-on-staging';
  end if;

  -- A3 the space moves on: every allowed value
  begin
    update individual_scholar_learning_session set last_space = 'revise' where id = s1;
    update individual_scholar_learning_session set last_space = 'apply' where id = s1;
    update individual_scholar_learning_session set last_space = 'evaluate' where id = s1;
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' A3:' || sqlerrm;
  end;

  -- B refusals on the session
  begin
    update individual_scholar_learning_session set last_space = 'home' where id = s1;
    fail := fail + 1; failed := failed || ' B1:accepted-space';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_learning_session (user_id, scope_kind, title, topic, objective_outcome)
    values (u, 'topic', 'An outcome without a competency', 'renal', 'Assess fluid balance');
    fail := fail + 1; failed := failed || ' B2:outcome-without-competency';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_learning_session set objective_outcome = '   ' where id = s2;
    fail := fail + 1; failed := failed || ' B3:blank-outcome';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_learning_session set objective_outcome = repeat('x', 501) where id = s2;
    fail := fail + 1; failed := failed || ' B4:long-outcome';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_learning_session set objective_text = repeat('x', 301) where id = s1;
    fail := fail + 1; failed := failed || ' B5:long-objective';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_learning_session set objective_text = '  ' where id = s1;
    fail := fail + 1; failed := failed || ' B6:blank-objective';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_learning_session set connected = null where id = s1;
    fail := fail + 1; failed := failed || ' B7:null-connected';
  exception when not_null_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_learning_session set objective_outcome = repeat('y', 500) where id = s2;
    update individual_scholar_learning_session set objective_text = repeat('z', 300) where id = s1;
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' B8:limits-refused:' || sqlerrm;
  end;

  -- C links
  begin
    insert into individual_scholar_study_link (session_id, user_id, kind, ref_id) values
      (s1, u, 'revision_session', ref), (s1, u, 'osce_attempt', ref), (s1, u, 'flashcard_deck', gen_random_uuid()),
      (s1, u, 'case_session', gen_random_uuid()), (s1, u, 'evaluation', gen_random_uuid()), (s1, u, 'exam_paper', gen_random_uuid());
    pass := pass + 1;
  exception when others then fail := fail + 1; failed := failed || ' C1:' || sqlerrm;
  end;
  begin
    insert into individual_scholar_study_link (session_id, user_id, kind, ref_id) values (s1, u, 'revision_session', ref);
    fail := fail + 1; failed := failed || ' C2:twice';
  exception when unique_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_study_link (session_id, user_id, kind, ref_id) values (s1, u, 'quiz_attempt', gen_random_uuid());
    fail := fail + 1; failed := failed || ' C3:kind';
  exception when check_violation then pass := pass + 1;
  end;
  if other is not null then
    begin
      insert into individual_scholar_study_link (session_id, user_id, kind, ref_id) values (s1, other, 'evaluation', gen_random_uuid());
      fail := fail + 1; failed := failed || ' C4:cross-user';
    exception when foreign_key_violation then pass := pass + 1;
    end;
    begin
      insert into individual_scholar_learning_session (user_id, scope_kind, title, topic, connected) values (other, 'topic', 'Another learner', 'renal', true) returning id into s_other;
      insert into individual_scholar_study_link (session_id, user_id, kind, ref_id) values (s_other, u, 'evaluation', gen_random_uuid());
      fail := fail + 1; failed := failed || ' C5:link-into-other-session';
    exception when foreign_key_violation then pass := pass + 1;
    end;
  else fail := fail + 2; failed := failed || ' C4-C5:no-second-profile';
  end if;
  begin
    insert into individual_scholar_study_link (session_id, user_id, kind, ref_id) values (s1, u, 'evaluation', null);
    fail := fail + 1; failed := failed || ' C6:null-ref';
  exception when not_null_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_study_link (session_id, user_id, kind, ref_id) values (gen_random_uuid(), u, 'evaluation', gen_random_uuid());
    fail := fail + 1; failed := failed || ' C7:no-session';
  exception when foreign_key_violation then pass := pass + 1;
  end;

  -- D1 deleting the session removes its links, and only its links
  select count(*) into n from individual_scholar_study_link where session_id = s1;
  delete from individual_scholar_learning_session where id = s1 and user_id = u;
  if n = 6 and not exists (select 1 from individual_scholar_study_link where session_id = s1) then pass := pass + 1;
  else fail := fail + 1; failed := failed || ' D1:links-before=' || n;
  end if;

  -- D2 removing the competency clears the outcome with it, and the session stays
  begin
    select domain_id into dom from framework_competencies where domain_id is not null limit 1;
    insert into framework_competencies (domain_id, name) values (dom, 'VERIFY 740 temporary competency') returning id into tmp_comp;
    insert into individual_scholar_learning_session (user_id, scope_kind, title, competency_id, connected, objective_outcome)
    values (u, 'competency', 'Temporary', tmp_comp, true, 'An outcome of the temporary competency') returning id into s3;
    delete from framework_competencies where id = tmp_comp;
    select coalesce(competency_id::text, 'null') || '/' || coalesce(objective_outcome, 'null') into v from individual_scholar_learning_session where id = s3;
    if v = 'null/null' then pass := pass + 1; else fail := fail + 1; failed := failed || ' D2:' || coalesce(v, 'session-gone'); end if;
  exception when others then fail := fail + 1; failed := failed || ' D2:' || sqlerrm;
  end;

  -- D3 clearing the competency by hand clears the outcome too (the same trigger)
  begin
    update individual_scholar_learning_session set competency_id = null where id = s2;
    select coalesce(objective_outcome, 'null') into v from individual_scholar_learning_session where id = s2;
    if v = 'null' then pass := pass + 1; else fail := fail + 1; failed := failed || ' D3:' || v; end if;
  exception when others then fail := fail + 1; failed := failed || ' D3:' || sqlerrm;
  end;

  -- D4 an ordinary 414 session is still written exactly as Learn writes it today
  begin
    insert into individual_scholar_learning_session (user_id, scope_kind, title, topic) values (u, 'topic', 'Plain Learn', 'renal') returning id into s4;
    select connected::text || '/' || coalesce(last_space, 'null') || '/' || coalesce(objective_outcome, 'null') || '/' || coalesce(objective_text, 'null') into v
      from individual_scholar_learning_session where id = s4;
    if v = 'false/null/null/null' then pass := pass + 1; else fail := fail + 1; failed := failed || ' D4:' || v; end if;
  exception when others then fail := fail + 1; failed := failed || ' D4:' || sqlerrm;
  end;

  -- F schema posture
  if (select relrowsecurity from pg_class where oid = 'public.individual_scholar_study_link'::regclass) then pass := pass + 1;
  else fail := fail + 1; failed := failed || ' F1:no-rls'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'individual_scholar_study_link';
  if n = 1 and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'individual_scholar_study_link'
                         and cmd = 'SELECT' and qual = '(auth.uid() = user_id)') then pass := pass + 1;
  else fail := fail + 1; failed := failed || ' F2:policies=' || n; end if;
  if exists (select 1 from pg_constraint where conname = 'individual_scholar_study_link_session_fk' and confdeltype = 'c'
               and confrelid = 'public.individual_scholar_learning_session'::regclass and array_length(conkey, 1) = 2) then pass := pass + 1;
  else fail := fail + 1; failed := failed || ' F3:composite-fk'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.individual_scholar_study_link'::regclass and contype = 'f' and conname <> 'individual_scholar_study_link_session_fk') then pass := pass + 1;
  else fail := fail + 1; failed := failed || ' F4:fk-to-activity'; end if;

  raise exception 'VERIFY 740 RESULT pass=% fail=% %', pass, fail, case when failed = '' then '' else ' --' || failed end;
end;
$$;
