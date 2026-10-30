-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql block between dollar quotes.
-- ====================================================================================================
-- VERIFY 720 (staging). Behaviour checks. Every write happens inside this block, which ALWAYS ends by raising
-- an exception that carries the result line, so the runner rolls the whole transaction back and nothing is kept.
-- Expected runner output: FAILED ... rolled back, nothing changed: VERIFY 720 RESULT pass=N fail=0 ...
-- ====================================================================================================

do $$
declare
  u uuid;
  u2 uuid;
  st uuid;
  m uuid;
  pass int := 0;
  failn int := 0;
  log text := '';
  ok_list jsonb := '[{"id":"a","text":"Introduces self","critical":false},{"id":"b","text":"Gains consent","critical":true},{"id":"c","text":"Hand hygiene","critical":true},{"id":"d","text":"Counts respiratory rate","critical":true,"outcome":"o1"},{"id":"e","text":"Checks oxygen saturation","critical":false},{"id":"f","text":"Escalates per local policy","critical":true}]';
  secs jsonb := '["Introduction and consent", "Assessment", "Findings", "Escalation and plan"]';
  bad_names text[] := array['checklist of 5', 'critical not boolean', 'item without id', 'empty text', 'outcome not string', 'item not object'];
  bad_lists text[] := array[
    '[{"id":"a","text":"x","critical":true},{"id":"b","text":"x","critical":true},{"id":"c","text":"x","critical":true},{"id":"d","text":"x","critical":true},{"id":"e","text":"x","critical":true}]',
    '[{"id":"a","text":"x","critical":"yes"},{"id":"b","text":"x","critical":true},{"id":"c","text":"x","critical":true},{"id":"d","text":"x","critical":true},{"id":"e","text":"x","critical":true},{"id":"f","text":"x","critical":true}]',
    '[{"text":"x","critical":true},{"id":"b","text":"x","critical":true},{"id":"c","text":"x","critical":true},{"id":"d","text":"x","critical":true},{"id":"e","text":"x","critical":true},{"id":"f","text":"x","critical":true}]',
    '[{"id":"a","text":"","critical":true},{"id":"b","text":"x","critical":true},{"id":"c","text":"x","critical":true},{"id":"d","text":"x","critical":true},{"id":"e","text":"x","critical":true},{"id":"f","text":"x","critical":true}]',
    '[{"id":"a","text":"x","critical":true,"outcome":3},{"id":"b","text":"x","critical":true},{"id":"c","text":"x","critical":true},{"id":"d","text":"x","critical":true},{"id":"e","text":"x","critical":true},{"id":"f","text":"x","critical":true}]',
    '["a",{"id":"b","text":"x","critical":true},{"id":"c","text":"x","critical":true},{"id":"d","text":"x","critical":true},{"id":"e","text":"x","critical":true},{"id":"f","text":"x","critical":true}]'
  ];
  i int;
