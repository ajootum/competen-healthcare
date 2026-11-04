-- VERIFY-970-prod (SALE-2026-11 R2, SALE-10). PRODUCTION-SAFE, STRUCTURE ONLY: no insert, update, delete or alter.
-- APPLY THIS FILE WHOLE (it holds a DO block). Raises on the first failure. Passing = the PASS notice.
-- Run after 970 is applied with the owner's GO. The behaviour probes live in docs/evidence/SALE-R2/VERIFY-970.sql (staging only).
do $$
begin
  if to_regclass('public.individual_scholar_transfer_check') is null then raise exception 'VERIFY-970: table missing'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_transfer_check'
       and column_name in ('id', 'user_id', 'revision_session_id', 'question_id', 'topic', 'outside', 'source', 'context_chunk_ids', 'created_at')) <> 9
     or (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_transfer_check') <> 9 then
    raise exception 'VERIFY-970: expected exactly the nine columns';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_transfer_check'
       and column_name in ('user_id', 'revision_session_id', 'question_id', 'topic', 'outside', 'source', 'context_chunk_ids') and is_nullable = 'YES') then
    raise exception 'VERIFY-970: a required column is nullable';
  end if;
  if not coalesce((select pg_get_constraintdef(oid) like '%library%' and pg_get_constraintdef(oid) like '%other_material%' and pg_get_constraintdef(oid) like '%other_section%'
       and pg_get_constraintdef(oid) like '%new_question%' and pg_get_constraintdef(oid) like '%saved%' and pg_get_constraintdef(oid) like '%generated%'
       and pg_get_constraintdef(oid) like '%120%' and pg_get_constraintdef(oid) like '%200%' and pg_get_constraintdef(oid) like '%btrim%'
       from pg_constraint where conname = 'individual_scholar_transfer_check_shape_check'), false) then
    raise exception 'VERIFY-970: shape check missing or incomplete';
  end if;
  if not coalesce((select confdeltype = 'c' and confrelid = 'public.individual_scholar_revision_session'::regclass
       from pg_constraint where conname = 'individual_scholar_transfer_check_session_fk'), false) then
    raise exception 'VERIFY-970: session foreign key missing or not cascading';
  end if;
  if not coalesce((select confdeltype = 'c' and confrelid = 'public.individual_scholar_revision_session_item'::regclass
       from pg_constraint where conname = 'individual_scholar_transfer_check_item_fk'), false) then
    raise exception 'VERIFY-970: session item foreign key missing or not cascading';
  end if;
  if not coalesce((select confdeltype = 'c' from pg_constraint where conrelid = 'public.individual_scholar_transfer_check'::regclass
       and contype = 'f' and confrelid = 'public.profiles'::regclass), false) then
    raise exception 'VERIFY-970: owner foreign key missing or not cascading';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_scholar_transfer_check'::regclass and contype = 'f') <> 3 then
    raise exception 'VERIFY-970: expected exactly three foreign keys';
  end if;
  if to_regclass('public.ux_individual_scholar_transfer_check_session_question') is null or to_regclass('public.idx_individual_scholar_transfer_check_user') is null then
    raise exception 'VERIFY-970: an index is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.individual_scholar_transfer_check'::regclass) then raise exception 'VERIFY-970: RLS off'; end if;
  if (select count(*) from pg_policies where tablename = 'individual_scholar_transfer_check') <> 1
     or not exists (select 1 from pg_policies where tablename = 'individual_scholar_transfer_check' and policyname = 'individual_scholar_transfer_check_read_own' and cmd = 'SELECT') then
    raise exception 'VERIFY-970: expected exactly the read-own policy';
  end if;
  raise notice 'VERIFY-970 PASS (structure). Rows now: %', (select count(*) from individual_scholar_transfer_check);
end $$;
