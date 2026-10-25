-- !! APPLY THIS FILE WHOLE. Part B is one DO block with a temporary helper. Paste the entire file and run it.
--
-- VERIFY 510 AND 511. Part A is read-only. Part B runs inside a transaction that ends in ROLLBACK, so it leaves
-- nothing behind (its fixtures are existing profiles, a temporary appointment per role and its own rows).
-- Every line should read true or PASS. A FAIL names the control that did not hold.

-- A. Structure
select 'seven tables, RLS on' as check, (select count(*) = 7 and bool_and(relrowsecurity) from pg_class where relname in ('competency_verification_method',
  'competency_verification_method_version', 'competency_assessor_scope', 'competency_verification_request', 'competency_verification_evidence',
  'competency_verification_event', 'competency_verification_decision')) as ok
union all select 'own-row read only, on the four person tables', (select count(*) = 4 and bool_and(cmd = 'SELECT') from pg_policies where tablename like 'competency_verification_%')
union all select 'the two capabilities exist, held only by the two new positions', (select count(*) = 2 from hq_capability where code like 'hq.competency.verification.%')
  and not exists (select 1 from hq_position_capability where capability_code like 'hq.competency.verification.%' and effective_to is null
                  and position_code not in ('competency_verification_administrator', 'competency_assessor'))
union all select 'nobody is appointed', not exists (select 1 from ogs_office_appointments where role in ('competency_verification_administrator', 'competency_assessor') and status = 'active')
union all select '511: assess is excluded from approval, govern, authoring and the Studio', (select count(*) = 4 from hq_capability_exclusions() where capability_a = 'hq.competency.verification.assess')
union all select '511: both rights are clinical-sensitive', hq_capability_sensitive_class('hq.competency.verification.assess') = 'clinical' and hq_capability_sensitive_class('hq.competency.verification.manage') = 'clinical'
union all select 'no scope or tenant column on the person tables', not exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name like 'competency_verification_%' and column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id'));

-- B. Behaviour, rolled back
begin;
create function pg_temp.refused(p_sql text, p_expect text) returns boolean language plpgsql as $f$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm ilike '%' || p_expect || '%';
end
$f$;

do $$
declare
  subj uuid; adm uuid; ass uuid; ass2 uuid; other uuid;
  office uuid; a_adm uuid; a_ass uuid; a_ass2 uuid;
  comp uuid; scale uuid; lvl uuid; lvl_low uuid; m uuid; v1 uuid; v2 uuid; v_draft uuid;
  req uuid; req2 uuid; cpd uuid; cpd_other uuid; ev uuid; dec uuid; n integer; s text; ok boolean;
  v_content jsonb;
  procedure_ok text;
