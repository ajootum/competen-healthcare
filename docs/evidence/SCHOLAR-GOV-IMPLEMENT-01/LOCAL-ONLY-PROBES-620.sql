-- LOCAL REHEARSAL ONLY. NEVER RUN ON STAGING OR PRODUCTION: it writes test profiles, a test position and grant,
-- appointments, structure versions and audit rows.
-- Run against a throwaway postgres:17 holding a stub schema, the real 116, 117, 264, 281, 500, 580, 610 and 620.
\set VERBOSITY terse
\set O '''00000000-0000-0000-0000-000000000001'''
\set E '''00000000-0000-0000-0000-00000000000e'''
\set D '''00000000-0000-0000-0000-000000000003'''
\set A '''00000000-0000-0000-0000-00000000000a'''
insert into profiles (id, full_name, roles) values ('00000000-0000-0000-0000-000000000001', 'Owner', array['super_admin']);
insert into profiles (id, full_name) values ('00000000-0000-0000-0000-00000000000e', 'Studio Editor'),
  ('00000000-0000-0000-0000-000000000003', 'Director'), ('00000000-0000-0000-0000-00000000000a', 'Person A');
-- An editor through the capability: a test position, its grant and an active HQ appointment.
insert into hq_position (code, space, name) values ('gov_studio_editor', 'platform', 'Studio Editor (test)');
insert into hq_position_capability (position_code, capability_code) values ('gov_studio_editor', 'hq.platform.governance.manage');
insert into ogs_office_appointments (office_id, person_id, role, status)
  select id, '00000000-0000-0000-0000-00000000000e', 'gov_studio_editor', 'active' from ogs_offices where office_type = 'hq_platform';

\echo S0 a nomination under version 1
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_ai_governance_rep', :A, null, 'nominated', null, null, 'nominate A') ->> 'status';
select v.version_no as a_recorded_under from hq_gov_seat_appointment a join hq_gov_structure_version v on v.id = a.structure_version_id;

\echo S1 a user without the capability cannot open a draft
select hq_gov_studio_create_draft(:D, 'D', 't', 'scholar', 'try', 'try a draft');
\echo S2 the editor opens a draft, a copy of version 1
select hq_gov_studio_create_draft(:E, 'E', 't', 'scholar', 'Version 2: quality office', 'restructure portfolios') ->> 'version_no';
\echo S3 a second open version is refused
select hq_gov_studio_create_draft(:O, 'O', 't', 'scholar', 'another', 'second draft');
\echo S4 a stale revision is refused
select hq_gov_studio_save_draft(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 2), 99, '{}'::jsonb, null, null, 'stale save');

\echo S5 the editor changes the draft: a new department, a new position in it, a move, a rename, a new escalation line
with v as (select id, revision, definition d from hq_gov_structure_version where structure_code = 'scholar' and version_no = 2)
select hq_gov_studio_save_draft(:E, 'E', 't', v.id, v.revision,
  jsonb_set(jsonb_set(jsonb_set(v.d,
    '{units}', (v.d -> 'units') || '[{"code": "scholar_quality_office", "level": 3, "kind": "department", "name": "Scholar Quality Office", "parent": "scholar_product_operations", "constitution_status": "pending_constitution", "sort": 45}]'::jsonb),
    '{positions}', (select jsonb_agg(case
        when p ->> 'code' = 'portfolio_student_success' then p || '{"name": "Student Success and Wellbeing"}'::jsonb
        when p ->> 'code' = 'portfolio_finance_administration' then p || '{"unit": "scholar_quality_office"}'::jsonb
        else p end) from jsonb_array_elements(v.d -> 'positions') p)
      || '[{"code": "quality_office_lead", "unit": "scholar_quality_office", "name": "Quality Office Lead", "kind": "lead", "requirements": "Quality management qualification", "sort": 10}]'::jsonb),
    '{relationships}', (v.d -> 'relationships') || '[{"code": "quality_office_escalation", "from": "scholar_quality_office", "to": "scholar_governance_committee", "type": "escalation", "scope": "Quality concerns escalate to the Committee", "sort": 90}]'::jsonb),
  null, 'Adds a Quality Office', 'restructure portfolios') ->> 'revision' from v;

