-- LOCAL-ONLY-STUB-650: the minimum of 001, 040, 178, 264, 279 and 500 that 650 touches, on a THROWAWAY postgres:17.
-- NEVER on staging or production. hq_actor_is_owner is copied verbatim from 500.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, email_confirmed_at timestamptz,
  banned_until timestamptz, encrypted_password text);
create table profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, email text,
  role text, roles text[], platform_role text, platform_roles text[]);
create table hospitals (id uuid primary key);
create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid references profiles(id) on delete set null,
  actor_name text, action text, entity_type text, entity_id uuid, entity_name text, hospital_id uuid references hospitals(id),
  old_value jsonb, new_value jsonb, created_at timestamptz not null default now(), tenant_id uuid, trace_id text);
create table hq_config (id text primary key default 'singleton', mode text not null default 'observe', updated_at timestamptz,
  updated_by uuid references profiles(id) on delete set null);
insert into hq_config (id) values ('singleton');
create table platform_membership (user_id uuid, status text);
create table individual_membership (user_id uuid, status text);
create table ogs_office_appointments (id uuid primary key default gen_random_uuid(), person_id uuid, status text);
create table competency_decisions (id uuid primary key default gen_random_uuid(), nurse_id uuid);

create or replace function hq_actor_is_owner(p_actor uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from profiles p
     where p.id = p_actor
       and (
         coalesce(case when coalesce(cardinality(p.roles), 0) > 0 then 'super_admin' = any(p.roles) else p.role = 'super_admin' end, false)
         or coalesce(case when coalesce(cardinality(p.platform_roles), 0) > 0 then 'platform_owner' = any(p.platform_roles) else p.platform_role = 'platform_owner' end, false)
       )
  )
$$;

-- People. Each comment says what 650 must do with them.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('10000000-0000-0000-0000-000000000001', 'owner@real.example.com', '{}', now()),                       -- owner, stays Unclassified
  ('10000000-0000-0000-0000-000000000002', 'ruth.nabwire@amu.competen.demo', '{}', now()),               -- Demo (seed-cohort cast)
  ('10000000-0000-0000-0000-000000000003', 'andrew.mwesigwa@amu.competen.demo', '{}', now()),            -- Demo (seed-cohort cast)
  ('10000000-0000-0000-0000-000000000004', 'stranger@amu.competen.demo', '{}', now()),                   -- domain only: Unclassified
  ('10000000-0000-0000-0000-000000000005', 'testnurse-a1b2c3@competen.test', '{}', now()),               -- Test (functional-test)
  ('10000000-0000-0000-0000-000000000006', 'harness-usersa-viewer@competen.test', '{"synthetic": true}', now()), -- Test (harness list)
  ('10000000-0000-0000-0000-000000000007', 'someone@competen.test', '{}', now()),                        -- test domain only: Unclassified
  ('10000000-0000-0000-0000-000000000008', 'agmckwheierhykydq@gmail.com', '{}', null),                   -- random sign-up: Unclassified
  ('10000000-0000-0000-0000-000000000009', 'selfmarked@gmail.com', '{"synthetic": true}', now()),        -- marker on real domain: Unclassified
  ('10000000-0000-0000-0000-00000000000a', 'adhoc@staging.competen.invalid', '{"synthetic": true}', now()), -- marker + .invalid: Test
  ('10000000-0000-0000-0000-00000000000b', 'probe-1761650000000@example.invalid', '{}', null),           -- Test (signup probe)
  ('10000000-0000-0000-0000-00000000000c', 'nurse@real.example.com', '{}', now());                       -- not owner, stays Unclassified
insert into profiles (id, full_name, email, role, roles, platform_role)
select id, 'Person ' || right(id::text, 2), email, 'nurse', '{}', null from auth.users;
update profiles set role = 'super_admin', full_name = 'The Owner' where id = '10000000-0000-0000-0000-000000000001';
insert into platform_membership values ('10000000-0000-0000-0000-000000000002', 'active'), ('10000000-0000-0000-0000-00000000000c', 'active');
insert into individual_membership values ('10000000-0000-0000-0000-00000000000c', 'active');
insert into ogs_office_appointments (person_id, status) values ('10000000-0000-0000-0000-000000000001', 'active');
insert into competency_decisions (nurse_id) values ('10000000-0000-0000-0000-000000000002');