begin
  select id into subj from profiles order by created_at limit 1;
  select id into adm from profiles order by created_at offset 1 limit 1;
  select id into ass from profiles order by created_at offset 2 limit 1;
  select id into ass2 from profiles order by created_at offset 3 limit 1;
  select id into other from profiles order by created_at offset 4 limit 1;
  select id into office from ogs_offices where office_type = 'hq_quality' and is_active is not false and coalesce(status, 'active') not in ('dissolved', 'archived') limit 1;
  select c.id into comp from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
   where f.hospital_id is null and f.pub_status = 'published' and f.is_active is not false and jsonb_array_length(c.learning_outcomes) >= 2 limit 1;
  select id into scale from scoring_scales order by is_default desc nulls last, name limit 1;
  select id into lvl from scoring_levels where scale_id = scale order by score desc limit 1;
  select id into lvl_low from scoring_levels where scale_id = scale order by score asc limit 1;
  if other is null or office is null or comp is null or lvl is null or lvl = lvl_low then
    raise notice 'SKIP behaviour: needs five profiles, an HQ quality office, a published shared competency with two outcomes, and a scale with two levels';
    return;
  end if;

  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start)
    values (office, adm, 'VERIFY-510 admin', 'competency_verification_administrator', 'active', now() - interval '1 minute') returning id into a_adm;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start)
    values (office, ass, 'VERIFY-510 assessor', 'competency_assessor', 'active', now() - interval '1 minute') returning id into a_ass;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start)
    values (office, ass2, 'VERIFY-510 assessor two', 'competency_assessor', 'active', now() - interval '1 minute') returning id into a_ass2;

  -- METHODS AND VERSIONS
  raise notice '% only the Studio creates a method', case when pg_temp.refused(format('insert into competency_verification_method (code, name, kind, created_by) values (%L, %L, %L, %L)',
    'v510_x', 'VERIFY-510 x', 'direct_observation', ass), 'not authorised') then 'PASS' else 'FAIL' end;
  insert into competency_verification_method (code, name, kind, created_by) values ('v510_ecg', 'VERIFY-510 ECG direct observation', 'direct_observation', adm) returning id into m;
  insert into competency_verification_method_version (method_id, authored_by) values (m, adm) returning id into v1;
  raise notice '% an empty version cannot be published', case when pg_temp.refused(format('update competency_verification_method_version set state = %L, published_by = %L where id = %L',
    'published', adm, v1), 'at least one outcome') then 'PASS' else 'FAIL' end;
  v_content := jsonb_build_object(
    'applicability', jsonb_build_object('competencyIds', jsonb_build_array(comp::text), 'contexts', jsonb_build_array('independent')),
    'scaleId', scale::text,
    'outcomes', jsonb_build_array(
      jsonb_build_object('code', 'verified', 'class', 'verified', 'label', 'Verified at the level stated'),
      jsonb_build_object('code', 'more', 'class', 'further_evidence', 'label', 'Further evidence required'),
      jsonb_build_object('code', 'not_demo', 'class', 'not_demonstrated', 'label', 'Not demonstrated under these conditions')),
    'criteria', jsonb_build_array(jsonb_build_object('id', 'c1', 'text', 'Identifies the rhythm', 'required', true),
                                   jsonb_build_object('id', 'c2', 'text', 'Optional extra', 'required', false)),
    'checklist', jsonb_build_array(jsonb_build_object('id', 'k1', 'text', 'Leads placed correctly', 'critical', true)),
    'minEvidence', 1,
    'workflow', jsonb_build_object('assignment', 'administrator', 'allowFurtherEvidence', true),
    'validity', jsonb_build_object('months', 24));
  update competency_verification_method_version set content = v_content where id = v1;
  raise notice '% a draft cannot be published by an assessor', case when pg_temp.refused(format('update competency_verification_method_version set state = %L, published_by = %L where id = %L',
    'published', ass, v1), 'not authorised to publish') then 'PASS' else 'FAIL' end;
  update competency_verification_method_version set state = 'published', published_by = adm where id = v1;
  raise notice '% published with its content hash', case when (select content_hash is not null from competency_verification_method_version where id = v1) then 'PASS' else 'FAIL' end;
  raise notice '% published criteria never change', case when pg_temp.refused(format('update competency_verification_method_version set content = %L where id = %L', '{}', v1), 'never change') then 'PASS' else 'FAIL' end;
  raise notice '% a published version cannot be deleted', case when pg_temp.refused(format('delete from competency_verification_method_version where id = %L', v1), 'retire it instead') then 'PASS' else 'FAIL' end;

  -- ASSESSOR SCOPE
  raise notice '% an assessor cannot scope their own appointment', case when pg_temp.refused(format('insert into competency_assessor_scope (appointment_id, scope_kind, scope_ref, granted_by) values (%L, %L, %L, %L)',
    a_ass, 'competency', comp, ass), 'not authorised') then 'PASS' else 'FAIL' end;
  raise notice '% a scope goes only on an assessor appointment', case when pg_temp.refused(format('insert into competency_assessor_scope (appointment_id, scope_kind, scope_ref, granted_by) values (%L, %L, %L, %L)',
    a_adm, 'competency', comp, adm), 'hold hq.competency.verification.assess') then 'PASS' else 'FAIL' end;
  insert into competency_assessor_scope (appointment_id, scope_kind, scope_ref, granted_by, grant_reason) values (a_ass, 'competency', comp, adm, 'VERIFY-510');
  insert into competency_assessor_scope (appointment_id, scope_kind, scope_ref, granted_by, grant_reason) values (a_ass, 'method', m, adm, 'VERIFY-510');
  raise notice '% a scope is never rewritten', case when pg_temp.refused(format('update competency_assessor_scope set scope_ref = %L where appointment_id = %L and scope_kind = %L', gen_random_uuid(), a_ass, 'competency'), 'never rewritten') then 'PASS' else 'FAIL' end;

  -- REQUEST AND EVIDENCE
  raise notice '% a learning outcome that is not the competency is refused', case when pg_temp.refused(format('insert into competency_verification_request (user_id, competency_id, method_version_id, outcome_indexes) values (%L, %L, %L, %L)',
    subj, comp, v1, '{99}'), 'learning outcome') then 'PASS' else 'FAIL' end;
  raise notice '% a context the method does not apply to is refused', case when pg_temp.refused(format('insert into competency_verification_request (user_id, competency_id, method_version_id, context) values (%L, %L, %L, %L)',
    subj, comp, v1, 'employer_x'), 'does not apply') then 'PASS' else 'FAIL' end;
  insert into competency_verification_request (user_id, competency_id, method_version_id, outcome_indexes, target_level_id) values (subj, comp, v1, '{0,1}', lvl) returning id into req;
  raise notice '% the request pins the competency content and framework version', case when (select competency_hash is not null and framework_version is not null and competency_snapshot ? 'learning_outcomes'
    from competency_verification_request where id = req) then 'PASS' else 'FAIL' end;
  raise notice '% a request is append-only', case when pg_temp.refused(format('update competency_verification_request set note = %L where id = %L', 'x', req), 'append-only') then 'PASS' else 'FAIL' end;
  insert into individual_professional_cpd (user_id, experience_code, activity_type, title, hours, activity_date) values (subj, 'professional', 'course', 'VERIFY-510 ECG course', 2, current_date) returning id into cpd;
  insert into individual_professional_cpd (user_id, experience_code, activity_type, title, hours, activity_date) values (other, 'professional', 'course', 'VERIFY-510 other', 1, current_date) returning id into cpd_other;
  raise notice '% another person record cannot be evidence', case when pg_temp.refused(format('insert into competency_verification_evidence (request_id, user_id, kind, cpd_id) values (%L, %L, %L, %L)',
    req, subj, 'cpd', cpd_other), 'not the person own') then 'PASS' else 'FAIL' end;
  insert into competency_verification_evidence (request_id, user_id, kind, cpd_id, outcome_indexes) values (req, subj, 'cpd', cpd, '{0}') returning id into ev;
  raise notice '% evidence carries its provenance snapshot', case when (select provenance ->> 'title' = 'VERIFY-510 ECG course' and provenance ->> 'evidence_class' = 'self_declared'
    from competency_verification_evidence where id = ev) then 'PASS' else 'FAIL' end;

  -- ASSIGNMENT
  raise notice '% nobody assigns their own request', case when pg_temp.refused(format('insert into competency_verification_event (request_id, user_id, event, actor_id, assessor_id, appointment_id) values (%L, %L, %L, %L, %L, %L)',
    req, subj, 'assigned', subj, ass, a_ass), 'no self-verification') then 'PASS' else 'FAIL' end;
  raise notice '% an assessor with no scope is refused', case when pg_temp.refused(format('insert into competency_verification_event (request_id, user_id, event, actor_id, assessor_id, appointment_id) values (%L, %L, %L, %L, %L, %L)',
    req, subj, 'assigned', adm, ass2, a_ass2), 'out of scope') then 'PASS' else 'FAIL' end;
  raise notice '% an assessor cannot claim a method assigned by an administrator', case when pg_temp.refused(format('insert into competency_verification_event (request_id, user_id, event, actor_id, assessor_id, appointment_id) values (%L, %L, %L, %L, %L, %L)',
    req, subj, 'assigned', ass, ass, a_ass), 'cannot claim') then 'PASS' else 'FAIL' end;
  insert into competency_verification_event (request_id, user_id, event, actor_id, assessor_id, appointment_id) values (req, subj, 'assigned', adm, ass, a_ass);
  raise notice '% assigned', case when competency_verification_state(req) = 'assigned' then 'PASS' else 'FAIL' end;

  -- DECISION
  raise notice '% self-verification is refused', case when pg_temp.refused(format('insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, level_id, rationale) values (%L, %L, %L, %L, %L, %L, %L, %L)',
    req, subj, subj, a_ass, v1, 'verified', lvl, 'Self assessed and verified'), 'no self-verification') then 'PASS' else 'FAIL' end;
  raise notice '% only the assigned assessor decides', case when pg_temp.refused(format('insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, level_id, rationale) values (%L, %L, %L, %L, %L, %L, %L, %L)',
    req, subj, ass2, a_ass2, v1, 'verified', lvl, 'Not the assigned assessor'), 'not the assigned assessor') then 'PASS' else 'FAIL' end;
  raise notice '% every required criterion is answered', case when pg_temp.refused(format('insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, level_id, rationale, checklist_results, evidence_reviewed) values (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    req, subj, ass, a_ass, v1, 'verified', lvl, 'Missing a criterion', '[{"id":"k1","result":"done"}]', array[ev]), 'criterion c1') then 'PASS' else 'FAIL' end;
  raise notice '% a verified outcome states its level', case when pg_temp.refused(format('insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, rationale, criteria_results, checklist_results, evidence_reviewed) values (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    req, subj, ass, a_ass, v1, 'verified', 'No level stated here', '[{"id":"c1","result":"met"}]', '[{"id":"k1","result":"done"}]', array[ev]), 'states the level') then 'PASS' else 'FAIL' end;
  raise notice '% a verified outcome needs the evidence the method requires', case when pg_temp.refused(format('insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, level_id, rationale, criteria_results, checklist_results) values (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    req, subj, ass, a_ass, v1, 'verified', lvl, 'No evidence reviewed', '[{"id":"c1","result":"met"}]', '[{"id":"k1","result":"done"}]'), 'at least 1 evidence') then 'PASS' else 'FAIL' end;
  raise notice '% a required criterion not met cannot be verified', case when pg_temp.refused(format('insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, level_id, rationale, criteria_results, checklist_results, evidence_reviewed) values (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    req, subj, ass, a_ass, v1, 'verified', lvl, 'Criterion not met here', '[{"id":"c1","result":"not_met"}]', '[{"id":"k1","result":"done"}]', array[ev]), 'not met') then 'PASS' else 'FAIL' end;
  insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, level_id, rationale, criteria_results, checklist_results, evidence_reviewed)
    values (req, subj, ass, a_ass, v1, 'verified', lvl, 'Observed interpreting three ECGs correctly', '[{"id":"c1","result":"met"}]', '[{"id":"k1","result":"done"}]', array[ev]) returning id into dec;
  raise notice '% the decision pins the criteria, the content and its validity', case when (select method_content_hash = (select content_hash from competency_verification_method_version where id = v1)
    and competency_hash is not null and outcome_class = 'verified' and valid_until = (current_date + interval '24 months')::date - 1 from competency_verification_decision where id = dec) then 'PASS' else 'FAIL' end;
  raise notice '% a decision is never rewritten', case when pg_temp.refused(format('update competency_verification_decision set rationale = %L where id = %L', 'Rewritten afterwards', dec), 'append-only') then 'PASS' else 'FAIL' end;
  raise notice '% a decision is never deleted', case when pg_temp.refused(format('delete from competency_verification_decision where id = %L', dec), 'append-only') then 'PASS' else 'FAIL' end;
  raise notice '% a decided request takes no more evidence', case when pg_temp.refused(format('insert into competency_verification_evidence (request_id, user_id, kind, cpd_id) values (%L, %L, %L, %L)',
    req, subj, 'cpd', cpd), 'takes no more evidence') then 'PASS' else 'FAIL' end;
  raise notice '% a decided request is not decided twice', case when pg_temp.refused(format('insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, rationale) values (%L, %L, %L, %L, %L, %L, %L)',
    req, subj, ass, a_ass, v1, 'not_demo', 'A second decision afterwards'), 'cannot be decided now') then 'PASS' else 'FAIL' end;

  -- REVOCATION
  raise notice '% an assessor cannot revoke', case when pg_temp.refused(format('insert into competency_verification_event (request_id, user_id, event, actor_id, decision_id, reason) values (%L, %L, %L, %L, %L, %L)',
    req, subj, 'revoked', ass, dec, 'Assessor revoking'), 'not authorised to revoke') then 'PASS' else 'FAIL' end;
  insert into competency_verification_event (request_id, user_id, event, actor_id, decision_id, reason) values (req, subj, 'revoked', adm, dec, 'VERIFY-510 revocation');
  raise notice '% a revocation happens once', case when pg_temp.refused(format('insert into competency_verification_event (request_id, user_id, event, actor_id, decision_id, reason) values (%L, %L, %L, %L, %L, %L)',
    req, subj, 'revoked', adm, dec, 'Second revocation'), 'already revoked') then 'PASS' else 'FAIL' end;
  raise notice '% the revoked decision is still there, unchanged', case when exists (select 1 from competency_verification_decision where id = dec and outcome_class = 'verified') then 'PASS' else 'FAIL' end;

  -- FURTHER EVIDENCE, THEN A NEW VERSION RETIRES THE OLD
  insert into competency_verification_request (user_id, competency_id, method_version_id) values (subj, comp, v1) returning id into req2;
  insert into competency_verification_event (request_id, user_id, event, actor_id, assessor_id, appointment_id) values (req2, subj, 'assigned', adm, ass, a_ass);
  insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, rationale, checklist_results, criteria_results)
    values (req2, subj, ass, a_ass, v1, 'more', 'Needs one more observed ECG', '[{"id":"k1","result":"not_done"}]', '[{"id":"c1","result":"not_met"}]');
  raise notice '% further evidence leaves the request awaiting evidence', case when competency_verification_state(req2) = 'awaiting_evidence' then 'PASS' else 'FAIL' end;
  raise notice '% no decision until new evidence arrives', case when pg_temp.refused(format('insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, rationale, checklist_results, criteria_results) values (%L, %L, %L, %L, %L, %L, %L, %L, %L)',
    req2, subj, ass, a_ass, v1, 'not_demo', 'Too early to decide', '[{"id":"k1","result":"done"}]', '[{"id":"c1","result":"met"}]'), 'cannot be decided now') then 'PASS' else 'FAIL' end;
  insert into competency_verification_evidence (request_id, user_id, kind, cpd_id) values (req2, subj, 'cpd', cpd);
  raise notice '% new evidence reopens it for the assigned assessor', case when competency_verification_state(req2) = 'assigned' then 'PASS' else 'FAIL' end;

  update competency_assessor_scope set ended_at = now(), ended_by = adm, end_reason = 'VERIFY-510 end' where appointment_id = a_ass and scope_kind = 'competency';
  raise notice '% an ended scope stops the decision', case when pg_temp.refused(format('insert into competency_verification_decision (request_id, user_id, assessor_id, appointment_id, method_version_id, outcome_code, rationale, checklist_results, criteria_results) values (%L, %L, %L, %L, %L, %L, %L, %L, %L)',
    req2, subj, ass, a_ass, v1, 'not_demo', 'After the scope ended', '[{"id":"k1","result":"done"}]', '[{"id":"c1","result":"met"}]'), 'out of scope') then 'PASS' else 'FAIL' end;

  insert into competency_verification_method_version (method_id, authored_by, content) values (m, adm, v_content) returning id into v2;
  update competency_verification_method_version set state = 'published', published_by = adm where id = v2;
  raise notice '% a newer published version retires the older, which keeps its criteria', case when (select state = 'retired' and content_hash is not null from competency_verification_method_version where id = v1) then 'PASS' else 'FAIL' end;

  -- THE PERSON REMOVES A SOURCE RECORD: the reference clears, the provenance stays
  delete from individual_professional_cpd where id = cpd;
  raise notice '% removing the source keeps the submitted provenance', case when (select cpd_id is null and provenance ->> 'title' = 'VERIFY-510 ECG course' from competency_verification_evidence where id = ev) then 'PASS' else 'FAIL' end;
end
$$;
rollback;

-- C. Atomic submission, rolled back: a request whose evidence fails leaves no request behind.
begin;
do $$
declare
  subj uuid; other uuid; comp uuid; v uuid; cpd_other uuid; n integer; ok boolean := false; rid uuid; adm uuid; office uuid; a_adm uuid; m uuid;
begin
  select id into subj from profiles order by created_at limit 1;
  select id into adm from profiles order by created_at offset 1 limit 1;
  select id into other from profiles order by created_at offset 4 limit 1;
  select id into office from ogs_offices where office_type = 'hq_quality' and is_active is not false limit 1;
  select c.id into comp from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
   where f.hospital_id is null and f.pub_status = 'published' and f.is_active is not false and jsonb_array_length(c.learning_outcomes) >= 2 limit 1;
  if other is null or office is null or comp is null then raise notice 'SKIP atomic submission'; return; end if;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start) values (office, adm, 'VERIFY-510 admin', 'competency_verification_administrator', 'active', now() - interval '1 minute') returning id into a_adm;
  insert into competency_verification_method (code, name, kind, created_by) values ('v510_atomic', 'VERIFY-510 atomic', 'portfolio_review', adm) returning id into m;
  insert into competency_verification_method_version (method_id, authored_by, content) values (m, adm,
    '{"outcomes":[{"code":"partial","class":"partial","label":"Partially demonstrated"}],"criteria":[{"id":"c1","text":"Portfolio complete","required":true}]}') returning id into v;
  update competency_verification_method_version set state = 'published', published_by = adm where id = v;
  insert into individual_professional_cpd (user_id, experience_code, activity_type, title, hours, activity_date) values (other, 'professional', 'course', 'VERIFY-510 other', 1, current_date) returning id into cpd_other;
  select count(*) into n from competency_verification_request where user_id = subj;
  begin
    perform competency_verification_submit(subj, comp, v, '{0}', null, 'independent', null, null, jsonb_build_array(jsonb_build_object('kind', 'cpd', 'id', cpd_other)));
  exception when others then ok := true; end;
  raise notice '% evidence that is not the person own refuses the whole submission', case when ok and (select count(*) from competency_verification_request where user_id = subj) = n then 'PASS' else 'FAIL' end;
  rid := competency_verification_submit(subj, comp, v, '{0,1}', null, 'independent', 'VERIFY-510 note', null, '[]'::jsonb);
  raise notice '% a submission with no evidence yet is a request', case when rid is not null and competency_verification_state(rid) = 'open' then 'PASS' else 'FAIL' end;
end
$$;
rollback;

-- D. Scholar study as evidence, rolled back: formative, the person own, never a verification. It uses an existing
--    Scholar Passport item (375) where the environment has one, and SKIPs where none exists.
begin;
create function pg_temp.refused(p_sql text, p_expect text) returns boolean language plpgsql as $f$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm ilike '%' || p_expect || '%';
end
$f$;
do $$
declare
  subj uuid; adm uuid; other uuid; office uuid; comp uuid; m uuid; v uuid; rid uuid; mine uuid; ev uuid;
begin
  select id, user_id into mine, subj from individual_scholar_passport_item order by included_at limit 1;
  if mine is null and to_regclass('public.individual_scholar_material') is null then
    insert into individual_scholar_passport_item (user_id, material_id, achievement, label) values ((select id from profiles order by created_at limit 1), gen_random_uuid(), 'practice_questions', 'VERIFY-510 practice questions')
      returning id, user_id into mine, subj;
  end if;
  if mine is null then raise notice 'SKIP Scholar evidence: no Scholar Passport item on this environment'; return; end if;
  select id into adm from profiles where id <> subj order by created_at limit 1;
  select id into other from profiles where id not in (subj, adm) order by created_at limit 1;
  select id into office from ogs_offices where office_type = 'hq_quality' and is_active is not false limit 1;
  select c.id into comp from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
   where f.hospital_id is null and f.pub_status = 'published' and f.is_active is not false and jsonb_array_length(c.learning_outcomes) >= 2 limit 1;
  if other is null or office is null or comp is null then raise notice 'SKIP Scholar evidence'; return; end if;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start) values (office, adm, 'VERIFY-510 admin', 'competency_verification_administrator', 'active', now() - interval '1 minute');
  insert into competency_verification_method (code, name, kind, created_by) values ('v510_scholar', 'VERIFY-510 scholar', 'portfolio_review', adm) returning id into m;
  insert into competency_verification_method_version (method_id, authored_by, content) values (m, adm,
    '{"outcomes":[{"code":"partial","class":"partial","label":"Partially demonstrated"}],"criteria":[{"id":"c1","text":"Portfolio complete","required":true}]}') returning id into v;
  update competency_verification_method_version set state = 'published', published_by = adm where id = v;
  rid := competency_verification_submit(subj, comp, v, '{0}', null, 'independent', null, null, jsonb_build_array(jsonb_build_object('kind', 'study_achievement', 'id', mine, 'linkId', gen_random_uuid())));
  select id into ev from competency_verification_evidence where request_id = rid and kind = 'study_achievement';
  raise notice '% Scholar study keeps its educational class: formative, never a verification', case when (select provenance ->> 'evidence_class' = 'scholar_formative'
    and provenance ->> 'context' like '%Not a verification%' and portfolio_link_id is not null from competency_verification_evidence where id = ev) then 'PASS' else 'FAIL' end;
  raise notice '% another person study achievement is refused', case when pg_temp.refused(format('select competency_verification_submit(%L, %L, %L, %L, null, %L, null, null, %L)',
    other, comp, v, '{0}', 'independent', jsonb_build_array(jsonb_build_object('kind', 'study_achievement', 'id', mine))), 'not the person own') then 'PASS' else 'FAIL' end;
end
$$;
rollback;
