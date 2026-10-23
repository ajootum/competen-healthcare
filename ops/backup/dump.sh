# Dump and encrypt in one stream; the plaintext never leaves the container's pipe.
. /cb/prelude.sh
pg_dump "$CB_CONN" -Fc --no-sync | gpgk --yes --symmetric --cipher-algo AES256 --compress-algo none -o "/out/$CB_NAME.dump.gpg.tmp"
psql "$CB_CONN" -Atc "select current_setting('server_version')"
