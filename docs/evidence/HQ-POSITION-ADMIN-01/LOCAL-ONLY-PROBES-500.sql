-- LOCAL REHEARSAL ONLY. NEVER RUN ON STAGING OR PRODUCTION: it writes test profiles, positions, grants and audit rows.
-- Run against a throwaway postgres:17 holding a stub schema, the real 264, the code catalogue and 500.
\set VERBOSITY terse
insert into profiles (id, full_name, roles) values ('00000000-0000-0000-0000-000000000001','Owner', array['super_admin']);
insert into profiles (id, full_name, platform_role) values ('00000000-0000-0000-0000-000000000002','PlatOwner','platform_owner');
insert into profiles (id, full_name, roles, platform_roles) values ('00000000-0000-0000-0000-000000000003','Director', array['nurse'], array['platform_operations']);
\echo P1 non-owner create refused
select hq_position_admin_create('00000000-0000-0000-0000-000000000003','D','t','competency_author','quality','Competency Author',null,'owner asked for it');
\echo P2 null actor refused
select hq_position_admin_create(null,'D','t','competency_author','quality','Competency Author',null,'owner asked for it');
\echo P3 no reason refused
select hq_position_admin_create('00000000-0000-0000-0000-000000000001','O','t','competency_author','quality','Competency Author',null,'  ');
\echo P4 bad code refused
select hq_position_admin_create('00000000-0000-0000-0000-000000000001','O','t','Competency Author','quality','Competency Author',null,'owner asked');
\echo P5 bad space refused
select hq_position_admin_create('00000000-0000-0000-0000-000000000001','O','t','competency_author','clinical','Competency Author',null,'owner asked');
\echo P6 owner create OK
select hq_position_admin_create('00000000-0000-0000-0000-000000000001','O','t1','competency_author','quality','Competency Author','Authors CFCA','owner asked for it');
\echo P7 duplicate refused
select hq_position_admin_create('00000000-0000-0000-0000-000000000002','PO','t','competency_author','quality','X',null,'owner asked');
\echo P8 grant author OK by platform_owner
select hq_position_admin_grant('00000000-0000-0000-0000-000000000002','PO','t2','competency_author','hq.quality.competency.author','curators author CFCA',false);
\echo P9 SoD approve refused even acknowledged
select hq_position_admin_grant('00000000-0000-0000-0000-000000000001','O','t','competency_author','hq.quality.clinical.approve','try both rights',true);
\echo P10 sensitive without ack refused
select hq_position_admin_grant('00000000-0000-0000-0000-000000000001','O','t','competency_author','hq.platform.users.view','needs to see users',false);
\echo P11 sensitive with ack OK
select hq_position_admin_grant('00000000-0000-0000-0000-000000000001','O','t3','competency_author','hq.platform.users.view','needs to see users',true);
\echo P12 direct insert SoD refused (migration path)
insert into hq_position_capability (position_code, capability_code) values ('clinical_content_reviewer','hq.quality.case.author');
\echo P13 direct insert reverse pair refused
insert into hq_position_capability (position_code, capability_code) values ('clinical_case_educator','hq.quality.case.publish');
\echo P14 govern+approve refused
insert into hq_position_capability (position_code, capability_code) values ('quality_council_member','hq.quality.clinical.approve');
\echo P15 end grant, non-owner refused
select hq_position_admin_end_grant('00000000-0000-0000-0000-000000000003','D','t','competency_author','hq.platform.users.view','not needed');
\echo P16 end grant OK
select hq_position_admin_end_grant('00000000-0000-0000-0000-000000000001','O','t4','competency_author','hq.platform.users.view','not needed after all');
\echo P17 ended row kept with window
select capability_code, effective_to is not null as ended, ended_by is not null as by, end_reason, grant_reason from hq_position_capability where position_code='competency_author' order by 1;
\echo P18 reopen refused (direct update)
update hq_position_capability set effective_to = null where position_code='competency_author' and capability_code='hq.platform.users.view';
\echo P19 rewrite live grant refused
update hq_position_capability set effective_from = now() - interval '1 day' where position_code='competency_author' and capability_code='hq.quality.competency.author';
\echo P20 re-grant ended pair refused
select hq_position_admin_grant('00000000-0000-0000-0000-000000000001','O','t','competency_author','hq.platform.users.view','needs it again',true);
\echo P21 end twice refused
select hq_position_admin_end_grant('00000000-0000-0000-0000-000000000001','O','t','competency_author','hq.platform.users.view','again');
\echo P22 after ending author, approve is allowed
select hq_position_admin_end_grant('00000000-0000-0000-0000-000000000001','O','t8','competency_author','hq.quality.competency.author','test end');
select hq_position_admin_grant('00000000-0000-0000-0000-000000000001','O','t9','competency_author','hq.quality.clinical.approve','after author ended',true);
\echo P23 unknown capability refused
select hq_position_admin_grant('00000000-0000-0000-0000-000000000001','O','t','competency_author','hq.made.up','x x x x x',true);
\echo P24 update name OK and space change refused
select hq_position_admin_update('00000000-0000-0000-0000-000000000001','O','t5','competency_author','Competency Author (CFCA)','Authors CFCA','clarify name');
update hq_position set space='learning' where code='competency_author';
\echo P25 deactivate OK, grant to deactivated refused, deactivate twice refused
select hq_position_admin_set_active('00000000-0000-0000-0000-000000000001','O','t6','competency_author',false,'pilot paused');
select hq_position_admin_grant('00000000-0000-0000-0000-000000000001','O','t','competency_author','hq.quality.assurance.view','x x x x x',false);
select hq_position_admin_set_active('00000000-0000-0000-0000-000000000001','O','t','competency_author',false,'again again');
\echo P26 register: exists refused, new OK, bad code refused
select hq_position_admin_register('00000000-0000-0000-0000-000000000001','O','t','hq.quality.case.author','quality','X',null,'register it');
delete from hq_capability where code='hq.quality.research.review';
select hq_position_admin_register('00000000-0000-0000-0000-000000000001','O','t7','hq.quality.research.review','quality','Independent scientific review',null,'catalogue sync');
select hq_position_admin_register('00000000-0000-0000-0000-000000000001','O','t','Hq.bad code','quality','X',null,'register it');
\echo P27 audit rows, one per successful change
select trace_id, action, entity_name from audit_log order by created_at, trace_id;
\echo P28 refused actions leave no audit row
select count(*) as audits_for_refused from audit_log where trace_id = 't';
\echo P29 execute privileges
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('service_role', p.oid, 'execute') as svc from pg_proc p where p.proname like 'hq_position_admin%' or p.proname='hq_actor_is_owner' order by 1;
\echo P30 delete still works (rollback scripts)
delete from hq_position where code='clinical_case_educator';
select count(*) from hq_position_capability where position_code='clinical_case_educator';
