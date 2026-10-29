-- ====================================================================================================
-- APPLY THIS FILE WHOLE. PROBE-690: the migration 690 rules exercised end to end on STAGING, inside ONE transaction
-- that ALWAYS ROLLS BACK. It appoints synthetic staging profiles, builds a method from a competency, reviews,
-- publishes, requests, drafts, decides and confirms, and checks every refusal. It ends by raising its own results as
-- an exception, so nothing it did is ever committed. STAGING ONLY.
-- ====================================================================================================

do $probe$
declare
  -- Synthetic staging profiles (labelled *.staging.competen.invalid).
  p_author uuid := '6a59fe42-a9aa-4723-8dfd-a16b74626ac7';
  p_publisher uuid := '667cf735-faf6-4010-93a0-589e8c753467';
  p_reviewer uuid := '89572381-0509-4fd6-b7d7-9188e5b9df01';
  p_lead uuid := '981d5cb1-166e-4b90-afc8-192219f298e7';
  p_owner uuid := '804ee8e5-ad1f-4e89-a8f0-9d087fcda1dc';
  p_person uuid := 'e91abf3c-9590-4247-b9eb-0c787a18ab07';
  p_a1 uuid := 'f55a16ba-f867-4db4-a5c1-c0f8a5182458';
  p_a2 uuid := '68d0c979-b997-443a-8d6b-a4222f6d8b7f';
  v_office uuid := '60f0fc0c-5288-4ae3-a1b2-a3a12291311e';
  v_scale uuid := '8bde00ab-62ca-46cf-b073-2d22b7e373eb';
  v_fw uuid := '158a7293-6da7-4049-b045-c6ca8e0fe134';
  v_comp uuid := 'ed4f335f-e565-4379-a483-83d02ecd51e7';
  ap_author uuid; ap_pub uuid; ap_rev uuid; ap_lead uuid; ap_a1 uuid; ap_a2 uuid;
  k1 uuid; k2 uuid;
  v_method uuid; v_ver uuid; v_ccv uuid; v_req uuid; v_dec uuid; v_lvl uuid; v_content jsonb;
  v_state text; v_msg text; v_n int; v_row record;
  r text := '';
  procedure_ok boolean;
