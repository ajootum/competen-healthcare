-- LOCAL-ONLY-PROBES-650: planted violations against the real 650 on the throwaway stub. NEVER on staging.
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
create or replace function pg_temp.expect(p_label text, p_ok boolean) returns void language plpgsql as $f$
begin
  if p_ok then raise warning 'PASS  %', p_label; else raise warning 'FAIL  %', p_label; end if;
end $f$;

-- A. the seed: evidence only
select pg_temp.expect('A1 the two cast-list addresses are Demo',
  (select count(*) = 2 from hq_account_classification where account_type = 'demo'
     and profile_id in ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003')));
select pg_temp.expect('A2 a cohort-domain address NOT in the cast list stays Unclassified',
  not exists (select 1 from hq_account_classification where profile_id = '10000000-0000-0000-0000-000000000004'));
select pg_temp.expect('A3 functional-test, harness list, signup probe and marker-on-.invalid are Test',
  (select count(*) = 4 from hq_account_classification where account_type = 'test' and profile_id in
     ('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a')));
select pg_temp.expect('A4 a test domain without a script address stays Unclassified',
  not exists (select 1 from hq_account_classification where profile_id = '10000000-0000-0000-0000-000000000007'));
select pg_temp.expect('A5 a random sign-up and an unverified account stay Unclassified',
  not exists (select 1 from hq_account_classification where profile_id = '10000000-0000-0000-0000-000000000008'));
select pg_temp.expect('A6 a self-set synthetic marker on a real domain stays Unclassified',
  not exists (select 1 from hq_account_classification where profile_id = '10000000-0000-0000-0000-000000000009'));
select pg_temp.expect('A7 nobody is Human or System, and the owner is untouched',
  not exists (select 1 from hq_account_classification where account_type in ('human', 'system') or profile_id = '10000000-0000-0000-0000-000000000001'));
select pg_temp.expect('A8 six seeded rows, six audit rows, each naming its source',
  (select count(*) = 6 from hq_account_classification where basis = 'provenance' and source_ref is not null)
  and (select count(*) = 6 from audit_log where action = 'hq_account_classified' and actor_id is null));

-- B. the admin function: owner only, reason, valid type, every change audited, no-op on no change
select pg_temp.refused('B1 a non-owner cannot classify',
  $q$select hq_account_classify('10000000-0000-0000-0000-00000000000c', 'Nurse', array['10000000-0000-0000-0000-000000000008']::uuid[], 'human', 'looks real', 't')$q$, 'owner_required');
select pg_temp.refused('B2 nobody (null actor) cannot classify',
  $q$select hq_account_classify(null, 'x', array['10000000-0000-0000-0000-000000000008']::uuid[], 'human', 'looks real', 't')$q$, 'owner_required');
select pg_temp.refused('B3 a blank reason is refused',
  $q$select hq_account_classify('10000000-0000-0000-0000-000000000001', 'The Owner', array['10000000-0000-0000-0000-000000000008']::uuid[], 'human', '  ', 't')$q$, 'reason');
select pg_temp.refused('B4 an unknown type is refused',
  $q$select hq_account_classify('10000000-0000-0000-0000-000000000001', 'The Owner', array['10000000-0000-0000-0000-000000000008']::uuid[], 'robot', 'checked', 't')$q$, 'unknown account type');
select pg_temp.refused('B5 a missing account is refused (nothing written)',
  $q$select hq_account_classify('10000000-0000-0000-0000-000000000001', 'The Owner', array['10000000-0000-0000-0000-000000000008', '99999999-0000-0000-0000-000000000000']::uuid[], 'human', 'checked', 't')$q$, 'not_found');
select pg_temp.refused('B6 the table refuses an unknown type even from a direct write',
  $q$insert into hq_account_classification (profile_id, account_type, reason) values ('10000000-0000-0000-0000-000000000008', 'robot', 'x')$q$, 'type_check');
select pg_temp.refused('B7 a provenance row without a source is refused',
  $q$insert into hq_account_classification (profile_id, account_type, basis, reason) values ('10000000-0000-0000-0000-000000000008', 'test', 'provenance', 'x')$q$, 'source_check');

select pg_temp.expect('B8 the owner classifies two accounts Human: 2 changed',
  hq_account_classify('10000000-0000-0000-0000-000000000001', 'The Owner',
    array['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c']::uuid[], 'human', 'Confirmed with the facility', 'trace-b8') = 2);
select pg_temp.expect('B9 each change wrote one audit row: before, after, who, when, reason, trace',
  (select count(*) = 2 from audit_log where action = 'hq_account_classified' and trace_id = 'trace-b8'
     and actor_id = '10000000-0000-0000-0000-000000000001' and actor_name = 'The Owner'
     and old_value ->> 'account_type' = 'unclassified' and new_value ->> 'account_type' = 'human'
     and new_value ->> 'reason' = 'Confirmed with the facility' and created_at is not null));
select pg_temp.expect('B10 classifying again to the same type changes and audits nothing',
  hq_account_classify('10000000-0000-0000-0000-000000000001', 'The Owner',
    array['10000000-0000-0000-0000-00000000000c']::uuid[], 'human', 'again', 'trace-b10') = 0
  and not exists (select 1 from audit_log where trace_id = 'trace-b10'));
select pg_temp.expect('B11 reclassifying a seeded Demo row records demo -> human and makes it manual',
  hq_account_classify('10000000-0000-0000-0000-000000000001', 'The Owner',
    array['10000000-0000-0000-0000-000000000003']::uuid[], 'human', 'Real nurse reusing a demo login', 'trace-b11') = 1);
select pg_temp.expect('B11b (next statement, so it sees the write) the trail says demo to human and the row is manual',
  exists (select 1 from audit_log where trace_id = 'trace-b11' and old_value ->> 'account_type' = 'demo' and new_value ->> 'account_type' = 'human')
  and exists (select 1 from hq_account_classification where profile_id = '10000000-0000-0000-0000-000000000003' and basis = 'manual' and source_ref is null));
-- B12: a direct write, not through the function, is audited too.
insert into hq_account_classification (profile_id, account_type, reason) values ('10000000-0000-0000-0000-000000000008', 'system', 'direct');
select pg_temp.expect('B12b the direct write produced its audit row',
  exists (select 1 from audit_log where action = 'hq_account_classified' and entity_id = '10000000-0000-0000-0000-000000000008' and new_value ->> 'account_type' = 'system'));

-- C. the default view
select pg_temp.expect('C1 default is Active Humans', (select users_default_view = 'active_humans' from hq_config));
select pg_temp.refused('C2 a non-owner cannot change it',
  $q$select hq_users_default_view_set('10000000-0000-0000-0000-00000000000c', 'Nurse', 'all', 't')$q$, 'owner_required');
select pg_temp.refused('C3 an unknown view is refused',
  $q$select hq_users_default_view_set('10000000-0000-0000-0000-000000000001', 'The Owner', 'everyone', 't')$q$, 'unknown view');
select pg_temp.expect('C4 the owner sets All Accounts, audited',
  hq_users_default_view_set('10000000-0000-0000-0000-000000000001', 'The Owner', 'all', 'trace-c4') = 'all');
select pg_temp.expect('C4b (next statement) the setting is All Accounts and the change is audited',
  (select users_default_view = 'all' from hq_config)
  and exists (select 1 from audit_log where trace_id = 'trace-c4' and action = 'hq_users_default_view_set'
               and old_value ->> 'users_default_view' = 'active_humans' and new_value ->> 'users_default_view' = 'all'));
select pg_temp.refused('C5 the column refuses an unknown view from a direct write',
  $q$update hq_config set users_default_view = 'everyone'$q$, 'users_default_view_check');

-- D. red-proof: with the audit trigger OFF, a change leaves no audit row -- so the trigger is what audits
begin;
alter table hq_account_classification disable trigger trg_hq_account_classification_audit;
update hq_account_classification set account_type = 'test', reason = 'red proof' where profile_id = '10000000-0000-0000-0000-00000000000c';
select pg_temp.expect('D1 RED-PROOF with the trigger off, the change is NOT audited (the trigger is the control)',
  not exists (select 1 from audit_log where entity_id = '10000000-0000-0000-0000-00000000000c' and new_value ->> 'reason' = 'red proof'));
rollback;

-- D2 red-proof: with the owner check removed, a non-owner WOULD classify -- so hq_actor_is_owner is the control
begin;
create or replace function hq_actor_is_owner(p_actor uuid) returns boolean language sql as $$ select true $$;
select pg_temp.expect('D2 RED-PROOF with the owner check planted open, a non-owner classifies (so the check is the control)',
  hq_account_classify('10000000-0000-0000-0000-00000000000c', 'Nurse', array['10000000-0000-0000-0000-000000000007']::uuid[], 'human', 'planted', 't') = 1);
rollback;

-- E. data preserved: the access tables are exactly as seeded
select pg_temp.expect('E1 memberships, appointments, decisions and auth users unchanged by classification',
  (select count(*) = 2 from platform_membership) and (select count(*) = 1 from individual_membership)
  and (select count(*) = 1 from ogs_office_appointments where status = 'active')
  and (select count(*) = 1 from competency_decisions) and (select count(*) = 12 from auth.users where banned_until is null));
