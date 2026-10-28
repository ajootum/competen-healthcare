-- LOCAL-ONLY-PROBES-641: planted violations against the real 640 + 641 on a throwaway database. NEVER on staging.
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
create or replace function pg_temp.red_without(p_label text, p_disable text, p_sql text) returns void language plpgsql as $f$
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
create or replace function pg_temp.truth(p_label text, p_cond boolean) returns void language plpgsql as $f$
begin
  if p_cond then raise warning 'PASS  %', p_label; else raise warning 'FAIL  %', p_label; end if;
end $f$;

insert into profiles (id, full_name, roles) values
  ('00000000-0000-0000-0000-0000000000a0', 'Owner', array['super_admin']),
  ('00000000-0000-0000-0000-0000000000a1', 'Ann', null),
  ('00000000-0000-0000-0000-0000000000b1', 'Ben', null),
  ('00000000-0000-0000-0000-0000000000c1', 'Cat', null),
  ('00000000-0000-0000-0000-0000000000d1', 'Dan', null);
insert into ogs_offices (id, office_type, name, scope_type) values ('00000000-0000-0000-0000-00000000f001', 'hq_quality', 'HQ Quality', 'enterprise');

-- ---- independence of the appointment itself (non-switchable) -----------------------------------------
select pg_temp.refused('an HQ appointment with no authoriser is refused',
  $$insert into ogs_office_appointments (office_id, person_id, role, status) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', 'clinical_content_reviewer', 'active')$$,
  'not_authorised');
