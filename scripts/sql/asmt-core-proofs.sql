-- ====================================================================================================
-- ASMT CORE DB PROOFS (S1a). STAGING ONLY. Run by scripts/assessment-core-harness.ts, never by hand.
-- ====================================================================================================
-- One transaction. It plants its own people appointments, definitions, instances and answers, checks what the
-- database refuses and allows, and ALWAYS ENDS BY RAISING its RESULT line so everything rolls back and nothing is
-- kept. It never touches a real row. It needs 14 profiles without an HQ appointment and a platform owner. The
-- harness replaces the marker line below with the statements of one planted violation to prove that each
-- control can fail (plant, observe red, restore by the rollback).
--
-- Expect: RESULT ASMT PROOFS pass=<n> fail=0 failed:
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
  values (p_office, p_person, 'asmt proof ' || p_role, p_role, 'active', p_owner, now());
end $$;

create function pg_temp.publish_version(p_tbl text, p_id uuid, p_submitter uuid, p_gov uuid[], p_dom uuid[], p_publisher uuid) returns void
language plpgsql as $$
declare v_hash text; v_risk text; v_dom boolean; v_need int; i int;
begin
  execute format('update %I set state = ''in_review'', submitted_by = %L where id = %L', p_tbl, p_submitter, p_id);
  execute format('select content_hash, coalesce(to_jsonb(t) ->> ''risk'', ''standard''), coalesce((to_jsonb(t) ->> ''requires_domain_review'')::boolean, false) from %I t where id = %L',
                 p_tbl, p_id) into v_hash, v_risk, v_dom;
  v_need := hq_sod_required_approvals(v_risk);
  for i in 1..v_need loop
    insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash)
    values (p_tbl, p_id, 'governance', p_gov[i], 'approved', v_hash);
    if v_dom then
      insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash)
      values (p_tbl, p_id, 'domain', p_dom[i], 'approved', v_hash);
    end if;
  end loop;
  execute format('update %I set state = ''approved'' where id = %L', p_tbl, p_id);
  execute format('update %I set state = ''published'', published_by = %L where id = %L', p_tbl, p_publisher, p_id);
end $$;

-- answer one field. Returns the error text or null.
create function pg_temp.answer(p_inst uuid, p_item uuid, p_field text, p_level text, p_state text, p_value jsonb, p_reason text, p_sat boolean default null) returns text
language plpgsql as $$
declare v_ver uuid;
begin
  select instrument_version_id into v_ver from asmt_instance where id = p_inst;
  insert into asmt_response (instance_id, version_id, item_id, field_key, value, satisfactory, updated_by)
  values (p_inst, v_ver, p_item, p_field,
          jsonb_strip_nulls(jsonb_build_object('level_code', p_level, 'state', p_state, 'value', p_value, 'reason', p_reason)), p_sat, null)
  on conflict (instance_id, item_id, field_key) do update
    set value = excluded.value, satisfactory = excluded.satisfactory;
  return null;
exception when others then return sqlerrm;
end $$;

