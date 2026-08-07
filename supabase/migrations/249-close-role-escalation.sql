-- ============================================================
-- MIGRATION 249: CLOSE THE TWO PATHS TO super_admin
-- COMP-SECURITY-SURVEY-001 s0.1 and s0.1b, Phase 0 item 1
--
-- ----------------------------------------------------------------------------------------------------
-- WARNING: THIS IS A LIVE PRODUCT WITH A LIVE ESCALATION. BOTH HALVES MUST LAND TOGETHER.
--
-- Two independent routes to super_admin exist on this database today. Each was read back from the
-- deployed catalogue, not from a migration file, because migration text is not evidence of what is
-- running. Fixing either one alone leaves the platform fully open, so they are one file.
--
--   PATH 1, UNAUTHENTICATED. The deployed body of public.handle_new_user() copies the signup payload's
--   role verbatim:
--       coalesce(nullif(trim(new.raw_user_meta_data->>'role'), ''), 'nurse')
--   There is no allow-list. The trigger fires on auth.users, so the clamp in
--   src/app/api/auth/signup/route.ts is not the only door -- a direct POST to GoTrue /auth/v1/signup
--   with the public anon key that ships to every browser reaches the same trigger. Live auth settings
--   read back today: disable_signup false, mailer_autoconfirm true. So the call returns a usable
--   session immediately, with whatever role the caller asked for.
--
--   PATH 2, ANY SIGNED-IN USER. The deployed profiles UPDATE policy is
--       USING (auth.uid() = id)   WITH CHECK = null
--   Postgres reuses USING as the check when WITH CHECK is absent, and auth.uid() = id is still true
--   after the row changes. So the policy permits a user to rewrite EVERY column of their own row,
--   including every column that grants authority. One PATCH /rest/v1/profiles?id=eq.<self> with the
--   browser's own session is a promotion. The policy comes from supabase/schema.sql and was never
--   dropped or replaced in 248 migrations.
--
-- profiles.role is what every workspace gate reads AND what current_user_is_super_admin() reads, so
-- either path clears the application gates and the database policies in one step.
-- ----------------------------------------------------------------------------------------------------
--
-- WHAT DECIDES AUTHORITY, AND WHY THE CHECK COVERS TWELVE COLUMNS AND NOT ONE.
-- profiles carries SIX overlapping role columns and three overlapping tenant columns, and different
-- gates read different ones. A WITH CHECK that pinned only role would be theatre: platform_roles is the
-- landlord axis (getLandlordCaller passes on length > 0 and has no CHECK constraint behind it, so any
-- string works), org_roles drives the organisation plane, hospital_id / organisation_id / tenant_id
-- decide WHOSE data is in reach, managed_country widens a country_admin to every hospital when null,
-- is_senior_assessor grants senior-assessor authority, and account_status is the suspension state.
-- All twelve are pinned. Live values were read before choosing them.
--
-- TWO MECHANISMS, DELIBERATELY, BECAUSE EACH COVERS THE OTHER'S FAILURE MODE.
--   Section 3 is the RLS policy. It states the rule where a reader looks for it and it survives a
--   future re-grant of table privileges, which Supabase tooling does routinely.
--   Section 4 is column-level UPDATE privilege. It is enforced by the privilege system rather than by
--   evaluating an expression, so it cannot recurse, cannot error at runtime, and holds even where RLS
--   is currently unreliable -- and on this database RLS on profiles IS currently unreliable: an anon
--   read of profiles returns 42P17 infinite recursion today, caused by the two pre-existing SELECT
--   policies that join profiles to itself. That recursion is NOT fixed here. It is a separate, larger
--   change across profiles, hospitals, assessments and competency_scores, and mixing it into an
--   escalation fix would put a lockout risk inside the one change that has none.
--
-- WHY THE CHECK CALLS A SECURITY DEFINER FUNCTION INSTEAD OF SUBQUERYING profiles INLINE.
-- An inline subquery on profiles inside a profiles policy is exactly what causes the live 42P17 -- see
-- the two SELECT policies named above. A security definer function runs as the table owner, which is
-- exempt from row-level security, so it reads the current row without re-entering the policy. This is
-- the pattern already proven on this database: 38 live policies across 28 tables reach profiles only
-- through current_user_is_* helpers, and every one of those tables answers an anon probe with 200 while
-- every table that references profiles directly answers 42P17. The function is verified, not assumed.
--
-- SEARCH PATH IS PINNED ON BOTH FUNCTIONS TOUCHED HERE. Seven of nine security definer functions in
-- this database have no pin, and it is precisely the seven that make authorization decisions. An
-- unpinned definer function can be pointed at an attacker-created schema. The other six are NOT fixed
-- here -- one file, one concern.
--
-- WHAT THIS FILE REFUSES TO DO:
--   NO EXCEPTION IS RAISED IN THE TRIGGER. An unrecognised role becomes 'nurse'. A raising trigger on
--   auth.users fails signup in ways that are hard to diagnose and can strand a legitimate user mid
--   registration, and this product has self-service signup switched on right now.
--   THE EXISTING `exception when others then return new` SWALLOW IS LEFT ALONE. Removing it is a real
--   improvement and a separate, riskier change: a hard failure there breaks signup entirely.
--   NO BLANKET DENIAL OF SELF-EDIT. A user may still change their own name, phone, country,
--   specialization and avatar. Only authority moves out of reach.
--   THE profiles INSERT POLICY IS NOT TOUCHED. "Users insert own profile" has
--   WITH CHECK (auth.uid() = id) and would let a signed-in user mint a privileged row -- but only if
--   their profile row were absent, and no DELETE policy on profiles exists for them to make it absent.
--   It is a third door of the same class, currently unreachable, and it is reported rather than
--   silently widened into this file.
--
-- >>> APPLY THIS FILE AS A WHOLE, IN THE SUPABASE SQL EDITOR, NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 1 is plpgsql and carries internal semicolons inside its $$ ... $$ body, exactly as the
-- deployed function and migration 194 section 6 do. A naive splitter would cut it into fragments, the
-- replace would fail, and the OLD AND VULNERABLE function would stay deployed while the run looked
-- like it had worked -- the same shape of false success that migration 238 produced. Section 2's body
-- is a single sql statement, the shape migrations 168, 172 and 187 use, and survives either way.
--
-- AFTER APPLYING, CONFIRM BOTH OBJECTS CHANGED rather than trusting the editor's success message.
-- plat_function_registry() returns the deployed body of handle_new_user, and plat_rls_registry()
-- returns with_check for the profiles UPDATE policy, which must no longer be null.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and NO SEMICOLON ANYWHERE EXCEPT ENDING A
-- STATEMENT -- including inside comments. The runner splits on them, and a semicolon inside a comment
-- silently drops the statements around it while still reporting success. That happened on migration 238.
-- Function bodies follow migration 194's proven single-statement shape, which the runner carries intact.
--
-- ORDER MATTERS INSIDE THIS FILE. Section 2 must exist before section 3 can name it in a policy, and
-- section 4's revoke must precede its grant or the column-level privileges are swallowed by the
-- table-level one.
-- ============================================================


