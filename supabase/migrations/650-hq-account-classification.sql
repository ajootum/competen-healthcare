-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql function bodies between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 650: HQ ACCOUNT CLASSIFICATION (Human, Demo, Test, System / Service, Unclassified)
--
-- Owner GO HQ-USERS-CLASSIFY-01 (28 Oct 2026). The HQ Users page mixes genuine people with demo, test and
-- fixture accounts. This adds an ADMINISTRATIVE label per profile for filtering, counting and reporting.
-- Build record: docs/evidence/HQ-USERS-CLASSIFY-01/650-build-record.md
--
-- DEPENDS ON 001 (profiles), 040 + 178 (audit_log with trace_id), 264 (hq_config), 500 (hq_actor_is_owner).
-- All in production. Additive. Re-running it is a no-op. It never overwrites a classification that exists.
--
-- WHAT IT ADDS
--   hq_account_classification   one row per classified profile. No row = Unclassified. Kept separate from
--                               account status, which stays with Auth (active, pending, suspended).
--   hq_config.users_default_view  the default view of the Users screen, Active Humans.
--   hq_account_classification_audit  trigger. EVERY insert, change and removal writes one audit_log row
--                               (before, after, who, when, reason), whoever the writer is.
--   hq_account_classify()       bulk classification. Owner only (hq_actor_is_owner, 500). Service role only.
--   hq_users_default_view_set() the default view. Owner only. Audited. Service role only.
--
-- WHAT IT DOES NOT DO. It grants and revokes nothing. No function, policy or guard reads the new table
-- except the three above (VERIFY-650 row 6 proves it). It writes no auth.users row, entitlement, membership,
-- HQ appointment, governance seat, competency record, Passport, learning row or relationship.
--
-- EVIDENCE-BASED SEED (section 5). Demo or Test ONLY where a script in the repository provably created the
-- account: the exact address, or the exact address rule, that the script writes. Never by email domain,
-- name, missing login or verification alone. Everything else stays Unclassified for a person to review.
-- Nobody is classified Human or System by this file. Each row names its source in source_ref.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. APPLY WHOLE banner above.
-- No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/HQ-USERS-CLASSIFY-01/ROLLBACK-650.sql
-- ====================================================================================================


-- ---- 1. the classification -------------------------------------------------------------------------

create table if not exists hq_account_classification (
  profile_id     uuid primary key references profiles(id) on delete cascade,
  account_type   text not null default 'unclassified',
  basis          text not null default 'manual',
  source_ref     text,
  reason         text not null,
  classified_by  uuid references profiles(id) on delete set null,
  classified_at  timestamptz not null default now()
);

alter table hq_account_classification drop constraint if exists hq_account_classification_type_check;
alter table hq_account_classification add constraint hq_account_classification_type_check
  check (account_type in ('human', 'demo', 'test', 'system', 'unclassified'));
alter table hq_account_classification drop constraint if exists hq_account_classification_basis_check;
alter table hq_account_classification add constraint hq_account_classification_basis_check
  check (basis in ('manual', 'provenance'));
alter table hq_account_classification drop constraint if exists hq_account_classification_source_check;
alter table hq_account_classification add constraint hq_account_classification_source_check
  check (basis <> 'provenance' or length(btrim(coalesce(source_ref, ''))) > 0);
alter table hq_account_classification drop constraint if exists hq_account_classification_reason_check;
alter table hq_account_classification add constraint hq_account_classification_reason_check
  check (length(btrim(reason)) between 1 and 600);

create index if not exists hq_account_classification_type_idx on hq_account_classification (account_type);

-- HQ reads it with the service role. No policy: nobody else reads or writes it.
alter table hq_account_classification enable row level security;
revoke all on table hq_account_classification from anon, authenticated;


-- ---- 2. the default view (existing HQ configuration) ------------------------------------------------

