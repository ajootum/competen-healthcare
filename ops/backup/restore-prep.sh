# Restore test, step 1 (no network): decrypt into the scratch volume and count every row the archive holds.
. /cb/prelude.sh
gpgk -d "/in/$CB_FILE" > /vol/d.dump
pg_restore --list /vol/d.dump > /vol/toc
pg_restore -a -f - /vol/d.dump | awk '/^COPY /{t=$2;n=0;on=1;next} on&&/^\\.$/{print t"\t"n;on=0;next} on{n++}' > /vol/dump-counts.tsv
chmod 644 /vol/*
echo "tables_with_data=$(wc -l </vol/dump-counts.tsv) rows=$(awk -F'\t' '{s+=$2} END{print s+0}' /vol/dump-counts.tsv)"
