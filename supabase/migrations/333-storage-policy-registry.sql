-- APPLY THIS FILE WHOLE -- it defines a function body, so a semicolon-splitting runner would cut it
-- in half. Paste the entire file into the Supabase SQL editor and Run once.
--
-- Migration 333: plat_storage_policy_registry() -- read-only measurement infrastructure
--
-- COMP-ENG-002C section 6 requires the per-operation policy definitions on Supabase Storage to be
-- captured, not inferred. They cannot be read today. plat_rls_registry (172) filters to the public
-- schema, and PostgREST refuses the storage schema outright -- a direct read returns
-- "Invalid schema: storage". So the SELECT/INSERT/UPDATE/DELETE semantics governing the avatars,
-- evidence and practice-attachments buckets are invisible from the repository.
--
-- THIS IS NOT A CANONICALISATION MIGRATION. It creates no bucket, alters no policy, grants nothing to
-- any application role, and changes no behaviour. Section 9 of COMP-ENG-002C forbids canonicalisation
-- until storage is captured -- this is the instrument that makes capture possible.
--
-- Same shape as plat_trigger_registry (332) and the four registries before it: stable, language sql,
-- pinned search_path, security INVOKER, execute granted to service_role alone.

create or replace function plat_storage_policy_registry()
returns table(
  tbl text,
  policy_name text,
  cmd text,
  roles text,
  qual text,
  with_check text
)
language sql
stable
set search_path = pg_catalog, public
as $BODY$
  select c.relname::text,
         p.polname::text,
         case p.polcmd
           when 'r' then 'SELECT'
           when 'a' then 'INSERT'
           when 'w' then 'UPDATE'
           when 'd' then 'DELETE'
           else 'ALL'
         end,
         coalesce(
           (select string_agg(r.rolname::text, ',' order by r.rolname::text)
              from pg_roles r
             where r.oid = any (p.polroles)),
           'public'),
         pg_get_expr(p.polqual, p.polrelid)::text,
         pg_get_expr(p.polwithcheck, p.polrelid)::text
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage'
$BODY$;

revoke all on function plat_storage_policy_registry() from public;
revoke all on function plat_storage_policy_registry() from anon;
revoke all on function plat_storage_policy_registry() from authenticated;
grant execute on function plat_storage_policy_registry() to service_role;

notify pgrst, 'reload schema';
