-- ============================================================
-- MIGRATION 172: RLS REGISTRY (for the policy-drift audit)
--
-- WHY. The tenant-scoping work across this codebase rests on an assumption nobody has ever checked:
-- that row-level security is actually switched on in the database, with the policies the repo declares.
-- The repo declares RLS on 208 tables and 390 policies, applied by hand over 171 migrations, and nothing
-- compares that to what is deployed.
--
-- A table whose RLS is off is not subtly wrong -- it is readable and writable by any authenticated user
-- of any hospital, through the ordinary client, with no error anywhere. That is the same failure shape as
-- the function drift in migration 168: silent, invisible to the compiler, and only findable by asking the
-- database.
--
-- Reads catalog metadata only, writes nothing. Service-role only, for the same reason as
-- plat_function_registry: policy expressions describe exactly how to get around them.
--
-- Additive and idempotent.
-- ============================================================

create or replace function plat_rls_registry()
returns table(tbl text, rls_enabled boolean, policy_name text, cmd text, roles text, qual text, with_check text)
language sql
stable
as $$
  select c.relname::text,
         c.relrowsecurity,
         p.polname::text,
         case p.polcmd
           when 'r' then 'SELECT'
           when 'a' then 'INSERT'
           when 'w' then 'UPDATE'
           when 'd' then 'DELETE'
           else 'ALL'
         end,
         (select string_agg(r.rolname::text, ',' order by r.rolname)
            from pg_roles r
           where r.oid = any(p.polroles)),
         pg_get_expr(p.polqual, p.polrelid)::text,
         pg_get_expr(p.polwithcheck, p.polrelid)::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relkind = 'r'
$$;

revoke all on function plat_rls_registry() from public;
revoke all on function plat_rls_registry() from anon;
revoke all on function plat_rls_registry() from authenticated;
grant execute on function plat_rls_registry() to service_role;

notify pgrst, 'reload schema';
