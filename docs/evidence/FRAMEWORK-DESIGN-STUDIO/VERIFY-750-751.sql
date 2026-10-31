-- ====================================================================================================
-- APPLY THIS FILE WHOLE. VERIFY-750-751: the 750 and 751 rules exercised on STAGING inside ONE transaction that
-- ALWAYS ROLLS BACK. It ends by raising its own results as an exception, so nothing it did is ever committed.
-- Synthetic staging profiles and office as in PROBE-690. STAGING ONLY.
-- ====================================================================================================

do $probe$
declare
  p_author uuid := '6a59fe42-a9aa-4723-8dfd-a16b74626ac7';
  p_publisher uuid := '667cf735-faf6-4010-93a0-589e8c753467';
  p_reviewer uuid := '89572381-0509-4fd6-b7d7-9188e5b9df01';
  p_owner uuid := '804ee8e5-ad1f-4e89-a8f0-9d087fcda1dc';
  v_office uuid := '60f0fc0c-5288-4ae3-a1b2-a3a12291311e';
  v_fw158 uuid := '158a7293-6da7-4049-b045-c6ca8e0fe134';
  v_comp158 uuid := 'ed4f335f-e565-4379-a483-83d02ecd51e7';
  v_comp uuid := 'aced295d-5d77-4f67-8fb6-b346d80fb289';
  v_user uuid := 'df8503a0-7886-4a3f-a865-71c4f330ec55';
  v_mv uuid := 'd86827b2-dbc3-42a4-872c-037b30550a9b';
  v_cpd uuid := '512722cc-49ec-47d9-b0be-d9db850d13e3';
  v_old_evid uuid := 'fa54f2e9-f04c-4b2a-a40c-26a2b8cb7040';
  v_old_req uuid := '3c80b70c-1f8c-4956-be01-7f92c288ce1c';
  v_fwx uuid := 'e8e1a08d-b3b2-487e-a6d7-4fd743a62989';
  nil uuid := '00000000-0000-0000-0000-000000000000';
  t jsonb; i0 jsonb; i1 jsonb; h0 text; h1 text;
  v_req uuid; v_ids uuid[]; v_eids uuid[]; v_text text; v_text2 text;
  v_d1 uuid; v_d2 uuid; v_c1 uuid; v_c2 uuid; v_s1 uuid; v_s2 uuid; v_dom_other uuid;
  v_new uuid; ap_rev uuid; v_ccv uuid; v_at timestamptz;
  r text := '';
