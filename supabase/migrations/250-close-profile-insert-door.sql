-- ============================================================
-- MIGRATION 250: CLOSE THE THIRD DOOR ON public.profiles -- THE INSERT POLICY
-- COMP-SECURITY-SURVEY-001 s0.1b, and the one item migration 249 reported rather than silently widened.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IS OPEN. Read back from the deployed catalogue with plat_rls_registry() while writing this file,
-- not from any migration text:
--
--     table=profiles  cmd=INSERT  policy="Users insert own profile"
--         roles      = null, which in pg_policy means PUBLIC, so anon and authenticated both
--         USING      = null
--         WITH CHECK = (auth.uid() = id)
--
-- The check constrains ONE column. A signed-in user may insert a profiles row carrying their own id and
-- any value in every other column -- role, roles, org_role, org_roles, platform_role, platform_roles,
-- hospital_id, organisation_id, tenant_id, managed_country, is_senior_assessor, account_status. Those are
-- the exact twelve migration 249 pinned on UPDATE. On INSERT there is no pin at all, so 249 closed the
-- promotion by one verb and left it open by the other.
--
-- WHY NOBODY HAS WALKED THROUGH IT. The caller's row already exists, so the insert hits the primary key.
-- It is unreachable only because no DELETE policy on profiles lets them remove their own row first --
-- re-confirmed live for this file: profiles carries five policies, three SELECT, one UPDATE, one INSERT,
-- and none over DELETE. That is an accident of configuration, not a control. One DELETE policy added by
-- anyone for any reason turns this straight back into a working promotion, and nothing would flag it.
--
-- The policy comes from supabase/fix-profile.sql, an unnumbered hand-applied script, where it sits under
-- the comment "Allow users to insert their own profile" beside the very trigger 249 had to clamp. It was
-- a workaround for profile creation failing in 2024. Profile creation has not needed it for a long time.
-- ----------------------------------------------------------------------------------------------------
--
-- WHAT REPLACES IT: NOTHING, ON PURPOSE. There is no legitimate browser-side INSERT into profiles left to
-- preserve. Every INSERT or UPSERT into profiles in src/ was traced for this file -- there are exactly
-- three, and all three run on the service role:
--     src/app/api/auth/signup/route.ts:56          admin.from("profiles").upsert  service role
--     src/app/api/super-admin/users/route.ts:99    admin.from("profiles").upsert  service role
--     src/app/api/v1/practice/signup/route.ts:101  admin.from("profiles").upsert  service role
-- The only write to profiles reachable from a browser session anywhere in the repository remains
-- src/app/admin/settings/page.tsx, and it is an UPDATE of full_name and phone, which migration 249
-- already provided for with a column-level UPDATE grant. So the narrow fix is available: take the INSERT
-- away rather than try to pin twelve columns on a statement no product code issues.
--
-- >>> THIS CANNOT BREAK SIGNUP. THE ARGUMENT IS A CASE ANALYSIS, NOT AN ASSUMPTION. <<<
-- The profile row for a new account is written twice, by two paths, and this file touches neither.
--   PATH A, the trigger. on_auth_user_created fires inside GoTrue's own transaction on auth.users. GoTrue
--   connects as supabase_auth_admin. PostgREST is the only thing on this platform that ever assumes anon
--   or authenticated, and PostgREST does not write auth.users. So whatever role the trigger's insert runs
--   as -- the function owner if the deployed attribute really is security definer, supabase_auth_admin if
--   it is not -- it is neither of the two roles section 1 touches, and a revoke aimed at exactly those two
--   cannot reach it. That holds without having to trust the attribute.
--   The same case analysis covers section 2. If the trigger runs as the owner of profiles, row-level
--   security does not apply to it and dropping a policy is irrelevant. If it does NOT run as the owner,
--   then the policy being dropped is ALREADY refusing its insert today, because auth.uid() reads a
--   PostgREST GUC that GoTrue never sets, so auth.uid() = id evaluates to null rather than true. Under
--   either branch, dropping this policy removes nothing the trigger was using.
--   PATH B, the service-role write-back. All three routes above upsert the profile immediately after
--   signUp with SUPABASE_SERVICE_ROLE_KEY. service_role bypasses RLS and holds its own grants, neither of
--   which is touched here. Live evidence that the pair works: 47 auth users, 47 profiles rows, zero auth
--   users without a profile, checked against the deployed database for this file.
--
-- WHY BOTH A REVOKE AND A POLICY DROP, WHICH IS THE SHAPE 249 ARGUED FOR.
--   Section 1 is the privilege system. It refuses with 42501 before any policy is evaluated, so it holds
--   even where RLS on profiles is currently unreliable -- and it is: an anon read of profiles still
--   answers 42P17 infinite recursion today, from the two SELECT policies that join profiles to itself.
--   That recursion is NOT fixed here, for the same reason 249 gave: it is a separate, larger change and
--   mixing it into a fix that has no lockout risk would give it one.
--   Section 2 is the row-level rule, and it is the layer that survives. Supabase tooling re-grants table
--   privileges routinely, and a re-grant of INSERT would silently undo section 1 on its own. With no
--   INSERT policy present, RLS denies by default and the re-grant buys nothing.
--
-- WHY NOT A POLICY WITH `with check (false)` INSTEAD OF DROPPING. It reads as a positive statement of
-- intent, which is attractive, but it is the same no-op: policies are OR'd, so a false policy stops
-- nothing that a later INSERT policy would allow, exactly as absence does. It would also be an object
-- whose only purpose is to be read, and this repository already has enough of those. The intent is
-- recorded here and asserted by scripts/practice-auth-guard-harness.ts instead.
--
-- ----------------------------------------------------------------------------------------------------
-- SECTIONS 3 AND 4 ARE TOOLING, AND THEY ARE IN THIS FILE BECAUSE WITHOUT THEM THIS FIX CANNOT BE PROVEN.
--
-- The whole class of bug being closed here is a file that says one thing and a database that does
-- another, so the fix is only worth as much as the assertion that watches it. Today nothing in this
-- repository can see either of the two things that matter:
--   plat_function_registry() returns prosrc and nothing else, so NOTHING can read prosecdef or proconfig.
--   That means "handle_new_user is security definer" and "search_path is pinned" -- 249's two central
--   attribute claims, and the exact pair that `create or replace` silently resets -- are unverifiable,
--   and COMP-SECURITY-SURVEY-001 s0.6's finding that seven authorization functions have no search_path
--   pin can never be regression-tested.
--   Nothing at all can read a grant. Migration 249 section 4 IS a grant -- five column-level UPDATE
--   privileges on profiles -- and it is invisible to every tool here. So is section 1 of this file.
-- Both new functions read catalogue metadata and write nothing, mirroring migrations 168, 172 and 187,
-- which are proven on this database. This is the cheap half of s0.4b's recommendation to wire the
-- registries into a harness.
--
-- `revoke ... from public` DOES appear in sections 3 and 4, and that is not the thing 249 warned against.
-- 249's warning was about `public.profiles`, where stripping PUBLIC could take away a privilege
-- service_role inherits and break every server-side write. On a FUNCTION, the revoke is immediately
-- followed by an explicit `grant execute ... to service_role`, so nothing is left depending on
-- inheritance. It is the pattern 168 and 172 already use, and it exists because Postgres grants EXECUTE
-- on a new function to PUBLIC by default, which in Supabase means anon and authenticated -- and a
-- catalogue registry describes precisely how to get around the controls it lists.
-- ----------------------------------------------------------------------------------------------------
--
-- WHAT THIS FILE REFUSES TO DO:
--   IT DOES NOT ADD A DELETE POLICY. profiles has none, and the harness asserts it stays that way. This
--   file removes the reason a DELETE policy would be dangerous, it does not invite one.
--   IT DOES NOT `create or replace` handle_new_user() OR profile_authority_unchanged(). Both were read
--   back from the deployed catalogue and both already carry 249's text. Replacing a function resets its
--   attribute set, and a file that does not need to touch them must not risk downgrading security definer
--   to security invoker for nothing.
--   IT DOES NOT REVOKE ANYTHING FROM public ON public.profiles, and it does not touch service_role.
--   IT DOES NOT TOUCH THE SELECT RECURSION, THE `exception when others then return new` SWALLOW, OR THE
--   SIX REMAINING UNPINNED SECURITY DEFINER FUNCTIONS. One file, one concern. Section 3 makes the last of
--   those findable, which is the useful half.
--
-- ORDER MATTERS. Section 2 must follow section 1 only in the sense that both must land -- but sections 3
-- and 4 each revoke before they grant, or the explicit grant is swallowed by the revoke that follows it.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and NO SEMICOLON ANYWHERE EXCEPT ENDING A
-- STATEMENT, including inside comments. The runner splits on them and migration 238 lost two sections to
-- a semicolon in a comment while still reporting success. Neither function body below contains an
-- internal semicolon -- each is a single sql statement, migration 172's proven shape -- so this file
-- survives a naive splitter as well as the SQL editor.
-- ============================================================


