# Restore test, step 2 (inside the network-less Supabase Postgres): load the archive into a fresh database.
set -euo pipefail
for i in $(seq 1 60); do pg_isready -q -h localhost -U supabase_admin && break; sleep 3; done
sleep 3
psql -X -q -U supabase_admin -h localhost -d postgres -c "do \$\$begin if not exists (select from pg_roles where rolname='supabase_realtime_admin') then create role supabase_realtime_admin nologin; end if; end\$\$"
createdb -U supabase_admin -h localhost restore_test
s=$(date +%s)
rc=0; pg_restore -U supabase_admin -h localhost -d restore_test /vol/d.dump > /vol/restore.log 2>&1 || rc=$?
echo "restore_rc=$rc restore_errors=$(grep -c '^pg_restore: error' /vol/restore.log || true) restore_seconds=$(( $(date +%s)-s ))"