begin
  -- ===== 751 A. outcome ids on the competency =====
  select learning_outcomes, learning_outcome_ids into t, i0 from framework_competencies where id = v_comp;
  h0 := competency_content_hash(v_comp);

  -- A1 reorder [0,1,2] to [2,0,1]: ids move with their text.
  update framework_competencies set learning_outcomes = jsonb_build_array(t -> 2, t -> 0, t -> 1) where id = v_comp;
  select learning_outcome_ids into i1 from framework_competencies where id = v_comp;
  r := r || 'A1 reorder=' || case when i1 = jsonb_build_array(i0 -> 2, i0 -> 0, i0 -> 1) then 'ok' else 'FAIL ' || i1::text end || '; ';
  -- A2 reorder is still a clinical change (outcome order is in the hash).
  h1 := competency_content_hash(v_comp);
  r := r || 'A2 hash_changed=' || case when h1 <> h0 then 'ok' else 'FAIL' end || '; ';
  -- A3 edit the text of one outcome: only that one gets a new id.
  update framework_competencies set learning_outcomes = jsonb_build_array(t -> 2, to_jsonb('PROBE edited outcome'::text), t -> 1) where id = v_comp;
  select learning_outcome_ids into i1 from framework_competencies where id = v_comp;
  r := r || 'A3 edit=' || case when i1 -> 0 = i0 -> 2 and i1 -> 2 = i0 -> 1 and i1 -> 1 <> i0 -> 0 and i1 -> 1 <> i0 -> 1 and i1 -> 1 <> i0 -> 2 then 'ok' else 'FAIL ' || i1::text end || '; ';
  -- A4 restore the original order and wording: the reordered ones keep their ids, the edited one is new again.
  update framework_competencies set learning_outcomes = t where id = v_comp;
  select learning_outcome_ids into i1 from framework_competencies where id = v_comp;
  r := r || 'A4 restore=' || case when i1 -> 1 = i0 -> 1 and i1 -> 2 = i0 -> 2 and i1 -> 0 <> i0 -> 0 then 'ok' else 'FAIL' end || '; ';
  update framework_competencies set learning_outcomes = t where id = v_comp;
  -- A5 writing the ids alone is refused.
  begin
    update framework_competencies set learning_outcome_ids = jsonb_build_array(i0 -> 1, i0 -> 0, i0 -> 2) where id = v_comp;
    r := r || 'A5=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%kept by the database%' then 'A5=ok; ' else 'A5=FAIL(' || sqlerrm || '); ' end;
  end;
  -- A6 a new competency with duplicate outcomes: distinct ids, matched in order on reorder.
  insert into framework_competencies (domain_id, name, learning_outcomes)
  select domain_id, 'PROBE 751 competency', '["A", "A", "B"]'::jsonb from framework_competencies where id = v_comp
  returning id into v_new;
  select learning_outcome_ids into i0 from framework_competencies where id = v_new;
  update framework_competencies set learning_outcomes = '["B", "A", "A"]'::jsonb where id = v_new;
  select learning_outcome_ids into i1 from framework_competencies where id = v_new;
  r := r || 'A6 dup=' || case when jsonb_array_length(i0) = 3 and competency_outcome_ids_valid(i0, '["A","A","B"]'::jsonb)
                               and i1 = jsonb_build_array(i0 -> 2, i0 -> 0, i0 -> 1) then 'ok' else 'FAIL ' || i0::text || ' ' || i1::text end || '; ';

  -- ===== 751 B. evidence keeps its outcome ids =====
  select learning_outcome_ids into i0 from framework_competencies where id = v_comp;
  -- B1 a request through the real submit path, naming outcomes 1 and 2, with evidence naming outcome 2.
  begin
    v_req := competency_verification_submit(v_user, v_comp, v_mv, array[1, 2], null, 'independent', 'PROBE 751', null,
               jsonb_build_array(jsonb_build_object('kind', 'cpd', 'id', v_cpd, 'outcomeIndexes', jsonb_build_array(2))));
    select outcome_ids into v_ids from competency_verification_request where id = v_req;
    select outcome_ids into v_eids from competency_verification_evidence where request_id = v_req;
    r := r || 'B1 submit=' || case when v_ids = array[(i0 ->> 1)::uuid, (i0 ->> 2)::uuid] and v_eids = array[(i0 ->> 2)::uuid] then 'ok' else 'FAIL ' || v_ids::text || ' ' || v_eids::text end || '; ';
  exception when others then r := r || 'B1=FAIL(' || sqlerrm || '); ';
  end;
  select m ->> 'text' into v_text from competency_verification_request q, jsonb_array_elements(q.outcome_map) m where q.id = v_req and (m ->> 'id')::uuid = v_eids[1];
  -- B2 reorder and edit the live competency: the stored ids do not move and still resolve to the same words.
  update framework_competencies set learning_outcomes = jsonb_build_array(to_jsonb('PROBE replaced'::text), t -> 2, t -> 0) where id = v_comp;
  select m ->> 'text' into v_text2 from competency_verification_request q, jsonb_array_elements(q.outcome_map) m where q.id = v_req
     and (m ->> 'id')::uuid = (select outcome_ids[1] from competency_verification_evidence where request_id = v_req);
  r := r || 'B2 evidence_after_reorder=' || case when v_text2 = v_text and v_text = t ->> 2
       and (select outcome_ids from competency_verification_evidence where request_id = v_req) = v_eids
       and (select outcome_ids from competency_verification_request where id = v_req) = v_ids then 'ok' else 'FAIL' end || '; ';
  -- B3 the live competency still carries that id, now at its new position.
  r := r || 'B3 live_id_moved=' || case when (select learning_outcome_ids ->> 1 from framework_competencies where id = v_comp)::uuid = v_eids[1] then 'ok' else 'FAIL' end || '; ';
  -- B4 the backfilled pre-751 evidence still resolves to its original words after the reorder.
  r := r || 'B4 backfilled=' || case when (select m ->> 'text' from competency_verification_request q, jsonb_array_elements(q.outcome_map) m
       where q.id = v_old_req and (m ->> 'id')::uuid = (select outcome_ids[1] from competency_verification_evidence where id = v_old_evid)) = t ->> 0 then 'ok' else 'FAIL' end || '; ';
  update framework_competencies set learning_outcomes = t where id = v_comp;
  -- B5 evidence whose ids do not match its indexes is refused.
  begin
    insert into competency_verification_evidence (request_id, user_id, kind, cpd_id, outcome_indexes, outcome_ids)
    values (v_req, v_user, 'cpd', v_cpd, array[0], array[gen_random_uuid()]);
    r := r || 'B5=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%do not match%' then 'B5=ok; ' else 'B5=FAIL(' || sqlerrm || '); ' end;
  end;
  -- B6 evidence naming an outcome outside the request map is refused.
  begin
    insert into competency_verification_evidence (request_id, user_id, kind, cpd_id, outcome_indexes) values (v_req, v_user, 'cpd', v_cpd, array[7]);
    r := r || 'B6=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%not one of this competency%' then 'B6=ok; ' else 'B6=FAIL(' || sqlerrm || '); ' end;
  end;
  -- B7 evidence with matching ids is accepted (the id-first write slice B will use), -1 maps to the nil uuid.
  begin
    insert into competency_verification_evidence (request_id, user_id, kind, cpd_id, outcome_indexes, outcome_ids)
    values (v_req, v_user, 'cpd', v_cpd, array[-1, 0], array[nil, (i0 ->> 0)::uuid]);
    r := r || 'B7=ok; ';
  exception when others then r := r || 'B7=FAIL(' || sqlerrm || '); ';
  end;
  -- B8 a request whose ids do not match its indexes is refused.
  begin
    insert into competency_verification_request (user_id, competency_id, method_version_id, outcome_indexes, outcome_ids, context)
    values (v_user, v_comp, v_mv, array[0], array[(i0 ->> 1)::uuid], 'independent');
    r := r || 'B8=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%do not match%' then 'B8=ok; ' else 'B8=FAIL(' || sqlerrm || '); ' end;
  end;

  -- ===== 750. layout draft =====
  select d.id into v_d1 from framework_domains d where d.framework_id = v_fwx and exists (select 1 from framework_competencies c where c.domain_id = d.id) order by d.sort_order, d.id limit 1;
  select d.id into v_d2 from framework_domains d where d.framework_id = v_fwx and d.id <> v_d1 and exists (select 1 from framework_competencies c where c.domain_id = d.id) order by d.sort_order, d.id limit 1;
  select c.id into v_c1 from framework_competencies c where c.domain_id = v_d1 and exists (select 1 from competency_skills s where s.competency_id = c.id) order by c.sort_order, c.id limit 1;
  select c.id into v_c2 from framework_competencies c join framework_domains d on d.id = c.domain_id
   where d.framework_id = v_fwx and c.id <> v_c1 and exists (select 1 from competency_skills s where s.competency_id = c.id) order by c.sort_order, c.id limit 1;
  select s.id into v_s1 from competency_skills s where s.competency_id = v_c1 order by s.sort_order, s.id limit 1;
  select s.id into v_s2 from competency_skills s where s.competency_id = v_c2 order by s.sort_order, s.id limit 1;
  select d.id into v_dom_other from framework_domains d where d.framework_id <> v_fwx limit 1;

  -- L1 a valid draft is accepted and stamped.
  begin
    update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1,
      'domains', jsonb_build_array(v_d2, v_d1),
      'competencies', jsonb_build_object(v_d1::text, jsonb_build_array(v_c1)),
      'criteria', jsonb_build_object(v_c1::text, jsonb_build_array(v_s1)),
      'componentOrder', '["knowledge", "clinical_skills"]'::jsonb) where id = v_fwx;
    select layout_draft_at into v_at from frameworks where id = v_fwx;
    r := r || 'L1 valid=' || case when v_at is not null then 'ok' else 'FAIL' end || '; ';
  exception when others then r := r || 'L1=FAIL(' || sqlerrm || '); ';
  end;
  -- L2 clearing it clears its author and time.
  update frameworks set layout_draft = null where id = v_fwx;
  r := r || 'L2 clear=' || case when (select layout_draft_by is null and layout_draft_at is null from frameworks where id = v_fwx) then 'ok' else 'FAIL' end || '; ';
  -- L3 to L10 refusals.
  begin update frameworks set layout_draft = '{"v": 1}'::jsonb where id = v_fwx; r := r || 'L3=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%records who saved it%' then 'L3 no_author=ok; ' else 'L3=FAIL(' || sqlerrm || '); ' end; end;
  begin update frameworks set layout_draft_by = p_author, layout_draft = '[]'::jsonb where id = v_fwx; r := r || 'L4=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%not a version 1 layout%' then 'L4 not_object=ok; ' else 'L4=FAIL(' || sqlerrm || '); ' end; end;
  begin update frameworks set layout_draft_by = p_author, layout_draft = '{"v": 1, "order": []}'::jsonb where id = v_fwx; r := r || 'L5=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%not a version 1 layout%' then 'L5 unknown_key=ok; ' else 'L5=FAIL(' || sqlerrm || '); ' end; end;
  begin update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1, 'domains', jsonb_build_array(v_dom_other)) where id = v_fwx; r := r || 'L6=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%not one of this framework%' then 'L6 foreign_domain=ok; ' else 'L6=FAIL(' || sqlerrm || '); ' end; end;
  begin update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1, 'competencies', jsonb_build_object(v_d2::text, jsonb_build_array(v_c1))) where id = v_fwx; r := r || 'L7=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%not in that domain%' then 'L7 cross_domain=ok; ' else 'L7=FAIL(' || sqlerrm || '); ' end; end;
  begin update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1, 'criteria', jsonb_build_object(v_c1::text, jsonb_build_array(v_s2))) where id = v_fwx; r := r || 'L8=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%not of that competency%' then 'L8 cross_competency=ok; ' else 'L8=FAIL(' || sqlerrm || '); ' end; end;
  begin update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1, 'domains', jsonb_build_array(v_d1, v_d1)) where id = v_fwx; r := r || 'L9=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%repeated%' then 'L9 repeat=ok; ' else 'L9=FAIL(' || sqlerrm || '); ' end; end;
  begin update frameworks set layout_draft_by = p_author, layout_draft = '{"v": 1, "componentOrder": ["no_such_component"]}'::jsonb where id = v_fwx; r := r || 'L10=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%component registry%' then 'L10 bad_section=ok; ' else 'L10=FAIL(' || sqlerrm || '); ' end; end;
  -- L11 component_order: valid accepted, repeat refused.
  begin
    update frameworks set component_order = array['knowledge_application', 'knowledge', 'clinical_skills'] where id = v_fwx;
    r := r || 'L11 order=ok; ';
  exception when others then r := r || 'L11=FAIL(' || sqlerrm || '); ';
  end;
  begin update frameworks set component_order = array['knowledge', 'knowledge'] where id = v_fwx; r := r || 'L12=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%named twice%' then 'L12 order_repeat=ok; ' else 'L12=FAIL(' || sqlerrm || '); ' end; end;
  -- L13 the size cap and the object CHECK hold even without the trigger (trigger paused inside this probe only).
  alter table frameworks disable trigger frameworks_layout_guard;
  begin
    update frameworks set layout_draft_by = p_author, layout_draft_at = now(),
      layout_draft = jsonb_build_object('v', 1, 'pad', repeat('x', 600000)) where id = v_fwx;
    r := r || 'L13=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%frameworks_layout_draft_check%' then 'L13 size_cap=ok; ' else 'L13=FAIL(' || sqlerrm || '); ' end;
  end;
  begin
    update frameworks set layout_draft_by = p_author, layout_draft_at = now(), layout_draft = '"text"'::jsonb where id = v_fwx;
    r := r || 'L14=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%frameworks_layout_draft_check%' then 'L14 check_object=ok; ' else 'L14=FAIL(' || sqlerrm || '); ' end;
  end;
  alter table frameworks enable trigger frameworks_layout_guard;

  -- ===== 751 C. F4: reorder_layout is contribution, not authorship =====
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at)
  values (v_office, p_reviewer, 'PROBE reviewer', 'clinical_content_reviewer', 'active', current_date, p_owner, now()) returning id into ap_rev;
  insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values (ap_rev, 'framework', v_fw158, p_owner);
  insert into clinical_content_version (competency_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot)
  values (v_comp158, 'competency', array[p_author], p_author, 'x', '{}'::jsonb) returning id into v_ccv;
  -- The reviewer only reordered the framework.
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name)
  values (p_reviewer, 'PROBE reviewer', 'reorder_layout', 'framework', v_fw158, 'PROBE');
  -- C1 the reorderer may still review (decision accepted, then undone).
  begin
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v_ccv, p_reviewer, ap_rev, 'approved');
    raise exception 'PROBE_UNDO';
  exception when others then r := r || case when sqlerrm = 'PROBE_UNDO' then 'C1 reorder_not_authorship=ok; ' else 'C1=FAIL(' || sqlerrm || '); ' end;
  end;
  -- C2 the original 640 refusal: a reviewer with an authoring audit row on the competency is refused.
  begin
    insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name)
    values (p_reviewer, 'PROBE reviewer', 'update_competency', 'competency', v_comp158, 'PROBE');
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v_ccv, p_reviewer, ap_rev, 'approved');
    r := r || 'C2=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%not independent. The reviewer authored%' then 'C2 authorship_refused=ok; ' else 'C2=FAIL(' || sqlerrm || '); ' end;
  end;
  -- C3 publication SoD counts the reorder: a publisher who only reordered cannot publish a revision.
  update frameworks set competency_layer = 'foundational' where id = v_fw158;
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name)
  values (p_publisher, 'PROBE publisher', 'reorder_layout', 'framework', v_fw158, 'PROBE');
  begin
    update frameworks set version_revision = coalesce(version_revision, 0) + 1, published_by = p_publisher where id = v_fw158;
    r := r || 'C3=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%authored or curated%' then 'C3 reorder_is_contribution=ok; ' else 'C3=FAIL(' || sqlerrm || '); ' end;
  end;
  -- C4 control: an independent publisher (no audit row) may publish the same revision.
  begin
    update frameworks set version_revision = coalesce(version_revision, 0) + 1, published_by = p_author where id = v_fw158;
    r := r || 'C4 independent_publishes=ok; ';
  exception when others then r := r || 'C4=FAIL(' || sqlerrm || '); ';
  end;

  raise exception 'VERIFY %', r;
end
$probe$;
