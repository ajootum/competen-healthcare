-- ============================================================
-- MIGRATION 187: INDEX REGISTRY (for the migration-object audit)
--
-- THE BLIND SPOT THIS CLOSES. Three audits already ask the database whether the repo's intent arrived:
-- schema-drift compares COLUMNS the code reads, function-drift compares FUNCTION BODIES, rls-drift
-- compares POLICIES. Nothing checks that a declared TABLE or INDEX was ever created.
--
-- That is not hypothetical here. Migrations 108, 109 and 166 were TRUNCATED when applied -- the tail of
-- each file simply never ran. It was found only because the anon-exposure harness noticed 13 tables with
-- RLS switched off, and the RLS was in those tails. Every audit at the time was green.
--
-- A `create index if not exists` in a lost tail is the quietest of the three. A missing table errors the
-- moment code touches it. A missing policy is a security hole a probe can find. A missing index changes
-- nothing except that a tenant-filtered query starts scanning the table -- correct results, no error, and
-- the only symptom is a page that gets slower as the data grows. Nothing in this repo could see it.
--
-- Indexes are the reason this needs a function at all: tables can be probed through PostgREST directly,
-- but pg_indexes cannot. Reads catalog metadata only, writes nothing.
--
-- SERVICE-ROLE ONLY, for the same reason as plat_rls_registry. An index list describes the shape of every
-- table and which columns are worth filtering on -- reconnaissance, not secrets, but there is no reason
-- for a logged-in user to have it.
--
-- Additive and idempotent.
-- ============================================================

create or replace function plat_index_registry()
returns table(tbl text, index_name text, is_unique boolean, is_primary boolean, definition text)
language sql
stable
as $$
  select c.relname::text,
         i.relname::text,
         x.indisunique,
         x.indisprimary,
         pg_get_indexdef(i.oid)::text
  from pg_index x
  join pg_class c on c.oid = x.indrelid
  join pg_class i on i.oid = x.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
$$;

revoke all on function plat_index_registry() from public;
revoke all on function plat_index_registry() from anon;
revoke all on function plat_index_registry() from authenticated;
grant execute on function plat_index_registry() to service_role;

notify pgrst, 'reload schema';
