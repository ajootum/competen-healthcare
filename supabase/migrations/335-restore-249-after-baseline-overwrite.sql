-- APPLY THIS FILE WHOLE. It defines a function body, so a statement-splitting runner would cut it in
-- half.
--
-- Migration 335: restore migration 249 after 001 overwrote it in production
--
-- ============================ WHY THIS EXISTS ============================
--
-- APPLY THIS ONE TO PRODUCTION. It is a repair, not a baseline.
--
-- On 2026-08-19 supabase/migrations/001-canonical-baseline.sql was applied to the PRODUCTION project.
-- 001 is written for a FRESH database, where migration 249 runs after it and re-hardens what 001
-- creates in bootstrap form. Production has no migrations after 001, so two objects that 249 had
-- hardened were silently reverted to their 2026 bootstrap form.
--
-- MEASURED, not inferred. Production was read immediately afterwards:
--   profile_authority_unchanged  present   -- so 249 HAD run, and 001 overwrote its work
--   handle_new_user              bootstrap body, no role clamp, no exception handler
--   Users update own profile     with check NULL, where 249 left a twelve-column authority pin
--
-- ============================ WHAT WAS AND WAS NOT AT RISK ============================
--
-- NO PRIVILEGE ESCALATION WAS REACHABLE. 249 section 4 revokes table-level UPDATE on profiles from
-- authenticated and grants back only five personal columns. That layer is untouched by 001, and was
-- re-measured live: authenticated holds column UPDATE on avatar_url, country, full_name, phone,
-- specialization and nothing else, with no table-level UPDATE for authenticated or anon. A write to
-- role is refused with 42501 by the privilege system before any policy is evaluated.
--
-- SO THIS IS A LOST BACKSTOP, NOT AN OPEN DOOR. 249 section 3 exists precisely as the layer that holds
-- if the grant assumption is ever wrong, and defence in depth went from two layers to one.
--
-- THE OPERATIONAL RISK WAS THE LARGER ONE. the 249 handle_new_user ends with an exception handler that
-- returns new, so a failure writing profiles cannot abort the auth.users insert. The bootstrap body
-- has no handler, so any error creating a profile row would fail user creation outright -- and
-- inviteUserByEmail and admin.createUser both run through this trigger.
--
-- ============================ WHAT THIS RESTORES ============================
--
-- Both objects, byte-identical to migration 249. Nothing else in 001 caused drift: the nine tables are
-- create-if-not-exists no-ops, the RLS enables were already true, and the other six policies 001
-- recreated are declared in no later migration, so they were rewritten to the form they already had.
--
-- create or replace preserves the function OID, so the on_auth_user_created trigger is not disturbed.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1), 'New User'),
    new.email,
    case
      when nullif(trim(new.raw_user_meta_data->>'role'), '') in ('nurse', 'assessor', 'educator')
        then trim(new.raw_user_meta_data->>'role')
      else 'nurse'
    end
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email     = excluded.email,
    role      = excluded.role;
  return new;
exception when others then
  return new;
end;
$$;


-- The twelve-column authority pin from 249 section 3. Restored exactly, including the with check that
-- 001 dropped.

drop policy if exists "Users update own profile" on public.profiles;

create policy "Users update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = profiles.id)
  with check (
    auth.uid() = profiles.id
    and public.profile_authority_unchanged(
      profiles.role,
      profiles.roles,
      profiles.org_role,
      profiles.org_roles,
      profiles.platform_role,
      profiles.platform_roles,
      profiles.hospital_id,
      profiles.organisation_id,
      profiles.tenant_id,
      profiles.managed_country,
      profiles.is_senior_assessor,
      profiles.account_status
    )
  );

notify pgrst, 'reload schema';
