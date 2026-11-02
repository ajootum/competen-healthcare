-- ====================================================================================================
-- ASMT SCHOLAR ADAPTER DB PROOFS (S3a, migration 893). STAGING ONLY. Run by scripts/assessment-core-harness.ts scholar.
-- ====================================================================================================
-- One transaction. It plants its own appointments, definitions, instances and answers, checks what the database
-- refuses and allows, and ALWAYS ENDS BY RAISING its RESULT line so everything rolls back and nothing is kept.
-- It READS the real staging scoring scale DACUM 0-6 with its published stage mapping v1, the real NUR-CCF
-- framework (Respiratory Assessment, 12 criteria) and the real assessment components. It needs 11 profiles
-- without an HQ appointment and a platform owner. It needs that nothing was imported from DACUM 0-6 yet (a real
-- import makes the import proofs describe the existing version, so it refuses to run and says so).
-- The harness replaces the marker line below with the statements of one planted violation to prove that each
-- control can fail (plant, observe red, restore by the rollback).
--
-- Expect: RESULT ASMT SCHOLAR PROOFS pass=<n> fail=0 failed:
create temp table proof (id text, ok boolean, detail text) on commit drop;

create function pg_temp.rec(p_id text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into pg_temp.proof values (p_id, coalesce(p_ok, false), p_detail) $$;

create function pg_temp.try_sql(p_sql text) returns text
language plpgsql as $$ begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

create function pg_temp.refused(p_id text, p_sql text, p_pattern text default '%') returns void
language plpgsql as $$
declare e text := pg_temp.try_sql(p_sql);
begin
  perform pg_temp.rec(p_id, e is not null and e ilike p_pattern, coalesce(left(e, 200), 'NOT REFUSED'));
end $$;

create function pg_temp.allowed(p_id text, p_sql text) returns void
language plpgsql as $$
declare e text := pg_temp.try_sql(p_sql);
begin
  perform pg_temp.rec(p_id, e is null, coalesce(left(e, 200), 'ok'));
end $$;

create function pg_temp.appoint(p_office uuid, p_owner uuid, p_person uuid, p_role text) returns void
language plpgsql as $$
begin
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, authorised_by, authorised_at)
  values (p_office, p_person, 'asmt scholar proof ' || p_role, p_role, 'active', p_owner, now());
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

-- Plants a current clinical approval of a competency: a version of its current content and enough approvals from
-- reviewers whose appointments hold the clinical approve capability and whose scope covers the framework.
create function pg_temp.plant_approval(p_comp uuid, p_submitter uuid, p_owner uuid, p_reviewers uuid[]) returns int
language plpgsql as $$
declare v uuid; need int; i int;
begin
  insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by)
    select a.id, 'framework', d.framework_id, p_owner
      from ogs_office_appointments a, framework_competencies c join framework_domains d on d.id = c.domain_id
     where c.id = p_comp and a.person_id = any(p_reviewers) and a.role = 'clinical_content_reviewer';
  insert into clinical_content_version (content_kind, competency_id, submitted_by, authored_by)
    values ('competency', p_comp, p_submitter, array[p_submitter]) returning id, required_approvals into v, need;
  for i in 1..need loop
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision)
    values (v, p_reviewers[i], (select id from ogs_office_appointments where person_id = p_reviewers[i] and role = 'clinical_content_reviewer'), 'approved');
  end loop;
  return need;
end $$;

create function pg_temp.answer(p_inst uuid, p_item uuid, p_value jsonb) returns void
language plpgsql as $$
declare v_ver uuid;
begin
  select instrument_version_id into v_ver from asmt_instance where id = p_inst;
  insert into asmt_response (instance_id, version_id, item_id, field_key, value)
  values (p_inst, v_ver, p_item, 'primary', jsonb_build_object('value', p_value));
end $$;