-- ---- 1. TAKE INSERT ON profiles AWAY FROM THE TWO BROWSER-FACING ROLES ----------------------------
--
-- Named roles, not PUBLIC, exactly as 249 section 4 did for UPDATE. Supabase grants to anon,
-- authenticated and service_role by name, so these two are the whole browser-reachable surface, and
-- service_role keeps everything it had.
--
-- anon is revoked as well, for symmetry and because nothing signs up without going through GoTrue. anon
-- could not have satisfied the old check anyway -- auth.uid() is null with no session -- but a privilege
-- that is only unusable by accident is the situation this file exists to end.
--
-- Revoking a privilege that is not held is a no-op, so this is idempotent either way.

revoke insert on public.profiles from anon;

revoke insert on public.profiles from authenticated;


-- ---- 2. DROP THE INSERT POLICY -------------------------------------------------------------------
--
-- After this, profiles has no INSERT policy for any role. RLS is enabled, so the default is deny, and
-- there is nothing left for a future re-grant of table privileges to switch back on.
--
-- `if exists` so the file is idempotent. There is no `create policy if not exists`, which is why 249
-- used drop-then-create -- here there is nothing to create.

drop policy if exists "Users insert own profile" on public.profiles;


-- ---- 3. FUNCTION ATTRIBUTE REGISTRY --------------------------------------------------------------
--
-- prosecdef and proconfig, which plat_function_registry() has never returned. Same shape, same
-- extension-exclusion via pg_depend, same service-role-only grant.
--
-- proconfig is flattened to a comma-joined string and coalesced to the empty string rather than left
-- null. A null would make "the pin is absent" and "the function was not found" the same value to a
-- caller, and a check that cannot tell those apart passes for the wrong reason.
--
-- NOT security definer. It must run as the caller so that only service_role can read it, which is the
-- whole point of the grant below. search_path IS pinned even so: this function resolves pg_proc and
-- pg_depend by name, and a registry that could be pointed at somebody else's schema would report
-- comfortable nonsense about the very attributes it exists to police.

