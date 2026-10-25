-- CKRI 444 behavioural test. LOCAL DISPOSABLE DATABASE ONLY (a schema-only copy with 440-444 applied). Synthetic people.
-- g1, g2 governors, l1 research lead, x1 external collaborator.
\set ON_ERROR_STOP 1
create or replace function pg_temp.expect_error(p_sql text, p_like text, p_name text) returns void language plpgsql as $f$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm like p_like then raise notice 'PASS %', p_name; return; end if;
    raise notice 'FAIL % -- wrong error: %', p_name, sqlerrm; return;
  end;
  raise notice 'FAIL % -- no error', p_name;
end $f$;
create or replace function pg_temp.expect(p_ok boolean, p_name text) returns void language plpgsql as $f$
begin raise notice '% %', case when p_ok then 'PASS' else 'FAIL' end, p_name; end $f$;

begin;
set local session_replication_role = replica;
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000002' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 4) g;
insert into profiles (id) select ('00000000-0000-0000-0000-0000000002' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 4) g;
insert into ogs_offices (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'CKRI test office');
insert into ogs_office_appointments (office_id, person_id, role, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000201', 'research_governance_officer', 'active'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000202', 'research_governance_officer', 'active'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000203', 'research_lead', 'active');
set local session_replication_role = origin;

-- lawful basis
insert into ckri_purpose (code, permission, label, description, created_by) values
  ('edu_quality', 'collective_analytics', 'Educational quality', 'Aggregate learning measures for improving educational resources.', '00000000-0000-0000-0000-000000000201'),
  ('reasoning_study', 'research_study', 'Clinical reasoning study', 'An identified study of clinical reasoning difficulty patterns.', '00000000-0000-0000-0000-000000000201');
update ckri_purpose set requires_ethics = false where code = 'edu_quality';
select pg_temp.expect_error($q$update ckri_purpose set status = 'active', activated_by = '00000000-0000-0000-0000-000000000202' where code = 'edu_quality'$q$, '%lawful basis%', 'L1 no activation without a recorded lawful basis');
select pg_temp.expect_error($q$update ckri_purpose set lawful_basis = 'because', basis_decision_ref = 'X-1' where code = 'edu_quality'$q$, '%ckri_purpose_basis_check%', 'L2 the basis is one of the recognised bases');
update ckri_purpose set lawful_basis = 'consent', basis_decision_ref = 'COUNSEL-2026-01 (draft)' where code in ('edu_quality', 'reasoning_study');
update ckri_purpose set status = 'active', activated_by = '00000000-0000-0000-0000-000000000202' where code in ('edu_quality', 'reasoning_study');
select pg_temp.expect_error($q$update ckri_purpose set lawful_basis = 'legitimate_interests' where code = 'edu_quality'$q$, '%frozen%', 'L3 the basis of an active purpose is frozen');

-- ethics approval or documented exemption
insert into ckri_research_project (id, code, title, purpose_code, sponsor, proposed_by, changed_by) values
  ('00000000-0000-0000-0000-00000000a201', 'quality-2026', 'Quality analytics 2026', 'edu_quality', 'platform', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000203'),
  ('00000000-0000-0000-0000-00000000a202', 'study-2026', 'Reasoning study 2026', 'reasoning_study', 'platform', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000203');
insert into ckri_research_document (project_id, kind, version_no, content, authored_by)
  select p.id, k.kind, 1, case when k.kind = 'protocol' then '{"population": "p p p", "selection_criteria": "s s s", "instruments": "i i i", "scoring": "s s s", "missing_data": "m m m", "statistical_methods": "s s s", "limitations": "l l l", "generalisability": "g g g"}'::jsonb else '{"plan": "descriptive"}'::jsonb end, p.proposed_by
    from ckri_research_project p cross join (values ('protocol'), ('analysis_plan')) k(kind) where p.code in ('quality-2026', 'study-2026');
update ckri_research_document set state = 'frozen', frozen_by = '00000000-0000-0000-0000-000000000203';
update ckri_research_project set status = 'submitted', changed_by = '00000000-0000-0000-0000-000000000203';
update ckri_research_project set status = 'approved', changed_by = '00000000-0000-0000-0000-000000000201', decided_by = '00000000-0000-0000-0000-000000000201', retain_until = '2031-01-01';
select pg_temp.expect_error($q$update ckri_research_project set status = 'recruiting', changed_by = '00000000-0000-0000-0000-000000000201' where code = 'quality-2026'$q$, '%ethics approval or a documented ethics exemption%', 'E1 no research without ethics approval or exemption, even where ethics is not required');
select set_config('ckri.builder', 'build', true);
insert into ckri_snapshot (id, measure, period_grain, period_from, period_to, cohort_dimension, min_cohort, round_to, complementary, contract_version, policy_version, builder_version, built_by, retain_until)
  values ('00000000-0000-0000-0000-00000000c201', 'knowledge_gap', 'month', '2026-10-01', '2026-11-01', 'none', 10, 5, true, 'c/1', 'p/1', 'b/1', '00000000-0000-0000-0000-000000000201', '2027-01-01');
select set_config('ckri.builder', '', true);
select pg_temp.expect_error($q$insert into ckri_research_dataset (project_id, snapshot_id, label, approved_by) values ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-00000000c201', 'Gaps', '00000000-0000-0000-0000-000000000202')$q$, '%before its ethics approval or documented exemption%', 'E2 no data released before ethics approval or exemption');
select pg_temp.expect_error($q$update ckri_research_project set ethics_exemption_ref = 'EXEMPT-1', ethics_exemption_basis = 'Aggregate secondary analysis of suppressed counts only.', ethics_exemption_by = '00000000-0000-0000-0000-000000000201', changed_by = '00000000-0000-0000-0000-000000000201' where code = 'study-2026'$q$, '%cannot be exempted%', 'E3 a research study can never be exempted');
select pg_temp.expect_error($q$update ckri_research_project set ethics_exemption_ref = 'EXEMPT-1', ethics_exemption_basis = 'Aggregate secondary analysis of suppressed counts only.', ethics_exemption_by = '00000000-0000-0000-0000-000000000203', changed_by = '00000000-0000-0000-0000-000000000203' where code = 'quality-2026'$q$, '%not authorised%', 'E4 only a governor records an exemption');
select pg_temp.expect_error($q$update ckri_research_project set ethics_exemption_ref = 'EXEMPT-1', ethics_exemption_basis = 'too short', ethics_exemption_by = '00000000-0000-0000-0000-000000000201', changed_by = '00000000-0000-0000-0000-000000000201' where code = 'quality-2026'$q$, '%exemption_check%', 'E5 an exemption states its basis');
update ckri_research_project set ethics_exemption_ref = 'EXEMPT-1', ethics_exemption_basis = 'Aggregate secondary analysis of suppressed counts only, no contact with people.', ethics_exemption_by = '00000000-0000-0000-0000-000000000201', changed_by = '00000000-0000-0000-0000-000000000201' where code = 'quality-2026';
select pg_temp.expect_error($q$update ckri_research_project set ethics_body = 'REC', ethics_ref = 'REC-2', ethics_decided_at = now(), changed_by = '00000000-0000-0000-0000-000000000201' where code = 'quality-2026'$q$, '%exemption_check%', 'E6 never both an exemption and an approval');
insert into ckri_research_dataset (project_id, snapshot_id, label, approved_by) values ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-00000000c201', 'Gaps', '00000000-0000-0000-0000-000000000202');
update ckri_research_project set status = 'recruiting', changed_by = '00000000-0000-0000-0000-000000000201' where code = 'quality-2026';
select pg_temp.expect((select status = 'recruiting' and ethics_exemption_at is not null from ckri_research_project where code = 'quality-2026'), 'E7 with a documented exemption, research begins');
select pg_temp.expect_error($q$update ckri_research_project set ethics_exemption_ref = null, ethics_exemption_basis = null, ethics_exemption_by = null, ethics_exemption_at = null, changed_by = '00000000-0000-0000-0000-000000000201' where code = 'quality-2026'$q$, '%never after%', 'E8 the exemption cannot be removed once research began');

-- partner agreements and external access
select pg_temp.expect_error($q$insert into ckri_partner_agreement (code, partner_name, partner_kind, terms, document_ref, recorded_by) values ('AGR-X-2026', 'Synthetic University', 'university', '{}', 'vault/agr-x', '00000000-0000-0000-0000-000000000203')$q$, '%not authorised%', 'A1 only a governor records an agreement');
insert into ckri_partner_agreement (code, partner_name, partner_kind, project_id, terms, document_ref, signed_on, expires_on, recorded_by) values
  ('AGR-X-2026', 'Synthetic University', 'university', '00000000-0000-0000-0000-00000000a201', '{"scientific_leadership": "joint", "data_responsibilities": "aggregate only"}', 'vault/agr-x', current_date - 1, current_date + 365, '00000000-0000-0000-0000-000000000201');
select pg_temp.expect_error($q$update ckri_partner_agreement set status = 'active', authorised_by = '00000000-0000-0000-0000-000000000202' where code = 'AGR-X-2026'$q$, '%ckri_partner_agreement_check%', 'A2 all five s7 terms before it is in force');
update ckri_partner_agreement set terms = terms || '{"intellectual_property": "shared per clause 9", "authorship": "ICMJE", "publication_rights": "joint approval"}' where code = 'AGR-X-2026';
select pg_temp.expect_error($q$update ckri_partner_agreement set status = 'active', authorised_by = '00000000-0000-0000-0000-000000000201' where code = 'AGR-X-2026'$q$, '%did not record%', 'A3 the recorder cannot authorise');
insert into ckri_research_member (id, project_id, person_id, role, external, agreement_ref) values ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-000000000204', 'external_collaborator', true, 'AGR-X-2026');
select pg_temp.expect_error($q$update ckri_research_member set status = 'active', appointed_by = '00000000-0000-0000-0000-000000000201' where id = '00000000-0000-0000-0000-00000000b201'$q$, '%authorised partner agreement%', 'A4 no external access under a draft agreement');
update ckri_partner_agreement set status = 'active', authorised_by = '00000000-0000-0000-0000-000000000202' where code = 'AGR-X-2026';
select pg_temp.expect_error($q$update ckri_partner_agreement set terms = '{}' where code = 'AGR-X-2026'$q$, '%frozen%', 'A5 an authorised agreement is frozen');
update ckri_research_member set status = 'active', appointed_by = '00000000-0000-0000-0000-000000000201' where id = '00000000-0000-0000-0000-00000000b201';
select pg_temp.expect((select status = 'active' from ckri_research_member where id = '00000000-0000-0000-0000-00000000b201'), 'A6 external access under an authorised agreement in force');
insert into ckri_research_member (id, project_id, person_id, role, external, agreement_ref) values ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-00000000a202', '00000000-0000-0000-0000-000000000204', 'external_collaborator', true, 'AGR-X-2026');
select pg_temp.expect_error($q$update ckri_research_member set status = 'active', appointed_by = '00000000-0000-0000-0000-000000000201' where id = '00000000-0000-0000-0000-00000000b202'$q$, '%authorised partner agreement%', 'A7 an agreement for one project gives no access to another');
update ckri_partner_agreement set status = 'terminated', end_reason = 'Partner withdrew from the collaboration.' where code = 'AGR-X-2026';
select pg_temp.expect((select status = 'ended' from ckri_research_member where id = '00000000-0000-0000-0000-00000000b201'), 'A8 ending the agreement ends the external access made under it');
select pg_temp.expect_error($q$update ckri_partner_agreement set status = 'active' where code = 'AGR-X-2026'$q$, '%stays%', 'A9 a terminated agreement stays terminated');
select pg_temp.expect(ckri_expire_agreements() = 0, 'A10 the expiry sweep runs');
-- an institution sponsor needs an agreement in force with that institution
insert into ckri_research_project (id, code, title, purpose_code, sponsor, institution_ref, agreement_ref, proposed_by, changed_by) values
  ('00000000-0000-0000-0000-00000000a203', 'inst-2026', 'Institution analytics 2026', 'edu_quality', 'institution', '00000000-0000-0000-0000-00000000ee01', 'AGR-I-2026', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000203');
insert into ckri_research_document (project_id, kind, version_no, content, authored_by)
  select '00000000-0000-0000-0000-00000000a203', k.kind, 1, case when k.kind = 'protocol' then '{"population": "p p p", "selection_criteria": "s s s", "instruments": "i i i", "scoring": "s s s", "missing_data": "m m m", "statistical_methods": "s s s", "limitations": "l l l", "generalisability": "g g g"}'::jsonb else '{"plan": "descriptive"}'::jsonb end, '00000000-0000-0000-0000-000000000203'
    from (values ('protocol'), ('analysis_plan')) k(kind);
update ckri_research_document set state = 'frozen', frozen_by = '00000000-0000-0000-0000-000000000203' where project_id = '00000000-0000-0000-0000-00000000a203';
update ckri_research_project set status = 'submitted', changed_by = '00000000-0000-0000-0000-000000000203' where code = 'inst-2026';
update ckri_research_project set status = 'approved', changed_by = '00000000-0000-0000-0000-000000000201', decided_by = '00000000-0000-0000-0000-000000000201', retain_until = '2031-01-01' where code = 'inst-2026';
update ckri_research_project set ethics_exemption_ref = 'EXEMPT-2', ethics_exemption_basis = 'Aggregate secondary analysis of suppressed counts only, no contact with people.', ethics_exemption_by = '00000000-0000-0000-0000-000000000201', changed_by = '00000000-0000-0000-0000-000000000201' where code = 'inst-2026';
select pg_temp.expect_error($q$update ckri_research_project set status = 'recruiting', changed_by = '00000000-0000-0000-0000-000000000201' where code = 'inst-2026'$q$, '%agreement in force with that institution%', 'A11 an institution sponsor needs an authorised agreement with that institution');
insert into ckri_partner_agreement (code, partner_name, partner_kind, institution_ref, terms, document_ref, signed_on, expires_on, recorded_by) values
  ('AGR-I-2026', 'Synthetic Nursing School', 'nursing_school', '00000000-0000-0000-0000-00000000ee01', '{"scientific_leadership": "school", "data_responsibilities": "aggregate only", "intellectual_property": "clause 9", "authorship": "ICMJE", "publication_rights": "joint"}', 'vault/agr-i', current_date - 1, current_date + 365, '00000000-0000-0000-0000-000000000201');
update ckri_partner_agreement set status = 'active', authorised_by = '00000000-0000-0000-0000-000000000202' where code = 'AGR-I-2026';
update ckri_research_project set status = 'recruiting', changed_by = '00000000-0000-0000-0000-000000000201' where code = 'inst-2026';
select pg_temp.expect((select status = 'recruiting' from ckri_research_project where code = 'inst-2026'), 'A12 with the agreement in force, the institution study begins');
rollback;
