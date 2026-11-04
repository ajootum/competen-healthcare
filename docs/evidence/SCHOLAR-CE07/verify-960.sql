-- VERIFY 960 (SCHOLAR-CE07C). A DO block that raises on the first failure. Writes nothing that survives (the probe
-- rows are inserted and removed inside a sub-block whose exception rolls them back).
do $v$
declare n int;
begin
  select count(*) into n from information_schema.tables where table_schema = 'public' and table_name = 'individual_scholar_upload';
  if n <> 1 then raise exception '960: table missing'; end if;
  select count(*) into n from pg_class where relname = 'individual_scholar_upload' and relrowsecurity;
  if n <> 1 then raise exception '960: RLS not on'; end if;
  select count(*) into n from pg_policies where tablename = 'individual_scholar_upload';
  if n <> 0 then raise exception '960: unexpected policy'; end if;
  select count(*) into n from pg_constraint where conrelid = 'individual_scholar_upload'::regclass and contype = 'c';
  if n <> 4 then raise exception '960: expected 4 CHECK constraints, found %', n; end if;
  -- CHECKs refuse what they must (each in its own sub-block, rolled back)
  begin
    insert into individual_scholar_upload (id, user_id, mime_type, byte_size, sha256, issued_at)
      select gen_random_uuid(), id, 'image/png', 10, repeat('a', 64), now() from profiles limit 1;
    raise exception '960: bad mime accepted';
  exception when check_violation then null; end;
  begin
    insert into individual_scholar_upload (id, user_id, mime_type, byte_size, sha256, issued_at)
      select gen_random_uuid(), id, 'application/pdf', 26214401, repeat('a', 64), now() from profiles limit 1;
    raise exception '960: oversize accepted';
  exception when check_violation then null; end;
  begin
    insert into individual_scholar_upload (id, user_id, mime_type, byte_size, sha256, issued_at, state)
      select gen_random_uuid(), id, 'application/pdf', 10, repeat('a', 64), now(), 'processing' from profiles limit 1;
    raise exception '960: processing without a start accepted';
  exception when check_violation then null; end;
  begin
    insert into individual_scholar_upload (id, user_id, mime_type, byte_size, sha256, issued_at, state, settled_at)
      select gen_random_uuid(), id, 'application/pdf', 10, repeat('a', 64), now(), 'refused', now() from profiles limit 1;
    raise exception '960: refused without a status accepted';
  exception when check_violation then null; end;
  begin
    insert into individual_scholar_upload (id, user_id, mime_type, byte_size, sha256, issued_at)
      select gen_random_uuid(), id, 'application/pdf', 10, 'XYZ', now() from profiles limit 1;
    raise exception '960: bad sha256 accepted';
  exception when check_violation then null; end;
  raise notice '960 VERIFY PASSED';
end $v$;