\echo S6 removing a published position instead of retiring it is refused at submit
with v as (select id, revision, definition d from hq_gov_structure_version where version_no = 2)
select hq_gov_studio_save_draft(:E, 'E', 't', v.id, v.revision,
  jsonb_set(v.d, '{positions}', (select jsonb_agg(p) from jsonb_array_elements(v.d -> 'positions') p where p ->> 'code' <> 'portfolio_student_success')),
  null, null, 'drop a seat') ->> 'revision' from v;
select hq_gov_studio_transition(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 2), 'submit', 'ready for review');
\echo S6b restore the position from the version 1 definition
with v as (select id, revision, definition d from hq_gov_structure_version where version_no = 2),
     s as (select p from hq_gov_structure_version x, jsonb_array_elements(x.definition -> 'positions') p
            where x.version_no = 1 and p ->> 'code' = 'portfolio_student_success')
select hq_gov_studio_save_draft(:E, 'E', 't', v.id, v.revision,
  jsonb_set(v.d, '{positions}', (v.d -> 'positions') || jsonb_build_array((select p || '{"name": "Student Success and Wellbeing"}'::jsonb from s))),
  null, null, 'restore the seat') ->> 'revision' from v;

\echo S7 the editor submits for review
select hq_gov_studio_transition(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 2), 'submit', 'ready for review') ->> 'to';
\echo S7b submitting a version already in review is refused
select hq_gov_studio_transition(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 2), 'submit', 'submit again');
\echo S8 a review is not edited
select hq_gov_studio_save_draft(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 2),
  (select revision from hq_gov_structure_version where version_no = 2), '{}'::jsonb, null, null, 'edit in review');
\echo S9 the editor cannot approve
select hq_gov_studio_transition(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 2), 'approve', 'approve it');
\echo S10 the owner approves, not self-approved
select hq_gov_studio_transition(:O, 'O', 't', (select id from hq_gov_structure_version where version_no = 2), 'approve', 'reviewed and approved') ->> 'self_approved';
\echo S11 the editor cannot publish, and the owner needs a basis
select hq_gov_studio_publish(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 2), null, 'Owner decision 1', 'publish');
select hq_gov_studio_publish(:O, 'O', 't', (select id from hq_gov_structure_version where version_no = 2), null, ' ', 'publish');
\echo S12 the owner publishes
select hq_gov_studio_publish(:O, 'O', 't', (select id from hq_gov_structure_version where version_no = 2), date '2026-11-01', 'Owner decision OD-1', 'publish v2') ->> 'version_no';
select version_no, status, effective_from, jsonb_array_length(definition -> 'positions') as positions from hq_gov_structure_version order by version_no;

\echo S13 the live structure is version 2: new department, moved and renamed positions, a pending escalation line
select code, kind, level, parent_body_code, (select version_no from hq_gov_structure_version where id = introduced_version_id) as introduced
  from hq_gov_body where code = 'scholar_quality_office';
select code, body_code, name from hq_gov_seat where code in ('portfolio_finance_administration', 'portfolio_student_success', 'quality_office_lead') order by code;
select code, relation, status from hq_gov_delegation where code = 'quality_office_escalation';
\echo S14 the earlier decisions and appointment are untouched
select count(*) filter (where status = 'interim') as interim, count(*) filter (where status = 'pending') as pending from hq_gov_delegation;
select v.version_no as a_still_under from hq_gov_seat_appointment a join hq_gov_structure_version v on v.id = a.structure_version_id where a.seat_code = 'committee_ai_governance_rep';
\echo S15 version 1 is history: superseded, its definition unchanged, still names the old position name
select status, superseded_by_version_id is not null as superseded,
       (select p ->> 'name' from jsonb_array_elements(definition -> 'positions') p where p ->> 'code' = 'portfolio_student_success') as old_name
  from hq_gov_structure_version where version_no = 1;