create function pg_temp.mk_instance(p_version uuid, p_subject uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into asmt_instance (instrument_version_id, subject_kind, subject_id, subject_user_id, respondent_role, respondent_id, owner_scope, attestation)
  values (p_version, 'person', p_subject, p_subject, 'self', p_subject, 'holdings', 'self_reported')
  returning id into v_id;
  return v_id;
end $$;

-- A mapping of a criterion with a complete, correct snapshot of the criterion as it is NOW.
create function pg_temp.map_skill(p_version uuid, p_item uuid, p_skill uuid, p_actor uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into asmt_mapping (version_id, item_id, kind, ref_id, ref_code, ref_version, ref_hash, ref_snapshot, relation, updated_by)
  select p_version, p_item, 'competency_criterion', s.id, c.code, 'NUR-CCF 1.0.0', public.competency_content_hash(c.id),
         jsonb_build_object('wording', s.name, 'component_code', s.component_code, 'competency_id', c.id, 'competency_name', c.name,
                            'framework_code', 'NUR-CCF', 'framework_version', '1.0.0'),
         'assesses', p_actor
    from competency_skills s join framework_competencies c on c.id = s.competency_id where s.id = p_skill
  returning id into v_id;
  return v_id;
end $$;

create function pg_temp.new_ver(p_code text, p_purpose text, p_actor uuid) returns uuid
language plpgsql as $$
declare v_ins uuid; v_ver uuid;
begin
  insert into asmt_instrument (code, name, kind) values ('ZZPROOF-' || p_code, 'Scholar proof ' || p_code, 'assessment_checklist') returning id into v_ins;
  insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, method_codes, scoring, scoring_hash, delivery_modes)
    values (v_ins, array[p_actor], p_purpose, array['self_assessment'],
      '{"outcomes":[{"code":"ACH","label":"Achieved","class":"positive"},{"code":"NOT","label":"Not achieved","class":"negative"},{"code":"INC","label":"Incomplete","class":"incomplete"}],"gates":{"criticalFail":"NOT","mandatoryMissing":"INC"}}',
      'zz' || p_code, array['self_assessment']) returning id into v_ver;
  insert into asmt_item (version_id, code, prompt, response_type, updated_by, position) values (v_ver, 'RA-CS-01', 'Criterion for ' || p_code, 'free_text', p_actor, 1);
  return v_ver;
end $$;

create function pg_temp.item_of(p_version uuid) returns uuid
language sql as $$ select id from asmt_item where version_id = p_version order by position limit 1 $$;

do $$
declare
  pass int := 0;
  fail int := 0;
  failed text := '';
  r record;
  e text;
  n int;
  n2 int;
  ids uuid[];
  office uuid;
  owner uuid;
  u_author uuid; u_rev1 uuid; u_rev2 uuid; u_pub uuid; u_cl1 uuid; u_cl2 uuid; u_subj uuid; u_subj2 uuid; u_nocap uuid; u_coord uuid; u_assr uuid;
  appt_assr uuid;
  gov uuid[];
  dacum uuid; benner uuid; map1 uuid; rv uuid; rv2 uuid; sv uuid; bv uuid; bv_stage uuid; j jsonb;
  ra uuid; skills uuid[]; sk_comp text;
  ins uuid; v1 uuid; v2 uuid; vm uuid; vm2 uuid; vmb uuid; vver uuid; vfw uuid; vsk uuid; i_ra uuid; i_ra2 uuid; i_fw uuid; i_b uuid; i_sk uuid;
  mid uuid; vx uuid; mx uuid;
  h text; need int; k int;
  ev uuid; ei uuid; ei_item uuid; inst_a uuid; inst_b uuid; inst_c uuid; o1 uuid; ps uuid; psv uuid; g1 uuid; g2 uuid;
  res jsonb;
  v_scoring jsonb := '{"outcomes":[{"code":"ACH","label":"Achieved","class":"positive"},{"code":"NOT","label":"Not achieved","class":"negative"},{"code":"INC","label":"Incomplete","class":"incomplete"}],"gates":{"criticalFail":"NOT","mandatoryMissing":"INC"}}';
begin
  -- @@PLANT@@

  -- ---- setup: people and appointments ---------------------------------------------------------------------
  select p.id into owner from profiles p where hq_actor_is_owner(p.id) order by p.id limit 1;
  select o.id into office from ogs_offices o where o.office_type = 'hq_quality' limit 1;
  select array_agg(id) into ids from (
    select p.id from profiles p
     where not exists (select 1 from ogs_office_appointments a where a.person_id = p.id) and not hq_actor_is_owner(p.id)
     order by p.id limit 11) s;
  if owner is null or office is null or cardinality(ids) < 11 then
    raise exception 'RESULT ASMT SCHOLAR PROOFS needs a platform owner, the hq_quality office and 11 profiles without an appointment';
  end if;
  u_author := ids[1]; u_rev1 := ids[2]; u_rev2 := ids[3]; u_pub := ids[4]; u_cl1 := ids[5]; u_cl2 := ids[6];
  u_subj := ids[7]; u_subj2 := ids[8]; u_nocap := ids[9]; u_coord := ids[10]; u_assr := ids[11];
  gov := array[u_rev1, u_rev2];
  perform pg_temp.appoint(office, owner, u_author, 'assessment_studio_author');
  perform pg_temp.appoint(office, owner, u_rev1, 'assessment_studio_reviewer');
  perform pg_temp.appoint(office, owner, u_rev2, 'assessment_studio_reviewer');
  perform pg_temp.appoint(office, owner, u_pub, 'assessment_studio_publisher');
  perform pg_temp.appoint(office, owner, u_cl1, 'clinical_content_reviewer');
  perform pg_temp.appoint(office, owner, u_cl2, 'clinical_content_reviewer');
  perform pg_temp.appoint(office, owner, u_coord, 'assessment_coordinator');
  perform pg_temp.appoint(office, owner, u_assr, 'checklist_assessor');
  select id into appt_assr from ogs_office_appointments where person_id = u_assr and role = 'checklist_assessor';

  select id into dacum from scoring_scales where name = 'DACUM 0-6';
  select id into benner from scoring_scales where name = 'Benner 0-6 Scale';
  select id into map1 from competency_stage_mapping where scale_id = dacum and version = 1 and status = 'published';
  select id into ra from framework_competencies where code = 'NUR-CCF-001';
  select array_agg(id order by sort_order, id) into skills from competency_skills where competency_id = ra and is_active;
  perform pg_temp.rec('Z0', dacum is not null and benner is not null and map1 is not null and ra is not null and cardinality(skills) = 12
    and not exists (select 1 from asmt_response_scale_version where source_ref in (dacum, map1)),
    'staging has DACUM 0-6 with published mapping v1, the Respiratory Assessment competency with 12 criteria, and no earlier import');
  if fail + (select count(*) from pg_temp.proof where not ok) > 0 then
    raise exception 'RESULT ASMT SCHOLAR PROOFS precondition not met (Z0): %', (select detail from pg_temp.proof where id = 'Z0');
  end if;

  -- ---- registry rows and execute rights -----------------------------------------------------------------------
  select count(*) into n from asmt_mapping_kind where code in ('competency_criterion', 'competency', 'framework', 'programme_framework', 'qualification_level');
  select count(*) into n2 from asmt_method where code in ('self_assessment', 'direct_observation', 'knowledge_examination', 'simulation_osce', 'case_based', 'portfolio_review');
  perform pg_temp.rec('R1', n = 5 and n2 = 6, 'five mapping kinds and six methods: ' || n || '/' || n2);
  select count(*) into n from asmt_purpose where code in ('practice', 'diagnostic', 'formative', 'summative') and publishable;
  select count(*) into n2 from asmt_purpose where code = 'verification' and not publishable;
  perform pg_temp.rec('R2', n = 4 and n2 = 1, 'four publishable purposes and verification NOT publishable: ' || n || '/' || n2);
  select count(*) into n from unnest(array['asmt_scholar_import_scale(uuid,uuid,uuid)', 'asmt_scholar_import_stage_scale(uuid,uuid,uuid)', 'asmt_scholar_stage_scale(uuid)',
      'asmt_scholar_prefill_groups(uuid,uuid)', 'asmt_scholar_mapping_check(uuid)', 'asmt_scholar_criteria(text)', 'asmt_scholar_erase_user(uuid)']) f
   where has_function_privilege('service_role', 'public.' || f, 'execute')
     and not has_function_privilege('authenticated', 'public.' || f, 'execute') and not has_function_privilege('anon', 'public.' || f, 'execute');
  perform pg_temp.rec('P1', n = 7, 'every adapter function is service role only: ' || n || ' of 7');

  -- ---- import of the scoring scale and its stage mapping ---------------------------------------------------------------
  perform pg_temp.refused('I0', format($q$select public.asmt_scholar_import_scale(%L, %L, %L)$q$, dacum, map1, u_nocap), '%not authorised%');
  perform pg_temp.refused('I7', format($q$select public.asmt_scholar_import_scale(%L, %L, %L)$q$, dacum, gen_random_uuid(), u_author), '%published%mapping%');
  perform pg_temp.refused('I7b', format($q$select public.asmt_scholar_import_scale(%L, %L, %L)$q$, benner, map1, u_author), '%another scoring scale%');
  rv := public.asmt_scholar_import_scale(dacum, map1, u_author);
  select * into r from asmt_response_scale_version where id = rv;
  perform pg_temp.rec('I1', r.state = 'draft' and r.scale_kind = 'rating' and r.source_kind = 'scoring_scale' and r.source_ref = dacum and r.authored_by = array[u_author],
    'a draft rating version authored by the importer: ' || r.state || ' ' || r.scale_kind);
  select count(*) into n from asmt_response_scale_level where version_id = rv;
  perform pg_temp.rec('I1b', n = 7, 'seven levels: ' || n);
  select count(*) into n from asmt_response_scale_level l join scoring_levels sl on sl.id = l.source_level_id
   where l.version_id = rv and l.satisfactory is not distinct from sl.is_passing and l.code = sl.score::text and l.ordinal = sl.score and l.numeric_value = sl.score and l.label = sl.label;
  perform pg_temp.rec('I2', n = 7, 'code, ordinal, numeric value, label and satisfactory come from the scoring level: ' || n || ' of 7');
  select count(*) into n from asmt_response_scale_level where version_id = rv and satisfactory and ordinal >= 3;
  select count(*) into n2 from asmt_response_scale_level where version_id = rv and satisfactory is false and ordinal <= 2;
  perform pg_temp.rec('I2b', n = 4 and n2 = 3, 'satisfactory from level 3 up, not below: ' || n || '/' || n2);
  select count(*) into n from asmt_response_scale_state where version_id = rv;
  select label into e from asmt_response_scale_state where version_id = rv and state = 'unable_to_determine';
  select label into h from asmt_response_scale_state where version_id = rv and state = 'not_assessed';
  perform pg_temp.rec('I3', n = 5 and e = 'Unable to judge' and h = 'Not answered', 'the five states with their labels: ' || n || ' ' || coalesce(e, '-') || ' ' || coalesce(h, '-'));
  select count(*) into n from asmt_response_scale_level where version_id = rv and code = '0' and satisfactory is not false;
  perform pg_temp.rec('I3b', n = 0, 'absence is a state, level 0 is a real unsatisfactory level');

  select id into sv from asmt_response_scale_version where source_kind = 'competency_stage_mapping' and source_ref = map1;
  select * into r from asmt_response_scale_version where id = sv;
  perform pg_temp.rec('I4', sv is not null and r.scale_kind = 'stage' and r.state = 'draft', 'a draft stage version was built from the mapping');
  select count(*) into n from asmt_response_scale_level l join competency_stage st on st.code = l.code where l.version_id = sv and l.ordinal = st.sort_order and l.label = st.label;
  perform pg_temp.rec('I4b', n = 6 and (select count(*) from asmt_response_scale_level where version_id = sv) = 6, 'six stage levels with the stage sort order as ordinal: ' || n);
  select count(*) into n from asmt_scholar_stage_band where scale_version_id = sv and rating_scale_version_id = rv;
  select count(*) into n2 from asmt_scholar_stage_band where scale_version_id = sv and stage_code = 'novice' and from_ordinal = 1 and to_ordinal = 2;
  perform pg_temp.rec('I4c', n = 6 and n2 = 1, 'six bands and novice covers levels 1 to 2: ' || n || '/' || n2);
  select count(*) into n from asmt_response_scale_level l
   where l.version_id = rv and (select count(*) from asmt_scholar_stage_band b where b.scale_version_id = sv and l.ordinal between b.from_ordinal and b.to_ordinal) = 1;
  perform pg_temp.rec('I4d', n = 7, 'every rating level falls in exactly one band: ' || n || ' of 7');
  j := public.asmt_scholar_stage_scale(sv);
  perform pg_temp.rec('I5', jsonb_array_length(j -> 'stages') = 6 and jsonb_array_length(j -> 'bands') = 6 and (j -> 'bands' -> 1 ->> 'stage') = 'novice'
    and (j -> 'stages' -> 0 ->> 'code') = 'unstaged' and (j -> 'bands' -> 1 ->> 'from_ordinal') = '1', 'the engine stage scale is one read: ' || left(j::text, 120));
  perform pg_temp.rec('I5b', public.asmt_scholar_stage_scale(rv) is null, 'a rating version has no stage scale');

  -- idempotent per scale and mapping
  perform pg_temp.rec('I6', public.asmt_scholar_import_scale(dacum, map1, u_author) = rv and public.asmt_scholar_import_stage_scale(rv, map1, u_author) = sv
    and (select count(*) from asmt_response_scale_version where source_ref = dacum) = 1
    and (select count(*) from asmt_response_scale_version where source_ref = map1) = 1
    and (select count(*) from asmt_response_scale_level where version_id = rv) = 7, 'a second import returns the same versions and adds nothing');
  -- without a mapping: a rating version only
  bv := public.asmt_scholar_import_scale(benner, null, u_author);
  select count(*) into n from asmt_response_scale_level where version_id = bv;
  select count(*) into n2 from scoring_levels where scale_id = benner;
  perform pg_temp.rec('I8', n = n2 and n > 0 and not exists (select 1 from asmt_response_scale_version where scale_kind = 'stage' and id <> sv) and bv <> rv,
    'no mapping: a rating version with the levels of the scale and no stage version: ' || n);

  -- the bands of a draft: edits allowed, overlap refused
  perform pg_temp.refused('I9', format($q$insert into asmt_scholar_stage_band (scale_version_id, stage_code, from_ordinal, to_ordinal, rating_scale_version_id, updated_by) values (%L, 'advanced_beginner', 2, 3, %L, %L)$q$, sv, rv, u_author), '%overlap%');
  perform pg_temp.refused('I9b', format($q$update asmt_scholar_stage_band set to_ordinal = 4 where scale_version_id = %L and stage_code = 'novice'$q$, sv), '%overlap%');
  perform pg_temp.refused('I9c', format($q$insert into asmt_scholar_stage_band (scale_version_id, stage_code, from_ordinal, to_ordinal, rating_scale_version_id, updated_by) values (%L, 'expert', 9, 3, %L, %L)$q$, sv, rv, u_author), '%');
  perform pg_temp.refused('I9d', format($q$insert into asmt_scholar_stage_band (scale_version_id, stage_code, from_ordinal, to_ordinal, rating_scale_version_id, updated_by) values (%L, 'no_such_stage', 9, 9, %L, %L)$q$, sv, rv, u_author), '%');
  perform pg_temp.allowed('I9e', format($q$delete from asmt_scholar_stage_band where scale_version_id = %L and from_ordinal = 6$q$, sv));
  perform pg_temp.allowed('I9f', format($q$insert into asmt_scholar_stage_band (scale_version_id, stage_code, from_ordinal, to_ordinal, rating_scale_version_id, updated_by) values (%L, 'expert', 6, 6, %L, %L)$q$, sv, rv, u_author));

  -- the imported versions go through the normal lifecycle, published by somebody else
  perform pg_temp.refused('I10', format($q$update asmt_response_scale_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_nocap, rv), '%author or editor%');
  perform pg_temp.publish_version('asmt_response_scale_version', rv, u_author, gov, u_pub);
  perform pg_temp.publish_version('asmt_response_scale_version', sv, u_author, gov, u_pub);
  select state into e from asmt_response_scale_version where id = sv;
  perform pg_temp.rec('I10b', e = 'published', 'the stage version was published through the lifecycle: ' || e);
  perform pg_temp.refused('I11', format($q$insert into asmt_scholar_stage_band (scale_version_id, stage_code, from_ordinal, to_ordinal, rating_scale_version_id, updated_by) values (%L, 'expert', 9, 9, %L, %L)$q$, sv, rv, u_author), '%frozen%');
  perform pg_temp.refused('I11b', format($q$update asmt_scholar_stage_band set stage_code = 'expert' where scale_version_id = %L and from_ordinal = 0$q$, sv), '%frozen%');
  perform pg_temp.refused('I11c', format($q$delete from asmt_scholar_stage_band where scale_version_id = %L$q$, sv), '%frozen%');
  j := public.asmt_scholar_stage_scale(sv);
  perform pg_temp.rec('I11d', jsonb_array_length(j -> 'bands') = 6, 'a published stage scale still reads as one stage scale');

  -- ---- groups from the assessment components --------------------------------------------------------------------------
  insert into asmt_instrument (code, name, kind) values ('ZZPROOF-SCH-1', 'Scholar proof one', 'assessment_checklist') returning id into ins;
  insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, method_codes, scoring, scoring_hash, delivery_modes)
    values (ins, array[u_author], 'formative', array['self_assessment'], v_scoring, 'zzs1', array['self_assessment']) returning id into v1;
  perform pg_temp.refused('G0', format($q$select public.asmt_scholar_prefill_groups(%L, %L)$q$, v1, u_nocap), '%not authorised%');
  n := public.asmt_scholar_prefill_groups(v1, u_author);
  select count(*) into n2 from asmt_group g join competency_assessment_component c on c.code = g.code
   where g.version_id = v1 and g.label = c.label and g.position = c.sort_order and c.code in ('clinical_skills', 'knowledge', 'knowledge_application');
  perform pg_temp.rec('G1', n = 3 and n2 = 3 and (select count(*) from asmt_group where version_id = v1) = 3, 'the three components became groups: ' || n || '/' || n2);
  perform pg_temp.rec('G2', public.asmt_scholar_prefill_groups(v1, u_author) = 0 and (select count(*) from asmt_group where version_id = v1) = 3, 'a second pre-fill adds nothing');
  insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, scoring, scoring_hash, delivery_modes)
    values (ins, array[u_author], 'formative', v_scoring, 'zzs1b', array['self_assessment']) returning id into v2;
  insert into asmt_group (version_id, code, label, updated_by) values (v2, 'knowledge', 'Own wording', u_author);
  perform pg_temp.rec('G3', public.asmt_scholar_prefill_groups(v2, u_author) = 2
    and (select label from asmt_group where version_id = v2 and code = 'knowledge') = 'Own wording', 'an existing code is skipped and kept');
  perform pg_temp.refused('G5', format($q$select public.asmt_scholar_prefill_groups(%L, %L)$q$, gen_random_uuid(), u_author), '%not found%');

  -- ---- the criterion picker read ------------------------------------------------------------------------------------------
  select count(*) into n from public.asmt_scholar_criteria('NUR-CCF') where competency_code = 'NUR-CCF-001';
  perform pg_temp.rec('C1', n = 12, 'Respiratory Assessment has 12 criteria: ' || n);
  select count(*) into n from public.asmt_scholar_criteria('NUR-CCF') c
   where c.competency_code = 'NUR-CCF-001' and c.framework_code = 'NUR-CCF' and c.framework_version = '1.0.0' and c.framework_pub_status = 'draft'
     and c.competency_hash = public.competency_content_hash(ra) and c.clinically_approved = public.competency_clinically_approved(ra)
     and c.skill_id = any(skills) and c.wording = (select name from competency_skills where id = c.skill_id)
     and c.component_code is not distinct from (select component_code from competency_skills where id = c.skill_id)
     and (c.component_code is null or c.component_code in ('clinical_skills', 'knowledge', 'knowledge_application')) and c.competency_name = 'Respiratory Assessment';
  perform pg_temp.rec('C2', n = 12, 'every row carries the framework, hash, wording and component of the criterion: ' || n);
  perform pg_temp.rec('C3', not public.competency_clinically_approved(ra) and (select count(*) from public.asmt_scholar_criteria('NUR-CCF') where competency_code = 'NUR-CCF-001' and clinically_approved) = 0,
    'Respiratory Assessment is not clinically approved on staging, so the read says so on every row');
  select count(*) into n from public.asmt_scholar_criteria('NUR-CCF');
  select count(*) into n2 from competency_skills s join framework_competencies c on c.id = s.competency_id join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
   where f.code = 'NUR-CCF' and f.hospital_id is null and s.is_active is not false;
  perform pg_temp.rec('C4', n = n2 and n > 12, 'the whole framework is readable by code: ' || n || ' of ' || n2);
  perform pg_temp.rec('C5', (select count(*) from public.asmt_scholar_criteria('no-such-framework')) = 0, 'an unknown framework has no criteria');

  -- ---- the mapping check and its guard ----------------------------------------------------------------------------------------
  -- Every scenario has its own draft version, so a control that fails to refuse never breaks the next scenario.
  -- A: a complete and current mapping of a competency that is not clinically approved
  vm := pg_temp.new_ver('SCH-A', 'formative', u_author);
  mid := pg_temp.map_skill(vm, pg_temp.item_of(vm), skills[1], u_author);
  j := public.asmt_scholar_mapping_check(vm);
  perform pg_temp.rec('M0', (j ->> 'ok') = 'false' and jsonb_array_length(j -> 'problems') = 1 and (j -> 'problems' -> 0 ->> 'reason') = 'not_clinically_approved'
    and (j -> 'problems' -> 0 ->> 'item') = 'RA-CS-01', 'the check names the item and the single reason: ' || left(j::text, 160));
  perform pg_temp.refused('M3', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, vm), '%RA-CS-01%no current clinical approval%');
  -- B: a stale content hash
  vx := pg_temp.new_ver('SCH-B', 'formative', u_author);
  mx := pg_temp.map_skill(vx, pg_temp.item_of(vx), skills[2], u_author);
  update asmt_mapping set ref_hash = 'stalehash' where id = mx;
  j := public.asmt_scholar_mapping_check(vx);
  perform pg_temp.rec('M1a', (select count(*) from jsonb_array_elements(j -> 'problems') p where p ->> 'reason' = 'hash_stale') = 1, 'the check reports a stale hash');
  perform pg_temp.refused('M1', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, vx), '%RA-CS-01%stale content hash%');
  -- C: a wrong snapshot wording
  vx := pg_temp.new_ver('SCH-C', 'formative', u_author);
  mx := pg_temp.map_skill(vx, pg_temp.item_of(vx), skills[2], u_author);
  update asmt_mapping set ref_snapshot = ref_snapshot || '{"wording":"something else"}' where id = mx;
  j := public.asmt_scholar_mapping_check(vx);
  perform pg_temp.rec('M2a', (select count(*) from jsonb_array_elements(j -> 'problems') p where p ->> 'reason' = 'wording_changed') = 1
    and (select count(*) from jsonb_array_elements(j -> 'problems') p where p ->> 'reason' = 'hash_stale') = 0, 'the check reports changed wording and not a stale hash');
  perform pg_temp.refused('M2', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, vx), '%RA-CS-01%wording%');
  -- D: a wrong snapshot component
  vx := pg_temp.new_ver('SCH-D', 'formative', u_author);
  mx := pg_temp.map_skill(vx, pg_temp.item_of(vx), skills[2], u_author);
  update asmt_mapping set ref_snapshot = jsonb_set(ref_snapshot, '{component_code}', to_jsonb('zz_other_component'::text)) where id = mx;
  j := public.asmt_scholar_mapping_check(vx);
  perform pg_temp.rec('M2b', (select count(*) from jsonb_array_elements(j -> 'problems') p where p ->> 'reason' = 'component_changed') = 1, 'the check reports a changed component');
  perform pg_temp.refused('M2c', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, vx), '%component%');
  -- E: a criterion that does not exist
  vx := pg_temp.new_ver('SCH-E', 'formative', u_author);
  insert into asmt_mapping (version_id, item_id, kind, ref_id, ref_hash, ref_snapshot, relation, updated_by)
    values (vx, pg_temp.item_of(vx), 'competency_criterion', gen_random_uuid(), 'x', '{"wording":"x"}', 'assesses', u_author);
  j := public.asmt_scholar_mapping_check(vx);
  perform pg_temp.rec('M5', (select count(*) from jsonb_array_elements(j -> 'problems') p where p ->> 'reason' = 'skill_missing' and p ->> 'item' = 'RA-CS-01') = 1, 'a missing criterion is reported with its item');
  -- F: other kinds and relations are not checked
  vm2 := pg_temp.new_ver('SCH-F', 'practice', u_author);
  insert into asmt_mapping (version_id, item_id, kind, ref_id, ref_hash, ref_snapshot, relation, updated_by)
    values (vm2, pg_temp.item_of(vm2), 'framework', gen_random_uuid(), 'x', '{}', 'assesses', u_author),
           (vm2, pg_temp.item_of(vm2), 'competency_criterion', gen_random_uuid(), 'x', '{}', 'references', u_author);
  perform pg_temp.rec('M6', (public.asmt_scholar_mapping_check(vm2) ->> 'ok') = 'true', 'a framework mapping and a references relation are not checked');
  perform pg_temp.allowed('M6b', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, vm2));
  -- G: the purpose verification
  insert into asmt_instrument (code, name, kind) values ('ZZPROOF-SCH-G', 'Scholar proof verification', 'assessment_checklist') returning id into ins;
  insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, scoring, scoring_hash, delivery_modes)
    values (ins, array[u_author], 'verification', v_scoring, 'zzsg', array['self_assessment']) returning id into vver;
  j := public.asmt_scholar_mapping_check(vver);
  perform pg_temp.rec('M4', (j ->> 'ok') = 'false' and (j -> 'problems' -> 0 ->> 'reason') = 'purpose_not_allowed', 'the check refuses the purpose verification');
  perform pg_temp.refused('M4b', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, vver), '%');

  -- plant a clinical approval of the competency and the same submit passes
  need := pg_temp.plant_approval(ra, u_subj, owner, array[u_cl1, u_cl2]);
  perform pg_temp.rec('M7a', public.competency_clinically_approved(ra) and (public.asmt_scholar_mapping_check(vm) ->> 'ok') = 'true', 'with a current clinical approval the check is ok (approvals needed: ' || need || ')');
  perform pg_temp.allowed('M7', format($q$update asmt_instrument_version set state = 'in_review', submitted_by = %L where id = %L$q$, u_author, vm));
  select count(*) into n from public.asmt_scholar_criteria('NUR-CCF') where competency_code = 'NUR-CCF-001' and clinically_approved;
  perform pg_temp.rec('C6', n = 12, 'the criterion read now shows the approval on every row: ' || n);

  -- a second instrument approved and published while the mapping is current
  vmb := pg_temp.new_ver('SCH-5', 'summative', u_author);
  perform pg_temp.map_skill(vmb, pg_temp.item_of(vmb), skills[3], u_author);
  perform pg_temp.publish_version('asmt_instrument_version', vmb, u_author, gov, u_pub);
  select state into e from asmt_instrument_version where id = vmb;
  perform pg_temp.rec('M8a', e = 'published', 'a current, approved mapping publishes: ' || e);

  -- another is approved, then the criterion is reworded before it is published
  vx := pg_temp.new_ver('SCH-H', 'formative', u_author);
  perform pg_temp.map_skill(vx, pg_temp.item_of(vx), skills[1], u_author);
  update asmt_instrument_version set state = 'in_review', submitted_by = u_author where id = vx;
  select content_hash, coalesce(risk, 'standard') into h, e from asmt_instrument_version where id = vx;
  for k in 1..hq_sod_required_approvals(e) loop
    insert into asmt_review_decision (version_table, version_id, review_kind, reviewer_id, decision, content_hash) values ('asmt_instrument_version', vx, 'governance', gov[k], 'approved', h);
  end loop;
  update asmt_instrument_version set state = 'approved' where id = vx;
  update competency_skills set name = name || ' (reworded)' where id = skills[1];
  j := public.asmt_scholar_mapping_check(vx);
  perform pg_temp.rec('M8b', exists (select 1 from jsonb_array_elements(j -> 'problems') p where p ->> 'reason' = 'wording_changed')
    and exists (select 1 from jsonb_array_elements(j -> 'problems') p where p ->> 'reason' = 'hash_stale')
    and exists (select 1 from jsonb_array_elements(j -> 'problems') p where p ->> 'reason' = 'not_clinically_approved'), 'a reworded criterion is wording changed, stale and no longer approved');
  perform pg_temp.refused('M8', format($q$update asmt_instrument_version set state = 'published', published_by = %L where id = %L$q$, u_pub, vx), '%RA-CS-01%');
  select state into e from asmt_instrument_version where id = vx;
  perform pg_temp.rec('M8c', e = 'approved', 'the refused publication left it approved: ' || e);
  -- a retired criterion
  vsk := pg_temp.new_ver('SCH-6', 'diagnostic', u_author);
  perform pg_temp.map_skill(vsk, pg_temp.item_of(vsk), skills[5], u_author);
  update competency_skills set is_active = false where id = skills[5];
  j := public.asmt_scholar_mapping_check(vsk);
  perform pg_temp.rec('M9', (j -> 'problems' -> 0 ->> 'reason') = 'skill_inactive' and (j -> 'problems' -> 0 ->> 'item') = 'RA-CS-01', 'a retired criterion is reported: ' || left(j::text, 120));
  select count(*) into n from public.asmt_scholar_criteria('NUR-CCF') where competency_code = 'NUR-CCF-001';
  perform pg_temp.rec('C7', n = 11, 'the picker read lists only active criteria: ' || n);

  -- ---- Scholar erasure of assessment rows ----------------------------------------------------------------------------------------
  insert into asmt_instrument (code, name, kind) values ('ZZPROOF-SCH-7', 'Scholar proof seven', 'assessment_checklist') returning id into ins;
  insert into asmt_instrument_version (instrument_id, authored_by, purpose_code, scoring, scoring_hash, delivery_modes, respondent_roles, assess_capability)
    values (ins, array[u_author], 'formative', v_scoring, 'zzs7', array['self_assessment'], array['self', 'assessor'], 'hq.assessment.instrument.assess') returning id into vver;
  insert into asmt_item (version_id, code, prompt, response_type, updated_by, position) values (vver, 'E1', 'Free text', 'free_text', u_author, 1) returning id into ei_item;
  perform pg_temp.publish_version('asmt_instrument_version', vver, u_author, gov, u_pub);
  perform pg_temp.refused('G4', format($q$select public.asmt_scholar_prefill_groups(%L, %L)$q$, vver, u_author), '%frozen%');

  inst_a := pg_temp.mk_instance(vver, u_subj);
  perform pg_temp.answer(inst_a, ei_item, '"first answer"'::jsonb);
  insert into asmt_evidence (instance_id, item_id, kind, note) values (inst_a, ei_item, 'note', 'observed');
  insert into asmt_evidence (instance_id, kind, storage_path) values (inst_a, 'upload', 'zzproof/' || u_subj::text || '/a.pdf');
  o1 := public.asmt_submit_instance(inst_a, u_subj, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzs7');
  insert into asmt_comment (instance_id, kind, body, author_id) values (inst_a, 'comment', 'after submission', u_subj);
  inst_b := pg_temp.mk_instance(vver, u_subj);
  inst_c := pg_temp.mk_instance(vver, u_subj2);
  perform pg_temp.answer(inst_c, ei_item, '"someone else"'::jsonb);
  perform public.asmt_submit_instance(inst_c, u_subj2, '{"outcomeCode":"ACH","outcomeClass":"positive"}', 'asmt-engine/1', 'zzs7');
  insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (ins, 'person', u_subj, u_subj, u_assr, 'assessor', appt_assr, u_coord, 'proof grant') returning id into g1;
  insert into asmt_respondent_grant (instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason)
    values (ins, 'person', u_subj2, u_subj2, u_assr, 'assessor', appt_assr, u_coord, 'proof grant other') returning id into g2;
  insert into asmt_progression_rule_set (code, name, target_kind) values ('ZZPROOF-SCH-PROG', 'Scholar proof progression', 'subject_target') returning id into ps;
  insert into asmt_progression_rule_version (rule_set_id, authored_by, rules, rules_hash, stage_scale_version_id) values (ps, array[u_author], '{"x":1}', 'zzrh7', sv) returning id into psv;
  perform pg_temp.publish_version('asmt_progression_rule_version', psv, u_author, gov, u_pub);
  perform public.asmt_record_progression(u_subj, psv, 'unassessed', null, null, '[]', '{}', '{}', 'asmt-engine/1', 'rules_published', null);
  perform public.asmt_record_progression(u_subj2, psv, 'unassessed', null, null, '[]', '{}', '{}', 'asmt-engine/1', 'rules_published', null);

  perform pg_temp.refused('E0', format($q$delete from asmt_instance where id = %L$q$, inst_a), '%kept as history%');
  perform pg_temp.refused('E0b', format($q$delete from asmt_progression_decision where subject_user_id = %L$q$, u_subj), '%append-only%');
  select (select count(*) from asmt_instance where subject_user_id = u_subj) + (select count(*) from asmt_response where subject_user_id = u_subj)
       + (select count(*) from asmt_evidence where subject_user_id = u_subj) + (select count(*) from asmt_comment where subject_user_id = u_subj)
       + (select count(*) from asmt_outcome where subject_user_id = u_subj) + (select count(*) from asmt_progression_decision where subject_user_id = u_subj)
       + (select count(*) from asmt_respondent_grant where subject_user_id = u_subj) into n;
  perform pg_temp.rec('E1', n = 2 + 1 + 2 + 1 + 1 + 1 + 1, 'the fixture holds every kind of row of the learner: ' || n);
  perform pg_temp.refused('E7', $q$select public.asmt_scholar_erase_user(gen_random_uuid())$q$, '%unknown person%');
  res := public.asmt_scholar_erase_user(u_subj);
  perform pg_temp.rec('E2', (res -> 'counts' ->> 'instances') = '2' and (res -> 'counts' ->> 'responses') = '1' and (res -> 'counts' ->> 'evidence') = '2'
    and (res -> 'counts' ->> 'comments') = '1' and (res -> 'counts' ->> 'outcomes') = '1' and (res -> 'counts' ->> 'progression_decisions') = '1'
    and (res -> 'counts' ->> 'grants') = '1', 'the erase reports what it removed: ' || left((res -> 'counts')::text, 200));
  perform pg_temp.rec('E2b', res -> 'storage_paths' = to_jsonb(array['zzproof/' || u_subj::text || '/a.pdf']), 'it returns the storage paths of uploaded evidence: ' || (res -> 'storage_paths')::text);
  select (select count(*) from asmt_instance where subject_user_id = u_subj) + (select count(*) from asmt_response where subject_user_id = u_subj)
       + (select count(*) from asmt_evidence where subject_user_id = u_subj) + (select count(*) from asmt_comment where subject_user_id = u_subj)
       + (select count(*) from asmt_outcome where subject_user_id = u_subj) + (select count(*) from asmt_progression_decision where subject_user_id = u_subj)
       + (select count(*) from asmt_respondent_grant where subject_user_id = u_subj) + (select count(*) from asmt_instance_layout where instance_id in (inst_a, inst_b)) into n;
  perform pg_temp.rec('E3', n = 0, 'nothing of the learner remains: ' || n);
  select (select count(*) from asmt_instance where subject_user_id = u_subj2) + (select count(*) from asmt_response where subject_user_id = u_subj2)
       + (select count(*) from asmt_outcome where subject_user_id = u_subj2) + (select count(*) from asmt_progression_decision where subject_user_id = u_subj2)
       + (select count(*) from asmt_respondent_grant where subject_user_id = u_subj2) into n;
  perform pg_temp.rec('E4', n = 5, 'another learner is untouched: ' || n);
  perform pg_temp.rec('E4b', exists (select 1 from profiles where id = u_subj) and (select count(*) from asmt_definition_event) > 0 and exists (select 1 from asmt_instrument_version where id = vver and state = 'published'),
    'the profile and the published definition stay');
  select count(*) into n from asmt_scholar_erasure where user_id = u_subj and (counts ->> 'instances') = '2';
  perform pg_temp.rec('E5', n = 1, 'one receipt with counts and no content: ' || n);
  perform pg_temp.refused('E6', format($q$update asmt_scholar_erasure set counts = '{}' where user_id = %L$q$, u_subj), '%append-only%');
  perform pg_temp.refused('E6b', format($q$delete from asmt_scholar_erasure where user_id = %L$q$, u_subj), '%append-only%');
  perform pg_temp.refused('E8', $q$delete from asmt_instance where status = 'submitted' and subject_user_id is not null$q$, '%kept as history%');
  res := public.asmt_scholar_erase_user(u_subj);
  perform pg_temp.rec('E9', (res -> 'counts' ->> 'instances') = '0' and (res -> 'storage_paths') = '[]'::jsonb, 'erasing again is a harmless no-op');

  -- ---- result ----------------------------------------------------------------------------------------------------------------------
  select count(*) filter (where ok), count(*) filter (where not ok), coalesce(string_agg(id, ' ' order by id) filter (where not ok), '')
    into pass, fail, failed from pg_temp.proof;
  raise exception 'RESULT ASMT SCHOLAR PROOFS pass=% fail=% failed: %', pass, fail, failed;
end;
$$;