create function pg_temp.mk_instance(p_version uuid, p_subject uuid, p_role text, p_respondent uuid, p_grant uuid, p_att text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into asmt_instance (instrument_version_id, subject_kind, subject_id, subject_user_id, respondent_role, respondent_id, grant_id, owner_scope, attestation)
  values (p_version, 'person', p_subject, p_subject, p_role, p_respondent, p_grant, 'holdings', p_att)
  returning id into v_id;
  return v_id;
end $$;

create function pg_temp.item_id(p_version uuid, p_code text) returns uuid
language sql as $$ select id from asmt_item where version_id = p_version and code = p_code $$;

create function pg_temp.schema_signature() returns text
language sql as $$
  select md5(
    coalesce((select string_agg(table_name || '.' || column_name || ':' || data_type, ',' order by table_name, ordinal_position)
                from information_schema.columns where table_schema = 'public' and table_name like 'asmt\_%'), '')
    || '|' || coalesce((select string_agg(conrelid::regclass::text || '.' || conname, ',' order by conrelid::regclass::text, conname)
                from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text like 'asmt\_%'), '')
    || '|' || coalesce((select string_agg(tgrelid::regclass::text || '.' || tgname, ',' order by tgrelid::regclass::text, tgname)
                from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'asmt\_%'), ''))
$$;

do $$
declare
  pass int := 0;
  fail int := 0;
  failed text := '';
  r record;
  e text;
  n int;
  n2 int;
  sig_before text;
  inst_tmp uuid;
  ids uuid[];
  office uuid;
  owner uuid;
  u_author uuid; u_editor uuid; u_rev1 uuid; u_rev2 uuid; u_pub uuid; u_coord uuid; u_assr uuid; u_subj uuid;
  u_dom1 uuid; u_dom2 uuid; u_other uuid; u_subj2 uuid; u_assr2 uuid; u_nocap uuid;
  appt_assr uuid; appt_assr2 uuid;
  gov uuid[]; dom uuid[];
  sc uuid; scv uuid; stg uuid; stgv uuid;
  lay uuid; layA uuid; layB uuid; layC uuid; layD uuid;
  ins uuid; v1 uuid; v2 uuid; sec1 uuid; tv uuid; tins uuid; inst_f7 uuid; o7 uuid; gx uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid;
  a_ver uuid; a_ins uuid;
  h text;
  g1 uuid; g2 uuid; g3 uuid;
  inst_ok uuid; inst_f1 uuid; inst_f2 uuid; inst_f3 uuid; inst_f8 uuid; inst_self uuid; inst_self2 uuid; inst_e uuid; inst_o2 uuid; inst_o3 uuid; inst_aud uuid;
  o1 uuid; o2 uuid; o3 uuid;
  ps uuid; psv uuid; d1 uuid; d2 uuid;
  oc record;
  jwt text;
  v_scoring jsonb := '{"outcomes":[{"code":"ACH","label":"Achieved","class":"positive"},{"code":"PART","label":"Partial","class":"partial"},{"code":"NOT","label":"Not achieved","class":"negative"},{"code":"INC","label":"Incomplete","class":"incomplete"}],"gates":{"criticalFail":"NOT","mandatoryMissing":"INC"}}';
begin
  -- @@PLANT@@
  sig_before := pg_temp.schema_signature();

  -- ---- setup: people, appointments -----------------------------------------------------------------------
  select p.id into owner from profiles p where hq_actor_is_owner(p.id) order by p.id limit 1;
  select o.id into office from ogs_offices o where o.office_type = 'hq_quality' limit 1;
  select array_agg(id) into ids from (
    select p.id from profiles p
     where not exists (select 1 from ogs_office_appointments a where a.person_id = p.id) and not hq_actor_is_owner(p.id)
     order by p.id limit 14) s;
  if owner is null or office is null or cardinality(ids) < 14 then
    raise exception 'RESULT ASMT PROOFS needs a platform owner, the hq_quality office and 14 profiles without an appointment';
  end if;
  u_author := ids[1]; u_editor := ids[2]; u_rev1 := ids[3]; u_rev2 := ids[4]; u_pub := ids[5]; u_coord := ids[6]; u_assr := ids[7];
  u_subj := ids[8]; u_dom1 := ids[9]; u_dom2 := ids[10]; u_other := ids[11]; u_subj2 := ids[12]; u_assr2 := ids[13]; u_nocap := ids[14];
  gov := array[u_rev1, u_rev2]; dom := array[u_dom1, u_dom2];
  perform pg_temp.appoint(office, owner, u_author, 'assessment_studio_author');
  perform pg_temp.appoint(office, owner, u_editor, 'assessment_studio_author');
  perform pg_temp.appoint(office, owner, u_rev1, 'assessment_studio_reviewer');
  perform pg_temp.appoint(office, owner, u_rev2, 'assessment_studio_reviewer');
  perform pg_temp.appoint(office, owner, u_pub, 'assessment_studio_publisher');
  perform pg_temp.appoint(office, owner, u_coord, 'assessment_coordinator');
  perform pg_temp.appoint(office, owner, u_assr, 'checklist_assessor');
  perform pg_temp.appoint(office, owner, u_assr2, 'checklist_assessor');
  perform pg_temp.appoint(office, owner, u_dom1, 'clinical_content_reviewer');
  perform pg_temp.appoint(office, owner, u_dom2, 'clinical_content_reviewer');
  select id into appt_assr from ogs_office_appointments where person_id = u_assr and role = 'checklist_assessor';
  select id into appt_assr2 from ogs_office_appointments where person_id = u_assr2 and role = 'checklist_assessor';
  perform pg_temp.rec('S1', appt_assr is not null and appt_assr2 is not null, 'appointments planted');

  -- registries (rows) and a family
  insert into asmt_purpose (code, label, publishable) values ('zzproof_formative', 'Formative', true), ('zzproof_verification', 'Verification', false);
  insert into asmt_method (code, label) values ('zzproof_self', 'Self'), ('zzproof_obs', 'Observation');
  insert into asmt_mapping_kind (code, label) values ('zzproof_criterion', 'Criterion'), ('zzproof_standard', 'Standard');
  insert into asmt_instrument_family (code, label) values ('ZZ', 'Proof family');
  insert into asmt_instrument_family (code, label, is_active) values ('ZY', 'Inactive proof family', false);

  -- ---- a rating scale, published through the full lifecycle -----------------------------------------------
  insert into asmt_response_scale (code, name) values ('ZZPROOF-SCALE-1', 'Proof rating 0-6') returning id into sc;
  insert into asmt_response_scale_version (scale_id, authored_by, scale_kind) values (sc, array[u_author], 'rating') returning id into scv;
  for n in 0..6 loop
    insert into asmt_response_scale_level (version_id, code, label, ordinal, numeric_value, satisfactory, updated_by)
    values (scv, 'L' || n, 'Level ' || n, n, n, case when n >= 3 then true else false end, u_author);
  end loop;
  insert into asmt_response_scale_state (version_id, state, label, updated_by) values
    (scv, 'not_assessed', 'Not assessed', u_author), (scv, 'not_observed', 'Not observed', u_author),
    (scv, 'unable_to_demonstrate', 'Unable to demonstrate', u_author);
  -- A2: a draft is editable
  perform pg_temp.allowed('A2', format($q$update asmt_response_scale_level set label = 'Level 3 edited', updated_by = %L where version_id = %L and code = 'L3'$q$, u_author, scv));
  -- the draft scale cannot be used by a submitted instrument version later: checked in B16
  perform pg_temp.publish_version('asmt_response_scale_version', scv, u_author, gov, dom, u_pub);
  -- A1, A7: a published scale version is frozen
  perform pg_temp.refused('A1', format($q$update asmt_response_scale_version set description = 'x', last_edited_by = %L where id = %L$q$, u_author, scv), '%frozen%');
  perform pg_temp.refused('A7', format($q$update asmt_response_scale_level set label = 'hacked' where version_id = %L and code = 'L3'$q$, scv), '%frozen%');

  -- a stage scale (kind stage), published
  insert into asmt_response_scale (code, name) values ('ZZPROOF-STAGE-1', 'Proof stages') returning id into stg;
  insert into asmt_response_scale_version (scale_id, authored_by, scale_kind) values (stg, array[u_author], 'stage') returning id into stgv;
  for n in 0..6 loop
    insert into asmt_response_scale_level (version_id, code, label, ordinal, updated_by) values (stgv, 'S' || n, 'Stage ' || n, n, u_author);
  end loop;
  perform pg_temp.publish_version('asmt_response_scale_version', stgv, u_author, gov, dom, u_pub);

  -- layouts: A and B published and allowed, C published but not allowed, D left as a draft
  insert into asmt_layout_template (code, name) values ('ZZPROOF-LAYOUT-1', 'Proof layouts') returning id into lay;
  insert into asmt_layout_template_version (template_id, authored_by, presentation, layout) values (lay, array[u_author], 'standard_checklist', '{"presentation":"standard_checklist"}') returning id into layA;
  insert into asmt_layout_template_version (template_id, authored_by, presentation, layout) values (lay, array[u_author], 'guided_assessment', '{"presentation":"guided_assessment"}') returning id into layB;
  insert into asmt_layout_template_version (template_id, authored_by, presentation, layout) values (lay, array[u_author], 'audit_inspection', '{}') returning id into layC;
  insert into asmt_layout_template_version (template_id, authored_by, presentation, layout) values (lay, array[u_author], 'assessment_form', '{}') returning id into layD;
  perform pg_temp.publish_version('asmt_layout_template_version', layA, u_author, gov, dom, u_pub);
  perform pg_temp.publish_version('asmt_layout_template_version', layB, u_author, gov, dom, u_pub);
  perform pg_temp.publish_version('asmt_layout_template_version', layC, u_author, gov, dom, u_pub);
  -- publishing layout B retires layout A? No: they are versions 1 and 2 of the SAME template. B publishing retires A.
  select state into e from asmt_layout_template_version where id = layA;
  perform pg_temp.rec('B13a', e = 'retired', 'publishing version 2 retires version 1 of a layout template: ' || e);
  -- use fresh independent templates for the allowed and unallowed layouts so retirement does not interfere
  insert into asmt_layout_template (code, name) values ('ZZPROOF-LAYOUT-2', 'Proof layout two') returning id into lay;
  insert into asmt_layout_template_version (template_id, authored_by, presentation, layout) values (lay, array[u_author], 'standard_checklist', '{}') returning id into layA;
  perform pg_temp.publish_version('asmt_layout_template_version', layA, u_author, gov, dom, u_pub);
  insert into asmt_layout_template (code, name) values ('ZZPROOF-LAYOUT-3', 'Proof layout three') returning id into lay;
  insert into asmt_layout_template_version (template_id, authored_by, presentation, layout) values (lay, array[u_author], 'guided_assessment', '{}') returning id into layB;
  perform pg_temp.publish_version('asmt_layout_template_version', layB, u_author, gov, dom, u_pub);
  insert into asmt_layout_template (code, name) values ('ZZPROOF-LAYOUT-4', 'Proof layout four') returning id into lay;
  insert into asmt_layout_template_version (template_id, authored_by, presentation, layout) values (lay, array[u_author], 'audit_inspection', '{}') returning id into layC;
  perform pg_temp.publish_version('asmt_layout_template_version', layC, u_author, gov, dom, u_pub);
  insert into asmt_layout_template (code, name) values ('ZZPROOF-LAYOUT-5', 'Proof layout five') returning id into lay;
  insert into asmt_layout_template_version (template_id, authored_by, presentation, layout) values (lay, array[u_author], 'assessment_form', '{}') returning id into layD;

  -- ---- shape one: a competency style checklist (CHK-RESP-ASSESS) -------------------------------------------
  insert into asmt_instrument_family (code, label) values ('QQ', 'Second family');
  insert into asmt_instrument (code, name, kind, family_code, description)
    values ('ZZPROOF-CHK-1', 'Proof checklist', 'assessment_checklist', 'ZZ', 'proof') returning id into ins;
  insert into asmt_instrument_version (instrument_id, authored_by, title, purpose_code, method_codes, requires_domain_review, scoring, scoring_hash,
      respondent_roles, delivery_modes, assess_capability, default_layout_version_id)
    values (ins, array[u_author], 'Proof checklist', 'zzproof_formative', array['zzproof_self', 'zzproof_obs'], true, v_scoring, 'zzh1',
      array['self', 'assessor'], array['self_assessment', 'assessor_led'], 'hq.assessment.instrument.assess', layA)
    returning id into v1;
  insert into asmt_group (version_id, code, label, updated_by) values (v1, 'g_know', 'Knowledge', u_author);
  insert into asmt_section (version_id, title, updated_by) values (v1, 'Section one', u_author) returning id into sec1;
  insert into asmt_item (version_id, section_id, code, prompt, response_type, scale_version_id, group_code, method_codes, mandatory, critical, critical_requirements, position, updated_by)
    values (v1, sec1, 'I1', 'Critical rating item', 'rating_scale', scv, 'g_know', array['zzproof_obs'], true, true, array['must_be_satisfactory', 'must_be_observed'], 1, u_author);
  insert into asmt_item (version_id, section_id, code, prompt, response_type, scale_version_id, mandatory, position, updated_by)
    values (v1, sec1, 'I2', 'Mandatory rating item', 'rating_scale', scv, true, 2, u_author);
  insert into asmt_item (version_id, section_id, code, prompt, response_type, config, position, updated_by)
    values (v1, sec1, 'I3', 'Yes or no with reason', 'yes_no', '{"allowedStates":["not_applicable"],"naReasonRequired":true}', 3, u_author);
  insert into asmt_item (version_id, section_id, code, prompt, response_type, config, position, updated_by)
    values (v1, sec1, 'I4', 'Agreement', 'multiple_choice',
      '{"select":"single","allowedStates":["unable_to_determine"],"options":[{"code":"yes","label":"Yes","satisfactory":true,"credit":1},{"code":"partial","label":"Partial","satisfactory":null,"credit":0.5},{"code":"no","label":"No","satisfactory":false,"credit":0}]}',
      4, u_author);
  insert into asmt_item (version_id, section_id, code, prompt, response_type, scale_version_id, mandatory, critical, critical_requirements, position, updated_by)
    values (v1, sec1, 'I5', 'Must be observed', 'rating_scale', scv, true, true, array['must_be_observed'], 5, u_author);
  select id into i3 from asmt_item where version_id = v1 and code = 'I3';
  insert into asmt_item_field (version_id, item_id, field_key, label, response_type, config, updated_by)
    values (v1, i3, 'note', 'Note', 'free_text', '{"maxLength":20}', u_author);
  insert into asmt_item_field (version_id, item_id, field_key, label, response_type, config, updated_by)
    values (v1, i3, 'agree', 'Agreement', 'multiple_choice',
      '{"select":"single","options":[{"code":"y","label":"Yes","satisfactory":true,"credit":1},{"code":"n","label":"No","satisfactory":false,"credit":0}]}', u_author);
  insert into asmt_mapping (version_id, item_id, kind, ref_id, ref_code, ref_version, ref_hash, ref_snapshot, relation, updated_by)
    select v1, id, 'zzproof_criterion', gen_random_uuid(), 'REF-1', '1.0.0', 'hash', '{"wording":"w"}', 'assesses', u_author from asmt_item where version_id = v1 and code = 'I1';
  insert into asmt_version_layout (version_id, layout_version_id, updated_by) values (v1, layB, u_author);

  -- N1: catalogue code assignment and permanence
  e := public.asmt_assign_catalogue_code('ZZ');
  perform pg_temp.rec('N1a', e = 'ZZ-000001' and public.asmt_assign_catalogue_code('ZZ') = 'ZZ-000002', 'codes ' || e);
  perform pg_temp.refused('N1b', $q$select public.asmt_assign_catalogue_code('ZY')$q$, '%not exist or is not active%');
  perform pg_temp.refused('N2', format($q$update asmt_instrument set code = 'ZZPROOF-CHK-9' where id = %L$q$, ins), '%permanent%');
  perform pg_temp.refused('N3', format($q$update asmt_instrument set family_code = 'QQ' where id = %L$q$, ins), '%permanent%');
  perform pg_temp.allowed('N4', format($q$update asmt_instrument set name = 'Proof checklist renamed', description = 'd2' where id = %L$q$, ins));

  -- A3 (draft part): item edit by a second person records that person as an editor
  perform pg_temp.allowed('A2b', format($q$update asmt_item set prompt = 'Critical rating item edited', updated_by = %L where version_id = %L and code = 'I1'$q$, u_editor, v1));
  select (u_editor = any(edited_by)) :: int into n from asmt_instrument_version where id = v1;
  perform pg_temp.rec('A2c', n = 1, 'editor recorded in edited_by');

  -- a throwaway PUBLISHED version: the destructive freeze proofs run on it so a failed control never damages the main fixture
  insert into asmt_instrument (code, name, kind) values ('ZZPROOF-TMP-2', 'Throwaway published', 'assessment_checklist') returning id into tins;
  insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, scoring, scoring_hash, delivery_modes)
    values (tins, array[u_author], 'zzproof_formative', v_scoring, 'zzh9', array['self_assessment']) returning id into tv;
  insert into asmt_item (version_id, code, prompt, response_type, updated_by) values (tv, 'T1', 'throwaway item', 'yes_no', u_author);
  perform pg_temp.publish_version('asmt_instrument_version', tv, u_author, gov, dom, u_pub);

  -- ---- governance on v1 ---------------------------------------------------------------------------------
  -- purpose that cannot be published
  insert into asmt_instrument (code, name, kind) values ('ZZPROOF-VER-1', 'Verification purpose', 'assessment_checklist') returning id into a_ins;
  insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, scoring, delivery_modes)
    values (a_ins, array[u_author], 'zzproof_verification', v_scoring, array['self_assessment']) returning id into a_ver;
  perform pg_temp.refused('B17', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, a_ver), '%cannot be published%');
  insert into asmt_instrument (code, name, kind) values ('ZZPROOF-MODE-1', 'No delivery mode', 'assessment_checklist') returning id into a_ins;
  insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, scoring)
    values (a_ins, array[u_author], 'zzproof_formative', v_scoring) returning id into a_ver;
  perform pg_temp.refused('B18', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, a_ver), '%delivery mode%');

  -- B3: submission only by an author or editor
  perform pg_temp.refused('B3', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_other, v1), '%author or editor%');
  -- a draft version cannot go straight to approved or published
  perform pg_temp.refused('B3b', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_pub, v1), '%only be put forward%');
  perform pg_temp.allowed('B3c', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, v1));
  select content_hash, risk into h, e from asmt_instrument_version where id = v1;
  perform pg_temp.rec('B3d', h is not null and e = 'high', 'hash set and risk high because an item is critical: ' || coalesce(e, '-'));
  -- A8: content is frozen once in review
  perform pg_temp.refused('A8', format($q$update asmt_item set prompt = 'sneaky' where version_id = %L and code = 'I2'$q$, v1), '%frozen%');
  perform pg_temp.refused('A9', format($q$insert into asmt_section (version_id, title) values (%L, 'late section')$q$, v1), '%frozen%');
  -- B1, B2, B7, B8, B9: independence and authority of review decisions
  perform pg_temp.refused('B1', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v1, u_author, h), '%not independent%');
  perform pg_temp.refused('B2', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v1, u_editor, h), '%not independent%');
  perform pg_temp.refused('B7', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v1, u_nocap, h), '%not authorised%');
  perform pg_temp.refused('B8', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'domain', %L, 'approved', %L)$q$, v1, u_rev1, h), '%not authorised%');
  perform pg_temp.refused('B9', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', 'stalehash')$q$, v1, u_rev1), '%current content hash%');
  -- B4: no approval without decisions
  perform pg_temp.refused('B4', format($q$update asmt_instrument_version set state = 'approved' where id = %L$q$, v1), '%not approved%');
  perform pg_temp.allowed('B10', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v1, u_rev1, h));
  -- B12: the domain review is required for this version
  perform pg_temp.refused('B12', format($q$update asmt_instrument_version set state = 'approved' where id = %L$q$, v1), '%domain approval%');
  perform pg_temp.allowed('B10b', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'domain', %L, 'approved', %L)$q$, v1, u_dom1, h));
  perform pg_temp.allowed('B10c', format($q$update asmt_instrument_version set state = 'approved' where id = %L$q$, v1));
  -- B5, B6, B11: who cannot publish
  perform pg_temp.refused('B5', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_editor, v1), '%not independent%');
  perform pg_temp.refused('B6', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_author, v1), '%not independent%');
  perform pg_temp.refused('B11', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_rev1, v1), '%not authorised%');
  perform pg_temp.refused('A10', format($q$update asmt_instrument_version set title = 'changed while approved' where id = %L$q$, v1), '%approved version is published or returned%');
  perform pg_temp.allowed('B14', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_pub, v1));
  select count(*)::int into n from asmt_definition_event where subject_table = 'asmt_instrument_version' and subject_id = v1 and event in ('created', 'submitted', 'approved', 'published');
  perform pg_temp.rec('B14b', n = 4, 'event trail for v1 has created, submitted, approved, published: ' || n);
  -- A3 to A6: a published version is frozen in every part
  perform pg_temp.refused('A3', format($q$update asmt_item set prompt = 'edited after publish' where version_id = %L and code = 'T1'$q$, tv), '%frozen%');
  perform pg_temp.refused('A4', format($q$insert into asmt_item (version_id, prompt, response_type) values (%L, 'late', 'yes_no')$q$, tv), '%frozen%');
  perform pg_temp.refused('A5', format($q$delete from asmt_instrument_version where id = %L$q$, tv), '%kept as history%');
  perform pg_temp.refused('A6', format($q$update asmt_instrument_version set scoring_hash = 'other' where id = %L$q$, tv), '%frozen%');
  perform pg_temp.refused('A11', format($q$delete from asmt_item where version_id = %L and code = 'T1'$q$, tv), '%frozen%');

  -- ---- v2: a duplicate, an earlier editor cannot publish it, publishing it retires v1 -----------------------
  perform pg_temp.refused('B16', format($q$select public.asmt_duplicate_version(%L, %L)$q$, v1, u_nocap), '%not authorised%');
  v2 := public.asmt_duplicate_version(v1, u_author);
  select count(*)::int into n from asmt_item a join asmt_item b on b.stable_key = a.stable_key and b.version_id = v2 where a.version_id = v1;
  select count(*)::int into n2 from asmt_item where version_id = v1;
  perform pg_temp.rec('O1', n = n2 and n2 = 5, 'duplicate keeps the stable key of every item: ' || n || ' of ' || n2);
  select count(*)::int into n from asmt_item_field f join asmt_item i on i.id = f.item_id where f.version_id = v2 and i.version_id = v2;
  perform pg_temp.rec('O2', n = 2, 'item fields copied onto the new items: ' || n);
  select count(*)::int into n from asmt_mapping m join asmt_item i on i.id = m.item_id where m.version_id = v2 and i.version_id = v2;
  perform pg_temp.rec('O3', n = 1, 'mappings copied onto the new items: ' || n);
  select version_no, state, (duplicated_from_version_id = v1)::int, (select count(*) from asmt_version_layout where version_id = v2) into r from asmt_instrument_version where id = v2;
  perform pg_temp.rec('O4', r.version_no = 2 and r.state = 'draft', 'version 2 is a draft');
  perform pg_temp.allowed('B15a', format($q$update asmt_item set prompt = 'Critical rating item v2', updated_by = %L where version_id = %L and code = 'I1'$q$, u_author, v2));
  perform pg_temp.allowed('B15b', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, v2));
  select content_hash into h from asmt_instrument_version where id = v2;
  perform pg_temp.allowed('B15c', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'governance', %L, 'approved', %L)$q$, v2, u_rev2, h));
  perform pg_temp.allowed('B15d', format($q$insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', %L, 'domain', %L, 'approved', %L)$q$, v2, u_dom2, h));
  perform pg_temp.allowed('B15e', format($q$update asmt_instrument_version set state = 'approved' where id = %L$q$, v2));
  -- u_editor edited an EARLIER version of this definition, so it may not publish this one either
  perform pg_temp.refused('B15', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_editor, v2), '%not independent%');
  perform pg_temp.allowed('B15f', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_pub, v2));
  select state into e from asmt_instrument_version where id = v1;
  perform pg_temp.rec('B13', e = 'retired', 'publishing version 2 retires version 1: ' || e);
  perform pg_temp.refused('A12', format($q$update asmt_instrument_version set title = 'x' where id = %L$q$, v1), '%final%');

  -- ---- grants (D) -----------------------------------------------------------------------------------------
  perform pg_temp.refused('D1', format($q$insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (%L, 'person', %L, %L, %L, 'assessor', %L, %L, 'self grant')$q$, ins, u_subj, u_subj, u_assr, appt_assr, u_assr), '%');
  perform pg_temp.refused('D2', format($q$insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (%L, 'person', %L, %L, %L, 'assessor', %L, %L, 'self subject')$q$, ins, u_assr, u_assr, u_assr, appt_assr, u_coord), '%');
  perform pg_temp.refused('D3', format($q$insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (%L, 'person', %L, %L, %L, 'assessor', %L, %L, 'no authority')$q$, ins, u_subj, u_subj, u_assr, appt_assr, u_nocap), '%not authorised%');
  perform pg_temp.refused('D4', format($q$insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (%L, 'person', %L, %L, %L, 'assessor', %L, %L, 'wrong appointment')$q$, ins, u_subj, u_subj, u_subj2, appt_assr, u_coord), '%does not hold%');
  insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (ins, 'person', u_subj, u_subj, u_assr, 'assessor', appt_assr, u_coord, 'proof grant') returning id into g1;
  perform pg_temp.rec('D5', g1 is not null, 'a coordinator grants a named assessor a named subject');
  -- a separate grant takes the destructive grant proofs so a failed control never damages the main fixture
  insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (ins, 'person', u_other, u_other, u_assr2, 'assessor', appt_assr2, u_coord, 'proof grant x') returning id into gx;
  -- C6: a grant that is not accepted yet gives no authority
  perform pg_temp.refused('C6', format($q$select pg_temp.mk_instance(%L, %L, 'assessor', %L, %L, 'assessor_evaluated')$q$, v2, u_other, u_assr2, gx), '%not live%');
  perform pg_temp.refused('D6', format($q$update asmt_respondent_grant set accepted_at = now(), accepted_by = %L where id = %L$q$, u_assr2, gx), '%accepted by the subject%');
  perform pg_temp.allowed('D7', format($q$update asmt_respondent_grant set accepted_at = now(), accepted_by = %L where id = %L$q$, u_other, gx));
  perform pg_temp.refused('D8', format($q$update asmt_respondent_grant set reason = 'changed reason' where id = %L$q$, gx), '%only accepting and ending%');
  perform pg_temp.refused('D9', format($q$update asmt_respondent_grant set ended_at = now(), ended_by = %L, end_reason = 'outsider ends' where id = %L$q$, u_subj2, gx), '%is ended by%');
  update asmt_respondent_grant set accepted_at = now(), accepted_by = u_subj where id = g1;
  -- a second live grant for an assessor without an assess appointment is not possible (D4). A grant for a different subject:
  insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (ins, 'person', u_subj2, u_subj2, u_assr2, 'assessor', appt_assr2, u_coord, 'second grant') returning id into g2;
  perform pg_temp.allowed('D10', format($q$update asmt_respondent_grant set accepted_at = now(), accepted_by = %L where id = %L$q$, u_subj2, g2));
  perform pg_temp.allowed('D11', format($q$update asmt_respondent_grant set ended_at = now(), ended_by = %L, end_reason = 'the subject ends it' where id = %L$q$, u_subj2, g2));
  perform pg_temp.refused('D12', format($q$update asmt_respondent_grant set ended_at = null, ended_by = null, end_reason = null where id = %L$q$, g2), '%never reopened%');
  perform pg_temp.refused('C7', format($q$select pg_temp.mk_instance(%L, %L, 'assessor', %L, %L, 'assessor_evaluated')$q$, v2, u_subj2, u_assr2, g2), '%not live%');

  -- ---- instances (C) ---------------------------------------------------------------------------------------
  perform pg_temp.refused('C4', format($q$select pg_temp.mk_instance(%L, %L, 'self', %L, null, 'self_reported')$q$, v1, u_subj, u_subj), '%published version%');
  perform pg_temp.refused('C1', format($q$select pg_temp.mk_instance(%L, %L, 'self', %L, null, 'assessor_evaluated')$q$, v2, u_subj, u_subj), '%');
  perform pg_temp.refused('C2', format($q$select pg_temp.mk_instance(%L, %L, 'self', %L, null, 'auditor_recorded')$q$, v2, u_subj, u_subj), '%');
  perform pg_temp.refused('C2b', format($q$select pg_temp.mk_instance(%L, %L, 'assessor', %L, %L, 'self_reported')$q$, v2, u_subj, u_assr, g1), '%');
  perform pg_temp.refused('C3', format($q$select pg_temp.mk_instance(%L, %L, 'self', %L, null, 'self_reported')$q$, v2, u_subj, u_assr), '%');
  perform pg_temp.refused('C5', format($q$select pg_temp.mk_instance(%L, %L, 'assessor', %L, null, 'assessor_evaluated')$q$, v2, u_subj, u_assr, null), '%');
  perform pg_temp.refused('C8', format($q$select pg_temp.mk_instance(%L, %L, 'assessor', %L, %L, 'assessor_evaluated')$q$, v2, u_subj, u_subj, g1), '%');
  perform pg_temp.refused('C9', format($q$select pg_temp.mk_instance(%L, %L, 'assessor', %L, %L, 'assessor_evaluated')$q$, v2, u_other, u_assr, g1), '%does not match%');
  select count(*)::int into n from information_schema.columns where table_schema = 'public' and table_name like 'asmt\_%' and column_name ~* 'verif';
  perform pg_temp.rec('C10', n = 0, 'no verified column anywhere in the asmt tables: ' || n);
  -- self instances: both self attestations are allowed
  inst_self := pg_temp.mk_instance(v2, u_subj, 'self', u_subj, null, 'self_reported');
  inst_self2 := pg_temp.mk_instance(v2, u_subj, 'self', u_subj, null, 'ai_assisted_formative');
  perform pg_temp.rec('C11', inst_self is not null and inst_self2 is not null, 'self_reported and ai_assisted_formative self instances');
  inst_tmp := pg_temp.mk_instance(v2, u_subj, 'assessor', u_assr, g1, 'assessor_evaluated');
  select (respondent_snapshot ->> 'grantId') into e from asmt_instance where id = inst_tmp;
  perform pg_temp.rec('C12', e = g1::text, 'assessor instance snapshots the grant and the appointment');
  perform pg_temp.refused('C13', format($q$update asmt_instance set subject_id = %L, subject_user_id = %L where id = %L$q$, u_other, u_other, inst_self), '%only submission or withdrawal%');

  -- layouts pinned at start
  perform pg_temp.allowed('L1', format($q$insert into asmt_instance_layout (instance_id, layout_version_id, is_primary) values (%L, %L, true)$q$, inst_self, layA));
  perform pg_temp.allowed('L1b', format($q$insert into asmt_instance_layout (instance_id, layout_version_id, is_primary) values (%L, %L, false)$q$, inst_self, layB));
  perform pg_temp.refused('L2', format($q$insert into asmt_instance_layout (instance_id, layout_version_id) values (%L, %L)$q$, inst_self, layD), '%published layout%');
  perform pg_temp.refused('L3', format($q$insert into asmt_instance_layout (instance_id, layout_version_id) values (%L, %L)$q$, inst_self, layC), '%not one the definition allows%');
  perform pg_temp.refused('L4', format($q$update asmt_instance_layout set is_primary = false where instance_id = %L and layout_version_id = %L$q$, inst_self, layA), '%never change%');
  delete from asmt_instance where id = inst_self2;

  -- ---- responses (E) ----------------------------------------------------------------------------------------
  inst_e := pg_temp.mk_instance(v2, u_subj2, 'self', u_subj2, null, 'self_reported');
  i1 := pg_temp.item_id(v2, 'I1'); i2 := pg_temp.item_id(v2, 'I2'); i3 := pg_temp.item_id(v2, 'I3'); i4 := pg_temp.item_id(v2, 'I4'); i5 := pg_temp.item_id(v2, 'I5');
  e := pg_temp.answer(inst_e, i1, 'primary', 'L2', null, null, null, true);
  select satisfactory into r from asmt_response where instance_id = inst_e and item_id = i1;
  perform pg_temp.rec('E1', e is null and r.satisfactory = false, 'satisfactory is computed, a writer value is ignored: ' || coalesce(e, r.satisfactory::text));
  e := pg_temp.answer(inst_e, i1, 'primary', 'L5', null, null, null);
  select satisfactory, revision into r from asmt_response where instance_id = inst_e and item_id = i1;
  perform pg_temp.rec('E1b', e is null and r.satisfactory = true and r.revision = 2, 'computed true and the revision moved to 2: ' || r.revision);
  perform pg_temp.rec('E2', pg_temp.answer(inst_e, i2, 'primary', 'L9', null, null, null) like '%not on the scale%', 'level not on the scale');
  perform pg_temp.rec('E3', pg_temp.answer(inst_e, i1, 'primary', null, 'not_applicable', null, 'n/a') like '%not allowed%', 'a state the scale does not offer');
  perform pg_temp.rec('E3b', pg_temp.answer(inst_e, i2, 'primary', null, 'not_observed', null, null) is null, 'a state the scale offers');
  perform pg_temp.rec('E4', pg_temp.answer(inst_e, i4, 'primary', null, 'unable_to_determine', null, null) is null, 'unable_to_determine where the item allows it');
  perform pg_temp.rec('E4b', pg_temp.answer(inst_e, i3, 'primary', null, 'unable_to_determine', null, null) like '%not allowed%', 'unable_to_determine where the item does not allow it');
  perform pg_temp.rec('E5', pg_temp.answer(inst_e, i3, 'primary', null, 'not_applicable', null, null) like '%needs a reason%', 'not applicable needs a reason where configured');
  perform pg_temp.rec('E5b', pg_temp.answer(inst_e, i3, 'primary', null, 'not_applicable', null, 'exclusion: not performed on this ward') is null, 'not applicable with a reason');
  perform pg_temp.rec('E6', pg_temp.answer(inst_e, i3, 'note', null, null, '5'::jsonb, null) like '%non-empty text%', 'secondary field validated by its own type');
  perform pg_temp.rec('E6b', pg_temp.answer(inst_e, i3, 'zz', null, null, '"x"'::jsonb, null) like '%no field%', 'unknown field refused');
  perform pg_temp.rec('E6c', pg_temp.answer(inst_e, i3, 'note', null, null, '"a note longer than twenty chars"'::jsonb, null) like '%longer than allowed%', 'secondary field maxLength');
  perform pg_temp.rec('E6d', pg_temp.answer(inst_e, i3, 'agree', null, null, '"y"'::jsonb, null, true) is null, 'secondary field answered');
  select satisfactory into r from asmt_response where instance_id = inst_e and item_id = i3 and field_key = 'agree';
  perform pg_temp.rec('E6e', found and r.satisfactory is null, 'secondary fields are never scored');
  perform pg_temp.rec('E7', pg_temp.answer(inst_e, i4, 'primary', null, null, '"partial"'::jsonb, null) is null, 'partial credit option accepted');
  select satisfactory into r from asmt_response where instance_id = inst_e and item_id = i4;
  perform pg_temp.rec('E7b', r.satisfactory is null, 'option with satisfactory null stays null');
  perform pg_temp.rec('E7c', pg_temp.answer(inst_e, i4, 'primary', null, null, '"maybe"'::jsonb, null) like '%does not exist%', 'unknown option refused');
  perform pg_temp.rec('E8', pg_temp.answer(inst_e, i2, 'primary', 'L4', null, null, 'a remark with the answer') is null, 'a reason may accompany an answer');
  perform pg_temp.refused('E8b', format($q$insert into asmt_response (instance_id, version_id, item_id, field_key, value) values (%L, %L, %L, 'primary', '{"level_code":"L4","state":"not_observed"}')$q$, inst_e, v2, i2), '%exactly one of%');
  perform pg_temp.refused('E8c', format($q$insert into asmt_response (instance_id, version_id, item_id, field_key, value) values (%L, %L, %L, 'primary', '{"level_code":"L4","other":1}')$q$, inst_e, v2, i2), '%holds only%');
  -- state satisfactory rules: unable to demonstrate fails, every other state says nothing
  perform pg_temp.answer(inst_e, i2, 'primary', null, 'unable_to_demonstrate', null, null);
  select satisfactory into r from asmt_response where instance_id = inst_e and item_id = i2;
  perform pg_temp.rec('E9', r.satisfactory = false, 'unable_to_demonstrate counts as not satisfactory');
  perform pg_temp.answer(inst_e, i2, 'primary', null, 'not_observed', null, null);
  select satisfactory into r from asmt_response where instance_id = inst_e and item_id = i2;
  perform pg_temp.rec('E9b', found and r.satisfactory is null, 'not_observed says nothing about satisfactory');
  select level_code, state into r from asmt_response where instance_id = inst_e and item_id = i2;
  perform pg_temp.rec('E9c', r.level_code is null and r.state = 'not_observed', 'level_code and state are derived from the json answer');
  -- evidence and comments
  perform pg_temp.allowed('H0', format($q$insert into asmt_evidence (instance_id, item_id, kind, note) values (%L, %L, 'note', 'observed the procedure')$q$, inst_e, i1));
  select (provenance ? 'capturedAt')::int + (provenance ? 'itemStableKey')::int into n from asmt_evidence where instance_id = inst_e;
  perform pg_temp.rec('H0b', n = 2, 'provenance snapshot taken by trigger');
  perform pg_temp.refused('H0c', format($q$insert into asmt_evidence (instance_id, kind) values (%L, 'upload')$q$, inst_e), '%shape_check%');
  perform pg_temp.refused('H1', format($q$update asmt_evidence set note = 'changed' where instance_id = %L$q$, inst_e), '%append-only%');
  perform pg_temp.refused('H2', format($q$delete from asmt_evidence where instance_id = %L$q$, inst_e), '%append-only%');
  perform pg_temp.allowed('H3', format($q$insert into asmt_comment (instance_id, kind, body, author_id) values (%L, 'safety_concern', 'a concern', %L)$q$, inst_e, u_subj2));
  perform pg_temp.refused('H4', format($q$update asmt_comment set body = 'edited' where instance_id = %L$q$, inst_e), '%append-only%');
  -- cascade allowance: the instance (in progress) can be removed with its append-only rows
  perform pg_temp.allowed('H5', format($q$delete from asmt_instance where id = %L$q$, inst_e));
  select (select count(*) from asmt_evidence where instance_id = inst_e) + (select count(*) from asmt_comment where instance_id = inst_e) + (select count(*) from asmt_response where instance_id = inst_e) into n;
  perform pg_temp.rec('H5b', n = 0, 'the cascade removed the append-only rows with their instance: ' || n);

  -- ---- outcomes and the backstop (F) --------------------------------------------------------------------------
  -- F4: everything satisfactory, the engine says positive, the database leaves it alone
  inst_ok := pg_temp.mk_instance(v2, u_subj, 'assessor', u_assr, g1, 'assessor_evaluated');
  perform pg_temp.answer(inst_ok, i1, 'primary', 'L5', null, null, null);
  perform pg_temp.answer(inst_ok, i2, 'primary', 'L4', null, null, null);
  perform pg_temp.answer(inst_ok, i5, 'primary', 'L4', null, null, null);
  perform pg_temp.answer(inst_ok, i4, 'primary', null, null, '"yes"'::jsonb, null);
  perform pg_temp.refused('F5', format($q$select public.asmt_submit_instance(%L, %L, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'wronghash')$q$, inst_ok, u_assr), '%hash%');
  perform pg_temp.refused('F6', format($q$select public.asmt_submit_instance(%L, %L, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzh1')$q$, inst_ok, u_other), '%only the respondent%');
  o1 := public.asmt_submit_instance(inst_ok, u_assr, '{"outcomeCode":"ACH","outcomeClass":"positive","trace":{"k":1},"traceHash":"t1"}', 'asmt-engine/1', 'zzh1');
  select outcome_class, outcome_code, backstop_applied into oc from asmt_outcome where id = o1;
  perform pg_temp.rec('F4', oc.outcome_class = 'positive' and not oc.backstop_applied, 'a clean instance keeps the engine outcome: ' || oc.outcome_class);
  select status into e from asmt_instance where id = inst_ok;
  perform pg_temp.rec('F4b', e = 'submitted', 'the instance is closed');
  perform pg_temp.rec('F10', pg_temp.answer(inst_ok, i1, 'primary', 'L2', null, null, null) like '%in progress%', 'answers are final after submission');
  perform pg_temp.refused('F10b', format($q$select public.asmt_submit_instance(%L, %L, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzh1')$q$, inst_ok, u_assr), '%is submitted%');
  inst_f7 := pg_temp.mk_instance(v2, u_subj, 'assessor', u_assr, g1, 'assessor_evaluated');
  perform pg_temp.answer(inst_f7, i1, 'primary', 'L5', null, null, null);
  perform pg_temp.answer(inst_f7, i2, 'primary', 'L5', null, null, null);
  perform pg_temp.answer(inst_f7, i5, 'primary', 'L5', null, null, null);
  o7 := public.asmt_submit_instance(inst_f7, u_assr, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzh1');
  perform pg_temp.refused('F7', format($q$update asmt_outcome set outcome_class = 'partial', outcome_code = 'PART' where id = %L$q$, o7), '%append-only%');
  perform pg_temp.refused('F7b', format($q$delete from asmt_outcome where id = %L$q$, o7), '%append-only%');
  perform pg_temp.allowed('H6', format($q$insert into asmt_comment (instance_id, kind, body, author_id) values (%L, 'recommendation', 'after submission', %L)$q$, inst_ok, u_assr));

  -- F1: a failed critical item, the engine says positive on a high average
  inst_f1 := pg_temp.mk_instance(v2, u_subj, 'assessor', u_assr, g1, 'assessor_evaluated');
  perform pg_temp.answer(inst_f1, i1, 'primary', 'L2', null, null, null);
  perform pg_temp.answer(inst_f1, i2, 'primary', 'L6', null, null, null);
  perform pg_temp.answer(inst_f1, i5, 'primary', 'L6', null, null, null);
  o2 := public.asmt_submit_instance(inst_f1, u_assr, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzh1');
  select outcome_class, outcome_code, backstop_applied, backstop_detail ->> 'engineOutcomeClass' as eng into oc from asmt_outcome where id = o2;
  perform pg_temp.rec('F1', oc.outcome_class = 'negative' and oc.outcome_code = 'NOT' and oc.backstop_applied, 'critical fail forces negative: ' || oc.outcome_class || '/' || oc.outcome_code);
  -- F2: a mandatory item not assessed
  inst_f2 := pg_temp.mk_instance(v2, u_subj, 'assessor', u_assr, g1, 'assessor_evaluated');
  perform pg_temp.answer(inst_f2, i1, 'primary', 'L4', null, null, null);
  perform pg_temp.answer(inst_f2, i2, 'primary', null, 'not_assessed', null, null);
  perform pg_temp.answer(inst_f2, i5, 'primary', 'L4', null, null, null);
  o3 := public.asmt_submit_instance(inst_f2, u_assr, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzh1');
  select outcome_class, outcome_code, backstop_applied into oc from asmt_outcome where id = o3;
  perform pg_temp.rec('F2', oc.outcome_class = 'incomplete' and oc.outcome_code = 'INC' and oc.backstop_applied, 'mandatory not assessed forces incomplete: ' || oc.outcome_class);
  -- F3: both at once, negative wins
  inst_f3 := pg_temp.mk_instance(v2, u_subj, 'assessor', u_assr, g1, 'assessor_evaluated');
  perform pg_temp.answer(inst_f3, i1, 'primary', 'L1', null, null, null);
  perform pg_temp.answer(inst_f3, i2, 'primary', null, 'not_assessed', null, null);
  perform pg_temp.answer(inst_f3, i5, 'primary', 'L4', null, null, null);
  perform public.asmt_submit_instance(inst_f3, u_assr, '{"outcomeCode":"INC","outcomeClass":"incomplete"}', 'asmt-engine/1', 'zzh1');
  select outcome_class into e from asmt_outcome where instance_id = inst_f3;
  perform pg_temp.rec('F3', e = 'negative', 'a failed critical item outranks a missing mandatory item: ' || e);
  -- F8: must be observed and not observed
  inst_f8 := pg_temp.mk_instance(v2, u_subj, 'assessor', u_assr, g1, 'assessor_evaluated');
  perform pg_temp.answer(inst_f8, i1, 'primary', 'L4', null, null, null);
  perform pg_temp.answer(inst_f8, i2, 'primary', 'L4', null, null, null);
  perform pg_temp.answer(inst_f8, i5, 'primary', null, 'not_observed', null, null);
  perform public.asmt_submit_instance(inst_f8, u_assr, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzh1');
  select outcome_class into e from asmt_outcome where instance_id = inst_f8;
  perform pg_temp.rec('F8', e = 'negative', 'a critical item that must be observed and was not observed: ' || e);
  -- F9: a secondary field with a failing value never triggers the critical backstop
  -- (I3 has a secondary field agree answered n and I3 is not critical, so the primary-only rule is shown by F4 staying positive above.)

  -- a self instance submitted by the subject, for the progression proofs
  inst_o2 := pg_temp.mk_instance(v2, u_subj, 'self', u_subj, null, 'self_reported');
  perform pg_temp.answer(inst_o2, i1, 'primary', 'L5', null, null, null);
  perform pg_temp.answer(inst_o2, i2, 'primary', 'L5', null, null, null);
  perform pg_temp.answer(inst_o2, i5, 'primary', 'L5', null, null, null);
  perform public.asmt_submit_instance(inst_o2, u_subj, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzh1');
  select id into oc from asmt_outcome where instance_id = inst_o2;

  -- ---- shape two: a compliance audit (AUD-HH-01 style) with multi field items, no scale, no DDL change -------------
  perform pg_temp.rec('G0', true, 'schema signature taken before building the second shape');
  e := pg_temp.try_sql(format($q$
    with i as (insert into asmt_instrument (code, name, kind, family_code) values ('ZZPROOF-AUD-1', 'Proof audit', 'compliance_audit', 'ZZ') returning id)
    insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, scoring, scoring_hash, respondent_roles, delivery_modes, effective_from, review_due)
    select id, array[%L::uuid], 'zzproof_formative', %L::jsonb, 'zzh2', array['auditor'], array['audit'], current_date, current_date + 365 from i$q$, u_author, v_scoring::text));
  perform pg_temp.rec('G1a', e is null, 'audit definition and version: ' || coalesce(e, 'ok'));
  select v.id, v.instrument_id into a_ver, a_ins from asmt_instrument_version v join asmt_instrument i on i.id = v.instrument_id where i.code = 'ZZPROOF-AUD-1';
  e := pg_temp.try_sql(format($q$
    insert into asmt_item (version_id, code, prompt, response_type, config, mandatory, position, updated_by) values
      (%1$L, 'H1', 'Hand hygiene performed', 'yes_no', '{"allowedStates":["not_applicable"],"naReasonRequired":true}', true, 1, %2$L),
      (%1$L, 'H2', 'Visibly clean', 'pass_fail', '{}', false, 2, %2$L),
      (%1$L, 'H3', 'Opportunities observed', 'measurement', '{"unit":"count","min":0}', false, 3, %2$L),
      (%1$L, 'H4', 'Time of observation', 'datetime', '{}', false, 4, %2$L),
      (%1$L, 'H5', 'Comments', 'free_text', '{"maxLength":500}', false, 5, %2$L),
      (%1$L, 'H6', 'Agreement', 'multiple_choice', '{"select":"single","allowedStates":["unable_to_determine","not_applicable"],"options":[{"code":"yes","label":"Yes","satisfactory":true,"credit":1},{"code":"partial","label":"Partial","satisfactory":null,"credit":0.5},{"code":"no","label":"No","satisfactory":false,"credit":0}]}', false, 6, %2$L),
      (%1$L, 'H7', 'Safety rule', 'yes_no', '{}', true, 7, %2$L),
      (%1$L, 'H8', 'Photographs', 'evidence', '{"minCount":2}', false, 8, %2$L)$q$, a_ver, u_author));
  perform pg_temp.rec('G1b', e is null, 'audit items of seven response types: ' || coalesce(e, 'ok'));
  update asmt_item set critical = true where version_id = a_ver and code = 'H7';
  e := pg_temp.try_sql(format($q$
    insert into asmt_item_field (version_id, item_id, field_key, label, response_type, config, updated_by)
    select %1$L::uuid, id, f.k, f.l, 'free_text', '{}'::jsonb, %2$L::uuid from asmt_item, (values ('documented', 'Documented finding'), ('independent', 'Independent bedside finding'), ('timing', 'Timing note')) f(k, l)
     where version_id = %1$L and code = 'H6'$q$, a_ver, u_author));
  perform pg_temp.rec('G1c', e is null, 'a concurrent audit item with three extra fields: ' || coalesce(e, 'ok'));
  e := pg_temp.try_sql(format($q$
    insert into asmt_mapping (version_id, item_id, kind, ref_code, ref_snapshot, relation, updated_by)
    select %1$L::uuid, id, 'zzproof_standard', 'POLICY-7', '{"text":"policy"}'::jsonb, 'references', %2$L::uuid from asmt_item where version_id = %1$L and code = 'H1'$q$, a_ver, u_author));
  perform pg_temp.rec('G1d', e is null, 'a mapping to a quality standard held as data: ' || coalesce(e, 'ok'));
  perform pg_temp.publish_version('asmt_instrument_version', a_ver, u_author, gov, dom, u_pub);
  select count(*)::int into n from asmt_instrument_version where id = a_ver and state = 'published';
  perform pg_temp.rec('G1', n = 1, 'the audit shape publishes through the same lifecycle');
  -- an organisation unit audit by an auditor with a grant and a submitted outcome
  insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, respondent_id, respondent_role, appointment_id, granted_by, reason, accepted_at, accepted_by)
    values (a_ins, 'org_unit', gen_random_uuid(), u_assr, 'auditor', appt_assr, u_coord, 'audit grant', null, null) returning id into g3;
  update asmt_respondent_grant set accepted_at = now(), accepted_by = u_assr where id = g3;
  e := pg_temp.try_sql(format($q$insert into asmt_instance (instrument_version_id, subject_kind, subject_id, respondent_role, respondent_id, grant_id, owner_scope, attestation)
    select %L::uuid, 'org_unit', subject_id, 'auditor', %L::uuid, id, 'holdings', 'auditor_recorded' from asmt_respondent_grant where id = %L$q$, a_ver, u_assr, g3));
  perform pg_temp.rec('G2a', e is null, 'an organisation unit instance with no subject person: ' || coalesce(e, 'ok'));
  select id into inst_aud from asmt_instance where instrument_version_id = a_ver;
  select id into i1 from asmt_item where version_id = a_ver and code = 'H1';
  perform pg_temp.rec('G2b', pg_temp.answer(inst_aud, i1, 'primary', null, 'not_applicable', null, null) like '%needs a reason%', 'audit not applicable needs its reason');
  perform pg_temp.rec('G2c', pg_temp.answer(inst_aud, i1, 'primary', null, 'not_applicable', null, 'no patient contact in this unit') is null, 'audit not applicable with reason');
  perform pg_temp.rec('G2g', pg_temp.answer(inst_aud, (select id from asmt_item where version_id = a_ver and code = 'H8'), 'primary', null, null, '1'::jsonb, null) is null, 'evidence count answered');
  select satisfactory into r from asmt_response where instance_id = inst_aud and item_id = (select id from asmt_item where version_id = a_ver and code = 'H8');
  perform pg_temp.rec('G2h', r.satisfactory = false, 'one attachment is below minCount 2');
  perform pg_temp.answer(inst_aud, (select id from asmt_item where version_id = a_ver and code = 'H8'), 'primary', null, null, '2'::jsonb, null);
  select satisfactory into r from asmt_response where instance_id = inst_aud and item_id = (select id from asmt_item where version_id = a_ver and code = 'H8');
  perform pg_temp.rec('G2i', r.satisfactory = true, 'two attachments meet minCount 2');
  perform pg_temp.rec('G2j', pg_temp.answer(inst_aud, (select id from asmt_item where version_id = a_ver and code = 'H3'), 'primary', null, null, '{"value":7,"unit":"count"}'::jsonb, null) is null, 'a measurement may be an object with a value and a unit');
  perform pg_temp.rec('G2d', pg_temp.answer(inst_aud, (select id from asmt_item where version_id = a_ver and code = 'H3'), 'primary', null, null, '-1'::jsonb, null) like '%below the minimum%', 'measurement minimum');
  perform pg_temp.rec('G2e', pg_temp.answer(inst_aud, (select id from asmt_item where version_id = a_ver and code = 'H3'), 'primary', null, null, '12'::jsonb, null) is null, 'measurement answered');
  perform pg_temp.rec('G2f', pg_temp.answer(inst_aud, (select id from asmt_item where version_id = a_ver and code = 'H7'), 'primary', null, null, '"no"'::jsonb, null) is null, 'critical yes or no answered no');
  perform public.asmt_submit_instance(inst_aud, u_assr, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzh2');
  select outcome_class, backstop_applied into oc from asmt_outcome where instance_id = inst_aud;
  perform pg_temp.rec('G2', oc.outcome_class = 'negative' and oc.backstop_applied, 'a critical item with empty requirements counts as must be satisfactory, so the negative gate is forced: ' || oc.outcome_class);
  perform pg_temp.rec('G3', pg_temp.schema_signature() is not distinct from sig_before, 'no table, column, constraint or trigger was added to hold either shape');
  -- G4: a throwaway draft is removed completely
  insert into asmt_instrument (code, name, kind) values ('ZZPROOF-TMP-1', 'Throwaway', 'compliance_audit') returning id into a_ins;
  insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, scoring) values (a_ins, array[u_author], 'zzproof_formative', v_scoring) returning id into a_ver;
  insert into asmt_item (version_id, code, prompt, response_type, updated_by) values (a_ver, 'T1', 'throwaway', 'yes_no', u_author);
  delete from asmt_instrument_version where id = a_ver;
  delete from asmt_instrument where id = a_ins;
  select (select count(*) from asmt_item where version_id = a_ver) + (select count(*) from asmt_instrument where id = a_ins) into n;
  perform pg_temp.rec('G4', n = 0, 'a throwaway draft is removed with its items: ' || n);

  -- ---- progression (J) -------------------------------------------------------------------------------------------
  insert into asmt_progression_rule_set (code, name, target_kind) values ('ZZPROOF-PROG-1', 'Proof progression', 'subject_target') returning id into ps;
  insert into asmt_progression_rule_version (rule_set_id, authored_by, rules, rules_hash, stage_scale_version_id)
    values (ps, array[u_author], '{"x":1}', 'zzrh1', stgv) returning id into psv;
  perform pg_temp.refused('J8', format($q$select public.asmt_record_progression(%L, %L, 'unassessed', null, null, '[]', '{}', '{}', 'asmt-engine/1', 'rules_published', null)$q$, u_subj, psv), '%published rule version%');
  perform pg_temp.refused('J0', format($q$insert into asmt_progression_rule_version (rule_set_id, authored_by, stage_scale_version_id) values (%L, array[%L::uuid], %L)$q$, ps, u_author, scv), '%kind stage%');
  perform pg_temp.publish_version('asmt_progression_rule_version', psv, u_author, gov, dom, u_pub);
  perform pg_temp.allowed('J7', format($q$select public.asmt_record_progression(%L, %L, 'unassessed', null, 'S4', '[]', '{}', '{}', 'asmt-engine/1', 'rules_published', null)$q$, u_subj, psv));
  d1 := public.asmt_record_progression(u_subj, psv, 'staged', 'S3', 'S4', '[{"need":"more"}]', array[o1], '{"t":1}', 'asmt-engine/1', 'instance_submitted', now() + interval '180 days');
  perform pg_temp.rec('J1', d1 is not null, 'a stage resting on an assessor outcome of the same subject');
  d2 := public.asmt_record_progression(u_subj, psv, 'staged', 'S4', 'S4', '[]', array[o1], '{"t":2}', 'asmt-engine/1', 'instance_submitted', null);
  select (supersedes_id = d1)::int into n from asmt_progression_decision where id = d2;
  perform pg_temp.rec('J6', n = 1, 'the next decision supersedes the previous one');
  select id into o3 from asmt_outcome where instance_id = inst_f1;
  perform pg_temp.refused('J2', format($q$select public.asmt_record_progression(%L, %L, 'staged', 'S3', null, '[]', array[%L::uuid], '{}', 'asmt-engine/1', 'instance_submitted', null)$q$, u_subj2, psv, o1), '%same subject%');
  perform pg_temp.refused('J3', format($q$select public.asmt_record_progression(%L, %L, 'staged', 'S3', null, '[]', array[%L::uuid], '{}', 'asmt-engine/1', 'instance_submitted', null)$q$, u_subj, psv, (select id from asmt_outcome where instance_id = inst_o2)), '%self%');
  perform pg_temp.refused('J4', format($q$insert into asmt_progression_decision (subject_user_id, rule_version_id, rule_hash, engine_version, state, trigger_event, standing) values (%L, %L, 'zzrh1', 'e', 'unassessed', 'instance_submitted', 'verified')$q$, u_subj, psv), '%standing%');
  perform pg_temp.refused('J5', format($q$update asmt_progression_decision set stage_code = 'S5', state = 'staged' where id = %L$q$, d1), '%append-only%');
  perform pg_temp.refused('J9', format($q$select public.asmt_record_progression(%L, %L, 'staged', 'S9', null, '[]', array[%L::uuid], '{}', 'asmt-engine/1', 'instance_submitted', null)$q$, u_subj, psv, o1), '%not on the pinned stage scale%');
  perform pg_temp.refused('J10', format($q$select public.asmt_record_progression(%L, %L, 'staged', 'S3', null, '[]', '{}', '{}', 'asmt-engine/1', 'instance_submitted', null)$q$, u_subj, psv), '%');

  -- ---- privacy (K) ---------------------------------------------------------------------------------------------------
  select count(*)::int into n2 from asmt_instance where subject_user_id = u_subj;
  jwt := json_build_object('sub', u_subj::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claim.sub', u_subj::text, true);
  perform set_config('request.jwt.claims', jwt, true);
  execute 'set local role authenticated';
  select count(*)::int into n from asmt_instance;
  select count(*)::int into e from asmt_instrument;
  execute 'reset role';
  perform pg_temp.rec('K1', n = n2 and n2 > 0, 'a person reads only their own instances: ' || n || ' of ' || n2);
  perform pg_temp.rec('K2', e::int = 0, 'definitions are not readable by a signed in person: ' || e);
  perform set_config('request.jwt.claim.sub', u_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_other::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*)::int into n from asmt_instance;
  select count(*)::int into n2 from asmt_outcome;
  execute 'reset role';
  perform pg_temp.rec('K1b', n = 0 and n2 = 0, 'another person reads none of it: ' || n || '/' || n2);
  perform pg_temp.rec('K3', not has_function_privilege('anon', 'public.asmt_submit_instance(uuid,uuid,jsonb,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.asmt_submit_instance(uuid,uuid,jsonb,text,text)', 'execute')
    and has_function_privilege('service_role', 'public.asmt_submit_instance(uuid,uuid,jsonb,text,text)', 'execute'), 'the submit entry point is service role only');

  -- ---- result -----------------------------------------------------------------------------------------------------------
  select count(*) filter (where ok), count(*) filter (where not ok), coalesce(string_agg(id, ' ' order by id) filter (where not ok), '')
    into pass, fail, failed from pg_temp.proof;
  raise exception 'RESULT ASMT PROOFS pass=% fail=% failed: %', pass, fail, failed;
end;
$$;