\echo S16 a published version is immutable, a version is never deleted
update hq_gov_structure_version set title = 'rewritten' where version_no = 2;
update hq_gov_structure_version set definition = '{}'::jsonb where version_no = 1;
delete from hq_gov_structure_version where version_no = 1;
\echo S17 an appointment made now records version 2
select hq_gov_admin_appoint(:O, 'O', 't', 'quality_office_lead', null, 'External Quality Lead', 'nominated', null, null, 'nominate') ->> 'status';
select v.version_no from hq_gov_seat_appointment a join hq_gov_structure_version v on v.id = a.structure_version_id where a.seat_code = 'quality_office_lead';
\echo S18 retiring a position with a live record is refused, and changing a relationship scope is refused
select hq_gov_studio_create_draft(:E, 'E', 't', 'scholar', 'Version 3', 'retire test') ->> 'version_no';
with v as (select id, revision, definition d from hq_gov_structure_version where version_no = 3)
select hq_gov_studio_save_draft(:E, 'E', 't', v.id, v.revision,
  jsonb_set(v.d, '{positions}', (select jsonb_agg(case when p ->> 'code' = 'quality_office_lead' then p || '{"retired": true}'::jsonb else p end) from jsonb_array_elements(v.d -> 'positions') p)),
  null, null, 'retire the lead') ->> 'revision' from v;
select hq_gov_studio_transition(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 3), 'submit', 'submit retire');
with v as (select id, revision, definition d from hq_gov_structure_version where version_no = 3)
select hq_gov_studio_save_draft(:E, 'E', 't', v.id, v.revision,
  jsonb_set(v.d, '{relationships}', (select jsonb_agg(case when r ->> 'code' = 'board_to_committee' then r || '{"scope": "rewritten scope"}'::jsonb else r end) from jsonb_array_elements(v.d -> 'relationships') r)),
  null, null, 'rewrite scope') ->> 'revision' from v;
select hq_gov_studio_transition(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 3), 'submit', 'submit scope');
\echo S19 the draft is discarded, and the live structure is still version 2
select hq_gov_studio_transition(:E, 'E', 't', (select id from hq_gov_structure_version where version_no = 3), 'discard', 'not needed') ->> 'to';
select (select scope from hq_gov_delegation where code = 'board_to_committee') like 'Delegated educational%' as scope_kept,
       (select is_active from hq_gov_seat where code = 'quality_office_lead') as lead_active;
\echo S20 a unit code of another structure is refused
select hq_gov_studio_create_structure(:E, 'E', 't', 'enterprise_demo', 'Enterprise demo', 'enterprise', null, 'create one');
select hq_gov_studio_create_structure(:O, 'O', 't', 'enterprise_demo', 'Enterprise demo', 'enterprise', null, 'create one') ->> 'structure';
select hq_gov_studio_create_draft(:O, 'O', 't', 'enterprise_demo', 'First', 'first draft') ->> 'version_no';
with v as (select id, revision from hq_gov_structure_version where structure_code = 'enterprise_demo')
select hq_gov_studio_save_draft(:O, 'O', 't', v.id, v.revision,
  '{"levels": [{"level": 1, "label": "Corporate"}], "units": [{"code": "scholar_board", "level": 1, "kind": "board", "name": "X"}], "positions": [], "relationships": [], "links": [], "independence_pairs": []}'::jsonb,
  null, null, 'collide') ->> 'revision' from v;
select hq_gov_studio_transition(:O, 'O', 't', (select id from hq_gov_structure_version where structure_code = 'enterprise_demo'), 'submit', 'submit collide');
\echo S21 relationship types: the editor adds one, a user without the capability cannot
select hq_gov_studio_add_relation_type(:E, 'E', 't', 'advisory', 'Advisory', 'dotted', null, 'add advisory') ->> 'relation_type';
select hq_gov_studio_add_relation_type(:D, 'D', 't', 'other_type', 'Other', 'solid', null, 'add other');
\echo S22 granting the studio capability to a position needs the sensitive acknowledgement
select hq_position_admin_grant(:O, 'O', 't', 'platform_director', 'hq.platform.governance.manage', 'let the director draft', false);
\echo S23 a relationship decision records the version in force
select hq_gov_admin_set_delegation(:O, 'O', 't', 'holdings_to_technology_services', 'approved', 'Holdings resolution H-1', 'approve mandate') ->> 'to';
select v.version_no from hq_gov_delegation g join hq_gov_structure_version v on v.id = g.decided_version_id where g.code = 'holdings_to_technology_services';
\echo S24 audit rows by action
select action, count(*) from audit_log where action like 'hq_gov_%' group by action order by action;
