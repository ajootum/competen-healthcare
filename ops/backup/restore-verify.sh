# Restore test, step 3 (inside the restored, network-less server): compare every table's row count with the archive.
set -euo pipefail
db=${CB_DB:-restore_test}
q() { psql -X -q -U supabase_admin -h localhost -d "$db" -Atc "$1"; }
mism=0; checked=0
while IFS=$'\t' read -r t n; do
  got=$(q "select count(*) from $t" 2>/dev/null || echo MISSING)
  checked=$((checked+1))
  if [ "$got" != "$n" ]; then mism=$((mism+1)); echo "MISMATCH $t archive=$n restored=$got"; fi
done < /vol/dump-counts.tsv
echo "checked=$checked mismatches=$mism"
echo "public_tables=$(q "select count(*) from pg_tables where schemaname='public'")"
echo "public_rls_tables=$(q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")"
echo "public_policies=$(q "select count(*) from pg_policies where schemaname='public'")"
echo "public_functions=$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")"
echo "auth_users=$(q "select count(*) from auth.users" 2>/dev/null || echo n/a)"
echo "schema_fingerprint=$(q "select md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' order by table_name, ordinal_position)) from information_schema.columns where table_schema='public'")"
