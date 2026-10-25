-- CKRI 440 behavioural test. LOCAL DISPOSABLE DATABASE ONLY (a schema-only copy). Never staging or production.
-- Each refusal is asserted by its message. Each allowed path is asserted by its result. Everything rolls back.
\set ON_ERROR_STOP 1
create or replace function pg_temp.expect_error(p_sql text, p_like text, p_name text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_like then raise notice 'PASS %', p_name; return; end if;
    raise notice 'FAIL % -- wrong error: %', p_name, sqlerrm; return;
  end;
  raise notice 'FAIL % -- no error', p_name;
end $f$;
create or replace function pg_temp.expect(p_ok boolean, p_name text) returns void language plpgsql as $f$
begin raise notice '% %', case when p_ok then 'PASS' else 'FAIL' end, p_name; end $f$;

begin;
-- a, b = governors, c = research lead, d = student
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
insert into profiles (id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
insert into ogs_offices (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'CKRI test office');
insert into ogs_office_appointments (office_id, person_id, role, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'research_governance_officer', 'active'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000b', 'research_governance_officer', 'active'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000c', 'research_lead', 'active');

select pg_temp.expect(ckri_holds_capability('00000000-0000-0000-0000-00000000000a', 'hq.quality.research.govern'), 'A1 governor holds govern');
select pg_temp.expect(not ckri_holds_capability('00000000-0000-0000-0000-00000000000d', 'hq.quality.research.govern'), 'A2 student holds nothing');
select pg_temp.expect(not ckri_holds_capability('00000000-0000-0000-0000-00000000000c', 'hq.quality.research.govern'), 'A3 lead cannot govern');

-- purposes
insert into ckri_purpose (code, permission, label, description, created_by) values
  ('edu_quality', 'collective_analytics', 'Educational quality', 'Aggregate learning measures for improving educational resources.', '00000000-0000-0000-0000-00000000000a'),
  ('reasoning_study', 'research_study', 'Clinical reasoning study', 'An identified study of clinical reasoning difficulty patterns.', '00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($q$insert into ckri_purpose (code, permission, label, description, created_by) values ('content_x', 'content_contribution', 'X content', 'Content contribution is not a CKRI permission.', '00000000-0000-0000-0000-00000000000a')$q$, '%ckri_purpose_check%', 'P1 content contribution unrepresentable');
select pg_temp.expect_error($q$insert into ckri_purpose (code, permission, label, description, created_by, requires_ethics) values ('study_noethics', 'research_study', 'No ethics', 'A study purpose without an ethics requirement.', '00000000-0000-0000-0000-00000000000a', false)$q$, '%ckri_purpose_check%', 'P2 research study always needs ethics');
select pg_temp.expect_error($q$update ckri_purpose set status = 'active', activated_by = '00000000-0000-0000-0000-00000000000a' where code = 'edu_quality'$q$, '%not independent%', 'P3 author cannot activate');
select pg_temp.expect_error($q$update ckri_purpose set status = 'active', activated_by = '00000000-0000-0000-0000-00000000000c' where code = 'edu_quality'$q$, '%not authorised%', 'P4 non-governor cannot activate');
update ckri_purpose set status = 'active', activated_by = '00000000-0000-0000-0000-00000000000b' where code in ('edu_quality', 'reasoning_study');
select pg_temp.expect((select count(*) = 2 from ckri_purpose where status = 'active' and activated_at is not null), 'P5 independent governor activates');
select pg_temp.expect_error($q$update ckri_purpose set description = 'Rewritten after activation, which must be refused.' where code = 'edu_quality'$q$, '%frozen%', 'P6 active wording frozen');
select pg_temp.expect_error($q$delete from ckri_purpose where code = 'edu_quality'$q$, '%Retire it%', 'P7 purpose not deletable');

-- projects
select pg_temp.expect_error($q$insert into ckri_research_project (code, title, purpose_code, sponsor, proposed_by, changed_by) values ('p-student', 'Student proposal', 'reasoning_study', 'platform', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000d')$q$, '%not authorised%', 'R1 only a research lead proposes');
select pg_temp.expect_error($q$insert into ckri_research_project (code, title, purpose_code, sponsor, proposed_by, changed_by, data_access) values ('p-rows', 'Row access', 'reasoning_study', 'platform', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'row_level')$q$, '%ckri_research_project_check%', 'R2 row-level access unrepresentable');
select pg_temp.expect_error($q$insert into ckri_research_project (code, title, purpose_code, sponsor, proposed_by, changed_by, min_cohort) values ('p-small', 'Small cohort', 'reasoning_study', 'platform', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 3)$q$, '%ckri_research_project_check%', 'R3 cohort floor 5');
select pg_temp.expect_error($q$insert into ckri_research_project (code, title, purpose_code, sponsor, institution_ref, proposed_by, changed_by) values ('p-inst', 'Institution study', 'reasoning_study', 'institution', gen_random_uuid(), '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c')$q$, '%ckri_research_project_check%', 'R4 institution sponsor needs an agreement');
insert into ckri_research_project (code, title, purpose_code, sponsor, proposed_by, changed_by) values
  ('reasoning-2026', 'Reasoning difficulty 2026', 'reasoning_study', 'platform', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($q$update ckri_research_project set status = 'approved', changed_by = '00000000-0000-0000-0000-00000000000a', decided_by = '00000000-0000-0000-0000-00000000000a', retain_until = '2030-01-01' where code = 'reasoning-2026'$q$, '%cannot become%', 'R5 draft cannot jump to approved');
update ckri_research_project set status = 'submitted', changed_by = '00000000-0000-0000-0000-00000000000c' where code = 'reasoning-2026';
select pg_temp.expect_error($q$update ckri_research_project set status = 'approved', changed_by = '00000000-0000-0000-0000-00000000000c', decided_by = '00000000-0000-0000-0000-00000000000c', retain_until = '2030-01-01' where code = 'reasoning-2026'$q$, '%not authorised%', 'R6 proposer cannot approve');
select pg_temp.expect_error($q$update ckri_research_project set title = 'Changed after submission' where code = 'reasoning-2026'$q$, '%frozen%', 'R7 submitted project frozen');
select pg_temp.expect_error($q$update ckri_research_project set status = 'approved', changed_by = '00000000-0000-0000-0000-00000000000a', decided_by = '00000000-0000-0000-0000-00000000000a' where code = 'reasoning-2026'$q$, '%ckri_research_project_check%', 'R8 approval needs a retention date');
update ckri_research_project set status = 'approved', changed_by = '00000000-0000-0000-0000-00000000000a', decided_by = '00000000-0000-0000-0000-00000000000a', retain_until = '2030-01-01' where code = 'reasoning-2026';
select pg_temp.expect_error($q$update ckri_research_project set status = 'recruiting', changed_by = '00000000-0000-0000-0000-00000000000a' where code = 'reasoning-2026'$q$, '%ethics approval%', 'R9 recruiting needs ethics record');
select pg_temp.expect_error($q$update ckri_research_project set ethics_body = 'Test REC', ethics_ref = 'REC-1', ethics_decided_at = now(), changed_by = '00000000-0000-0000-0000-00000000000c' where code = 'reasoning-2026'$q$, '%not authorised%', 'R10 lead cannot record ethics');
update ckri_research_project set ethics_body = 'Test REC', ethics_ref = 'REC-1', ethics_decided_at = now(), changed_by = '00000000-0000-0000-0000-00000000000a' where code = 'reasoning-2026';

-- participation
select pg_temp.expect_error($q$insert into ckri_participation (user_id, permission, scope_key, project_id, status, notice_version) select '00000000-0000-0000-0000-00000000000d', 'research_study', id::text, id, 'granted', 'ckri-notice/1' from ckri_research_project where code = 'reasoning-2026'$q$, '%only while it is recruiting%', 'C1 cannot join a study not recruiting');
update ckri_research_project set status = 'recruiting', changed_by = '00000000-0000-0000-0000-00000000000a' where code = 'reasoning-2026';
insert into ckri_participation (user_id, permission, scope_key, project_id, status, notice_version)
  select '00000000-0000-0000-0000-00000000000d', 'research_study', id::text, id, 'granted', 'ckri-notice/1' from ckri_research_project where code = 'reasoning-2026';
insert into ckri_participation (user_id, permission, scope_key, status, notice_version) values ('00000000-0000-0000-0000-00000000000d', 'collective_analytics', 'all', 'granted', 'ckri-notice/1');
select pg_temp.expect_error($q$insert into ckri_participation (user_id, permission, scope_key, status, notice_version) values ('00000000-0000-0000-0000-00000000000c', 'collective_analytics', 'x', 'granted', 'ckri-notice/1')$q$, '%ckri_participation_check%', 'C2 analytics scope is all');
select pg_temp.expect_error($q$insert into ckri_participation (user_id, permission, scope_key, status, notice_version) values ('00000000-0000-0000-0000-00000000000c', 'personal_ai_learning', 'all', 'granted', 'n/1')$q$, '%ckri_participation_check%', 'C3 personal AI learning is not a CKRI record');
update ckri_participation set status = 'withdrawn' where user_id = '00000000-0000-0000-0000-00000000000d' and permission = 'collective_analytics';
select pg_temp.expect((select withdrawn_at is not null from ckri_participation where user_id = '00000000-0000-0000-0000-00000000000d' and permission = 'collective_analytics'), 'C4 withdrawal stamped');
select pg_temp.expect((select count(*) = 3 from ckri_participation_event where user_id = '00000000-0000-0000-0000-00000000000d'), 'C5 every change has its event');
select pg_temp.expect_error($q$insert into ckri_participation_event (user_id, permission, scope_key, event, notice_version) values ('00000000-0000-0000-0000-00000000000d', 'collective_analytics', 'all', 'granted', 'forged')$q$, '%written only by its record trigger%', 'C6 no forged events');
select pg_temp.expect_error($q$update ckri_participation_event set event = 'granted'$q$, '%append-only%', 'C7 events append-only');
select pg_temp.expect_error($q$delete from ckri_participation where user_id = '00000000-0000-0000-0000-00000000000d'$q$, '%withdrawn, not deleted%', 'C8 choice not deletable directly');
select pg_temp.expect((select count(*) = 4 from ckri_research_project_event), 'R11 project trail: draft, submitted, approved, recruiting');
select pg_temp.expect_error($q$update ckri_research_project set status = 'draft', changed_by = '00000000-0000-0000-0000-00000000000a' where code = 'reasoning-2026'$q$, '%cannot become%', 'R12 recruiting cannot return to draft');
-- erasure: deleting the person cascades through the guards
delete from profiles where id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect((select count(*) = 0 from ckri_participation_event where user_id = '00000000-0000-0000-0000-00000000000d') and (select count(*) = 0 from ckri_participation where user_id = '00000000-0000-0000-0000-00000000000d'), 'C9 erasure cascades');
rollback;
