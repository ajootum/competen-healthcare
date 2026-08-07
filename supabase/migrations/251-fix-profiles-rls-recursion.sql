-- ============================================================
-- MIGRATION 251: END THE 42P17 RECURSION ON public.profiles AND public.hospitals
-- The item migrations 249 and 250 both named and both deliberately deferred, because it is the one
-- change in this area that carries lockout risk and they did not want to inherit it.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IS DEPLOYED. Read back live from plat_rls_registry() and plat_function_attributes() while writing
-- this file, never from migration text -- the whole point of those registries is that a migration can say
-- one thing while the database does another, and migration 005 in this very area is an example: its text
-- for "Super admin reads all hospitals" is NOT what is deployed. Migration 002's text is.
--
--   public.profiles, RLS enabled, four policies:
--     [SELECT] "users_read_own_profile"                roles=PUBLIC  using (auth.uid() = id)
--     [SELECT] "Country admin reads country profiles"  roles=PUBLIC
--        using (hospital_id IN (SELECT h.id FROM hospitals h JOIN profiles p ON p.id = auth.uid()
--                                WHERE p.role = 'country_admin' AND h.organisation_id = p.organisation_id
--                                  AND (h.country = p.managed_country OR p.managed_country IS NULL)))
--     [SELECT] "Group admin reads org profiles"        roles=PUBLIC
--        using (hospital_id IN (SELECT h.id FROM hospitals h JOIN profiles p ON p.id = auth.uid()
--                                WHERE p.role = 'group_admin' AND h.organisation_id = p.organisation_id))
--     [UPDATE] "Users update own profile"              roles=authenticated  -- migration 249, untouched
--
--   public.hospitals, RLS enabled, four policies, all SELECT, all roles=PUBLIC:
--     "Authenticated users view hospitals"    using (auth.role() = 'authenticated')
--     "Country admin reads country hospitals" using (current_user_is_country_admin_for(id))
--     "Group admin reads org hospitals"       using (organisation_id IS NOT NULL
--                                                   AND current_user_is_group_admin_for(organisation_id))
--     "Super admin reads all hospitals"       using (EXISTS (SELECT 1 FROM profiles p
--                                                   WHERE p.id = auth.uid() AND p.role = 'super_admin'))
--
-- EXACTLY WHICH ONES RECURSE, AND WHY. Not the two that were suspected. Three, and they form ONE cycle
-- that runs between the two tables rather than inside either:
--   1. "Country admin reads country profiles" -- its subquery selects from profiles, which re-enters the
--      profiles SELECT policies, which contain this same subquery. Self-recursion. It also selects from
--      hospitals, which is the outbound edge of the cross-table cycle.
--   2. "Group admin reads org profiles" -- identical shape, identical two faults.
--   3. "Super admin reads all hospitals" -- its subquery selects from profiles, which evaluates 1 and 2,
--      which select from hospitals, which evaluates 3. Mutual recursion.
--   "users_read_own_profile" and the UPDATE policy read no table and are innocent. So is
--   "Authenticated users view hospitals". Proven by reading all eight quals above, not by assumption.
--   hospitals is named in the expression of exactly two policies on this database, and both of them are
--   the profiles policies at 1 and 2 -- so cutting 1 and 2 alone already breaks the cross-table cycle.
--   3 is rewritten anyway, see WHY THREE AND NOT TWO below.
--
-- HOW FAR IT SPREADS, AND HOW MUCH OF IT THIS FILE CLEARS. Every one of the 523 tables carrying policies
-- was probed with the anon key for this file. SIXTY-EIGHT answer 42P17. profiles and hospitals are two of
-- them. Most of the rest are innocent tables whose own policies happen to read profiles -- directly, like
-- departments, or two hops away, like cycle_frameworks through competency_cycles. They inherit the fault
-- the moment their subquery touches profiles. The remaining 455 answer 200 with zero rows, and the ones
-- among those that reach authorization data do it through the SECURITY DEFINER helpers -- which is the
-- shape this file adopts, already proven at scale on this database rather than merely argued for.
--
-- The policy-reference graph was then built from plat_rls_registry() over FROM and JOIN targets only, and
-- it reproduces the measurement: it predicts 69 tables in 42P17 against 68 measured, and the single
-- over-prediction is competency_assessments, whose profiles-reading policies are scoped to authenticated
-- so anon never evaluates them. With profiles' and hospitals' outbound edges removed, the same graph
-- predicts FOUR tables still recursing.
--
-- >>> SO THIS FILE CLEARS 64 OF THE 68, NOT ALL OF THEM. FOUR REMAIN, AND THEY ARE NOT THIS BUG. <<<
--   osce_exams, osce_candidates, osce_stations and osce_results carry a SECOND, INDEPENDENT cycle that
--   never touches profiles: osce_exams_select_involved selects FROM osce_candidates and FROM
--   osce_stations, and both of those select FROM osce_exams. osce_results only reaches it. Removing the
--   profiles recursion cannot help them and this file does not pretend to. They need their own migration,
--   and their policies want reading first -- osce_exams_select_involved also carries what looks like two
--   copy-paste faults in its join keys, c.exam_id = c.id and s.exam_id = s.id, which are almost certainly
--   meant to be c.exam_id = osce_exams.id. Fixing a recursion and a wrong join in one file is how a
--   security migration acquires a behaviour change nobody reviewed.
--
-- >>> WHY THIS MATTERS MORE THAN A 500. RLS IS NOT AN ENFORCEMENT LAYER ON THIS PLATFORM TODAY. <<<
-- A policy that raises 42P17 decides nothing. It is why 717 files reach for the service role, and why
-- /admin/settings and /admin/invite -- the only two client components in src/ that read profiles or
-- hospitals through the browser client -- are both broken at their first select.
-- ----------------------------------------------------------------------------------------------------
--
-- THE MECHANISM. A SECURITY DEFINER function runs as its owner. Its read of profiles is therefore not the
-- caller's read, and does not re-enter the caller's policy. This is not theory here: all four deployed
-- helpers were called with the anon key while profiles itself was answering 42P17, and all four returned
-- 200 false. The definer read escapes, and anon already holds EXECUTE on them.
--
-- Note the irony recorded in supabase/fix-super-admin-rls-recursion.sql, an unnumbered hand-applied
-- script. It diagnosed this same recursion in 2024, blamed the SECURITY DEFINER helpers for it, and
-- dropped both the helpers and the profiles super-admin read policy. The helpers were never the cause.
-- They were the cure, and migrations 005 and 008 brought them back for hospitals and forgot profiles.
--
-- >>> WHAT THIS FILE DOES NOT RESTORE. <<<
-- That script left profiles with NO super-admin read policy, and this file does not add one back. A
-- super_admin today sees exactly their own profiles row through RLS and reads everyone else's through the
-- service role. That is the deployed intent. Restoring "Super admin reads all profiles" would be a
-- widening dressed up as a repair, and it is the single easiest way to turn this fix into a leak.
--
-- ----------------------------------------------------------------------------------------------------
-- THE GRANT, BEFORE AND AFTER, POLICY BY POLICY. Nothing here may widen and nothing may narrow.
--
--   "Country admin reads country profiles"
--     BEFORE: a profiles row is visible if its hospital_id is one of the hospitals that (a) share an
--             organisation_id with the caller's own profile row and (b) sit in the caller's
--             managed_country, or any country when managed_country is null -- and the caller's role is
--             country_admin.
--     AFTER:  identical, expressed as current_user_is_country_admin_for(hospital_id). That helper's
--             deployed body is this policy's predicate with h.id = p_hospital_id substituted for the
--             IN-list. Read side by side for this file, term for term, including the managed_country
--             null branch. A null hospital_id yields no match under both -- NULL IN (..) is not true,
--             and a join on h.id = NULL finds nothing.
--
--   "Group admin reads org profiles"
--     BEFORE: a profiles row is visible if its hospital_id belongs to a hospital whose organisation_id
--             equals the caller's own organisation_id, and the caller's role is group_admin.
--     AFTER:  identical, expressed as current_user_is_group_admin_for_hospital(hospital_id), a helper
--             created below.
--     >>> WHY A NEW HELPER RATHER THAN THE EXISTING current_user_is_group_admin_for. <<<
--     THE ARGUMENT DOES NOT MAP. That helper takes an ORGANISATION id. This policy keys off the
--     ORGANISATION OF THE ROW'S HOSPITAL, which is a different value from the row's own
--     organisation_id column. Measured on the deployed data for this file: of the 32 profiles rows that
--     carry a hospital_id, 25 have organisation_id NULL, 5 match their hospital's organisation, and 0
--     disagree. So current_user_is_group_admin_for(organisation_id) would have silently NARROWED the
--     policy by 25 rows out of 32 -- a plausible-looking substitution that quietly changes the answer.
--     The new helper takes the hospital id and does the hospitals lookup itself, exactly as the country
--     helper already does. It is the same predicate, not an approximation of it.
--
--   "Super admin reads all hospitals"
--     BEFORE: every hospitals row is visible if the caller's own profiles row has role = 'super_admin'.
--     AFTER:  identical, expressed as current_user_is_super_admin(). The helper's deployed body is
--             character-for-character the same EXISTS, and both forms examine only the row where
--             p.id = auth.uid().
--
--   "users_read_own_profile", "Users update own profile", "Authenticated users view hospitals",
--   "Country admin reads country hospitals", "Group admin reads org hospitals"
--     UNTOUCHED. Not dropped, not recreated, not renamed.
--
-- ALL THREE REWRITTEN POLICIES KEEP roles=PUBLIC -- no TO clause, which is what pg_policy records as
-- PUBLIC and what all three carry today. Adding "TO authenticated" would look tidier and would be a
-- narrowing, so it is not done.
--
-- DOES LIFTING THE hospitals SUBQUERY INTO A DEFINER CONTEXT WIDEN ANYTHING. No, and the reason is
-- specific to this database rather than general. Inside the old policies, `hospitals h` was read under
-- the CALLER's RLS. hospitals carries "Authenticated users view hospitals" using auth.role() =
-- 'authenticated', so every authenticated caller already sees every hospitals row. Only an authenticated
-- caller can satisfy the rest of either predicate. The set of hospitals visible to any caller who could
-- get a true out of these policies is therefore already all of them, and reading them as the owner
-- instead changes nothing. `profiles p` was likewise already resolving to the caller's own row via
-- users_read_own_profile, which is the only row the definer bodies look at.
--
-- WHY THREE POLICIES AND NOT TWO. Cutting the two profiles policies is sufficient -- after that, no
-- policy on profiles reads any table, so nothing that enters profiles can come back out. But it leaves
-- hospitals depending on the internals of a policy on another table for its own freedom from recursion,
-- which is the property that just failed here for two years. The third rewrite is an exact substitution
-- into a helper that already exists and is already used by two of hospitals' other three policies, and
-- it makes hospitals independently non-recursive. It is not scope creep -- it is the third side of the
-- one cycle this file exists to cut.
--
-- ONE THING THIS FILE ASSUMES AND CANNOT PROVE FROM THE DEPLOYED CATALOGUE. plat_rls_registry() does not
-- return pg_policy.polpermissive, so nothing in this repository can read whether a policy is PERMISSIVE
-- or RESTRICTIVE, and CREATE POLICY defaults to PERMISSIVE. Recreating a RESTRICTIVE policy as PERMISSIVE
-- would widen. Two independent reasons to believe all three are permissive: the source that created each
-- deployed text -- migration 008 for the two on profiles, migration 002 for the one on hospitals, both
-- matching the deployed qual verbatim -- writes plain CREATE POLICY with no AS RESTRICTIVE. And a
-- RESTRICTIVE reading is self-refuting: with zero group_admin and zero country_admin rows on this
-- database, a restrictive "Country admin reads country profiles" would deny profiles to every caller
-- including every nurse, and users_read_own_profile could never have worked.
-- ----------------------------------------------------------------------------------------------------
--
-- WHAT THIS FILE REFUSES TO DO:
--   IT DOES NOT `create or replace` ANY EXISTING FUNCTION. Two helpers need their search_path pinned and
--   both get it through ALTER FUNCTION, which changes proconfig and touches nothing else. CREATE OR
--   REPLACE resets the attribute set, and an omitted `security definer` downgrades silently to security
--   invoker -- which on these four functions would re-enter the profiles policies and put the recursion
--   straight back, from a file whose whole purpose was to remove it. ALTER cannot make that mistake.
--   IT DOES NOT PIN THE OTHER UNPINNED DEFINER FUNCTIONS. current_user_is_group_admin_for(uuid) and
--   current_user_is_hospital_admin_for(uuid) are both SECURITY DEFINER with proconfig empty, read live
--   for this file. They are real findings and they are not this file's concern. Pin what you touch.
--   IT DOES NOT ADD, DROP OR ALTER A SINGLE GRANT ON public.profiles OR public.hospitals, and it does not
--   touch service_role. The 717 service-role callers and all three signup paths bypass RLS entirely and
--   cannot be affected by anything below.
--   IT DOES NOT ADD AN INSERT OR DELETE POLICY TO profiles. Migration 250 removed one and the harness
--   asserts both stay absent.
--   IT DOES NOT RESTORE A SUPER-ADMIN READ OF ALL PROFILES. See above -- that would be the leak.
--   IT DOES NOT REVOKE EXECUTE FROM public ON THE NEW HELPER. The four deployed helpers keep the default
--   PUBLIC grant, and a policy whose function the calling role cannot execute raises 42501 rather than
--   returning false -- trading a recursion error for a permission error. The helper answers a question
--   about the CALLER and returns false to anyone unauthenticated, so it leaks nothing by being callable.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and NO SEMICOLON ANYWHERE EXCEPT ENDING A
-- STATEMENT, including inside comments. The runner splits on them and migration 238 lost two sections to
-- a semicolon in a comment while still reporting success. The function body below contains no internal
-- semicolon -- one sql statement, migration 172's proven shape -- so this file survives a naive splitter.
-- ============================================================


