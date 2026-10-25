-- CKRI 441 behavioural test. LOCAL DISPOSABLE DATABASE ONLY (a schema-only copy). Never staging or production.
-- Synthetic learners: programme BSN has 12 people (11 granted, 1 withdrawn), programme DIP has 3 (all granted).
-- Fixture rows are written with triggers and foreign keys off (replica role). The builder runs with them on.
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
insert into practice_platform_flags (flag, enabled) values ('ckri_research', false) on conflict (flag) do update set enabled = false;
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 20) g;
insert into profiles (id) select ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 20) g;
insert into ogs_offices (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'CKRI test office');
insert into ogs_office_appointments (office_id, person_id, role, status) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000020', 'research_governance_officer', 'active');
insert into individual_scholar_programme (code, label, profession) values ('bsn', 'BSN', 'nursing'), ('dip', 'DIP', 'nursing');
insert into framework_competencies (id, name, domain_id) values ('00000000-0000-0000-0000-00000000c001', 'C1', gen_random_uuid()), ('00000000-0000-0000-0000-00000000c002', 'C2', gen_random_uuid());

-- people 1..12 BSN, 13..15 DIP. Each: one material, one chunk mapped (accepted) to C1, one question, two attempts.
create temporary table fx as select g, ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid as u,
  case when g <= 12 then 'bsn' else 'dip' end as prog from generate_series(1, 15) g;
insert into individual_scholar_learner_context (user_id, programme_code, effective_from) select u, prog, '2026-01-01' from fx;
insert into individual_scholar_material (id, user_id, title, file_name, mime_type, byte_size, sha256, storage_path, char_count, chunk_count, extractor, pii_attested_at)
  select u, u, 'm', 'm.txt', 'text/plain', 10, 'x', u::text || '/m', 10, 1, 't', now() from fx;
insert into individual_scholar_chunk (id, user_id, material_id, ordinal, content) select u, u, u, 1, 'private study text that must never be read' from fx;
insert into individual_scholar_competency_map (id, user_id, material_id, chunk_id, competency_id, layer, source) select u, u, u, u, '00000000-0000-0000-0000-00000000c001', 'foundational', 'student' from fx;
insert into individual_scholar_competency_decision (user_id, map_id, decision, decided_by, created_at) select u, u, 'accepted', 'student', '2026-10-05' from fx;
insert into individual_scholar_question (id, user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version)
  select u, u, u, u, 'mcq', 'stem', '["a","b","c","d"]', 0, 'r', 'q', 'm', 'p', 'v' from fx;
insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at) select u, u, 0, true, '2026-10-01' from fx;
insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at) select u, u, 1, false, '2026-10-20' from fx;
set local session_replication_role = origin;

insert into ckri_participation (user_id, permission, scope_key, status, notice_version) select u, 'collective_analytics', 'all', 'granted', 'n/1' from fx;
update ckri_participation set status = 'withdrawn' where user_id = '00000000-0000-0000-0000-000000000012';

select pg_temp.expect_error($q$select ckri_build_snapshot('outcome_coverage', '2026-10-01', '2026-11-01', 'month', 'programme', 10, 1, false, 'c/1', 'p/1', 365, '00000000-0000-0000-0000-000000000020')$q$, '%switched off%', 'B1 flag off refuses');
update practice_platform_flags set enabled = true where flag = 'ckri_research';
select pg_temp.expect_error($q$select ckri_build_snapshot('outcome_coverage', '2026-10-01', '2026-11-01', 'month', 'programme', 10, 1, false, 'c/1', 'p/1', 365, '00000000-0000-0000-0000-000000000001')$q$, '%not authorised%', 'B2 a non-governor cannot build');
select pg_temp.expect_error($q$select ckri_build_snapshot('outcome_coverage', '2026-10-01', '2026-11-01', 'month', 'programme', 3, 1, false, 'c/1', 'p/1', 365, '00000000-0000-0000-0000-000000000020')$q$, '%never below 5%', 'B3 floor 5');
select pg_temp.expect_error($q$select ckri_build_snapshot('evaluation_performance', '2026-10-01', '2026-11-01', 'month', 'programme', 10, 1, false, 'c/1', 'p/1', 365, '00000000-0000-0000-0000-000000000020')$q$, '%unknown or unavailable%', 'B4 pending measure refused');

