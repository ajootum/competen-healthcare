-- ====================================================================================================
-- ASMT ASSESSOR WORKSPACE DB PROOFS (S4). STAGING ONLY. Run by scripts/assessment-core-harness.ts (assessor-db), never by hand.
-- ====================================================================================================
-- One transaction. It plants its own people, appointments, a published checklist, a grant, an instance and answers, then
-- checks what the database allows and refuses along the assessor path: the coordinator makes a grant, the person accepts it,
-- the assessor starts, answers and submits, a failed critical item forces a negative outcome, a second assessor without a
-- grant cannot start, and a person cannot read anyone else's instance. It ALWAYS ENDS BY RAISING its RESULT line so
-- everything rolls back and nothing is kept. The harness replaces the marker line below with the statements of one planted
-- violation to prove that each control can fail.
--
-- Expect: RESULT ASMT ASSESSOR PROOFS pass=<n> fail=0 failed:
create temp table proof (id text, ok boolean, detail text) on commit drop;

create function pg_temp.rec(p_id text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into pg_temp.proof values (p_id, coalesce(p_ok, false), p_detail) $$;

create function pg_temp.try_sql(p_sql text) returns text
language plpgsql as $$ begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

create function pg_temp.refused(p_id text, p_sql text, p_pattern text default '%') returns void
language plpgsql as $$
declare e text := pg_temp.try_sql(p_sql);
begin
  perform pg_temp.rec(p_id, e is not null and e ilike p_pattern, coalesce(left(e, 160), 'NOT REFUSED'));
end $$;

create function pg_temp.allowed(p_id text, p_sql text) returns void
language plpgsql as $$
declare e text := pg_temp.try_sql(p_sql);
begin
  perform pg_temp.rec(p_id, e is null, coalesce(left(e, 160), 'ok'));
end $$;

create function pg_temp.appoint(p_office uuid, p_owner uuid, p_person uuid, p_role text) returns void
language plpgsql as $$
begin
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, authorised_by, authorised_at)
  values (p_office, p_person, 'asmt assessor proof ' || p_role, p_role, 'active', p_owner, now());
end $$;

create function pg_temp.publish_version(p_tbl text, p_id uuid, p_submitter uuid, p_gov uuid[], p_publisher uuid) returns void
language plpgsql as $$
declare v_hash text; v_risk text; v_need int; i int;
begin
  execute format('update %I set state = ''in_review'', submitted_by = %L where id = %L', p_tbl, p_submitter, p_id);
  execute format('select content_hash, coalesce(to_jsonb(t) ->> ''risk'', ''standard'') from %I t where id = %L', p_tbl, p_id) into v_hash, v_risk;
  v_need := hq_sod_required_approvals(v_risk);
  for i in 1..v_need loop
    insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash)
    values (p_tbl, p_id, 'governance', p_gov[i], 'approved', v_hash);
  end loop;
  execute format('update %I set state = ''approved'' where id = %L', p_tbl, p_id);
  execute format('update %I set state = ''published'', published_by = %L where id = %L', p_tbl, p_publisher, p_id);
end $$;

create function pg_temp.answer(p_inst uuid, p_item uuid, p_level text, p_state text) returns text
language plpgsql as $$
declare v_ver uuid;
begin
  select instrument_version_id into v_ver from asmt_instance where id = p_inst;
  insert into asmt_response (instance_id, version_id, item_id, field_key, value, updated_by)
  values (p_inst, v_ver, p_item, 'primary', jsonb_strip_nulls(jsonb_build_object('level_code', p_level, 'state', p_state)), null)
  on conflict (instance_id, item_id, field_key) do update set value = excluded.value;
  return null;
exception when others then return sqlerrm;
end $$;

