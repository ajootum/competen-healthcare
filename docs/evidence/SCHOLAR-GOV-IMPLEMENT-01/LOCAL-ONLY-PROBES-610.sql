-- LOCAL REHEARSAL ONLY. NEVER RUN ON STAGING OR PRODUCTION: it writes test profiles, appointments and audit rows.
-- Run against a throwaway postgres:17 holding a stub schema, the real 116, 117, 264, 281, 500, 580 and 610.
\set VERBOSITY terse
\set O '''00000000-0000-0000-0000-000000000001'''
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''
insert into profiles (id, full_name, roles) values ('00000000-0000-0000-0000-000000000001', 'Owner', array['super_admin']);
insert into profiles (id, full_name, roles, platform_roles) values ('00000000-0000-0000-0000-000000000003', 'Director', array['nurse'], array['platform_operations']);
insert into profiles (id, full_name) values ('00000000-0000-0000-0000-00000000000a', 'Person A'), ('00000000-0000-0000-0000-00000000000b', 'Person B'), ('00000000-0000-0000-0000-00000000000c', 'Person C');
\echo P1 non-owner refused
select hq_gov_admin_appoint('00000000-0000-0000-0000-000000000003', 'D', 't', 'committee_academic_lead_chair', :A, null, 'nominated', null, null, 'owner asked');
\echo P2 no reason refused
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_academic_lead_chair', :A, null, 'nominated', null, null, ' ');
\echo P3 self appointment refused
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_academic_lead_chair', :O, null, 'nominated', null, null, 'record me');
\echo P4 active without basis refused
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_academic_lead_chair', :A, null, 'active', null, 'None declared', 'appoint A');
\echo P5 active without interests refused
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_academic_lead_chair', :A, null, 'active', 'Resolution R-1', null, 'appoint A');
\echo P6 board director active refused, not incorporated
select hq_gov_admin_appoint(:O, 'O', 't', 'board_holdings_nominee_1', :A, null, 'active', 'Resolution R-1', 'None declared', 'appoint A');
\echo P7 board director interim refused
select hq_gov_admin_appoint(:O, 'O', 't', 'board_holdings_nominee_1', :A, null, 'interim', 'Resolution R-1', 'None declared', 'appoint A');
\echo P8 board nomination OK
select hq_gov_admin_appoint(:O, 'O', 't', 'board_holdings_nominee_1', :A, null, 'nominated', null, null, 'Holdings nominates A') ->> 'status';
\echo P9 second board seat same person refused
select hq_gov_admin_appoint(:O, 'O', 't', 'board_founder_nominee_1', :A, null, 'nominated', null, null, 'nominate A again');
\echo P10 independent director beside another seat refused
select hq_gov_admin_appoint(:O, 'O', 't', 'board_independent_director', :A, null, 'nominated', null, null, 'nominate A as independent');
\echo P11 reviewer then clinical content operations refused, seat pair
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_clinical_content_reviewer', :B, null, 'active', 'Owner decision D-1', 'None declared', 'B reviews') ->> 'status';
select hq_gov_admin_appoint(:O, 'O', 't', 'portfolio_clinical_content_operations', :B, null, 'nominated', null, null, 'B runs content ops');
\echo P12 reviewer then clinical governance lead refused, 580 pair approve and govern
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_clinical_governance_lead', :B, null, 'nominated', null, null, 'B as gov lead');
\echo P13 HQ competency author appointment then committee reviewer refused, 580 pair across the HQ appointment
insert into ogs_office_appointments (office_id, person_id, role, status) select id, '00000000-0000-0000-0000-00000000000c', 'competency_author', 'active' from ogs_offices where office_type = 'hq_quality';
select hq_gov_admin_end(:O, 'O', 't', (select id from hq_gov_seat_appointment where seat_code = 'committee_clinical_content_reviewer'), 'make room for probe') ->> 'from';
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_clinical_content_reviewer', :C, null, 'nominated', null, null, 'C reviews');
\echo P14 one live record per seat
select hq_gov_admin_appoint(:O, 'O', 't', 'board_holdings_nominee_1', :B, null, 'nominated', null, null, 'nominate B too');
\echo P15 combination allowed where independence permits, C as chair and AI representative
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_academic_lead_chair', :C, null, 'nominated', null, null, 'C chairs') ->> 'status';
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_ai_governance_rep', :C, null, 'nominated', null, null, 'C AI rep') ->> 'status';
\echo P16 nomination moved to active keeps one row and writes a declaration
select hq_gov_admin_appoint(:O, 'O', 't', 'committee_academic_lead_chair', :C, null, 'active', 'Holdings interim decision HI-1', 'Employed by a partner university', 'appoint C') ->> 'from_nomination';
select count(*) as rows_for_seat from hq_gov_seat_appointment where seat_code = 'committee_academic_lead_chair';
select count(*) as declarations from hq_gov_interest_declaration;
\echo P16b independent director beside a committee seat refused, exclusive seat
select hq_gov_admin_appoint(:O, 'O', 't', 'board_independent_director', :C, null, 'nominated', null, null, 'nominate C as independent');
\echo P17 external holder by name, no profile, OK
select hq_gov_admin_appoint(:O, 'O', 't', 'it_information_security_authority', null, 'External Adviser', 'nominated', null, null, 'external nominee') ->> 'status';
\echo P18 direct update of the seat refused
update hq_gov_seat_appointment set seat_code = 'committee_ai_governance_rep' where seat_code = 'committee_academic_lead_chair';
\echo P19 delete refused
delete from hq_gov_seat_appointment where seat_code = 'committee_academic_lead_chair';
\echo P20 ended row cannot change
update hq_gov_seat_appointment set end_reason = 'rewritten' where status = 'ended';
\echo P21 declaration append-only
update hq_gov_interest_declaration set interest = 'nothing';
\echo P22 approving the board delegation refused, board not established
select hq_gov_admin_set_delegation(:O, 'O', 't', 'board_to_committee', 'approved', 'Board resolution BR-1', 'board approves');
\echo P23 interim without basis refused
select hq_gov_admin_set_delegation(:O, 'O', 't', 'holdings_interim_scholar', 'pending', null, 'to pending') ->> 'to';
select hq_gov_admin_set_delegation(:O, 'O', 't', 'holdings_interim_scholar', 'interim', null, 'back to interim');
\echo P24 withdraw then reopen refused
select hq_gov_admin_set_delegation(:O, 'O', 't', 'board_to_product', 'withdrawn', null, 'not needed') ->> 'to';
select hq_gov_admin_set_delegation(:O, 'O', 't', 'board_to_product', 'pending', null, 'reopen');
\echo P25 declare interest OK
select hq_gov_admin_declare_interest(:O, 'O', 't', (select id from hq_gov_seat_appointment where seat_code = 'committee_academic_lead_chair'), 'Shareholding in a supplier', 'Recused from supplier decisions', 'annual declaration') ->> 'interest';
\echo P26 audit rows written, no HQ appointment written by hq_gov, grants unchanged
select count(*) as hq_gov_audit_rows from audit_log where action like 'hq_gov_%';
select count(*) as ogs_appointments from ogs_office_appointments;
select count(*) as grants from hq_position_capability;
\echo P27 a board seat linked to a position refused
insert into hq_gov_seat (code, body_code, name, seat_kind, authority_position_code) values ('x_dir', 'scholar_board', 'X', 'director', 'platform_director');
\echo P28 a document marked approved without a reference refused
update hq_gov_body set document_status = 'approved', document_ref = null where code = 'scholar_governance_committee';
\echo P29 profile removal cascades to null person, history kept
delete from audit_log where actor_id = '00000000-0000-0000-0000-00000000000a';
delete from profiles where id = '00000000-0000-0000-0000-00000000000a';
select count(*) as a_rows_kept from hq_gov_seat_appointment where seat_code = 'board_holdings_nominee_1';
\echo V1.1 P30 status item marked verified without evidence refused
select hq_gov_admin_set_status_item(:O, 'O', 't', 'recovery_capability', 'verified', 'short', null, 'claim it');
\echo V1.1 P31 status item, non-owner refused
select hq_gov_admin_set_status_item('00000000-0000-0000-0000-000000000003', 'D', 't', 'recovery_capability', 'pending', null, null, 'try it');
\echo V1.1 P32 status item verified directly without a decider refused, constraint
update hq_gov_status_item set status = 'verified', evidence = 'a long enough evidence text' where code = 'platform_governance_council_mandate';
\echo V1.1 P33 status item change by owner OK, audited
select hq_gov_admin_set_status_item(:O, 'O', 't', 'technical_appointments', 'pending', 'Nominations under discussion', null, 'status reviewed') ->> 'to';
\echo V1.1 P34 relation of a delegation never changes
update hq_gov_delegation set relation = 'corporate_reporting' where code = 'committee_to_product';
\echo V1.1 P35 the Technology Authority mandate can be approved only by the established Holdings, with a basis
select hq_gov_admin_set_delegation(:O, 'O', 't', 'holdings_to_technology_services', 'approved', null, 'approve it');
select hq_gov_admin_set_delegation(:O, 'O', 't', 'holdings_to_technology_services', 'approved', 'Holdings resolution H-1', 'approve it') ->> 'to';
\echo V1.1 P36 the joint review bridge cannot be approved while the Committee is not established
select hq_gov_admin_set_delegation(:O, 'O', 't', 'committee_technology_joint_review', 'approved', 'Committee minute C-1', 'approve it');
\echo V1.1 P37 a service body with a level refused, and a level body without one refused
insert into hq_gov_body (code, level, kind, name) values ('x_service', 3, 'service', 'X');
insert into hq_gov_body (code, level, kind, name) values ('x_board', null, 'board', 'X');
\echo V1.1 P38 a clearance with no route needs its note, and a routed link needs a capability
insert into hq_gov_link (code, seat_code, kind, clearance_domain, label) values ('x1', 'portfolio_product_technology', 'joint_clearance', 'scholar', 'X');
insert into hq_gov_link (code, seat_code, kind, label, route) values ('x2', 'portfolio_product_technology', 'administration', 'X', '/super-admin/individual');