alter table hq_config add column if not exists users_default_view text not null default 'active_humans';
alter table hq_config add column if not exists users_default_view_updated_at timestamptz;
alter table hq_config add column if not exists users_default_view_updated_by uuid references profiles(id) on delete set null;
alter table hq_config drop constraint if exists hq_config_users_default_view_check;
alter table hq_config add constraint hq_config_users_default_view_check
  check (users_default_view in ('active_humans', 'all_humans', 'pending', 'demo', 'test', 'system', 'unclassified', 'all'));


-- ---- 3. every change is audited, whoever writes it ----------------------------------------------------

create or replace function hq_account_classification_audit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row        hq_account_classification;
  v_old        text;
  v_new        text;
  v_actor      uuid;
  v_actor_name text;
  v_name       text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_old := old.account_type;
    v_new := 'unclassified';
    v_actor := null;
  elsif tg_op = 'UPDATE' then
    v_row := new;
    v_old := old.account_type;
    v_new := new.account_type;
    v_actor := new.classified_by;
  else
    v_row := new;
    v_old := 'unclassified';
    v_new := new.account_type;
    v_actor := new.classified_by;
  end if;

  if v_old = v_new then
    return coalesce(new, old);
  end if;

  select p.full_name into v_name from profiles p where p.id = v_row.profile_id;
  v_actor_name := nullif(current_setting('hq.classify_actor_name', true), '');
  if v_actor_name is null and v_actor is not null then
    select p.full_name into v_actor_name from profiles p where p.id = v_actor;
  end if;

  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name, old_value, new_value, trace_id)
  values (v_actor, v_actor_name, 'hq_account_classified', 'user', v_row.profile_id, v_name,
          jsonb_build_object('account_type', v_old),
          jsonb_build_object('account_type', v_new, 'reason', v_row.reason, 'basis', v_row.basis,
                             'source_ref', v_row.source_ref, 'operation', lower(tg_op)),
          nullif(current_setting('hq.classify_trace', true), ''));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_hq_account_classification_audit on hq_account_classification;
create trigger trg_hq_account_classification_audit
  after insert or update or delete on hq_account_classification
  for each row execute function hq_account_classification_audit();


-- ---- 4. the two admin functions (owner only, service role only) ---------------------------------------

