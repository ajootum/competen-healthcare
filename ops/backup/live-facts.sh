# Read-only catalog facts from the live source, for the restore cross-check. No row content is read.
. /cb/prelude.sh
q() { psql "$CB_CONN" -X -q -Atc "$1"; }
echo "public_tables=$(q "select count(*) from pg_tables where schemaname='public'")"
echo "public_rls_tables=$(q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")"
echo "public_policies=$(q "select count(*) from pg_policies where schemaname='public'")"
echo "public_functions=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")"
echo "auth_users=$(q "select count(*) from auth.users")"
echo "schema_fingerprint=$(q "select md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' order by table_name, ordinal_position)) from information_schema.columns where table_schema='public'")"
