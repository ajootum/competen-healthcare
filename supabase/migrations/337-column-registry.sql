-- APPLY THIS FILE WHOLE. It defines a function body, so a statement-splitting runner would cut it in
-- half.
--
-- Migration 337: plat_column_registry(), the instrument for the column-parity gate
--
-- ============================ WHY THIS EXISTS ============================
--
-- COMP-ENG-002G section 7: "The fidelity hierarchy must now explicitly compare columns. The accidental
-- discovery of absent audit_log columns demonstrates that table/policy parity alone is insufficient."
--
-- That discovery is the whole argument for this file. A clean build reproduced production on SEVEN
-- separate counts -- 663 tables, 318 policies, 67 functions, 10 SECURITY DEFINER, 0 unpinned, 45
-- triggers, 0 tables with RLS off -- while audit_log was quietly missing two columns. Nothing was
-- counting columns, so nothing failed.
--
-- ============================ WHY A DATABASE FUNCTION AND NOT AN API READ ============================
--
-- Production is reachable from a developer machine only through PostgREST, which cannot query
-- pg_catalog. The PostgREST OpenAPI document does expose column names, types and defaults -- it is how
-- the eleven orphan tables in 188a were reconstructed -- but it does NOT expose identity or generated
-- posture, and section 7 requires both. An instrument that cannot see an attribute cannot compare it.
--
-- So this follows the pattern the estate already uses for exactly this purpose: 168 and 170 for
-- functions, 172 for RLS, 187 for indexes, 250 for grants, 332 for triggers, 333 for storage policies.
-- Seven registries, one shape.
--
-- ============================ pg_catalog, NOT information_schema ============================
--
-- information_schema.columns reports data_type as a spelled-out category -- "character varying", "ARRAY"
-- -- and pushes precision, length and element type into separate nullable columns. Comparing two
-- databases through it means reassembling the type from four fields and hoping the reassembly is
-- faithful on both sides.
--
-- format_type(atttypid, atttypmod) returns the canonical rendering Postgres itself would print:
-- numeric(4,1), text[], timestamp with time zone, and a domain by its own name rather than its base
-- type. Section 7 asks for "canonical type, including relevant precision/array/domain identity", and
-- this is that string, produced by the server rather than assembled by the caller.
--
-- attidentity is '' none, 'a' always, 'd' by default. attgenerated is '' none, 's' stored. Both are
-- returned raw rather than interpreted, so the comparison tool decides what a difference means.
--
-- ============================ SCOPE ============================
--
-- public schema, ordinary tables only. relkind = 'r' excludes views, matviews and foreign tables, whose
-- columns are derived rather than declared and would report differences that are not schema drift.
--
-- Section 8: "Exclude Supabase-managed internal schemas unless a documented Competen control depends on
-- them." auth, storage and realtime are Supabase's to version, not this estate's -- and a clean build
-- gets them from the platform rather than from these migrations, so comparing them would report the
-- platform's own version skew as Competen drift. storage.buckets is the one place a Competen decision
-- reaches into a managed schema, and it is already covered by the fidelity manifest's bucket check.
--
-- ============================ ACCESS ============================
--
-- Revoked from public and anon, granted to service_role and authenticated, exactly as 250 does. This
-- reads no row of user data -- only the shape of the schema -- but a catalogue reader reachable without
-- a session is a smell this repo has revoked everywhere else.

create or replace function plat_column_registry()
returns table(
  tbl           text,
  col           text,
  ordinal       int,
  data_type     text,
  is_nullable   boolean,
  col_default   text,
  identity_kind text,
  generated_kind text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.relname::text,
         a.attname::text,
         a.attnum::int,
         format_type(a.atttypid, a.atttypmod)::text,
         (not a.attnotnull),
         pg_get_expr(d.adbin, d.adrelid)::text,
         a.attidentity::text,
         a.attgenerated::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attnum > 0
    and not a.attisdropped
$$;

revoke all on function plat_column_registry() from public;

revoke all on function plat_column_registry() from anon;

grant execute on function plat_column_registry() to service_role;

grant execute on function plat_column_registry() to authenticated;

notify pgrst, 'reload schema';