create function pg_temp.mk_instance(p_version uuid, p_subject uuid, p_respondent uuid, p_grant uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into asmt_instance (instrument_version_id, subject_kind, subject_id, subject_user_id, respondent_role, respondent_id, grant_id, owner_scope, attestation)
  values (p_version, 'person', p_subject, p_subject, 'assessor', p_respondent, p_grant, 'holdings', 'assessor_evaluated')
  returning id into v_id;
  return v_id;
end $$;

do $$
declare
  pass int := 0;
  fail int := 0;
  failed text := '';
  e text;
  n int;
  n2 int;
  owner uuid;
  office uuid;
  ids uuid[];
  u_author uuid; u_rev1 uuid; u_rev2 uuid; u_pub uuid; u_coord uuid; u_assr uuid; u_assr2 uuid; u_subj uuid; u_subj2 uuid; u_other uuid;
  gov uuid[];
  appt1 uuid; appt2 uuid;
  sc uuid; scv uuid; lay uuid; layv uuid;
  ins uuid; v1 uuid; sec uuid; ic uuid; im uuid; io uuid;
  g1 uuid; g2 uuid; g3 uuid;
  inst uuid; inst2 uuid; inst_x uuid;
  oc record;
  jwt text;
  v_scoring jsonb := '{"outcomes":[{"code":"ACH","label":"Achieved","class":"positive"},{"code":"NOT","label":"Not achieved","class":"negative"},{"code":"INC","label":"Incomplete","class":"incomplete"}],"gates":{"criticalFail":"NOT","mandatoryMissing":"INC"}}';
begin
  -- @@PLANT@@

  select p.id into owner from profiles p where hq_actor_is_owner(p.id) order by p.id limit 1;
  select o.id into office from ogs_offices o where o.office_type = 'hq_quality' limit 1;
  select array_agg(id) into ids from (
    select p.id from profiles p
     where not exists (select 1 from ogs_office_appointments a where a.person_id = p.id) and not hq_actor_is_owner(p.id)
     order by p.id limit 10) s;
  if owner is null or office is null or cardinality(ids) < 10 then
    raise exception 'RESULT ASMT ASSESSOR PROOFS needs a platform owner, the hq_quality office and 10 profiles without an appointment';
  end if;
  u_author := ids[1]; u_rev1 := ids[2]; u_rev2 := ids[3]; u_pub := ids[4]; u_coord := ids[5]; u_assr := ids[6]; u_assr2 := ids[7];
  u_subj := ids[8]; u_subj2 := ids[9]; u_other := ids[10];
  gov := array[u_rev1, u_rev2];
  perform pg_temp.appoint(office, owner, u_author, 'assessment_studio_author');
  perform pg_temp.appoint(office, owner, u_rev1, 'assessment_studio_reviewer');
  perform pg_temp.appoint(office, owner, u_rev2, 'assessment_studio_reviewer');
  perform pg_temp.appoint(office, owner, u_pub, 'assessment_studio_publisher');
  perform pg_temp.appoint(office, owner, u_coord, 'assessment_coordinator');
  perform pg_temp.appoint(office, owner, u_assr, 'checklist_assessor');
  perform pg_temp.appoint(office, owner, u_assr2, 'checklist_assessor');
  select id into appt1 from ogs_office_appointments where person_id = u_assr and role = 'checklist_assessor';
  select id into appt2 from ogs_office_appointments where person_id = u_assr2 and role = 'checklist_assessor';

  -- ---- a published checklist: one critical rating, one mandatory rating, one optional yes or no ------------------------
  insert into asmt_purpose (code, label, publishable) values ('zzasr_formative', 'Formative', true);
  insert into asmt_method (code, label) values ('zzasr_obs', 'Observation');
  insert into asmt_response_scale (code, name) values ('ZZASR-SCALE-1', 'Proof rating') returning id into sc;
  insert into asmt_response_scale_version (scale_id, authored_by, scale_kind) values (sc, array[u_author], 'rating') returning id into scv;
  for n in 0..6 loop
    insert into asmt_response_scale_level (version_id, code, label, ordinal, numeric_value, satisfactory, updated_by)
    values (scv, 'L' || n, 'Level ' || n, n, n, n >= 3, u_author);
  end loop;
  insert into asmt_response_scale_state (version_id, state, label, updated_by) values (scv, 'not_assessed', 'Not assessed', u_author), (scv, 'not_observed', 'Not observed', u_author);
  perform pg_temp.publish_version('asmt_response_scale_version', scv, u_author, gov, u_pub);
  insert into asmt_layout_template (code, name) values ('ZZASR-LAYOUT-1', 'Proof layout') returning id into lay;
  insert into asmt_layout_template_version (template_id, authored_by, presentation, layout) values (lay, array[u_author], 'standard_checklist', '{"schema":"asmt.layout/1","presentation":"standard_checklist"}') returning id into layv;
  perform pg_temp.publish_version('asmt_layout_template_version', layv, u_author, gov, u_pub);

  insert into asmt_instrument (code, name, kind) values ('ZZASR-CHK-1', 'Assessor proof checklist', 'assessment_checklist') returning id into ins;
  insert into asmt_instrument_version (instrument_id, authored_by, title, purpose_code, method_codes, scoring, scoring_hash, respondent_roles, delivery_modes, assess_capability, default_layout_version_id)
    values (ins, array[u_author], 'Assessor proof checklist', 'zzasr_formative', array['zzasr_obs'], v_scoring, 'zzasrh1', array['self', 'assessor'], array['assessor_led'], 'hq.assessment.instrument.assess', layv)
    returning id into v1;
  insert into asmt_section (version_id, title, updated_by) values (v1, 'Section one', u_author) returning id into sec;
  insert into asmt_item (version_id, section_id, code, prompt, response_type, scale_version_id, mandatory, critical, critical_requirements, position, updated_by)
    values (v1, sec, 'C1', 'Critical rating', 'rating_scale', scv, true, true, array['must_be_satisfactory'], 1, u_author) returning id into ic;
  insert into asmt_item (version_id, section_id, code, prompt, response_type, scale_version_id, mandatory, position, updated_by)
    values (v1, sec, 'M1', 'Mandatory rating', 'rating_scale', scv, true, 2, u_author) returning id into im;
  insert into asmt_item (version_id, section_id, code, prompt, response_type, position, updated_by)
    values (v1, sec, 'O1', 'Optional yes or no', 'yes_no', 3, u_author) returning id into io;
  perform pg_temp.publish_version('asmt_instrument_version', v1, u_author, gov, u_pub);
  select state into e from asmt_instrument_version where id = v1;
  perform pg_temp.rec('S0', e = 'published', 'the fixture checklist is published: ' || e);

  -- ---- H: making a grant ----------------------------------------------------------------------------------------------
  perform pg_temp.refused('H1', format($q$insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (%L, 'person', %L, %L, %L, 'assessor', %L, %L, 'self made')$q$, ins, u_subj, u_subj, u_assr, appt1, u_assr), '%not independent%');
  perform pg_temp.refused('H1b', format($q$insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (%L, 'person', %L, %L, %L, 'assessor', %L, %L, 'about myself')$q$, ins, u_subj, u_subj, u_assr, appt1, u_subj), '%not independent%');
  perform pg_temp.refused('H1c', format($q$insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (%L, 'person', %L, %L, %L, 'assessor', %L, %L, 'no authority')$q$, ins, u_subj, u_subj, u_assr, appt1, u_other), '%not authorised%');
  perform pg_temp.refused('H1d', format($q$insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (%L, 'person', %L, %L, %L, 'assessor', %L, %L, 'wrong appointment')$q$, ins, u_subj, u_subj, u_assr, appt2, u_coord), '%does not hold%');
  perform pg_temp.allowed('H2', format($q$insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (%L, 'person', %L, %L, %L, 'assessor', %L, %L, 'coordinator grants authority')$q$, ins, u_subj, u_subj, u_assr, appt1, u_coord));
  select id into g1 from asmt_respondent_grant where instrument_id = ins and respondent_id = u_assr;
  select (accepted_at is null)::int into n from asmt_respondent_grant where id = g1;
  perform pg_temp.rec('H2b', n = 1, 'a new grant is not accepted');

  -- ---- I: nothing starts before the person accepts --------------------------------------------------------------------
  perform pg_temp.refused('I1', format($q$select pg_temp.mk_instance(%L, %L, %L, %L)$q$, v1, u_subj, u_assr, g1), '%not live%');
  perform pg_temp.refused('I2', format($q$update asmt_respondent_grant set accepted_at = now(), accepted_by = %L where id = %L$q$, u_assr, g1), '%accepted by the subject%');
  perform pg_temp.refused('I2b', format($q$update asmt_respondent_grant set accepted_at = now(), accepted_by = %L where id = %L$q$, u_coord, g1), '%accepted by the subject%');
  perform pg_temp.allowed('I3', format($q$update asmt_respondent_grant set accepted_at = now(), accepted_by = %L where id = %L$q$, u_subj, g1));
  select (accepted_at is not null and accepted_by = u_subj)::int into n from asmt_respondent_grant where id = g1;
  perform pg_temp.rec('I3b', n = 1, 'acceptance is recorded with the person who accepted');

  -- ---- J: starting -----------------------------------------------------------------------------------------------------
  perform pg_temp.refused('J1', format($q$select pg_temp.mk_instance(%L, %L, %L, %L)$q$, v1, u_subj, u_assr2, g1), '%grant does not match%');
  perform pg_temp.refused('J2', format($q$select pg_temp.mk_instance(%L, %L, %L, null)$q$, v1, u_subj, u_assr2), '%grant does not match%');
  perform pg_temp.refused('J2b', format($q$select pg_temp.mk_instance(%L, %L, %L, %L)$q$, v1, u_subj2, u_assr, g1), '%grant does not match%');
  perform pg_temp.refused('J3', format($q$select pg_temp.mk_instance(%L, %L, %L, %L)$q$, v1, u_subj, u_subj, g1), '%');
  inst := pg_temp.mk_instance(v1, u_subj, u_assr, g1);
  perform pg_temp.rec('J4', inst is not null, 'the assessor with an accepted grant starts an instance');
  select (respondent_snapshot ->> 'positionCode' = 'checklist_assessor' and respondent_snapshot ->> 'capability' = 'hq.assessment.instrument.assess')::int into n from asmt_instance where id = inst;
  perform pg_temp.rec('J4b', n = 1, 'the authority is frozen into the instance');
  perform pg_temp.allowed('J5', format($q$insert into asmt_instance_layout (instance_id, layout_version_id, is_primary) values (%L, %L, true)$q$, inst, layv));
  -- a self instance for the assessor as subject is not what the workspace opens, and the subject cannot be their own assessor
  perform pg_temp.refused('J6', format($q$insert into asmt_instance (instrument_version_id, subject_kind, subject_id, subject_user_id, respondent_role, respondent_id, owner_scope, attestation)
    values (%L, 'person', %L, %L, 'assessor', %L, 'holdings', 'self_reported')$q$, v1, u_subj, u_subj, u_assr), '%');

  -- ---- K: answers and the submit ----------------------------------------------------------------------------------------
  perform pg_temp.rec('K1', pg_temp.answer(inst, ic, 'L1', null) is null, 'a failed critical rating is accepted as an answer');
  perform pg_temp.rec('K2', pg_temp.answer(inst, im, 'L5', null) is null, 'a high mandatory rating');
  select (satisfactory = false)::int into n from asmt_response where instance_id = inst and item_id = ic;
  perform pg_temp.rec('K3', n = 1, 'satisfactory is computed by the database (L1 is below the line)');
  select revision into n from asmt_response where instance_id = inst and item_id = ic;
  e := pg_temp.answer(inst, ic, 'L1', null);
  select revision into n2 from asmt_response where instance_id = inst and item_id = ic;
  perform pg_temp.rec('K4', e is null and n2 = n + 1, 'a change advances the revision: ' || n || ' to ' || n2);
  perform pg_temp.refused('K5', format($q$select public.asmt_submit_instance(%L, %L, '{"outcomeCode":"ACH","outcomeClass":"positive"}'::jsonb, 'asmt-engine/1', 'zzasrh1')$q$, inst, u_assr2), '%only the respondent%');
  perform pg_temp.refused('K6', format($q$select public.asmt_submit_instance(%L, %L, '{"outcomeCode":"ACH","outcomeClass":"positive"}'::jsonb, 'asmt-engine/1', 'wrong')$q$, inst, u_assr), '%hash%');
  -- the engine says positive, the facts say a critical item failed: the database forces the gate outcome
  perform pg_temp.allowed('K7', format($q$select public.asmt_submit_instance(%L, %L, '{"outcomeCode":"ACH","outcomeClass":"positive","trace":{"steps":[]},"traceHash":"t"}'::jsonb, 'asmt-engine/1', 'zzasrh1')$q$, inst, u_assr));
  select * into oc from asmt_outcome where instance_id = inst;
  perform pg_temp.rec('K8', oc.outcome_class = 'negative' and oc.outcome_code = 'NOT' and oc.backstop_applied, 'a failed critical item forces a negative outcome: ' || coalesce(oc.outcome_class, '-') || ' ' || coalesce(oc.outcome_code, '-'));
  perform pg_temp.rec('K8b', (oc.backstop_detail ->> 'engineOutcomeClass') = 'positive', 'the engine outcome is kept in the backstop detail');
  select (status = 'submitted' and submitted_at is not null)::int into n from asmt_instance where id = inst;
  perform pg_temp.rec('K9', n = 1, 'the instance is closed by the submit');
  perform pg_temp.refused('K10', format($q$update asmt_response set value = '{"level_code":"L6"}' where instance_id = %L and item_id = %L$q$, inst, ic), '%in progress%');
  perform pg_temp.refused('K11', format($q$select public.asmt_submit_instance(%L, %L, '{"outcomeCode":"ACH","outcomeClass":"positive"}'::jsonb, 'asmt-engine/1', 'zzasrh1')$q$, inst, u_assr), '%');

  -- ---- L: evidence and comments -----------------------------------------------------------------------------------------
  -- a second grant and instance for the evidence proofs
  insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (ins, 'person', u_subj2, u_subj2, u_assr, 'assessor', appt1, u_coord, 'second person') returning id into g2;
  update asmt_respondent_grant set accepted_at = now(), accepted_by = u_subj2 where id = g2;
  inst2 := pg_temp.mk_instance(v1, u_subj2, u_assr, g2);
  perform pg_temp.allowed('L1', format($q$insert into asmt_evidence (instance_id, version_id, item_id, kind, note, added_by) values (%L, %L, %L, 'note', 'Observed hand hygiene before contact', %L)$q$, inst2, v1, ic, u_assr));
  perform pg_temp.allowed('L2', format($q$insert into asmt_evidence (instance_id, version_id, kind, ref_kind, ref_id, added_by) values (%L, %L, 'record_ref', 'observation_form', gen_random_uuid(), %L)$q$, inst2, v1, u_assr));
  perform pg_temp.refused('L3', format($q$insert into asmt_evidence (instance_id, version_id, kind, added_by) values (%L, %L, 'upload', %L)$q$, inst2, v1, u_assr), '%');
  perform pg_temp.allowed('L4', format($q$insert into asmt_comment (instance_id, version_id, item_id, kind, body, author_id) values (%L, %L, %L, 'safety_concern', 'Did not check the identity band', %L)$q$, inst2, v1, ic, u_assr));
  perform pg_temp.allowed('L4b', format($q$insert into asmt_comment (instance_id, version_id, kind, body, author_id) values (%L, %L, 'strength', 'Clear explanations to the patient', %L)$q$, inst2, v1, u_assr));
  perform pg_temp.refused('L5', format($q$update asmt_comment set body = 'rewritten' where instance_id = %L$q$, inst2), '%append-only%');
  perform pg_temp.refused('L5b', format($q$delete from asmt_evidence where instance_id = %L$q$, inst2), '%append-only%');
  perform pg_temp.refused('L6', format($q$insert into asmt_comment (instance_id, version_id, kind, body, author_id) values (%L, %L, 'opinion', 'x', %L)$q$, inst2, v1, u_assr), '%');
  -- mandatory missing -> incomplete
  perform pg_temp.rec('L7', pg_temp.answer(inst2, ic, 'L5', null) is null, 'the critical item is met');
  perform pg_temp.allowed('L8', format($q$select public.asmt_submit_instance(%L, %L, '{"outcomeCode":"ACH","outcomeClass":"positive","traceHash":"t"}'::jsonb, 'asmt-engine/1', 'zzasrh1')$q$, inst2, u_assr));
  select * into oc from asmt_outcome where instance_id = inst2;
  perform pg_temp.rec('L9', oc.outcome_class = 'incomplete' and oc.outcome_code = 'INC' and oc.backstop_applied, 'a missing mandatory item forces incomplete: ' || coalesce(oc.outcome_class, '-'));
  perform pg_temp.allowed('L10', format($q$insert into asmt_comment (instance_id, version_id, kind, body, author_id) values (%L, %L, 'recommendation', 'Repeat after supervised practice', %L)$q$, inst2, v1, u_assr));

  -- ---- M: ending a grant ------------------------------------------------------------------------------------------------
  insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (ins, 'person', u_other, u_other, u_assr, 'assessor', appt1, u_coord, 'third person') returning id into g3;
  update asmt_respondent_grant set accepted_at = now(), accepted_by = u_other where id = g3;
  inst_x := pg_temp.mk_instance(v1, u_other, u_assr, g3);
  perform pg_temp.refused('M1', format($q$update asmt_respondent_grant set ended_at = now(), ended_by = %L, end_reason = 'nope' where id = %L$q$, u_assr2, g3), '%is ended by%');
  perform pg_temp.allowed('M2', format($q$update asmt_respondent_grant set ended_at = now(), ended_by = %L, end_reason = 'coordinator ends it' where id = %L$q$, u_coord, g3));
  perform pg_temp.refused('M3', format($q$select public.asmt_submit_instance(%L, %L, '{"outcomeCode":"ACH","outcomeClass":"positive"}'::jsonb, 'asmt-engine/1', 'zzasrh1')$q$, inst_x, u_assr), '%no longer live%');
  perform pg_temp.refused('M4', format($q$select pg_temp.mk_instance(%L, %L, %L, %L)$q$, v1, u_other, u_assr, g3), '%not live%');
  perform pg_temp.refused('M5', format($q$update asmt_respondent_grant set ended_at = null, ended_by = null where id = %L$q$, g3), '%never reopened%');

  -- ---- N: privacy -------------------------------------------------------------------------------------------------------
  select count(*)::int into n2 from asmt_instance where subject_user_id = u_subj;
  perform set_config('request.jwt.claim.sub', u_subj::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_subj::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*)::int into n from asmt_instance;
  select count(*)::int into e from asmt_instance where subject_user_id = u_subj2;
  execute 'reset role';
  perform pg_temp.rec('N1', n = n2 and n2 >= 1 and e::int = 0, 'the person reads their own instance and not another person''s: ' || n || ' of ' || n2 || ', other ' || e);
  perform set_config('request.jwt.claim.sub', u_subj2::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_subj2::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*)::int into n from asmt_instance where subject_user_id = u_subj;
  select count(*)::int into n2 from asmt_response where subject_user_id = u_subj;
  execute 'reset role';
  perform pg_temp.rec('N2', n = 0 and n2 = 0, 'the subject of another instance reads none of it: ' || n || '/' || n2);
  perform set_config('request.jwt.claim.sub', u_assr::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_assr::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*)::int into n from asmt_instance;
  execute 'reset role';
  perform pg_temp.rec('N3', n = 0, 'a signed in assessor reads no instance through the data API (the workspace reads through the server): ' || n);
  perform pg_temp.rec('N4', not has_function_privilege('authenticated', 'public.asmt_submit_instance(uuid,uuid,jsonb,text,text)', 'execute')
    and has_function_privilege('service_role', 'public.asmt_submit_instance(uuid,uuid,jsonb,text,text)', 'execute'), 'the submit entry point is service role only');

  select count(*) filter (where ok), count(*) filter (where not ok), coalesce(string_agg(id, ' ' order by id) filter (where not ok), '')
    into pass, fail, failed from pg_temp.proof;
  raise exception 'RESULT ASMT ASSESSOR PROOFS pass=% fail=% failed: %', pass, fail, failed;
end;
$$;
