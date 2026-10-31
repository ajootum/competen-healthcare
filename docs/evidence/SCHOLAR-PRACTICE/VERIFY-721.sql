-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql block between dollar quotes.
-- ====================================================================================================
-- VERIFY 721 (staging). Behaviour checks. Every write happens inside this block, which ALWAYS ends by raising
-- an exception that carries the result line, so the runner rolls the whole transaction back and nothing is kept.
-- The governed-station path (G) needs a published, approved osce_station version. Staging has none and the CKRI
-- guards need appointed HQ people, so G turns the CKRI and 395 USER triggers off INSIDE this transaction to plant
-- one (rolled back with everything else). If that is not permitted, G reports SKIP and the rest still runs.
-- Expected runner output: FAILED ... rolled back, nothing changed: VERIFY 721 RESULT pass=N fail=0 ...
-- ====================================================================================================

do $$
declare
  u uuid;
  st uuid;
  st20 uuid;
  a uuid;
  res uuid;
  ver uuid;
  draft_ver uuid;
  ccv uuid;
  pass int := 0;
  failn int := 0;
  log text := '';
  secs jsonb := '["Introduction and consent", "Assessment", "Findings", "Escalation and plan"]';
  one jsonb := '[{"id":"a","text":"Gains consent","critical":true}]';
  list20 jsonb;
  list60 jsonb;
  list61 jsonb;
  good jsonb;
  ticks20 jsonb;
