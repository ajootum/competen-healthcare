-- ============================================================
-- MIGRATION 168: FUNCTION REGISTRY (for the function-drift audit)
--
-- WHY THIS EXISTS. Migration 019 redefined search_ckcm() to add a branch and was never applied to this
-- database. Nothing caught it: the schema-drift audit compares selected COLUMNS against the live schema
-- and cannot see a function body, and PostgREST's OpenAPI exposes only the 8 functions callable through
-- the API -- and only their signatures, while 019's change kept the signature identical. So the library
-- search returned zero quality objects for months, confidently.
--
-- This exposes what pg_proc already knows so scripts/function-drift-audit.ts can compare the deployed
-- body against the last definition in the migrations. It reads catalog metadata only and writes nothing.
--
-- NOT CALLABLE FROM THE BROWSER. Postgres grants EXECUTE on new functions to PUBLIC by default, which in
-- Supabase means anon and authenticated. Function bodies encode business logic and access rules, so the
-- default grant is revoked and only service_role -- the key the audit script runs under -- keeps it.
--
-- Additive and idempotent.
-- ============================================================

create or replace function plat_function_registry()
returns table(fn_name text, identity_args text, lang text, src text)
language sql
stable
as $$
  select p.proname::text,
         pg_get_function_identity_arguments(p.oid)::text,
         l.lanname::text,
         p.prosrc::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
$$;

revoke all on function plat_function_registry() from public;
revoke all on function plat_function_registry() from anon;
revoke all on function plat_function_registry() from authenticated;
grant execute on function plat_function_registry() to service_role;

notify pgrst, 'reload schema';