-- ---- 1. THE SIGNUP TRIGGER: CLAMP THE CLIENT-SUPPLIED ROLE TO AN ALLOW-LIST -----------------------
--
-- THE ALLOW-LIST IS nurse, assessor, educator. Derived three independent ways, all agreeing:
--   1. src/app/signup/page.tsx offers exactly these three in its select, and says underneath it
--      "Administrator accounts are created by your organisation's admin or Competen".
--   2. src/app/api/auth/signup/route.ts already clamps to PUBLIC_ROLES = nurse, assessor, educator.
--   3. src/app/api/v1/practice/signup/route.ts hardcodes 'nurse'.
-- All three are inside the live distinct set of profiles.role, which today is nurse 36,
-- hospital_admin 4, educator 3, super_admin 3, assessor 1 over 47 rows. The four privileged values
-- that exist -- hospital_admin, country_admin, group_admin, super_admin -- are exactly the four a
-- self-signup must never be able to name.
--
-- NO ADMIN FLOW BREAKS. Both privileged creation paths go through GoTrue with NO role in the metadata:
-- inviteUserByEmail passes only full_name, and admin.createUser passes only full_name. Both therefore
-- already land on the 'nurse' default, and src/app/api/super-admin/users/route.ts then writes the real
-- role with the service role key, which bypasses RLS and every column grant below. The clamp changes
-- the outcome for nobody legitimate -- it changes it only for a caller who names a role the product
-- never offers.
--
-- SECURITY DEFINER IS RESTATED ON PURPOSE. create or replace REPLACES the attribute set, and omitting
-- it would silently downgrade the trigger to security invoker, which cannot write public.profiles.
-- That would break every signup on this platform.
--
-- The trigger on_auth_user_created on auth.users is unchanged and keeps pointing at this function.
-- create or replace preserves the OID, so the trigger is not disturbed.

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


-- ---- 2. THE AUTHORITY PIN, AS A SECURITY DEFINER FUNCTION ------------------------------------------
--
-- Answers one question: are the twelve authority columns of the row being written identical to the
-- twelve currently stored for the CALLER? It reads only auth.uid()'s own row, never a row named by an
-- argument, so it cannot be used as an oracle to probe somebody else's role -- it can only confirm
-- values the caller could already read about themselves.
--
-- is not distinct from, not =, throughout. Most of these columns are null on most rows -- 45 of 47
-- have a null org_role, 46 a null platform_role, 47 an empty platform_roles -- and null = null is
-- null, not true, so an equality test would refuse every ordinary self-edit on this database. That is
-- the mistake that would have locked people out.
--
-- stable, not volatile: it is a read, and the planner may cache it within the statement.

