-- APPLY THIS FILE WHOLE -- it defines a function body, so a semicolon-splitting runner would cut it
-- in half. Paste the entire file into the Supabase SQL editor and Run once.
--
-- Migration 332: plat_trigger_registry() -- read-only measurement infrastructure
--
-- COMP-ENG-002B section 9 priority 4 requires triggers to be measured before the canonicalisation
-- gate can be assessed. They cannot be: pg_trigger lives in pg_catalog, PostgREST does not expose
-- it, and this repository has no trigger registry. plat_rls_registry (172), plat_function_registry
-- (168), plat_index_registry and plat_function_attributes (250) already establish the pattern for
-- exactly this problem, and this adds the missing one.
--
-- THIS IS NOT A CANONICALISATION MIGRATION. It changes no policy, no table, no grant and no
-- application behaviour. It creates one read-only function so the fidelity gate can measure what it
-- is required to measure. Section 10 of COMP-ENG-002B forbids canonicalisation migrations until the
-- measurements are complete -- this is the instrument, not the change.
--
-- Mirrors the existing registries deliberately:
--   stable, language sql, search_path pinned to pg_catalog + public
--   security INVOKER (the default) -- the service role already reads the catalogue, so there is no
--   reason to run this as owner, and a SECURITY DEFINER catalogue reader is a broader thing than the
--   job needs
--
-- Excludes internal constraint triggers (tgisinternal), which are foreign-key machinery rather than
-- authored data-governance triggers, and would drown the real ones.

create or replace function plat_trigger_registry()
returns table(
  tbl text,
  trigger_name text,
  fn_name text,
  timing text,
  events text,
  enabled text
)
language sql
stable
set search_path = pg_catalog, public
as $BODY$
  select c.relname::text,
         t.tgname::text,
         p.proname::text,
         case when (t.tgtype & 2) <> 0 then 'BEFORE'
              when (t.tgtype & 64) <> 0 then 'INSTEAD OF'
              else 'AFTER' end,
         trim(both ' ' from
           case when (t.tgtype & 4)  <> 0 then 'INSERT ' else '' end ||
           case when (t.tgtype & 8)  <> 0 then 'DELETE ' else '' end ||
           case when (t.tgtype & 16) <> 0 then 'UPDATE ' else '' end ||
           case when (t.tgtype & 32) <> 0 then 'TRUNCATE ' else '' end),
         case t.tgenabled when 'O' then 'enabled'
                          when 'D' then 'DISABLED'
                          when 'R' then 'replica'
                          when 'A' then 'always'
                          else t.tgenabled::text end
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where n.nspname = 'public'
     and not t.tgisinternal
$BODY$;

revoke all on function plat_trigger_registry() from public;
revoke all on function plat_trigger_registry() from anon;
revoke all on function plat_trigger_registry() from authenticated;
grant execute on function plat_trigger_registry() to service_role;

notify pgrst, 'reload schema';