create or replace function hq_account_classify(
  p_actor uuid, p_actor_name text, p_profile_ids uuid[], p_account_type text, p_reason text, p_trace text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id      uuid;
  v_old     text;
  v_changed integer := 0;
begin
  if p_actor is null or not hq_actor_is_owner(p_actor) then
    raise exception 'hq_account_classify owner_required: classifying accounts requires platform ownership';
  end if;
  if p_account_type is null or p_account_type not in ('human', 'demo', 'test', 'system', 'unclassified') then
    raise exception 'hq_account_classify invalid: unknown account type';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(btrim(p_reason)) > 500 then
    raise exception 'hq_account_classify invalid: a reason of 3 to 500 characters is required';
  end if;
  if p_profile_ids is null or cardinality(p_profile_ids) = 0 or cardinality(p_profile_ids) > 500 then
    raise exception 'hq_account_classify invalid: select between 1 and 500 accounts';
  end if;
  if exists (select 1 from unnest(p_profile_ids) as x(id) where not exists (select 1 from profiles p where p.id = x.id)) then
    raise exception 'hq_account_classify not_found: an account in the selection does not exist';
  end if;

  perform set_config('hq.classify_actor_name', coalesce(p_actor_name, ''), true);
  perform set_config('hq.classify_trace', coalesce(p_trace, ''), true);

  for v_id in select distinct x.id from unnest(p_profile_ids) as x(id) loop
    v_old := null;
    select c.account_type into v_old from hq_account_classification c where c.profile_id = v_id for update;
    if coalesce(v_old, 'unclassified') = p_account_type then
      continue;
    end if;
    insert into hq_account_classification (profile_id, account_type, basis, source_ref, reason, classified_by, classified_at)
    values (v_id, p_account_type, 'manual', null, btrim(p_reason), p_actor, now())
    on conflict (profile_id) do update
      set account_type = excluded.account_type, basis = 'manual', source_ref = null,
          reason = excluded.reason, classified_by = excluded.classified_by, classified_at = excluded.classified_at;
    v_changed := v_changed + 1;
  end loop;

  perform set_config('hq.classify_actor_name', '', true);
  perform set_config('hq.classify_trace', '', true);
  return v_changed;
end;
$$;

create or replace function hq_users_default_view_set(p_actor uuid, p_actor_name text, p_view text, p_trace text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old text;
begin
  if p_actor is null or not hq_actor_is_owner(p_actor) then
    raise exception 'hq_users_default_view owner_required: changing the default view requires platform ownership';
  end if;
  if p_view is null or p_view not in ('active_humans', 'all_humans', 'pending', 'demo', 'test', 'system', 'unclassified', 'all') then
    raise exception 'hq_users_default_view invalid: unknown view';
  end if;
  select c.users_default_view into v_old from hq_config c where c.id = 'singleton' for update;
  if not found then
    raise exception 'hq_users_default_view not_found: the HQ configuration row is missing (migration 264)';
  end if;
  if v_old = p_view then
    return p_view;
  end if;

  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_users_default_view_set', 'hq_config', 'singleton',
          jsonb_build_object('users_default_view', v_old), jsonb_build_object('users_default_view', p_view), p_trace);

  update hq_config set users_default_view = p_view, users_default_view_updated_at = now(), users_default_view_updated_by = p_actor
   where id = 'singleton';
  return p_view;
end;
$$;

revoke all on function hq_account_classification_audit() from public, anon, authenticated;
revoke all on function hq_account_classify(uuid, text, uuid[], text, text, text) from public, anon, authenticated;
revoke all on function hq_users_default_view_set(uuid, text, text, text) from public, anon, authenticated;
grant execute on function hq_account_classify(uuid, text, uuid[], text, text, text) to service_role;
grant execute on function hq_users_default_view_set(uuid, text, text, text) to service_role;


-- ---- 5. the evidence-based seed --------------------------------------------------------------------
-- One row per account a repository script provably created, matched on the WHOLE address the script writes
-- (anchored, lower case). Never on a domain alone. on conflict do nothing: an existing classification, manual
-- or not, is never overwritten, so re-running this file changes nothing. The trigger audits each insert.
--
-- Deliberately NOT here, so they stay Unclassified for review:
--   accounts with no creating script in the repository (ad hoc staging accounts named only in docs)
--   random-looking self-service sign-ups (the open Practice signup is a real door, not a fixture)
--   rows inserted by scripts/ckri-db/test-44x.sql (local disposable database, always rolled back)
--   the people seed-storyline.mjs and seed-skill-scores.mjs UPDATE (real profiles, not created by them)

insert into hq_account_classification (profile_id, account_type, basis, source_ref, reason)
select m.id, m.account_type, 'provenance', m.source_ref, 'Created by a repository ' || m.kind || ' (migration 650, see source_ref)'
  from (
    select distinct on (u.id) u.id, ev.account_type, ev.kind, ev.source_ref
      from auth.users u
      join profiles p on p.id = u.id
      join (values
        ('demo', 'demo seed', 'scripts/seed-cohort.mjs:77-116 (AMU cohort cast list, 1 manager and 24 nurses)',
         '^(ruth\.nabwire|sarah\.namutebi|david\.okello|miriam\.auma|joseph\.kato|esther\.nabirye|samuel\.wanyama|rebecca\.achieng|daniel\.mugisha|florence\.nakimuli|peter\.ssali|agnes\.nafula|emmanuel\.tumusiime|joan\.akello|isaac\.byaruhanga|winnie\.nabukenya|robert\.ochieng|catherine\.nassali|brian\.kirya|lydia\.amoding|moses\.wamala|christine\.nakintu|henry\.opio|betty\.namusoke|andrew\.mwesigwa)@amu\.competen\.demo$'),
        ('test', 'test fixture', 'scripts/create-test-admin.mjs:48',
         '^testadmin@competen\.test$'),
        ('test', 'test fixture', 'scripts/functional-test.mjs:44 (makeUser, with its 6-hex collision suffix)',
         '^test(nurse|assessor|educator|educator2|outsider|dual|hospadmin)(-[0-9a-f]{6})?@competen\.test$'),
        ('test', 'test fixture', 'scripts/interaction-test.mjs:70',
         '^ixn-(edua|assra|nursea1|nursea2|admina|dualae|edub|assrb|nurseb1)@interaction\.test$'),
        ('test', 'test fixture', 'scripts/coe-test.mjs:36',
         '^coe-(admina|adminb|validated|unvalidated)@interaction\.test$'),
        ('test', 'test fixture', 'scripts/coe-shift-test.mjs:37',
         '^shft-(admina|adminb|nurse|other)@interaction\.test$'),
        ('test', 'test fixture', 'scripts/workforce-test.mjs:45',
         '^wae-(admin|emp)@interaction\.test$'),
        ('test', 'test fixture', 'scripts/identity-join-harness.ts:44',
         '^harness-join-[a-z0-9]+-[0-9]{10,}@harness\.invalid$'),
        ('test', 'test fixture', 'scripts/platform-membership-harness.ts:444-448',
         '^harness-cpsplit-(practice|estate)@competen\.test$'),
        ('test', 'test fixture', 'scripts/practice-identity-publication-harness.ts:140',
         '^pub-harness-(confirmed|unconfirmed|third)@competen\.test$'),
        ('test', 'test fixture', 'scripts/practice-signup-harness.ts:42-45',
         '^harness-signup(-other)?@competen\.test$'),
        ('test', 'test fixture', 'scripts/practice-signup-harness.ts:151 (signup probe)',
         '^probe-[0-9]{10,}@example\.invalid$'),
        ('test', 'test fixture', 'scripts/provision-staging-fixture.ts:66',
         '^smoke\.practitioner@staging\.competen\.invalid$'),
        ('test', 'test fixture', 'scripts/provision-staging-hq-fixture.ts:38',
         '^hq\.operator@staging\.competen\.invalid$'),
        ('test', 'test fixture', 'scripts/provision-staging-estate-fixture.ts:71-73,443,654,738',
         '^estate\.(owner\.a|owner\.b|nurse|staff\.[1-5]|twoclinics|nodest)@staging\.competen\.invalid$'),
        ('test', 'test fixture', 'scripts/pd-retry-idempotency-proof.ts:50',
         '^retry\.proof@staging\.competen\.invalid$'),
        ('test', 'test fixture', 'scripts/submit-staging-cf-found-review.ts:72',
         '^cf-found-curator@staging\.competen\.invalid$'),
        ('test', 'test fixture', 'scripts/staging-lcpd-ecg-acceptance.ts:154',
         '^stage4-ecg-professional@staging\.competen\.invalid$'),
        ('test', 'test fixture', 'scripts/staging-c5-verification-acceptance.ts:84',
         '^c5-(studio-admin|assessor)@staging\.competen\.invalid$'),
        ('test', 'test fixture', 'scripts/staging-hq-browser-check-user.ts:72',
         '^hq-browser-check@staging\.competen\.invalid$'),
        ('test', 'test fixture', 'scripts/rehearse-nursing-reviewer-scope.ts:78',
         '^rehearsal-nursing-reviewer@competen\.test$'),
        ('test', 'test fixture', 'scripts/account-profile-acceptance-harness.ts:61',
         '^harness-acct-(a|b|a-new)@competen\.test$'),
        ('test', 'test fixture', 'scripts/email-sync-acceptance-harness.ts:55-56',
         '^harness-esync-(c|u|c2|u2)-[0-9a-f]{6}@competen\.test$'),
        ('test', 'test fixture', 'scripts/scholar-join-harness.ts:203,282',
         '^harness-join-(new|unconfirmed)-[a-z0-9]{6}@competen\.test$'),
        ('test', 'test fixture', 'scripts/scholar-hfe-fixture.ts:59 (disposable browser-look student)',
         '^harness-hfe-(grantor|student)@competen\.test$'),
        ('test', 'test fixture', 'acceptance harnesses with fixed addresses: ai-fair-use, case-intelligence, clinical-review, learning, hq-users-authority, hq-users-reset, hq-users-directory, individual-acceptance, individual-access, individual-commerce-staging, individual-config, individual-professional, professional-profile, professional-profile-b, professional-needs, professional-plan, professional-competency, professional-c5-wiring, professional-evaluation, professional-passport, professional-progress, scholar-join, and the scholar harnesses (scripts/*-harness.ts)',
         '^harness-(aifu-person|ci-(student1|student2|educator|reviewer|publisher)|cr-(author|reviewer1|reviewer2|reviewer3)|lrn-(author|reviewer|publisher|price|issuer|learner|learner2)|usersa-(viewer|stranger|owner|victim|created)|usersb-(resetter|stranger|target|unverified|suspended|burst|target2|ceo|burstactor|owner|ownertarget)|usersc-(viewer|subject|stranger)|ind003-(grantor|both|scholar|pro|suspended|revoked)|access001-(grantor|scholar|pro|both|existing|expired|revoked|uninvited|invitee|invitee-revoked|invitee-expired|invitee-reuse)|p1c-(buyer|scholar)|cfg002-(holder|nonholder)|ind007-(grantor|pro|other|pilot)|prof01-(grantor|scholar|invited|other)|prof01b-(person|other|verifier|plain)|prof02-paeds|prof03-ecg|prof05-competency|prof05-c5wire|prof06-evaluation|prof07-passport|prof08-(progress|other)|join-pro|(ind004|ind004p|upload|upl01|revision01|revhold|prog01|learn01|journey|eval01|clinical01|exam)-(grantor|a|b)|s2-(a|b)|s5-(learner|grantor)|scholarshare)@competen\.test$')
      ) as ev(account_type, kind, source_ref, pattern)
        on lower(u.email) ~ ev.pattern
     order by u.id, ev.source_ref
  ) m
on conflict (profile_id) do nothing;

-- The explicit marker fixtures write at creation (user_metadata synthetic or synthetic_automation_account).
-- user_metadata is writable by its own user, so the marker alone is NOT enough: it counts only together with
-- an address on a reserved, undeliverable test domain (.test, .invalid). A marker on any other address is left
-- Unclassified and reported by VERIFY-650 for review.
insert into hq_account_classification (profile_id, account_type, basis, source_ref, reason)
select u.id, 'test', 'provenance',
       'auth.users.raw_user_meta_data synthetic marker written by the creating fixture script, on a reserved test domain',
       'Created by a repository test fixture: synthetic marker on a .test or .invalid address'
  from auth.users u
  join profiles p on p.id = u.id
 where (coalesce(u.raw_user_meta_data ->> 'synthetic', '') = 'true'
        or coalesce(u.raw_user_meta_data ->> 'synthetic_automation_account', '') = 'true')
   and lower(u.email) ~ '\.(test|invalid)$'
on conflict (profile_id) do nothing;


-- Verification: rows by type and basis (nothing manual, nothing human or system), and audit rows to match.
select account_type, basis, count(*) as accounts from hq_account_classification group by account_type, basis order by account_type;

select count(*) as classification_audit_rows from audit_log where action = 'hq_account_classified';

select users_default_view from hq_config where id = 'singleton';

notify pgrst, 'reload schema';