-- ---- 1. THE MISSING HELPER: GROUP ADMIN, KEYED ON A HOSPITAL ---------------------------------------
--
-- The exact predicate of "Group admin reads org profiles", evaluated as the owner. Sibling of
-- current_user_is_country_admin_for, which migration 008 already wrote in this shape -- 008 built the
-- definer helper for the country case and then wrote the country PROFILES policy as a raw subquery
-- anyway. This file finishes what 008 started.
--
-- Schema-qualified throughout and search_path pinned, so it resolves public.profiles and public.hospitals
-- no matter what the caller's search_path says. An unpinned definer function is a function that can be
-- pointed at somebody else's tables, which for an authorization predicate means it can be made to say
-- yes.
--
-- STABLE, not VOLATILE, because it is called once per row of a scan and Postgres may not hoist a volatile
-- call. It reads only committed data within the statement, which is what STABLE promises.

create or replace function public.current_user_is_group_admin_for_hospital(p_hospital_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.hospitals h on h.id = p_hospital_id
    where p.id = auth.uid()
      and p.role = 'group_admin'
      and h.organisation_id = p.organisation_id
  )
$$;

-- Explicit rather than inherited. Postgres grants EXECUTE on a new function to PUBLIC by default, which
-- on Supabase already covers anon and authenticated, so these three add nothing today. They are here so
-- that a later blanket `revoke ... from public` cannot silently turn the profiles group-admin policy into
-- a 42501 for the two roles that actually evaluate it.