create or replace function plat_function_attributes()
returns table(fn_name text, identity_args text, secdef boolean, config text, fn_owner text)
language sql
stable
set search_path = pg_catalog, public
as $$
  select p.proname::text,
         pg_get_function_identity_arguments(p.oid)::text,
         p.prosecdef,
         coalesce(array_to_string(p.proconfig, ','), '')::text,
         pg_get_userbyid(p.proowner)::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and not exists (
      select 1
      from pg_depend d
      where d.objid = p.oid
        and d.classid = 'pg_proc'::regclass
        and d.deptype = 'e'
    )
$$;

revoke all on function plat_function_attributes() from public;

revoke all on function plat_function_attributes() from anon;

revoke all on function plat_function_attributes() from authenticated;

grant execute on function plat_function_attributes() to service_role;


-- ---- 4. TABLE AND COLUMN GRANT REGISTRY ----------------------------------------------------------
--
-- Reads relacl and attacl through aclexplode, so it reports what Postgres actually holds rather than
-- what information_schema is willing to show the caller. Column-level rows carry the column name and
-- table-level rows carry null, because migration 249's control on profiles is column-level and a
-- registry that could not see it would leave that control as unwatched as this one was.
--
-- grantee 0 is PUBLIC and pg_get_userbyid would render it as "unknown (OID=0)", which is the kind of
-- value that gets read past. It is spelled out.
--
-- A table with a null relacl produces no rows at all -- that is Postgres saying "owner defaults only",
-- i.e. no grant to anon or authenticated. So absence here is meaningful, which is exactly why a caller
-- must first prove the registry returned SOMETHING for the table it is asking about.

create or replace function plat_table_grants()
returns table(tbl text, col text, grantee text, privilege text)
language sql
stable
set search_path = pg_catalog, public
as $$
  select c.relname::text,
         null::text,
         case when a.grantee = 0 then 'PUBLIC'::text else pg_get_userbyid(a.grantee)::text end,
         a.privilege_type::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'public'
    and c.relkind = 'r'
  union all
  select c.relname::text,
         att.attname::text,
         case when a.grantee = 0 then 'PUBLIC'::text else pg_get_userbyid(a.grantee)::text end,
         a.privilege_type::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
  cross join lateral aclexplode(att.attacl) a
  where n.nspname = 'public'
    and c.relkind = 'r'
$$;

revoke all on function plat_table_grants() from public;

revoke all on function plat_table_grants() from anon;

revoke all on function plat_table_grants() from authenticated;

grant execute on function plat_table_grants() to service_role;


-- ---- 5. RLS STAYS ON -----------------------------------------------------------------------------
--
-- Idempotent restatement, as in 249. Section 2's deny-by-default is worth nothing if row-level security
-- is ever switched off on this table, and six tables on this database already have it off.

alter table public.profiles enable row level security;


notify pgrst, 'reload schema';