create temporary table s as select
  ckri_build_snapshot('outcome_coverage', '2026-10-01', '2026-11-01', 'month', 'programme', 10, 1, false, 'c/1', 'p/1', 365, '00000000-0000-0000-0000-000000000020') as cov_plain,
  ckri_build_snapshot('outcome_coverage', '2026-10-01', '2026-11-01', 'month', 'programme', 10, 1, true, 'c/1', 'p/1', 365, '00000000-0000-0000-0000-000000000020') as cov_comp,
  ckri_build_snapshot('knowledge_gap', '2026-10-01', '2026-11-01', 'month', 'none', 10, 5, false, 'c/1', 'p/1', 365, '00000000-0000-0000-0000-000000000020') as gap_r5,
  ckri_build_snapshot('retention', '2026-10-01', '2026-11-01', 'month', 'none', 10, 1, false, 'c/1', 'p/1', 365, '00000000-0000-0000-0000-000000000020') as ret,
  ckri_build_snapshot('outcome_coverage', '2026-10-01', '2026-11-01', 'month', 'none', 20, 1, false, 'c/1', 'p/1', 365, '00000000-0000-0000-0000-000000000020') as cov_big;

select pg_temp.expect((select participants = 11 and not suppressed from ckri_snapshot_cell where snapshot_id = (select cov_plain from s) and cohort_value = 'bsn'), 'B5 BSN counts 11: the withdrawn person is excluded');
select pg_temp.expect((select suppressed and participants is null and events is null from ckri_snapshot_cell where snapshot_id = (select cov_plain from s) and cohort_value = 'dip'), 'B6 DIP (3) suppressed with no figures');
select pg_temp.expect((select bool_and(suppressed) from ckri_snapshot_cell where snapshot_id = (select cov_comp from s)), 'B7 complementary suppression hides the only other cell');
select pg_temp.expect((select participants = 15 and rate = 0.5 from ckri_snapshot_cell where snapshot_id = (select gap_r5 from s)), 'B8 knowledge gap: 14 people rounded to 15, rate 0.50');
select pg_temp.expect((select rate = 0 and events = 14 from ckri_snapshot_cell where snapshot_id = (select ret from s)), 'B9 retention: the later answers 19 days on, none correct');
select pg_temp.expect((select population_rounded is null and cells_suppressed = 1 and cells_reported = 0 from ckri_snapshot where id = (select cov_big from s)), 'B10 population under the minimum: no population figure, every cell suppressed');
select pg_temp.expect((select count(*) = 0 from information_schema.columns where table_name in ('ckri_snapshot_cell') and (column_name like '%user%' or column_name like '%person%' or column_name like '%profile%')), 'B11 no person column in a cell');
select pg_temp.expect_error($q$insert into ckri_snapshot_cell (snapshot_id, subject_kind, subject_ref, cohort_value, period_start, suppressed, participants) select cov_plain, 'competency', gen_random_uuid(), 'X', '2026-10-01', false, 6 from s$q$, '%written only by ckri_build_snapshot%', 'B12 no hand-written cells');
select pg_temp.expect_error($q$update ckri_snapshot_cell set participants = 3$q$, '%frozen once written%', 'B13 cells frozen');
select pg_temp.expect_error($q$update ckri_snapshot set min_cohort = 5 where id = (select cov_plain from s)$q$, '%frozen once built%', 'B14 snapshot frozen');
select pg_temp.expect_error($q$delete from ckri_snapshot where id = (select cov_plain from s)$q$, '%kept until its retention date%', 'B15 not deleted before retention');
update ckri_snapshot set retain_until = retain_until + 30 where id = (select cov_plain from s);
select pg_temp.expect_error($q$update ckri_snapshot set retain_until = retain_until - 60 where id = (select cov_plain from s)$q$, '%never shortened%', 'B16 retention extends, never shortens');
select pg_temp.expect(ckri_purge_expired_snapshots() = 0 and (select count(*) = 5 from ckri_snapshot), 'B17 purge removes nothing unexpired');
select pg_temp.expect_error($q$insert into ckri_snapshot (measure, period_grain, period_from, period_to, cohort_dimension, min_cohort, round_to, complementary, contract_version, policy_version, builder_version, built_by, retain_until) values ('retention', 'month', '2026-10-01', '2026-11-01', 'none', 5, 1, false, 'c', 'p', 'b', '00000000-0000-0000-0000-000000000020', '2030-01-01')$q$, '%written only by ckri_build_snapshot%', 'B18 no hand-written snapshots');
select pg_temp.expect((select count(*) = 0 from ckri_snapshot_cell where cohort_value like '%private%'), 'B19 no free text reaches a cell');
rollback;
