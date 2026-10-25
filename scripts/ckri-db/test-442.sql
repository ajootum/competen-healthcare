-- CKRI 442 behavioural test. LOCAL DISPOSABLE DATABASE ONLY (a schema-only copy with 395, 422, 440, 441, 442 applied).
-- e1, e2 knowledge educators, r a clinical content reviewer scoped to the framework, q a quality council member, s a student.
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
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2'), ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000c1');
insert into profiles (id) values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2'), ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000c1');
insert into hq_position (code, space, name, is_active) values ('quality_council_member', 'quality', 'QCM', true) on conflict (code) do nothing;
insert into hq_position_capability (position_code, capability_code, source) values ('quality_council_member', 'hq.quality.knowledge.publish', 'position_default');
insert into ogs_offices (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'CKRI test office');
insert into ogs_office_appointments (id, office_id, person_id, role, status) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'knowledge_educator', 'active'),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', 'knowledge_educator', 'active'),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'clinical_content_reviewer', 'active'),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'quality_council_member', 'active');
insert into frameworks (id, name, library) select '00000000-0000-0000-0000-00000000fa01', 'Shared F', (select (regexp_match(pg_get_constraintdef(oid), '''([a-z_]+)''::text'))[1] from pg_constraint where conname = 'frameworks_library_check');
insert into framework_domains (id, framework_id, name) values ('00000000-0000-0000-0000-00000000da01', '00000000-0000-0000-0000-00000000fa01', 'D');
insert into framework_competencies (id, name, domain_id) values ('00000000-0000-0000-0000-00000000c001', 'C1', '00000000-0000-0000-0000-00000000da01');
insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref) values ('00000000-0000-0000-0000-00000000aa03', 'framework', '00000000-0000-0000-0000-00000000fa01');
set local session_replication_role = origin;

-- A snapshot with one reported and one suppressed cell, written through the builder's own setting.
select set_config('ckri.builder', 'build', true);
insert into ckri_snapshot (id, measure, period_grain, period_from, period_to, cohort_dimension, min_cohort, round_to, complementary, contract_version, policy_version, builder_version, built_by, retain_until)
  values ('00000000-0000-0000-0000-00000000bb01', 'knowledge_gap', 'month', '2026-10-01', '2026-11-01', 'programme', 10, 5, false, 'c/1', 'p/1', 'b/1', '00000000-0000-0000-0000-0000000000e1', '2030-01-01');
insert into ckri_snapshot_cell values ('00000000-0000-0000-0000-00000000bb01', 'competency', '00000000-0000-0000-0000-00000000c001', 'bsn', '2026-10-01', false, 15, 30, 0.42, null, null),
                                     ('00000000-0000-0000-0000-00000000bb01', 'competency', '00000000-0000-0000-0000-00000000c001', 'dip', '2026-10-01', true, null, null, null, null, null);
select set_config('ckri.builder', '', true);

-- needs
select pg_temp.expect_error($q$insert into ckri_learning_need (snapshot_id, subject_kind, subject_ref, cohort_value, period_start, summary, response_kind, raised_by, changed_by) values ('00000000-0000-0000-0000-00000000bb01', 'competency', '00000000-0000-0000-0000-00000000c001', 'dip', '2026-10-01', 'Diploma students struggle with this.', 'knowledge_resource', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1')$q$, '%never from a suppressed%', 'N1 no need from a suppressed cell');
select pg_temp.expect_error($q$insert into ckri_learning_need (snapshot_id, subject_kind, subject_ref, cohort_value, period_start, summary, response_kind, raised_by, changed_by) values ('00000000-0000-0000-0000-00000000bb01', 'competency', '00000000-0000-0000-0000-00000000c001', 'bsn', '2026-10-01', 'BSN answers on this are mostly wrong.', 'knowledge_resource', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1')$q$, '%not authorised%', 'N2 only an educator raises a need');
insert into ckri_learning_need (id, snapshot_id, subject_kind, subject_ref, cohort_value, period_start, summary, response_kind, raised_by, changed_by, evidence)
  values ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000bb01', 'competency', '00000000-0000-0000-0000-00000000c001', 'bsn', '2026-10-01', 'BSN answers on this are mostly wrong.', 'knowledge_resource', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', '{"rate": 0.99}');
select pg_temp.expect((select (evidence ->> 'rate')::numeric = 0.42 and raised_by = '00000000-0000-0000-0000-0000000000e1' and measure = 'knowledge_gap' from ckri_learning_need where id = '00000000-0000-0000-0000-00000000ee01'), 'N3 evidence and raiser come from the database, not the writer');
select pg_temp.expect_error($q$update ckri_learning_need set evidence = '{}' where id = '00000000-0000-0000-0000-00000000ee01'$q$, '%cannot be rewritten%', 'N4 evidence frozen');
select pg_temp.expect_error($q$update ckri_learning_need set status = 'addressed', response_ref = gen_random_uuid() where id = '00000000-0000-0000-0000-00000000ee01'$q$, '%must be an existing%', 'N5 addressed only by a real record');

-- resources
select pg_temp.expect_error($q$insert into ckri_knowledge_resource (code, kind, title, created_by) values ('x-res', 'explanation', 'X', '00000000-0000-0000-0000-0000000000c1')$q$, '%not authorised%', 'K1 a student cannot create a resource');
insert into ckri_knowledge_resource (id, code, kind, title, created_by, need_id) values ('00000000-0000-0000-0000-00000000dd01', 'fluid-q1', 'revision_question', 'Fluid balance question', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000ee01');
select pg_temp.expect_error($q$insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by) values ('00000000-0000-0000-0000-00000000dd01', 1, '{"stem": "Which is correct here?", "options": ["a","b","c"], "correct_index": 0, "rationale": "Because it is."}', 'educator', '{00000000-0000-0000-0000-0000000000e1}')$q$, '%shape of a revision_question%', 'K2 content shape enforced');
select pg_temp.expect_error($q$insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by) values ('00000000-0000-0000-0000-00000000dd01', 1, '{"stem": "Which is correct here?", "options": ["a","b","c","d"], "correct_index": 0, "rationale": "Because it is."}', 'ai_draft', '{00000000-0000-0000-0000-0000000000e1}')$q$, '%ckri_knowledge_version_check%', 'K3 an AI draft names its model and prompt');
insert into ckri_knowledge_version (id, resource_id, version_no, content, origin, ai_provenance, authored_by) values ('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-00000000dd01', 1,
  '{"stem": "Which is correct here?", "options": ["a","b","c","d"], "correct_index": 0, "rationale": "Because it is."}', 'ai_draft', '{"model": "m", "prompt_version": "p/1"}', '{00000000-0000-0000-0000-0000000000e1}');
select pg_temp.expect_error($q$update ckri_knowledge_version set origin = 'educator', ai_provenance = null where id = '00000000-0000-0000-0000-00000000dd11'$q$, '%stays an AI draft%', 'K4 an edited AI draft stays an AI draft');
select pg_temp.expect_error($q$select ckri_knowledge_submit('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-0000000000e1', 1)$q$, '%must review this exact content%', 'K5 no submission without educator review');
select ckri_knowledge_review('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-0000000000e2');
update ckri_knowledge_version set content = jsonb_set(content, '{rationale}', '"Because it is, edited."') where id = '00000000-0000-0000-0000-00000000dd11';
select pg_temp.expect((select educator_reviewed_by is null from ckri_knowledge_version where id = '00000000-0000-0000-0000-00000000dd11'), 'K6 editing clears the review');
update ckri_knowledge_version set educator_reviewed_by = '00000000-0000-0000-0000-0000000000e2', educator_reviewed_hash = content_hash, educator_reviewed_at = now() where id = '00000000-0000-0000-0000-00000000dd11';
select pg_temp.expect((select educator_reviewed_by is null from ckri_knowledge_version where id = '00000000-0000-0000-0000-00000000dd11'), 'K7 a review cannot be written directly');
select ckri_knowledge_review('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-0000000000e2');
select pg_temp.expect_error($q$select ckri_knowledge_submit('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-0000000000e1', 1)$q$, '%name the CFCA competencies%', 'K8 competencies named first');
insert into ckri_knowledge_version_competency values ('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-00000000c001');
create temporary table ccv as select ckri_knowledge_submit('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-0000000000e1', 1) as id;
select pg_temp.expect((select content_kind = 'resource' and content_hash = (select content_hash from ckri_knowledge_version where id = '00000000-0000-0000-0000-00000000dd11') from clinical_content_version where id = (select id from ccv)), 'K9 submitted through 395 as kind resource with the exact hash');
select pg_temp.expect_error($q$update ckri_knowledge_version set content = jsonb_set(content, '{stem}', '"Changed after submission?"') where id = '00000000-0000-0000-0000-00000000dd11'$q$, '%only a draft is edited directly%', 'K10 submitted content frozen');
select pg_temp.expect_error($q$delete from ckri_knowledge_version_competency where version_id = '00000000-0000-0000-0000-00000000dd11'$q$, '%frozen%', 'K11 submitted competencies frozen');
select pg_temp.expect_error($q$select ckri_knowledge_publish('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-0000000000b1')$q$, '%not clinically approved%', 'K12 no publication before clinical approval');
select pg_temp.expect_error($q$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) select id, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000aa01', 'approved' from ccv$q$, '%not independent%', 'K13 the author cannot approve');
insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) select id, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa03', 'approved' from ccv;
select pg_temp.expect(ckri_knowledge_approved('00000000-0000-0000-0000-00000000dd11'), 'K14 clinically approved by an independent, scoped reviewer');
select pg_temp.expect_error($q$select ckri_knowledge_publish('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-0000000000e1')$q$, '%not authorised%', 'K15 an educator cannot publish');
select ckri_knowledge_publish('00000000-0000-0000-0000-00000000dd11', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select state = 'published' and origin = 'ai_draft' and educator_reviewed_by = '00000000-0000-0000-0000-0000000000e2' from ckri_knowledge_version where id = '00000000-0000-0000-0000-00000000dd11'), 'K16 published, still recorded as an AI draft that an educator reviewed');
update ckri_learning_need set status = 'addressed', response_ref = '00000000-0000-0000-0000-00000000dd01', changed_by = '00000000-0000-0000-0000-0000000000e1' where id = '00000000-0000-0000-0000-00000000ee01';
select pg_temp.expect_error($q$update ckri_learning_need set status = 'open' where id = '00000000-0000-0000-0000-00000000ee01'$q$, '%final%', 'N6 an addressed need is final');
select pg_temp.expect((select count(*) = 0 from information_schema.columns where table_name in ('ckri_knowledge_resource', 'ckri_knowledge_version', 'ckri_knowledge_version_competency', 'ckri_learning_need') and (column_name like '%material%' or column_name like '%student%' or column_name like '%private%' or column_name = 'user_id')), 'K17 no column can reference student material');
-- the 422 competency branch still works unchanged
insert into clinical_content_version (content_kind, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals)
  values ('competency', '00000000-0000-0000-0000-00000000c001', 'x', '{}', '{00000000-0000-0000-0000-0000000000e1}', '00000000-0000-0000-0000-0000000000e1', 1);
select pg_temp.expect((select content_hash = competency_content_hash('00000000-0000-0000-0000-00000000c001') from clinical_content_version where content_kind = 'competency' and competency_id = '00000000-0000-0000-0000-00000000c001'), 'K18 competency kind unchanged: hash computed by the trigger');
select pg_temp.expect_error($q$insert into clinical_content_version (content_kind, case_version_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals) values ('case', gen_random_uuid(), 'x', '{}', '{00000000-0000-0000-0000-0000000000e1}', '00000000-0000-0000-0000-0000000000e1', 1)$q$, '%only as a submitted case version%', 'K19 case kind unchanged');
rollback;