grant execute on function public.current_user_is_group_admin_for_hospital(uuid) to anon;

grant execute on function public.current_user_is_group_admin_for_hospital(uuid) to authenticated;

grant execute on function public.current_user_is_group_admin_for_hospital(uuid) to service_role;


-- ---- 2. PIN search_path ON THE TWO EXISTING HELPERS THIS FILE NOW DEPENDS ON -----------------------
--
-- Both read prosecdef = true and proconfig = '' on the deployed database. This file makes two policies
-- depend on them, so their search_path becomes this file's problem.
--
-- ALTER, NOT CREATE OR REPLACE. The bodies are already correct and were read back from pg_proc for this
-- file. ALTER FUNCTION changes only the actions named and leaves prosrc and prosecdef alone, so there is
-- no window in which a typo downgrades an authorization function to security invoker. `security definer`
-- is restated as an action anyway -- it is a no-op against the deployed state and it makes the intent
-- part of the statement rather than part of a comment.
--
-- Re-running either statement sets the same value, so both are idempotent.

alter function public.current_user_is_country_admin_for(uuid)
  security definer
  set search_path = pg_catalog, public;

alter function public.current_user_is_super_admin()
  security definer
  set search_path = pg_catalog, public;


-- ---- 3. profiles: THE TWO SELF-JOINING SELECT POLICIES ---------------------------------------------
--
-- drop-then-create, because there is no `create policy if not exists` and no way to alter a policy's
-- USING expression in place that is idempotent across re-runs. Same shape migration 249 used.
--
-- Between the drop and the create, the policy does not exist. That window is inside one transaction in
-- the SQL editor and, since both policies currently raise 42P17 for every caller, neither is granting
-- anything to anyone in the meantime.

drop policy if exists "Country admin reads country profiles" on public.profiles;

create policy "Country admin reads country profiles"
  on public.profiles for select
  using (public.current_user_is_country_admin_for(hospital_id));

drop policy if exists "Group admin reads org profiles" on public.profiles;

create policy "Group admin reads org profiles"
  on public.profiles for select
  using (public.current_user_is_group_admin_for_hospital(hospital_id));


-- ---- 4. hospitals: THE THIRD SIDE OF THE CYCLE -----------------------------------------------------
--
-- The only policy on hospitals that reads another table. Its two sibling admin policies already call
-- helpers -- this one was written in migration 002, before the helpers existed, and was never brought
-- into line.

drop policy if exists "Super admin reads all hospitals" on public.hospitals;

create policy "Super admin reads all hospitals"
  on public.hospitals for select
  using (public.current_user_is_super_admin());


-- ---- 5. RLS STAYS ON -------------------------------------------------------------------------------
--
-- Idempotent restatement, as in 249 and 250. Everything above is a row-level rule and every one of them
-- decides nothing on a table with row-level security switched off. Six tables on this database already
-- have it off, so this is not a hypothetical.

alter table public.profiles enable row level security;

alter table public.hospitals enable row level security;


notify pgrst, 'reload schema';