create or replace function public.profile_authority_unchanged(
  p_role text,
  p_roles text[],
  p_org_role text,
  p_org_roles text[],
  p_platform_role text,
  p_platform_roles text[],
  p_hospital_id uuid,
  p_organisation_id uuid,
  p_tenant_id uuid,
  p_managed_country text,
  p_is_senior_assessor boolean,
  p_account_status text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role               is not distinct from p_role
      and p.roles              is not distinct from p_roles
      and p.org_role           is not distinct from p_org_role
      and p.org_roles          is not distinct from p_org_roles
      and p.platform_role      is not distinct from p_platform_role
      and p.platform_roles     is not distinct from p_platform_roles
      and p.hospital_id        is not distinct from p_hospital_id
      and p.organisation_id    is not distinct from p_organisation_id
      and p.tenant_id          is not distinct from p_tenant_id
      and p.managed_country    is not distinct from p_managed_country
      and p.is_senior_assessor is not distinct from p_is_senior_assessor
      and p.account_status     is not distinct from p_account_status
  );
$$;

-- Only the signed-in plane needs it, because the policy below is scoped to authenticated. anon has no
-- auth.uid() and would only ever get false, but a security definer function reachable from the browser
-- with no session is a smell this repo has revoked everywhere else.

revoke all on function public.profile_authority_unchanged(
  text, text[], text, text[], text, text[], uuid, uuid, uuid, text, boolean, text) from public;

grant execute on function public.profile_authority_unchanged(
  text, text[], text, text[], text, text[], uuid, uuid, uuid, text, boolean, text) to authenticated;


-- ---- 3. THE profiles UPDATE POLICY GETS A REAL WITH CHECK ------------------------------------------
--
-- USING is unchanged, so exactly the same rows remain updatable and no existing user loses access to
-- their own row. WITH CHECK is what was missing: it is evaluated against the row AFTER the change, and
-- it now refuses any write that moves an authority column.
--
-- Scoped to authenticated rather than the previous implicit public. anon has no auth.uid(), so
-- auth.uid() = id already refused it -- this makes the intent explicit and nothing legitimate changes.
--
-- EVERY COLUMN REFERENCE IS QUALIFIED. In a WITH CHECK expression an unqualified name resolves against
-- the row being written, which is what is wanted, but role is a keyword in other contexts and this file
-- gets exactly one attempt. profiles.role is unambiguous to a reader and to the parser, and it still
-- means the NEW value.
--
-- drop-then-create rather than alter, so the file is idempotent. There is no create policy if not
-- exists.

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


-- ---- 4. COLUMN-LEVEL UPDATE PRIVILEGE, THE LAYER THAT CANNOT RECURSE OR MISFIRE --------------------
--
-- Postgres gives column-level UPDATE only to a role that does NOT hold table-level UPDATE, so the
-- revoke has to come first. After this, the browser planes can write five personal columns on profiles
-- and nothing else -- attempting any other column is refused by the privilege system with 42501,
-- before any policy is evaluated.
--
-- THE FIVE ARE THE PRODUCT'S OWN DEFINITION OF PERSONAL, not a guess. EDITABLE in
-- src/app/api/account/profile/route.ts is full_name, phone, country, specialization, and
-- src/app/api/account/avatar/route.ts writes avatar_url. Note country is the person's own country and
-- is NOT authority -- managed_country is the country_admin scope, and that one is pinned in section 3.
--
-- THE ONLY BROWSER-SIDE WRITE TO profiles IN THE WHOLE REPOSITORY is src/app/admin/settings/page.tsx,
-- which updates full_name and phone under the user's own session. Both are granted. Every other write
-- to profiles -- 14 of them, in API routes and lib engines -- goes through createAdminClient, which
-- uses SUPABASE_SERVICE_ROLE_KEY. service_role is untouched here, so super-admin user management, the
-- enterprise people API, the workforce engine, the importers, the senior-assessor grant, the practice
-- provisioning saga and the signup write-back all keep working exactly as before.
--
-- anon loses UPDATE outright and is granted nothing back. No flow anywhere writes profiles without a
-- session.
--
-- NOT REVOKED FROM PUBLIC, deliberately. Supabase grants to the named roles anon, authenticated and
-- service_role, not to PUBLIC, so there is nothing there to revoke -- and revoking from PUBLIC could
-- strip a privilege service_role inherits, which would break every server-side write to profiles. The
-- section 3 policy is the backstop if that assumption is ever wrong.

revoke update on public.profiles from anon;

revoke update on public.profiles from authenticated;

grant update (full_name, phone, country, specialization, avatar_url) on public.profiles to authenticated;


-- ---- 5. RLS STAYS ON -------------------------------------------------------------------------------
--
-- Idempotent restatement. profiles already has rls_enabled = true and this file must never be the
-- reason that changes.

alter table public.profiles enable row level security;


notify pgrst, 'reload schema';
