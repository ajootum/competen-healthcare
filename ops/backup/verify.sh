# Integrity: gpg checks the MDC on decrypt; pg_restore must read the whole table of contents.
. /cb/prelude.sh
f="/out/$CB_NAME.dump.gpg.tmp"
sha256sum "$f" | cut -d' ' -f1
gpgk -d "$f" > /dev/shm/d.dump
pg_restore --list /dev/shm/d.dump > /dev/shm/toc
grep -vc '^;' /dev/shm/toc
grep -c ' TABLE DATA public ' /dev/shm/toc || true
grep -c ' POLICY public ' /dev/shm/toc || true