begin
  -- Appointments, the way HQ makes them (the guards on ogs_office_appointments still run).
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at) values (v_office, p_author, 'PROBE author', 'competency_verification_administrator', 'active', current_date, p_owner, now()) returning id into ap_author;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at) values (v_office, p_publisher, 'PROBE publisher', 'competency_verification_administrator', 'active', current_date, p_owner, now()) returning id into ap_pub;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at) values (v_office, p_reviewer, 'PROBE reviewer', 'clinical_content_reviewer', 'active', current_date, p_owner, now()) returning id into ap_rev;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at) values (v_office, p_lead, 'PROBE lead', 'competency_programme_lead', 'active', current_date, p_owner, now()) returning id into ap_lead;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at) values (v_office, p_a1, 'PROBE assessor 1', 'competency_assessor', 'active', current_date, p_owner, now()) returning id into ap_a1;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at) values (v_office, p_a2, 'PROBE assessor 2', 'competency_assessor', 'active', current_date, p_owner, now()) returning id into ap_a2;
  insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values (ap_rev, 'framework', v_fw, p_owner);
  insert into competency_assessor_scope (appointment_id, scope_kind, scope_ref, granted_by, grant_reason) values (ap_a1, 'framework', v_fw, p_publisher, 'PROBE-690 scope');
  insert into competency_assessor_scope (appointment_id, scope_kind, scope_ref, granted_by, grant_reason) values (ap_a2, 'framework', v_fw, p_publisher, 'PROBE-690 scope');
  r := r || 'setup=ok; ';

  -- Two approved-style criteria on the competency (670 columns).
  insert into competency_skills (competency_id, name, sort_order, component_code, source_ref) values (v_comp, 'PROBE performs the observation correctly', 1, 'clinical_skills', 'PROBE!A1') returning id into k1;
  insert into competency_skills (competency_id, name, sort_order, component_code, source_ref) values (v_comp, 'PROBE explains the normal range', 2, 'knowledge', 'PROBE!A2') returning id into k2;
  select l.id into v_lvl from scoring_levels l where l.scale_id = v_scale and l.score = 4;

  -- A method draft made from the criteria, pinned, with a safety-critical component and the second assessor.
  insert into competency_verification_method (code, name, kind, created_by) values ('probe_690_method', 'PROBE 690 method', 'structured_assessment', p_author) returning id into v_method;
  insert into competency_verification_method_version (method_id, authored_by) values (v_method, p_author) returning id into v_ver;
  v_content := jsonb_build_object(
    'summary', 'PROBE assessment of the competency against its criteria.',
    'applicability', jsonb_build_object('competencyIds', jsonb_build_array(v_comp), 'frameworkIds', '[]'::jsonb, 'contexts', jsonb_build_array('independent')),
    'scaleId', v_scale, 'levelIds', '[]'::jsonb,
    'outcomes', jsonb_build_array(jsonb_build_object('code', 'verified', 'class', 'verified', 'label', 'Verified at the level stated'),
                                  jsonb_build_object('code', 'not_demonstrated', 'class', 'not_demonstrated', 'label', 'Not demonstrated in this assessment')),
    'criteria', jsonb_build_array(
      jsonb_build_object('id', k1::text, 'criterionId', k1::text, 'text', 'PROBE performs the observation correctly', 'required', true, 'component', 'clinical_skills', 'sourceRef', 'PROBE!A1'),
      jsonb_build_object('id', k2::text, 'criterionId', k2::text, 'text', 'PROBE explains the normal range', 'required', true, 'component', 'knowledge', 'sourceRef', 'PROBE!A2')),
    'checklist', '[]'::jsonb,
    'components', jsonb_build_array(jsonb_build_object('code', 'clinical_skills', 'passLevelId', v_lvl, 'mandatory', true, 'safetyCritical', true),
                                    jsonb_build_object('code', 'knowledge', 'passLevelId', v_lvl, 'mandatory', true, 'safetyCritical', false)),
    'minEvidence', 0, 'workflow', jsonb_build_object('assignment', 'administrator', 'allowFurtherEvidence', true, 'secondAssessor', true));
  update competency_verification_method_version set content = v_content, last_edited_by = p_author where id = v_ver;

  -- P1. Publishing before clinical review is refused (690), by an independent publisher.
  begin
    update competency_verification_method_version set state = 'published', published_by = p_publisher where id = v_ver;
    r := r || 'P1=FAIL(published unreviewed); ';
  exception when others then r := r || case when sqlerrm like '%not clinically approved%' then 'P1=ok; ' else 'P1=FAIL(' || sqlerrm || '); ' end;
  end;

  -- P2. Only the author or an editor puts it forward.
  begin
    perform competency_method_submit_review(v_ver, p_publisher);
    r := r || 'P2=FAIL; ';
  exception when others then r := r || case when sqlerrm like '%only the author or an editor%' then 'P2=ok; ' else 'P2=FAIL(' || sqlerrm || '); ' end;
  end;
  v_ccv := competency_method_submit_review(v_ver, p_author);
  select required_approvals into v_n from clinical_content_version where id = v_ccv;
  r := r || 'P3 submitted required=' || v_n || '; ';

  -- P4. The author can never review it, even with an approver appointment (independence).
  begin
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v_ccv, p_author, ap_author, 'approved');
    r := r || 'P4=FAIL; ';
  exception when others then r := r || case when sqlerrm like '%not independent%' or sqlerrm like '%not authorised%' then 'P4=ok; ' else 'P4=FAIL(' || sqlerrm || '); ' end;
  end;

  -- P5. A drifted criterion is refused for review (pinning).
  begin
    update competency_skills set name = 'PROBE performs the observation (changed)' where id = k1;
    perform competency_method_criteria_problem(v_content);
    if competency_method_criteria_problem(v_content) is null then r := r || 'P5=FAIL; '; else r := r || 'P5=ok; '; end if;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := r || 'P5=FAIL(' || sqlerrm || '); '; end if;
  end;

  -- P6. The independent reviewer approves (as many as required), then an independent administrator publishes.
  for i in 1..v_n loop
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v_ccv, p_reviewer, ap_rev, 'approved');
    exit;
  end loop;
  if v_n > 1 then r := r || 'P6=SKIP(needs ' || v_n || ' approvals); '; end if;
  begin
    update competency_verification_method_version set state = 'published', published_by = p_author where id = v_ver;
    r := r || 'P6a=FAIL(author published); ';
  exception when others then r := r || case when sqlerrm like '%not independent%' then 'P6a=ok; ' else 'P6a=FAIL(' || sqlerrm || '); ' end;
  end;
  update competency_verification_method_version set state = 'published', published_by = p_publisher where id = v_ver;
  r := r || 'P6=ok approved ' || competency_method_clinically_approved(v_ver, (select content_hash from competency_verification_method_version where id = v_ver))::text || '; ';

  -- P7. A request for somebody else needs the request capability. The lead has it, an assessor does not.
  begin
    insert into competency_verification_request (user_id, competency_id, method_version_id, requested_by) values (p_person, v_comp, v_ver, p_a2);
    r := r || 'P7a=FAIL; ';
  exception when others then r := r || case when sqlerrm like '%not authorised%' then 'P7a=ok; ' else 'P7a=FAIL(' || sqlerrm || '); ' end;
  end;
  insert into competency_verification_request (user_id, competency_id, method_version_id, requested_by, target_level_id) values (p_person, v_comp, v_ver, p_lead, v_lvl) returning id into v_req;
  r := r || 'P7=ok; ';

  -- P8. Assignment, then only the assigned assessor keeps a draft.
  insert into competency_verification_event (request_id, user_id, event, actor_id, assessor_id, appointment_id) values (v_req, p_person, 'assigned', p_publisher, p_a1, ap_a1);
  begin
    insert into competency_verification_decision_draft (request_id, assessor_id, appointment_id, content) values (v_req, p_a2, ap_a2, '{}');
    r := r || 'P8a=FAIL; ';
  exception when others then r := r || case when sqlerrm like '%not the assigned assessor%' then 'P8a=ok; ' else 'P8a=FAIL(' || sqlerrm || '); ' end;
  end;
  insert into competency_verification_decision_draft (request_id, assessor_id, appointment_id, content) values (v_req, p_a1, ap_a1, '{"rationale":"half written"}');
  update competency_verification_decision_draft set content = '{"rationale":"more written"}' where request_id = v_req and assessor_id = p_a1;
  r := r || 'P8=ok; ';

  -- P9. The verified decision: awaiting confirmation, stage stated, drafts cleared.
  insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, level_id, rationale, criteria_results, component_results)
  values (v_req, p_person, p_a1, ap_a1, v_ver, 'verified', v_lvl, 'PROBE observed and questioned, all criteria met.',
    jsonb_build_array(jsonb_build_object('id', k1::text, 'result', 'met'), jsonb_build_object('id', k2::text, 'result', 'met')),
    jsonb_build_array(jsonb_build_object('code', 'clinical_skills', 'levelId', v_lvl), jsonb_build_object('code', 'knowledge', 'levelId', v_lvl)))
  returning id into v_dec;
  select confirmation_required, stage_code, stage_mapping_version into v_row from competency_verification_decision where id = v_dec;
  v_state := competency_verification_state(v_req);
  select count(*) into v_n from competency_verification_decision_draft where request_id = v_req;
  r := r || 'P9 state=' || v_state || ' confirm=' || v_row.confirmation_required::text || ' stage=' || coalesce(v_row.stage_code, 'none') || ' v' || coalesce(v_row.stage_mapping_version::text, '-') || ' drafts=' || v_n || '; ';

  -- P10. The first assessor and the person cannot confirm. The second can.
  begin
    insert into competency_verification_confirmation (decision_id, request_id, user_id, assessor_id, appointment_id, result, rationale) values (v_dec, v_req, p_person, p_a1, ap_a1, 'confirmed', 'I agree with myself entirely.');
    r := r || 'P10a=FAIL; ';
  exception when others then r := r || case when sqlerrm like '%not independent%' then 'P10a=ok; ' else 'P10a=FAIL(' || sqlerrm || '); ' end;
  end;
  insert into competency_verification_confirmation (decision_id, request_id, user_id, assessor_id, appointment_id, result, rationale) values (v_dec, v_req, p_person, p_a2, ap_a2, 'confirmed', 'PROBE second assessor reviewed the record and agrees.');
  r := r || 'P10 state=' || competency_verification_state(v_req) || '; ';

  -- P11. Confirmations and decisions stay history.
  begin
    update competency_verification_confirmation set result = 'not_confirmed' where decision_id = v_dec;
    r := r || 'P11=FAIL; ';
  exception when others then r := r || case when sqlerrm like '%append-only%' then 'P11=ok; ' else 'P11=FAIL(' || sqlerrm || '); ' end;
  end;

  raise exception 'PROBE-690 RESULTS (rolled back): %', r;
end
$probe$;
