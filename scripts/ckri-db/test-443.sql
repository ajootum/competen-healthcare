-- CKRI 443 behavioural test. LOCAL DISPOSABLE DATABASE ONLY (a schema-only copy with 440, 441 and 443 applied).
-- g1, g2 governors, l1 research lead (proposer), a1 analyst, x1 external collaborator, r1 scientific reviewer.
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
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 6) g;
insert into profiles (id) select ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 6) g;
-- 01 g1, 02 g2, 03 l1, 04 a1, 05 x1, 06 r1
insert into ogs_offices (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'CKRI test office');
insert into ogs_office_appointments (office_id, person_id, role, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000101', 'research_governance_officer', 'active'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000102', 'research_governance_officer', 'active'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000102', 'research_scientific_reviewer', 'active'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000103', 'research_lead', 'active'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000106', 'research_scientific_reviewer', 'active');
set local session_replication_role = origin;

insert into ckri_purpose (code, permission, label, description, created_by) values ('edu_quality', 'collective_analytics', 'Educational quality', 'Aggregate learning measures for improving educational resources.', '00000000-0000-0000-0000-000000000101');
-- When 444 is applied, activation needs a recorded lawful basis: supply it.
do $b$ begin
  if exists (select 1 from information_schema.columns where table_name = 'ckri_purpose' and column_name = 'lawful_basis') then
    execute $x$update ckri_purpose set lawful_basis = 'consent', basis_decision_ref = 'TEST-BASIS-1' where status = 'draft'$x$;
  end if;
end $b$;
update ckri_purpose set status = 'active', activated_by = '00000000-0000-0000-0000-000000000102' where code = 'edu_quality';
insert into ckri_research_project (id, code, title, purpose_code, sponsor, proposed_by, changed_by) values ('00000000-0000-0000-0000-00000000a001', 'gaps-2026', 'Knowledge gaps 2026', 'edu_quality', 'platform', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000103');

select pg_temp.expect_error($q$update ckri_research_project set status = 'submitted', changed_by = '00000000-0000-0000-0000-000000000103' where code = 'gaps-2026'$q$, '%frozen protocol%', 'W1 no submission without a frozen protocol and plan');
select pg_temp.expect_error($q$insert into ckri_research_document (project_id, kind, version_no, content, authored_by) values ('00000000-0000-0000-0000-00000000a001', 'protocol', 1, '{"population": "Scholar users"}', '00000000-0000-0000-0000-000000000103')$q$, '%ckri_research_document_check%', 'W2 a protocol records every integrity field');
select pg_temp.expect_error($q$insert into ckri_research_document (project_id, kind, version_no, content, authored_by) values ('00000000-0000-0000-0000-00000000a001', 'analysis_plan', 1, '{"plan": "x"}', '00000000-0000-0000-0000-000000000105')$q$, '%not authorised%', 'W3 a non-member cannot write');
insert into ckri_research_document (id, project_id, kind, version_no, content, authored_by) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000a001', 'protocol', 1,
   '{"population": "consenting Scholar users", "selection_criteria": "collective analytics granted", "instruments": "formative MCQ, version 416", "scoring": "deterministic", "missing_data": "not imputed", "statistical_methods": "proportions with Wilson CI", "limitations": "self-selected, formative", "generalisability": "Scholar users only"}', '00000000-0000-0000-0000-000000000103'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000a001', 'analysis_plan', 1, '{"plan": "descriptive proportions by programme"}', '00000000-0000-0000-0000-000000000103');
update ckri_research_document set state = 'frozen', frozen_by = '00000000-0000-0000-0000-000000000103' where project_id = '00000000-0000-0000-0000-00000000a001';
select pg_temp.expect_error($q$update ckri_research_document set content = '{"plan": "changed"}' where id = '00000000-0000-0000-0000-00000000d002'$q$, '%never changes%', 'W4 a frozen document never changes');
insert into ckri_research_member (id, project_id, person_id, role) values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000104', 'analyst');
select pg_temp.expect_error($q$update ckri_research_member set status = 'active', appointed_by = '00000000-0000-0000-0000-000000000101' where id = '00000000-0000-0000-0000-00000000b001'$q$, '%before the project is approved%', 'W5 nobody joins before approval');
update ckri_research_project set status = 'submitted', changed_by = '00000000-0000-0000-0000-000000000103' where code = 'gaps-2026';
update ckri_research_project set status = 'approved', changed_by = '00000000-0000-0000-0000-000000000101', decided_by = '00000000-0000-0000-0000-000000000101', retain_until = '2031-01-01' where code = 'gaps-2026';
-- When 444 is applied, data is released only after an ethics record: record one.
update ckri_research_project set ethics_body = 'Test REC', ethics_ref = 'REC-9', ethics_decided_at = now(), changed_by = '00000000-0000-0000-0000-000000000101' where code = 'gaps-2026';
select pg_temp.expect_error($q$update ckri_research_member set status = 'active', appointed_by = '00000000-0000-0000-0000-000000000103' where id = '00000000-0000-0000-0000-00000000b001'$q$, '%not authorised%', 'W6 only a governor appoints');
update ckri_research_member set status = 'active', appointed_by = '00000000-0000-0000-0000-000000000101' where id = '00000000-0000-0000-0000-00000000b001';
select pg_temp.expect_error($q$insert into ckri_research_member (project_id, person_id, role, external) values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000105', 'external_collaborator', true)$q$, '%ckri_research_member_check%', 'W7 an external member needs an agreement');
select pg_temp.expect_error($q$insert into ckri_research_member (project_id, person_id, role, external, agreement_ref, access) values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000105', 'external_collaborator', true, 'AGR-2026-01', 'row_level')$q$, '%ckri_research_member_check%', 'W8 row-level access unrepresentable for anyone');
-- g2 joins as a team reviewer, which makes g2 not independent of this project
insert into ckri_research_member (id, project_id, person_id, role) values ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000102', 'reviewer');
update ckri_research_member set status = 'active', appointed_by = '00000000-0000-0000-0000-000000000101' where id = '00000000-0000-0000-0000-00000000b002';

select set_config('ckri.builder', 'build', true);
insert into ckri_snapshot (id, measure, period_grain, period_from, period_to, cohort_dimension, min_cohort, round_to, complementary, contract_version, policy_version, builder_version, built_by, retain_until) values
  ('00000000-0000-0000-0000-00000000c001', 'knowledge_gap', 'month', '2026-10-01', '2026-11-01', 'programme', 10, 5, true, 'c/1', 'p/1', 'b/1', '00000000-0000-0000-0000-000000000101', '2027-01-01'),
  ('00000000-0000-0000-0000-00000000c002', 'knowledge_gap', 'month', '2026-10-01', '2026-11-01', 'programme', 5, 5, true, 'c/1', 'p/1', 'b/1', '00000000-0000-0000-0000-000000000101', '2027-01-01'),
  ('00000000-0000-0000-0000-00000000c003', 'reasoning_difficulty', 'month', '2026-10-01', '2026-11-01', 'none', 10, 5, true, 'c/1', 'p/1', 'b/1', '00000000-0000-0000-0000-000000000101', '2027-01-01');
select set_config('ckri.builder', '', true);
select pg_temp.expect_error($q$insert into ckri_research_dataset (project_id, snapshot_id, label, approved_by) values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c001', 'Gaps Oct', '00000000-0000-0000-0000-000000000102')$q$, '%not on the project%', 'W9 a governor on the team cannot approve a dataset');
select pg_temp.expect_error($q$insert into ckri_research_dataset (project_id, snapshot_id, label, approved_by) values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c002', 'Gaps Oct small', '00000000-0000-0000-0000-000000000101')$q$, '%below the project minimum%', 'W10 a dataset never suppresses below the project minimum');
insert into ckri_research_dataset (id, project_id, snapshot_id, label, approved_by) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c001', 'Gaps Oct', '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c003', 'Reasoning Oct', '00000000-0000-0000-0000-000000000101');
select pg_temp.expect((select retain_until = '2031-01-01' from ckri_snapshot where id = '00000000-0000-0000-0000-00000000c001'), 'W11 an approved dataset is kept to the project date');

select pg_temp.expect_error($q$insert into ckri_research_output (project_id, dataset_ids, title, results, integrity, authored_by) values ('00000000-0000-0000-0000-00000000a001', '{00000000-0000-0000-0000-00000000e001}', 'Gaps', '{"p": 0.4}', '{"population": "consenting users"}', '00000000-0000-0000-0000-000000000104')$q$, '%ckri_research_output_check%', 'W12 an output records its full integrity record');
create temporary table integ as select '{"population": "consenting Scholar users", "selection": "collective analytics granted", "provenance": "snapshot c001, contract ckri-contract/1", "instrument_version": "formative MCQ 416", "scoring": "deterministic", "missing_data": "not imputed", "uncertainty": "Wilson 95 percent", "methods": "proportions", "limitations": "self-selected, formative", "generalisability": "Scholar users only", "reproducibility": "rebuild from snapshot provenance"}'::jsonb as j;
select pg_temp.expect_error($q$insert into ckri_research_output (project_id, dataset_ids, title, results, integrity, authored_by) select '00000000-0000-0000-0000-00000000a001', array[gen_random_uuid()], 'Gaps', '{"p": 0.4}', j, '00000000-0000-0000-0000-000000000104' from integ$q$, '%approved datasets of its own project%', 'W13 only approved datasets of this project');
select pg_temp.expect_error($q$insert into ckri_research_output (project_id, dataset_ids, title, results, integrity, authored_by) select '00000000-0000-0000-0000-00000000a001', '{00000000-0000-0000-0000-00000000e002}', 'Reasoning', '{"p": 0.4}', j, '00000000-0000-0000-0000-000000000104' from integ$q$, '%must say so%', 'W14 AI-marked figures must be declared');
select pg_temp.expect_error($q$insert into ckri_research_output (project_id, dataset_ids, title, results, integrity, authored_by, uses_ai_marked) select '00000000-0000-0000-0000-00000000a001', '{00000000-0000-0000-0000-00000000e002}', 'Reasoning', '{"p": 0.4}', j, '00000000-0000-0000-0000-000000000104', true from integ$q$, '%ckri_research_output_check%', 'W15 and stated as not validated');
insert into ckri_research_output (id, project_id, dataset_ids, title, results, integrity, authored_by, state) select '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000a001', '{00000000-0000-0000-0000-00000000e001}', 'Gaps', '{"p": 0.4}', j, '00000000-0000-0000-0000-000000000104', 'frozen' from integ;

insert into ckri_research_document (id, project_id, kind, version_no, content, authored_by) values ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000a001', 'manuscript', 1, '{"title": "Knowledge gaps in Scholar"}', '00000000-0000-0000-0000-000000000103');
update ckri_research_document set state = 'frozen', frozen_by = '00000000-0000-0000-0000-000000000103' where id = '00000000-0000-0000-0000-00000000d003';
select pg_temp.expect_error($q$insert into ckri_research_review (project_id, document_id, reviewer_id, decision, comments) values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-000000000102', 'endorse', 'Sound and well limited.')$q$, '%not independent%', 'W16 a team member cannot review');
select pg_temp.expect_error($q$insert into ckri_research_review (project_id, document_id, reviewer_id, decision, comments) values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-000000000101', 'endorse', 'Sound and well limited.')$q$, '%not authorised%', 'W17 review needs the reviewer right');
insert into ckri_publication (id, project_id, manuscript_id, venue, requested_by, changed_by) values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d003', 'African Journal of Nursing Education', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000103');
select pg_temp.expect_error($q$update ckri_publication set status = 'approved', integrity_attested = true, decided_by = '00000000-0000-0000-0000-000000000101', changed_by = '00000000-0000-0000-0000-000000000101' where id = '00000000-0000-0000-0000-00000000aa01'$q$, '%independent endorsement%', 'W18 no approval without independent endorsement');
insert into ckri_research_review (project_id, document_id, reviewer_id, decision, comments) values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-000000000106', 'endorse', 'Sound and well limited.');
select pg_temp.expect_error($q$update ckri_publication set status = 'approved', decided_by = '00000000-0000-0000-0000-000000000101', changed_by = '00000000-0000-0000-0000-000000000101' where id = '00000000-0000-0000-0000-00000000aa01'$q$, '%integrity attestation%', 'W19 no approval without the integrity attestation');
select pg_temp.expect_error($q$update ckri_publication set status = 'approved', integrity_attested = true, decided_by = '00000000-0000-0000-0000-000000000102', changed_by = '00000000-0000-0000-0000-000000000102' where id = '00000000-0000-0000-0000-00000000aa01'$q$, '%not on the project%', 'W20 a governor on the team cannot approve publication');
update ckri_publication set status = 'approved', integrity_attested = true, decided_by = '00000000-0000-0000-0000-000000000101', changed_by = '00000000-0000-0000-0000-000000000101' where id = '00000000-0000-0000-0000-00000000aa01';
update ckri_publication set status = 'published', changed_by = '00000000-0000-0000-0000-000000000103' where id = '00000000-0000-0000-0000-00000000aa01';
select ckri_publication_correct('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-000000000103', 'Table 2 denominator corrected from 40 to 45.');
select pg_temp.expect_error($q$insert into ckri_publication_event (publication_id, event, actor_id, note) values ('00000000-0000-0000-0000-00000000aa01', 'corrected', '00000000-0000-0000-0000-000000000103', 'forged correction text here')$q$, '%written only by%', 'W21 no forged publication events');
select pg_temp.expect_error($q$update ckri_publication set status = 'withdrawn', changed_by = '00000000-0000-0000-0000-000000000103' where id = '00000000-0000-0000-0000-00000000aa01'$q$, '%says why%', 'W22 a withdrawal says why');
update ckri_publication set status = 'withdrawn', changed_by = '00000000-0000-0000-0000-000000000101', note = 'Withdrawn after a data provenance error was found.' where id = '00000000-0000-0000-0000-00000000aa01';
select pg_temp.expect((select string_agg(event, ',' order by created_at) = 'requested,approved,published,corrected,withdrawn' from ckri_publication_event where publication_id = '00000000-0000-0000-0000-00000000aa01'), 'W23 the full trail: request, approval, publication, correction, withdrawal');
select pg_temp.expect_error($q$update ckri_publication set status = 'published', changed_by = '00000000-0000-0000-0000-000000000103' where id = '00000000-0000-0000-0000-00000000aa01'$q$, '%final%', 'W24 a withdrawn publication is final');
rollback;