begin
  select id into u from profiles order by created_at limit 1;
  select id into u2 from profiles where id <> u order by created_at limit 1;

  insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, duration_minutes, sections, checklist, source, content_status)
    values (u, 'Respiratory assessment', 'A simulated adult with breathlessness.', 'Assess and escalate.', 8, secs, ok_list, 'own', 'Learner written')
    returning id into st;
  pass := pass + 1; log := log || ' A1';
  insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, template_key, content_status)
    values (u, 'T', 'S', 'I', secs, ok_list, 'template', 'respiratory-assessment', 'Competen practice template - not clinically reviewed');
  pass := pass + 1; log := log || ' A2';

  for i in 1 .. array_length(bad_lists, 1) loop
    begin
      insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
        values (u, 'T', 'S', 'I', secs, bad_lists[i]::jsonb, 'own', 'x');
      failn := failn + 1; log := log || ' FAIL(accepted ' || bad_names[i] || ')';
    exception when check_violation then pass := pass + 1;
    end;
  end loop;

  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, duration_minutes, sections, checklist, source, content_status)
      values (u, 'T', 'S', 'I', 25, secs, ok_list, 'own', 'x');
    failn := failn + 1; log := log || ' FAIL(duration 25)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status, review_status)
      values (u, 'T', 'S', 'I', secs, ok_list, 'own', 'x', 'clinically_approved');
    failn := failn + 1; log := log || ' FAIL(review status)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
      values (u, 'T', 'S', 'I', secs, ok_list, 'ai', 'x');
    failn := failn + 1; log := log || ' FAIL(ai without material or model)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
      values (u, 'T', 'S', 'I', '[]'::jsonb, ok_list, 'own', 'x');
    failn := failn + 1; log := log || ' FAIL(no sections)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
      values (u, 'T', 'S', 'I', secs, ok_list, 'template', 'x');
    failn := failn + 1; log := log || ' FAIL(template without key)';
  exception when check_violation then pass := pass + 1;
  end;

  select id into m from individual_scholar_material where user_id <> u limit 1;
  if m is not null then
    begin
      insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status, material_id, model, prompt_version)
        values (u, 'T', 'S', 'I', secs, ok_list, 'ai', 'x', m, 'claude-test', 'osce-v1');
      failn := failn + 1; log := log || ' FAIL(cross-user material)';
    exception when foreign_key_violation then pass := pass + 1; log := log || ' X1';
    end;
  else
    log := log || ' X1-skipped';
  end if;

  insert into individual_scholar_osce_attempt (user_id, station_id) values (u, st);
  pass := pass + 1; log := log || ' B1';
  insert into individual_scholar_osce_attempt (user_id, station_id, finished_at, duration_seconds, time_up, responses, ticks, score, critical_missed, marking)
    values (u, st, now() + interval '1 minute', 60, true, '{"Assessment":"RR 24"}', '[{"itemId":"a","mark":"done"},{"itemId":"b","mark":"missed"}]', 0.5, 1, 'self_graded');
  pass := pass + 1; log := log || ' B2';
  insert into individual_scholar_osce_attempt (user_id, station_id, finished_at, duration_seconds, ticks, score, critical_missed, marking, evaluator_model, evaluator_prompt_version, feedback)
    values (u, st, now() + interval '1 minute', 60, '[{"itemId":"a","mark":"partly"}]', 0.25, 0, 'ai_evaluation', 'claude-sonnet', 'osce-eval-v1', '{"strengths":"x"}');
  pass := pass + 1; log := log || ' B3';

  begin
    insert into individual_scholar_osce_attempt (user_id, station_id, ticks, score, critical_missed, marking)
      values (u, st, '[{"itemId":"a","mark":"done"}]', 1, 0, 'self_graded');
    failn := failn + 1; log := log || ' FAIL(marked before finished)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_attempt (user_id, station_id, finished_at, duration_seconds, ticks, score, critical_missed, marking)
      values (u, st, now() + interval '1 minute', 60, '[{"itemId":"a","mark":5}]', 1, 0, 'self_graded');
    failn := failn + 1; log := log || ' FAIL(mark not string)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_attempt (user_id, station_id, finished_at, duration_seconds, ticks, score, critical_missed, marking)
      values (u, st, now() + interval '1 minute', 60, '[{"itemId":"a","mark":"passed"}]', 1, 0, 'self_graded');
    failn := failn + 1; log := log || ' FAIL(mark passed)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_attempt (user_id, station_id, finished_at, duration_seconds, ticks, score, critical_missed, marking)
      values (u, st, now() + interval '1 minute', 60, '[{"itemId":"a","mark":"done"}]', 1.5, 0, 'self_graded');
    failn := failn + 1; log := log || ' FAIL(score 1.5)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_attempt (user_id, station_id, finished_at, duration_seconds, ticks, score, critical_missed, marking)
      values (u, st, now() + interval '1 minute', 60, '[{"itemId":"a","mark":"done"}]', 1, 0, 'ai_evaluation');
    failn := failn + 1; log := log || ' FAIL(ai without model)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_attempt (user_id, station_id, finished_at, duration_seconds, ticks, score, critical_missed, marking)
      values (u, st, now() + interval '1 minute', 60, '[{"itemId":"a","mark":"done"}]', 1, 0, 'verified');
    failn := failn + 1; log := log || ' FAIL(marking verified)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_attempt (user_id, station_id, finished_at, duration_seconds) values (u, st, now(), 5000);
    failn := failn + 1; log := log || ' FAIL(duration 5000)';
  exception when check_violation then pass := pass + 1;
  end;
  if u2 is not null then
    begin
      insert into individual_scholar_osce_attempt (user_id, station_id) values (u2, st);
      failn := failn + 1; log := log || ' FAIL(cross-user attempt)';
    exception when foreign_key_violation then pass := pass + 1; log := log || ' X2';
    end;
  end if;

  insert into individual_scholar_revision_set (user_id, title, mode, scope, formats, quantity)
    values (u, 'Adaptive', 'adaptive', '{}', '["mcq"]', 10);
  pass := pass + 1; log := log || ' C1';
  insert into individual_scholar_revision_session (user_id, mode, total) values (u, 'adaptive', 10);
  pass := pass + 1; log := log || ' C2';
  begin
    insert into individual_scholar_revision_session (user_id, mode, total) values (u, 'exam', 10);
    failn := failn + 1; log := log || ' FAIL(mode exam)';
  exception when check_violation then pass := pass + 1;
  end;

  delete from individual_scholar_osce_station where id = st;
  if exists (select 1 from individual_scholar_osce_attempt where station_id = st) then
    failn := failn + 1; log := log || ' FAIL(cascade)';
  else pass := pass + 1; log := log || ' D1';
  end if;

  raise exception 'VERIFY 720 RESULT pass=% fail=% :%', pass, failn, log;
end;
$$;
