-- LOCAL-ONLY-PROBES-640: planted violations against the real 640 on a throwaway database. NEVER on staging.
-- Every refusal probe is also run once with the 640 control disabled, to prove the control is what refuses.
set client_min_messages = warning;

create or replace function pg_temp.refused(p_label text, p_sql text, p_pattern text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
    raise warning 'FAIL  % (accepted)', p_label;
  exception when others then
    if sqlerrm ~* p_pattern then raise warning 'PASS  % -- %', p_label, sqlerrm;
    else raise warning 'FAIL  % (wrong refusal: %)', p_label, sqlerrm; end if;
  end;
end $f$;
create or replace function pg_temp.ok(p_label text, p_sql text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
    raise warning 'PASS  % (accepted)', p_label;
  exception when others then
    raise warning 'FAIL  % (refused: %)', p_label, sqlerrm;
  end;
end $f$;
-- The control is load-bearing: with it disabled the same violation is accepted (and rolled back).
create or replace function pg_temp.red_without(p_label text, p_disable text, p_sql text, p_enable text) returns void language plpgsql as $f$
begin
  begin
    execute p_disable;
    execute p_sql;
    raise exception 'probe_rollback';
  exception when others then
    if sqlerrm = 'probe_rollback' then raise warning 'PASS  RED-PROOF % (accepted with the control off, so the control is what refuses)', p_label;
    else raise warning 'FAIL  RED-PROOF % (refused even with the control off: %)', p_label, sqlerrm; end if;
  end;
end $f$;

-- People: the owner, three team members (A, B, C), an outsider X.
insert into profiles (id, full_name, roles) values
  ('00000000-0000-0000-0000-0000000000a0', 'Owner', array['super_admin']),
  ('00000000-0000-0000-0000-0000000000a1', 'Ann', null),
  ('00000000-0000-0000-0000-0000000000b1', 'Ben', null),
  ('00000000-0000-0000-0000-0000000000c1', 'Cat', null),
  ('00000000-0000-0000-0000-0000000000d1', 'Xen', null);
insert into ogs_offices (id, office_type, name, scope_type) values
  ('00000000-0000-0000-0000-00000000f001', 'hq_quality', 'HQ Quality', 'enterprise');

-- ---- cross-cutting roles and multiple appointments ------------------------------------------------
select pg_temp.ok('cross-cutting: Ann appointed Scholar Clinical Lead (author + approve + govern + publish on one position)',
  $$insert into ogs_office_appointments (id, office_id, person_id, person_name, role, status, scope) values ('00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', 'Ann', 'scholar_clinical_lead', 'active', 'enterprise')$$);
select pg_temp.ok('cross-cutting: Ben appointed Scholar Clinical Lead',
  $$insert into ogs_office_appointments (id, office_id, person_id, person_name, role, status, scope) values ('00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000b1', 'Ben', 'scholar_clinical_lead', 'active', 'enterprise')$$);
select pg_temp.ok('cross-cutting: Cat appointed Scholar Clinical Lead',
  $$insert into ogs_office_appointments (id, office_id, person_id, person_name, role, status, scope) values ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000c1', 'Cat', 'scholar_clinical_lead', 'active', 'enterprise')$$);
select pg_temp.ok('multiple appointments: Ann also Clinical Case Educator (a second live appointment)',
  $$insert into ogs_office_appointments (id, office_id, person_id, person_name, role, status, scope) values ('00000000-0000-0000-0000-0000000aa002', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', 'Ann', 'clinical_case_educator', 'active', 'enterprise')$$);

insert into hq_capability (code, space, label) values ('hq.competency.verification.assess', 'quality', 'Assess') on conflict do nothing;
insert into hq_position (code, space, name) values ('test_assessor', 'quality', 'Test assessor') on conflict do nothing;
insert into hq_position_capability (position_code, capability_code, source) values ('test_assessor', 'hq.competency.verification.assess', 'position_default');

select pg_temp.refused('indirect escalation: a second appointment cannot combine assessor with clinical approval',
  $$insert into ogs_office_appointments (office_id, person_id, role, status, scope) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', 'test_assessor', 'active', 'enterprise')$$,
  'hq_sod separation_of_duties: a competency assessor cannot hold clinical content approval');
select pg_temp.red_without('second-appointment pair',
  'alter table ogs_office_appointments disable trigger trg_hq_sod_appointment_guard',
  $$insert into ogs_office_appointments (office_id, person_id, role, status, scope) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', 'test_assessor', 'active', 'enterprise')$$, '');
select pg_temp.refused('indirect escalation: a grant to a position a person holds cannot complete a pair across their appointments',
  $$insert into hq_position_capability (position_code, capability_code, source) values ('clinical_case_educator', 'hq.competency.verification.assess', 'explicit_grant')$$,
  'a holder of clinical_case_educator would then hold');
select pg_temp.refused('non-liftable: the assessor pair stays on positions (Scholar lead + assess)',
  $$insert into hq_position_capability (position_code, capability_code, source) values ('scholar_clinical_lead', 'hq.competency.verification.assess', 'explicit_grant')$$,
  'separation_of_duties');
select pg_temp.refused('non-liftable: the owner cannot allow the assessor pair',
  $$select hq_sod_admin_set_pair('00000000-0000-0000-0000-0000000000a0', 'Owner', null, 'hq.competency.verification.assess', 'hq.quality.clinical.approve', true, 'trying to lift it')$$,
  'not_liftable');
select pg_temp.refused('non-liftable: not even by a direct table write',
  $$update hq_sod_pair_policy set allowed = true where capability_a = 'hq.quality.research.propose' and capability_b = 'hq.quality.research.review'$$,
  'hq_sod_pair_policy_check');
select pg_temp.refused('settings: strict separation refused while the Scholar lead holds lifted pairs',
  $$select hq_sod_admin_set_settings('00000000-0000-0000-0000-0000000000a0', 'Owner', null, true, true, 'tighten now')$$,
  'hq_sod conflict: strict separation would leave position scholar_clinical_lead');
select pg_temp.refused('settings: multiple appointments cannot be switched off while Ann holds two',
  $$select hq_sod_admin_set_settings('00000000-0000-0000-0000-0000000000a0', 'Owner', null, false, false, 'one each')$$,
  'concurrent HQ appointments');
select pg_temp.refused('settings: blocking a lifted pair is refused while somebody holds it',
  $$select hq_sod_admin_set_pair('00000000-0000-0000-0000-0000000000a0', 'Owner', null, 'hq.quality.clinical.approve', 'hq.quality.competency.author', false, 'block it')$$,
  'hq_sod conflict: position');
select pg_temp.refused('owner only: Ann cannot change the separation settings',
  $$select hq_sod_admin_set_settings('00000000-0000-0000-0000-0000000000a1', 'Ann', null, false, true, 'my change')$$,
  'owner_required');
select pg_temp.refused('owner only: Ann cannot grant herself a capability (500, unchanged)',
  $$select hq_position_admin_grant('00000000-0000-0000-0000-0000000000a1', 'Ann', null, 'scholar_clinical_lead', 'hq.competency.verification.assess', 'want it', true)$$,
  'owner_required');
select pg_temp.ok('content rule: the owner turns publisher_not_approver on for cases (audit first)',
  $$select hq_sod_admin_set_content_rule('00000000-0000-0000-0000-0000000000a0', 'Owner', null, 'case', true, 'stricter for cases')$$);
select pg_temp.ok('audit: the content-rule change wrote its audit_log row',
  $q$do $d$ begin if not exists (select 1 from audit_log where action = 'hq_sod_content_rule_set' and entity_name = 'case') then raise exception 'no audit row'; end if; end $d$ $q$);

-- ---- reviewer scope: never self, only by governance, never reopened -----------------------------------
insert into frameworks (id, name, hospital_id, pub_status, competency_layer) values ('00000000-0000-0000-0000-0000000f0001', 'Shared CFCA', null, 'draft', 'cfca');
insert into framework_domains (id, framework_id, name) values ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000f0001', 'D');
insert into framework_competencies (id, domain_id, name, risk_category) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000d0001', 'K1', 'standard'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000d0001', 'K2', 'standard'),
  ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-0000000d0001', 'K3', 'high');

select pg_temp.refused('self-scope: Ann cannot set her own reviewer scope',
  $$insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values ('00000000-0000-0000-0000-0000000aa001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000a1')$$,
  'nobody sets or widens their own reviewer scope');
select pg_temp.red_without('self-scope',
  'alter table clinical_reviewer_scope disable trigger clinical_reviewer_scope_sod_guard',
  $$insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values ('00000000-0000-0000-0000-0000000aa001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000a1')$$, '');
select pg_temp.refused('scope: Xen (no clinical governance) cannot grant a scope',
  $$insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values ('00000000-0000-0000-0000-0000000aa001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000d1')$$,
  'not authorised');
select pg_temp.refused('scope: a scope with no granter is refused',
  $$insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref) values ('00000000-0000-0000-0000-0000000aa001', 'framework', '00000000-0000-0000-0000-0000000f0001')$$,
  'records who granted it');
select pg_temp.ok('scope: Ben grants Ann''s scope (another governance holder)',
  $$insert into clinical_reviewer_scope (id, appointment_id, scope_kind, scope_ref, granted_by) values ('00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-0000000aa001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000b1')$$);
select pg_temp.ok('scope: Ann grants Ben''s scope',
  $$insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values ('00000000-0000-0000-0000-0000000bb001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000a1')$$);
select pg_temp.ok('scope: the owner grants Cat''s scope',
  $$insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values ('00000000-0000-0000-0000-0000000cc001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000a0')$$);
insert into clinical_reviewer_scope (id, appointment_id, scope_kind, scope_ref, granted_by, ended_at)
  values ('00000000-0000-0000-0000-00000000e0a2', '00000000-0000-0000-0000-0000000aa001', 'domain', '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000000b1', now());
select pg_temp.refused('scope: an ended scope cannot be reopened (silent widening)',
  $$update clinical_reviewer_scope set ended_at = null where id = '00000000-0000-0000-0000-00000000e0a2'$$,
  'an ended scope stays ended');

-- ---- independent approval, self-approval and edited versions ----------------------------------------
-- Ann authors K1 and puts it forward.
insert into audit_log (actor_id, action, entity_type, entity_id) values ('00000000-0000-0000-0000-0000000000a1', 'competency_update', 'competency', '00000000-0000-0000-0000-00000000c001');
insert into clinical_content_version (id, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
  values ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-00000000c001', 'x', '{}', array['00000000-0000-0000-0000-0000000000a1'::uuid], '00000000-0000-0000-0000-0000000000a1', 1, 'standard risk');
select pg_temp.refused('self-approval: Ann cannot approve her own version (395/461, unchanged)',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000aa001', 'approved')$$,
  'not independent');
select pg_temp.ok('independent approval: Ben approves Ann''s version',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000bb001', 'approved')$$);

-- Cat edits K2 (her audit row), then Ann puts K2 forward naming only herself. Cat may not approve it.
insert into audit_log (actor_id, action, entity_type, entity_id) values ('00000000-0000-0000-0000-0000000000c1', 'competency_update', 'competency', '00000000-0000-0000-0000-00000000c002');
insert into clinical_content_version (id, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
  values ('00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-00000000c002', 'x', '{}', array['00000000-0000-0000-0000-0000000000a1'::uuid], '00000000-0000-0000-0000-0000000000a1', 1, 'standard risk');
select pg_temp.refused('edited version: Cat edited K2 (audit trail) and cannot approve it, though the version omits her',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000cc001', 'approved')$$,
  'or an earlier version of it');
select pg_temp.red_without('edited version (audit trail)',
  'alter table clinical_review_decision disable trigger clinical_review_decision_sod_guard',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000cc001', 'approved')$$, '');

-- Resubmission bypass: Ben submits K3 v1, the content changes, Ann resubmits v2 naming only herself.
insert into clinical_content_version (id, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
  values ('00000000-0000-0000-0000-0000000ee003', '00000000-0000-0000-0000-00000000c003', 'x', '{}', array['00000000-0000-0000-0000-0000000000b1'::uuid], '00000000-0000-0000-0000-0000000000b1', 1, 'high risk');
update framework_competencies set description = 'changed' where id = '00000000-0000-0000-0000-00000000c003';
insert into clinical_content_version (id, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
  values ('00000000-0000-0000-0000-0000000ee004', '00000000-0000-0000-0000-00000000c003', 'x', '{}', array['00000000-0000-0000-0000-0000000000a1'::uuid], '00000000-0000-0000-0000-0000000000a1', 1, 'high risk');
select pg_temp.refused('resubmission: Ben submitted v1 and cannot approve v2 resubmitted by Ann',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee004', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000bb001', 'approved')$$,
  'or an earlier version of it');
select pg_temp.red_without('resubmission (version lineage)',
  'alter table clinical_review_decision disable trigger clinical_review_decision_sod_guard',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee004', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000bb001', 'approved')$$, '');
select pg_temp.refused('version-exact: approving the stale v1 after the change is refused (395, unchanged)',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee003', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000cc001', 'approved')$$,
  'stale');
select pg_temp.ok('independent approval of the current version: Cat approves v2',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee004', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000cc001', 'approved')$$);
select pg_temp.refused('one decision per reviewer per version (395, unchanged)',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee004', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000cc001', 'approved')$$,
  'duplicate key');

-- ---- configurable approval counts --------------------------------------------------------------------
insert into workspace_config_overrides (scope_type, scope_ref, config_path, draft, published, published_by)
  values ('platform', 'holdings_clinical', 'holdings.clinical.required_approvals.standard', '{"value": 1}', '{"value": 1}', '00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok('counts: Ann (governance) raises standard to 2',
  $$update workspace_config_overrides set published = '{"value": 2}', published_by = '00000000-0000-0000-0000-0000000000a1' where config_path = 'holdings.clinical.required_approvals.standard'$$);
select pg_temp.refused('self-reduction: Ann cannot lower it back to 1',
  $$update workspace_config_overrides set published = '{"value": 1}', published_by = '00000000-0000-0000-0000-0000000000a1' where config_path = 'holdings.clinical.required_approvals.standard'$$,
  'self_reduction');
select pg_temp.red_without('self-reduction',
  'alter table workspace_config_overrides disable trigger wce_clinical_count_guard',
  $$update workspace_config_overrides set published = '{"value": 1}', published_by = '00000000-0000-0000-0000-0000000000a1' where config_path = 'holdings.clinical.required_approvals.standard'$$, '');
select pg_temp.refused('self-reduction: deleting a published count is refused',
  $$delete from workspace_config_overrides where config_path = 'holdings.clinical.required_approvals.standard'$$,
  'never deleted');
select pg_temp.refused('counts: out of range is refused',
  $$update workspace_config_overrides set published = '{"value": 9}', published_by = '00000000-0000-0000-0000-0000000000a0' where config_path = 'holdings.clinical.required_approvals.standard'$$,
  '1 to 5');
insert into framework_competencies (id, domain_id, name, risk_category) values ('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-0000000d0001', 'K4', 'standard');
insert into clinical_content_version (id, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
  values ('00000000-0000-0000-0000-0000000ee005', '00000000-0000-0000-0000-00000000c004', 'x', '{}', array['00000000-0000-0000-0000-0000000000a1'::uuid], '00000000-0000-0000-0000-0000000000a1', 1, 'standard risk');
select pg_temp.ok('counts: a version put forward asking for 1 is raised to the governed 2',
  $q$do $d$ begin if (select required_approvals from clinical_content_version where id = '00000000-0000-0000-0000-0000000ee005') <> 2 then raise exception 'not raised'; end if; end $d$ $q$);
select pg_temp.ok('counts: the owner may lower it to 1',
  $$update workspace_config_overrides set published = '{"value": 1}', published_by = '00000000-0000-0000-0000-0000000000a0' where config_path = 'holdings.clinical.required_approvals.standard'$$);

-- ---- publication: cases ------------------------------------------------------------------------------
insert into case_library_case (id, code, title) values ('00000000-0000-0000-0000-00000000ca01', 'CASE-ONE1', 'Case one');
insert into case_library_version (id, case_id, version_no, content, authored_by)
  values ('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-00000000ca01', 1, '{"title": "one"}', array['00000000-0000-0000-0000-0000000000a1'::uuid]);
insert into case_library_version_competency (version_id, competency_id) values ('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-00000000c001');
select case_library_submit('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-0000000000a1', 1);
select pg_temp.refused('self-approval (case): Ann cannot approve her own case',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) select id, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000aa001', 'approved' from clinical_content_version where case_version_id = '00000000-0000-0000-0000-00000000cb01'$$,
  'not independent');
select pg_temp.ok('independent approval (case): Ben approves Ann''s case',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) select id, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000bb001', 'approved' from clinical_content_version where case_version_id = '00000000-0000-0000-0000-00000000cb01'$$);
select pg_temp.refused('self-publication: Ann cannot publish her own approved case',
  $$select case_library_publish('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-0000000000a1')$$,
  'not independent. An author');
select pg_temp.red_without('self-publication (422 had no such check)',
  'alter table case_library_version disable trigger case_library_version_sod_publication',
  $$select case_library_publish('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-0000000000a1')$$, '');
select pg_temp.refused('content rule: with publisher_not_approver on, Ben (the approver) cannot publish the case',
  $$select case_library_publish('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-0000000000b1')$$,
  'clinical approvers');
select pg_temp.ok('publication: Cat (neither author nor approver) publishes the case',
  $$select case_library_publish('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-0000000000c1')$$);

-- ---- publication: shared frameworks ------------------------------------------------------------------
insert into frameworks (id, name, hospital_id, pub_status, competency_layer) values ('00000000-0000-0000-0000-0000000f0002', 'Catalogue', null, 'in_review', 'catalogue');
insert into audit_log (actor_id, action, entity_type, entity_id) values ('00000000-0000-0000-0000-0000000000a1', 'catalogue_entry_add', 'framework', '00000000-0000-0000-0000-0000000f0002');
insert into content_approvals (framework_id, submitted_by, status) values ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-0000000000b1', 'pending');
select pg_temp.refused('framework: a publication with no recorded publisher is refused',
  $$update frameworks set pub_status = 'published' where id = '00000000-0000-0000-0000-0000000f0002'$$,
  'must record its publisher');
select pg_temp.refused('framework: the curator (audit trail) cannot publish',
  $$update frameworks set pub_status = 'published', published_by = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000f0002'$$,
  'authored or curated');
select pg_temp.red_without('framework contributor',
  'alter table frameworks disable trigger trg_frameworks_sod_publication_guard',
  $$update frameworks set pub_status = 'published', published_by = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000f0002'$$, '');
select pg_temp.refused('framework: the submitter cannot publish',
  $$update frameworks set pub_status = 'published', published_by = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000f0002'$$,
  'put the framework forward');
select pg_temp.ok('framework: Cat (independent) publishes',
  $$update frameworks set pub_status = 'published', published_by = '00000000-0000-0000-0000-0000000000c1' where id = '00000000-0000-0000-0000-0000000f0002'$$);
select pg_temp.ok('framework: leaving publication clears the recorded publisher',
  $q$do $d$ begin update frameworks set pub_status = 'archived' where id = '00000000-0000-0000-0000-0000000f0002'; if (select published_by from frameworks where id = '00000000-0000-0000-0000-0000000f0002') is not null then raise exception 'stale publisher kept'; end if; end $d$ $q$);

-- ---- the 610 seat guard reads the same configuration ------------------------------------------------
select pg_temp.ok('610 consistent: hq_capability_exclusions() returns only the 6 blocked pairs',
  $q$do $d$ begin if (select count(*) from hq_capability_exclusions()) <> 6 then raise exception 'wrong count'; end if; end $d$ $q$);