select pg_temp.red_without('no authoriser',
  'alter table ogs_office_appointments disable trigger trg_hq_appointment_rules_guard',
  $$insert into ogs_office_appointments (office_id, person_id, role, status) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', 'clinical_content_reviewer', 'active')$$);
select pg_temp.refused('self-appointment is refused, even for the owner',
  $$insert into ogs_office_appointments (office_id, person_id, role, status, authorised_by, authorised_at) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a0', 'clinical_content_reviewer', 'active', '00000000-0000-0000-0000-0000000000a0', now())$$,
  'not_independent');
select pg_temp.refused('a non-owner cannot authorise an appointment',
  $$insert into ogs_office_appointments (office_id, person_id, role, status, authorised_by, authorised_at) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', 'clinical_content_reviewer', 'active', '00000000-0000-0000-0000-0000000000a1', now())$$,
  'owner_required');

-- ---- a broad role grants nothing by default: scoped appointments -------------------------------------
select pg_temp.refused('broad role: a Scholar Clinical Lead appointment must name what it carries',
  $$insert into ogs_office_appointments (office_id, person_id, role, status, authorised_by, authorised_at) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', 'scholar_clinical_lead', 'active', '00000000-0000-0000-0000-0000000000a0', now())$$,
  'grants authority per appointment');
select pg_temp.refused('broad role: a scope cannot name a capability the position does not grant',
  $$insert into ogs_office_appointments (office_id, person_id, role, status, capability_scope, authorised_by, authorised_at) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', 'scholar_clinical_lead', 'active', array['hq.platform.users.reset'], '00000000-0000-0000-0000-0000000000a0', now())$$,
  'does not grant hq.platform.users.reset');

-- ---- multiple holders of one role, each individually scoped -------------------------------------------
select pg_temp.ok('multiple holders: Ann holds Scholar Clinical Lead (author, approve, govern), as primary',
  $$insert into ogs_office_appointments (id, office_id, person_id, role, status, capability_scope, is_primary, authorised_by, authorised_at, term_start) values ('00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', 'scholar_clinical_lead', 'active', array['hq.quality.competency.author', 'hq.quality.clinical.approve', 'hq.quality.clinical.govern'], true, '00000000-0000-0000-0000-0000000000a0', now(), current_date)$$);
select pg_temp.ok('multiple holders: Ben holds the same role (approve, govern, case publish)',
  $$insert into ogs_office_appointments (id, office_id, person_id, role, status, capability_scope, authorised_by, authorised_at) values ('00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000b1', 'scholar_clinical_lead', 'active', array['hq.quality.clinical.approve', 'hq.quality.clinical.govern', 'hq.quality.case.publish'], '00000000-0000-0000-0000-0000000000a0', now())$$);
select pg_temp.ok('multiple holders: Cat holds the same role (case author, competency publish, no approval)',
  $$insert into ogs_office_appointments (id, office_id, person_id, role, status, capability_scope, authorised_by, authorised_at) values ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000c1', 'scholar_clinical_lead', 'active', array['hq.quality.case.author', 'hq.quality.competency.publish'], '00000000-0000-0000-0000-0000000000a0', now())$$);
select pg_temp.refused('primary: a role has at most one primary coordinator',
  $$update ogs_office_appointments set is_primary = true, authorised_by = '00000000-0000-0000-0000-0000000000a0', authorised_at = now() + interval '1 second' where id = '00000000-0000-0000-0000-0000000bb001'$$,
  'already has a primary holder');
select pg_temp.truth('individual scope: Ben carries clinical approval through the shared role', ckri_holds_capability('00000000-0000-0000-0000-0000000000b1', 'hq.quality.clinical.approve'));
select pg_temp.truth('individual scope: Cat holds the same role but does NOT carry clinical approval', not ckri_holds_capability('00000000-0000-0000-0000-0000000000c1', 'hq.quality.clinical.approve'));
select pg_temp.truth('individual scope: Cat carries case authoring', learning_holds_capability('00000000-0000-0000-0000-0000000000c1', 'hq.quality.case.author'));

-- ---- multiple appointments for one person -----------------------------------------------------------
select pg_temp.ok('multiple appointments: Ann also holds Clinical Content Reviewer (whole position)',
  $$insert into ogs_office_appointments (id, office_id, person_id, role, status, authorised_by, authorised_at) values ('00000000-0000-0000-0000-0000000aa002', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', 'clinical_content_reviewer', 'active', '00000000-0000-0000-0000-0000000000a0', now())$$);
select pg_temp.ok('unlimited holders: Dan also holds Clinical Content Reviewer (no maximum is set)',
  $$insert into ogs_office_appointments (id, office_id, person_id, role, status, authorised_by, authorised_at) values ('00000000-0000-0000-0000-0000000dd001', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', 'clinical_content_reviewer', 'active', '00000000-0000-0000-0000-0000000000a0', now())$$);

-- ---- self-authorised changes to your own appointment ---------------------------------------------------
select pg_temp.refused('self-widening: Ann cannot widen her own appointment scope',
  $$update ogs_office_appointments set capability_scope = array['hq.quality.competency.author', 'hq.quality.clinical.approve', 'hq.quality.clinical.govern', 'hq.quality.competency.publish'], authorised_by = '00000000-0000-0000-0000-0000000000a1', authorised_at = now() + interval '2 seconds' where id = '00000000-0000-0000-0000-0000000aa001'$$,
  'not_independent');
select pg_temp.red_without('self-widening of appointment scope',
  'alter table ogs_office_appointments disable trigger trg_hq_appointment_rules_guard',
  $$update ogs_office_appointments set capability_scope = array['hq.quality.competency.author', 'hq.quality.clinical.approve', 'hq.quality.clinical.govern', 'hq.quality.competency.publish'], authorised_by = '00000000-0000-0000-0000-0000000000a1', authorised_at = now() + interval '2 seconds' where id = '00000000-0000-0000-0000-0000000aa001'$$);
select pg_temp.refused('stale authority: a scope change must be stamped on that change, not ride on the old stamp',
  $$update ogs_office_appointments set capability_scope = array['hq.quality.case.author', 'hq.quality.competency.publish', 'hq.quality.clinical.approve'] where id = '00000000-0000-0000-0000-0000000cc001'$$,
  'not_authorised');

-- ---- configurable appointment rules (owner only, audit first) ----------------------------------------
select pg_temp.refused('rules: a non-owner cannot set appointment rules',
  $$select hq_position_admin_set_rules('00000000-0000-0000-0000-0000000000a1', 'Ann', null, 'scholar_clinical_lead', 3, 'optional', true, null, 'cap it')$$,
  'owner_required');
select pg_temp.refused('rules: a maximum below the live holders is refused',
  $$select hq_position_admin_set_rules('00000000-0000-0000-0000-0000000000a0', 'Owner', null, 'scholar_clinical_lead', 2, 'optional', true, null, 'cap it')$$,
  'more than 2');
select pg_temp.refused('rules: primary not_used is refused while a primary exists',
  $$select hq_position_admin_set_rules('00000000-0000-0000-0000-0000000000a0', 'Owner', null, 'scholar_clinical_lead', null, 'not_used', true, null, 'no primaries')$$,
  'has a primary holder');
select pg_temp.ok('rules: the owner caps Scholar Clinical Lead at 3 holders',
  $$select hq_position_admin_set_rules('00000000-0000-0000-0000-0000000000a0', 'Owner', null, 'scholar_clinical_lead', 3, 'optional', true, null, 'three leads for the pilot')$$);
select pg_temp.refused('rules: a fourth holder beyond the configured maximum is refused',
  $$insert into ogs_office_appointments (office_id, person_id, role, status, capability_scope, authorised_by, authorised_at) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000d1', 'scholar_clinical_lead', 'active', array['hq.quality.case.author'], '00000000-0000-0000-0000-0000000000a0', now())$$,
  'at most 3 concurrent holders');
select pg_temp.truth('audit: the rules change and every appointment write left audit rows',
  exists (select 1 from audit_log where action = 'hq_position_rules_set')
  and (select count(*) from audit_log where action = 'hq_appointment_recorded') >= 5);

-- ---- overlapping scopes and approval independence across a person's appointments ----------------------
insert into frameworks (id, name, hospital_id, pub_status, competency_layer) values ('00000000-0000-0000-0000-0000000f0001', 'Shared CFCA', null, 'draft', 'cfca');
insert into framework_domains (id, framework_id, name) values ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000f0001', 'D');
insert into framework_competencies (id, domain_id, name, risk_category) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000d0001', 'K1', 'standard'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000d0001', 'K2', 'standard');
-- Overlapping content scopes: both of Ann's appointments cover the framework, and the domain inside it.
insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values
  ('00000000-0000-0000-0000-0000000aa001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000aa002', 'domain', '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000bb001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000a1');
select pg_temp.refused('narrowed governance: Cat holds the role but not clinical governance, so cannot grant a scope',
  $$insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values ('00000000-0000-0000-0000-0000000dd001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000c1')$$,
  'not authorised');
insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values
  ('00000000-0000-0000-0000-0000000cc001', 'framework', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000b1');

-- Ben puts K1 forward. Ann approves under one appointment and tries again under the other.
insert into clinical_content_version (id, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
  values ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-00000000c001', 'x', '{}', array['00000000-0000-0000-0000-0000000000b1'::uuid], '00000000-0000-0000-0000-0000000000b1', 2, 'standard risk');
select pg_temp.ok('overlapping scopes: Ann approves Ben''s K1 under her Scholar lead appointment',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000aa001', 'approved')$$);
select pg_temp.refused('overlapping scopes: Ann cannot approve the same version again under her reviewer appointment (one person, one approval)',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000aa002', 'approved')$$,
  'duplicate key');
select pg_temp.refused('individual scope: Cat holds the role and a content scope, but her appointment does not carry approval',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000cc001', 'approved')$$,
  'does not carry clinical approval');
select pg_temp.red_without('appointment scope on approval',
  'alter table clinical_review_decision disable trigger clinical_review_decision_scope_guard',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000cc001', 'approved')$$);

-- Ann authors K2. Neither of her appointments may approve it.
insert into audit_log (actor_id, action, entity_type, entity_id) values ('00000000-0000-0000-0000-0000000000a1', 'competency_update', 'competency', '00000000-0000-0000-0000-00000000c002');
insert into clinical_content_version (id, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
  values ('00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-00000000c002', 'x', '{}', array['00000000-0000-0000-0000-0000000000a1'::uuid], '00000000-0000-0000-0000-0000000000a1', 1, 'standard risk');
select pg_temp.refused('independence across appointments: Ann cannot approve her own K2 under her reviewer appointment',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000aa002', 'approved')$$,
  'not independent');
select pg_temp.refused('independence across appointments: nor under her Scholar lead appointment',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000aa001', 'approved')$$,
  'not independent');
select pg_temp.ok('independent approval: Ben approves Ann''s K2',
  $$insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values ('00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000bb001', 'approved')$$);

-- ---- effective dates -------------------------------------------------------------------------------
select pg_temp.refused('term: an appointment cannot end before it starts',
  $$update ogs_office_appointments set term_start = current_date, term_end = current_date - 1, authorised_by = '00000000-0000-0000-0000-0000000000a0', authorised_at = now() + interval '3 seconds' where id = '00000000-0000-0000-0000-0000000dd001'$$,
  'ends before it starts');
update ogs_office_appointments set term_start = current_date - 30, term_end = current_date - 1, authorised_by = '00000000-0000-0000-0000-0000000000a0', authorised_at = now() + interval '4 seconds'
 where id = '00000000-0000-0000-0000-0000000dd001';
select pg_temp.truth('term: a lapsed appointment carries nothing, though its status is still active',
  not ckri_holds_capability('00000000-0000-0000-0000-0000000000d1', 'hq.quality.clinical.approve'));

-- ---- ending -----------------------------------------------------------------------------------------
select pg_temp.ok('ending an appointment needs no new authority and clears the primary flag',
  $$do $d$ begin update ogs_office_appointments set status = 'removed' where id = '00000000-0000-0000-0000-0000000aa001'; if (select is_primary from ogs_office_appointments where id = '00000000-0000-0000-0000-0000000aa001') then raise exception 'primary kept'; end if; end $d$ $$);
select pg_temp.truth('history kept: every appointment row and decision is still there',
  (select count(*) from ogs_office_appointments) = 5 and (select count(*) from clinical_review_decision) = 2);