begin
  select id into u from profiles order by created_at limit 1;
  select jsonb_agg(jsonb_build_object('id', 'i' || g, 'text', 'Item ' || g, 'critical', g % 3 = 0)) into list20 from generate_series(1, 20) g;
  select jsonb_agg(jsonb_build_object('id', 'i' || g, 'text', 'Item ' || g, 'critical', g % 3 = 0)) into list60 from generate_series(1, 60) g;
  select jsonb_agg(jsonb_build_object('id', 'i' || g, 'text', 'Item ' || g, 'critical', false)) into list61 from generate_series(1, 61) g;
  select jsonb_agg(jsonb_build_object('itemId', 'i' || g, 'mark', 'done')) into ticks20 from generate_series(1, 20) g;

  -- A. the checklist: 1 to 60, shape unchanged
  insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
    values (u, 'One item', 'S', 'I', secs, one, 'own', 'x');
  pass := pass + 1; log := log || ' A1';
  insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
    values (u, 'Twenty items', 'S', 'I', secs, list20, 'own', 'x') returning id into st20;
  pass := pass + 1; log := log || ' A2';
  insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
    values (u, 'Sixty items', 'S', 'I', secs, list60, 'own', 'x');
  pass := pass + 1; log := log || ' A3';
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
      values (u, 'T', 'S', 'I', secs, list61, 'own', 'x');
    failn := failn + 1; log := log || ' FAIL(61 items)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
      values (u, 'T', 'S', 'I', secs, '[]'::jsonb, 'own', 'x');
    failn := failn + 1; log := log || ' FAIL(0 items)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
      values (u, 'T', 'S', 'I', secs, '[{"id":"a","text":"x","critical":"yes"}]'::jsonb, 'own', 'x');
    failn := failn + 1; log := log || ' FAIL(critical not boolean)';
  exception when check_violation then pass := pass + 1;
  end;

  -- B. the definition fields
  insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status,
      profession, programme_code, programme_label, topic, body_system, difficulty, learning_outcomes, objectives, expected_activities, guidance, source_references, version)
    values (u, 'Defined', 'S', 'I', secs, one, 'own', 'x', 'Physiotherapy', 'BSC-PHYSIO', 'BSc Physiotherapy', 'Chest assessment', 'Respiratory', 'intermediate',
      '["Assesses breathing"]', '["Practise a systematic assessment"]', '["Introduces self", "Gains consent"]',
      '{"suggested_responses": ["I would introduce myself"], "assessment_guidance": "Look for a systematic order"}',
      '[{"kind": "notes", "materialId": null}]', 2)
    returning id into st;
  pass := pass + 1; log := log || ' B1';
  begin
    update individual_scholar_osce_station set difficulty = 'expert' where id = st;
    failn := failn + 1; log := log || ' FAIL(difficulty expert)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_osce_station set objectives = '[3]' where id = st;
    failn := failn + 1; log := log || ' FAIL(objective not text)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_osce_station set guidance = '["x"]' where id = st;
    failn := failn + 1; log := log || ' FAIL(guidance not object)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_osce_station set source_references = '["x"]' where id = st;
    failn := failn + 1; log := log || ' FAIL(reference not object)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_osce_station set version = 0 where id = st;
    failn := failn + 1; log := log || ' FAIL(version 0)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_osce_station set profession = ' ' where id = st;
    failn := failn + 1; log := log || ' FAIL(blank profession)';
  exception when check_violation then pass := pass + 1;
  end;

  -- C. source library is bound to a library version, and the status to it
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status)
      values (u, 'T', 'S', 'I', secs, one, 'library', 'x');
    failn := failn + 1; log := log || ' FAIL(library without version)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status, review_status)
      values (u, 'T', 'S', 'I', secs, one, 'own', 'x', 'library_approved');
    failn := failn + 1; log := log || ' FAIL(library_approved without version)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, sections, checklist, source, content_status, review_status, library_resource_id, library_version_id)
      values (u, 'T', 'S', 'I', secs, one, 'library', 'x', 'library_approved', gen_random_uuid(), gen_random_uuid());
    failn := failn + 1; log := log || ' FAIL(unknown library version)';
  exception when raise_exception or foreign_key_violation then pass := pass + 1;
  end;

  -- D. the attempt: status, snapshot, ticks to 60, gaps only on a marked run
  insert into individual_scholar_osce_attempt (user_id, station_id, station_version, station_snapshot, last_saved_at, responses)
    values (u, st20, 1, jsonb_build_object('version', 1, 'checklist', list20), now(), '{"Assessment": "autosaved"}')
    returning id into a;
  if (select status from individual_scholar_osce_attempt where id = a) = 'in_progress' then pass := pass + 1; log := log || ' D1'; else failn := failn + 1; log := log || ' FAIL(default status)'; end if;
  begin
    update individual_scholar_osce_attempt set finished_at = now(), duration_seconds = 10 where id = a;
    failn := failn + 1; log := log || ' FAIL(finished without status)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_osce_attempt set status = 'paused' where id = a;
    failn := failn + 1; log := log || ' FAIL(status paused)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_osce_attempt set station_snapshot = '[]' where id = a;
    failn := failn + 1; log := log || ' FAIL(snapshot array)';
  exception when check_violation then pass := pass + 1;
  end;
  begin
    update individual_scholar_osce_attempt set gaps = '[]' where id = a;
    failn := failn + 1; log := log || ' FAIL(gaps without ticks)';
  exception when check_violation then pass := pass + 1;
  end;
  update individual_scholar_osce_attempt set status = 'finished', finished_at = now(), duration_seconds = 10 where id = a;
  pass := pass + 1; log := log || ' D2';
  update individual_scholar_osce_attempt set ticks = ticks20, score = 1, critical_missed = 0, marking = 'self_graded',
      gaps = '[]', revision_suggestions = '[{"label": "Go to Revise", "segment": "revise", "query": {}}]' where id = a;
  pass := pass + 1; log := log || ' D3';
  insert into individual_scholar_osce_attempt (user_id, station_id, status) values (u, st20, 'abandoned');
  pass := pass + 1; log := log || ' D4';

  -- E. the 442 content shape: the three kinds unchanged, osce_station added
  good := '{"scenario": "A simulated person needs an assessment from you.", "candidate_instructions": "Assess and say what you would do next.", "duration_minutes": 8, "checklist": [{"id": "a", "text": "Gains consent", "critical": true}, {"id": "b", "text": "Explains the plan", "critical": false, "outcome": "Explains"}], "sections": ["Assessment"], "objectives": ["Practise"], "expected_activities": ["Introduces self"], "guidance": {"assessment_guidance": "Systematic order"}, "references": [{"label": "Course handbook"}], "difficulty": "introductory", "profession": "Midwifery", "topic": "Postnatal check", "body_system": "Reproductive"}';
  if ckri_knowledge_content_ok('osce_station', good) then pass := pass + 1; log := log || ' E1'; else failn := failn + 1; log := log || ' FAIL(good station content)'; end if;
  if ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{checklist}', list60)) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(60 item content)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{checklist}', list61)) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(61 item content)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{duration_minutes}', '8.5')) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(duration 8.5)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{duration_minutes}', '"8"')) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(duration text)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{duration_minutes}', '25')) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(duration 25)'; end if;
  if not ckri_knowledge_content_ok('osce_station', good - 'scenario') then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(no scenario)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{checklist}', '[{"id":"a","text":"x","critical":"yes"}]')) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(item shape)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{sections}', '[]')) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(no sections)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{difficulty}', '"expert"')) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(difficulty)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{guidance}', '"text"')) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(guidance text)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{objectives}', '"text"')) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(objectives text)'; end if;
  if not ckri_knowledge_content_ok('osce_station', jsonb_set(good, '{checklist}', '"text"')) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(checklist text)'; end if;
  if ckri_knowledge_content_ok('revision_question', '{"stem": "Which of these is a question stem?", "options": ["a", "b", "c", "d"], "correct_index": 1, "rationale": "Because it is the rationale."}') then pass := pass + 1; log := log || ' E2'; else failn := failn + 1; log := log || ' FAIL(revision question)'; end if;
  if ckri_knowledge_content_ok('explanation', '{"body": "An explanation long enough to be one."}') then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(explanation)'; end if;
  if not ckri_knowledge_content_ok('unknown_kind', good) then pass := pass + 1; else failn := failn + 1; log := log || ' FAIL(unknown kind)'; end if;

  -- F. the kind CHECK
  begin
    insert into ckri_knowledge_resource (code, kind, title, created_by) values ('verify-721-bad', 'osce_exam', 'Bad kind', u);
    failn := failn + 1; log := log || ' FAIL(kind osce_exam)';
  exception when check_violation or raise_exception then pass := pass + 1;
  end;

  -- G. a governed station: copy exactly a published, approved version, or be refused
  begin
    alter table ckri_knowledge_resource disable trigger user;
    alter table ckri_knowledge_version disable trigger user;
    alter table clinical_content_version disable trigger user;
    alter table clinical_review_decision disable trigger user;
    insert into ckri_knowledge_resource (code, kind, title, created_by) values ('verify-721-station', 'osce_station', 'Postnatal check practice station', u) returning id into res;
    insert into ckri_knowledge_version (resource_id, version_no, content, content_hash, origin, authored_by, state, educator_reviewed_by, educator_reviewed_hash, educator_reviewed_at, submitted_by, submitted_at, published_by, published_at)
      values (res, 1, good, 'h721', 'educator', array[u], 'published', u, 'h721', now(), u, now(), u, now()) returning id into ver;
    insert into ckri_knowledge_version (resource_id, version_no, content, content_hash, origin, authored_by, state)
      values (res, 2, good, 'h721b', 'educator', array[u], 'draft') returning id into draft_ver;
    insert into clinical_content_version (content_kind, knowledge_version_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals)
      values ('resource', ver, 'h721', '{}', array[u], u, 1) returning id into ccv;
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (ccv, gen_random_uuid(), gen_random_uuid(), 'approved');
    alter table ckri_knowledge_resource enable trigger user;
    alter table ckri_knowledge_version enable trigger user;
    alter table clinical_content_version enable trigger user;
    alter table clinical_review_decision enable trigger user;

    insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, duration_minutes, sections, checklist, expected_activities, guidance,
        source, content_status, review_status, library_resource_id, library_version_id, version)
      values (u, 'Postnatal check practice station', good ->> 'scenario', good ->> 'candidate_instructions', 8, good -> 'sections', good -> 'checklist', good -> 'expected_activities', good -> 'guidance',
        'library', 'Clinically approved Competen station, version 1', 'library_approved', res, ver, 1);
    pass := pass + 1; log := log || ' G1';
    begin
      insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, duration_minutes, sections, checklist, expected_activities, guidance,
          source, content_status, review_status, library_resource_id, library_version_id, version)
        values (u, 'Edited', good ->> 'scenario', good ->> 'candidate_instructions', 8, good -> 'sections', one, good -> 'expected_activities', good -> 'guidance',
          'library', 'x', 'library_approved', res, ver, 1);
      failn := failn + 1; log := log || ' FAIL(edited checklist copy)';
    exception when raise_exception then pass := pass + 1;
    end;
    begin
      insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, duration_minutes, sections, checklist, expected_activities, guidance,
          source, content_status, review_status, library_resource_id, library_version_id, version)
        values (u, 'Draft', good ->> 'scenario', good ->> 'candidate_instructions', 8, good -> 'sections', good -> 'checklist', good -> 'expected_activities', good -> 'guidance',
          'library', 'x', 'library_approved', res, draft_ver, 2);
      failn := failn + 1; log := log || ' FAIL(draft copy)';
    exception when raise_exception then pass := pass + 1;
    end;
    begin
      update individual_scholar_osce_station set guidance = '{"assessment_guidance": "changed"}' where library_version_id = ver;
      failn := failn + 1; log := log || ' FAIL(guidance edited after copy)';
    exception when raise_exception then pass := pass + 1;
    end;
    alter table clinical_review_decision disable trigger user;
    delete from clinical_review_decision where version_id = ccv;
    alter table clinical_review_decision enable trigger user;
    begin
      insert into individual_scholar_osce_station (user_id, title, scenario, candidate_instructions, duration_minutes, sections, checklist, expected_activities, guidance,
          source, content_status, review_status, library_resource_id, library_version_id, version)
        values ((select id from profiles where id <> u order by created_at limit 1), 'Unapproved', good ->> 'scenario', good ->> 'candidate_instructions', 8, good -> 'sections', good -> 'checklist', good -> 'expected_activities', good -> 'guidance',
          'library', 'x', 'library_approved', res, ver, 1);
      failn := failn + 1; log := log || ' FAIL(unapproved copy)';
    exception when raise_exception or not_null_violation then pass := pass + 1; log := log || ' G5';
    end;
  exception when insufficient_privilege then log := log || ' G:SKIP(' || sqlerrm || ')';
  end;

  raise exception 'VERIFY 721 RESULT pass=% fail=% :%', pass, failn, log;
end;
$$;
