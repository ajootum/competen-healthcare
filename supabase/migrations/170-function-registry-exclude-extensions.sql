-- ============================================================
-- MIGRATION 170: EXCLUDE EXTENSION FUNCTIONS FROM THE FUNCTION REGISTRY
--
-- plat_function_registry() returned all 124 functions in the public schema, 92 of which belong to the
-- pgvector extension (vector_add, hnswhandler, l2_distance and so on). The drift audit reported every one
-- as an ORPHAN -- deployed but not declared in the repo -- which is technically true and completely
-- useless: 92 lines of noise around the findings that matter is how a tool stops being read.
--
-- Extension membership is recorded in pg_depend with deptype 'e', so this is exact rather than a name
-- pattern. Functions installed by an extension are the extension's business, not the repo's.
--
-- Same signature, so this REPLACES the function rather than creating an overload.
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
    and not exists (
      select 1
      from pg_depend d
      where d.objid = p.oid
        and d.classid = 'pg_proc'::regclass
        and d.deptype = 'e'
    )
$$;

revoke all on function plat_function_registry() from public;
revoke all on function plat_function_registry() from anon;
revoke all on function plat_function_registry() from authenticated;
grant execute on function plat_function_registry() to service_role;

notify pgrst, 'reload schema';
