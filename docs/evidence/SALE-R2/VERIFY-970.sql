-- VERIFY-970 (SALE-2026-11 R2, SALE-10). STAGING. APPLY THIS FILE WHOLE (it holds a DO block). Raises on the first failure.
-- Structure, then behaviour probes against a real revision session item. Every probe row is written inside a sub-block that is
-- then rolled back (raise, caught), so nothing is kept. Passing = the runner says Committed.
do $$
declare
  it record;
  other record;
  probe text;
  ok boolean;
  refused boolean;
begin
  -- structure
  if to_regclass('public.individual_scholar_transfer_check') is null then raise exception 'VERIFY-970: table missing'; end if;
  if (select count(*) from information_schema.columns where table_name = 'individual_scholar_transfer_check'
       and column_name in ('id', 'user_id', 'revision_session_id', 'question_id', 'topic', 'outside', 'source', 'context_chunk_ids', 'created_at')) <> 9 then
    raise exception 'VERIFY-970: expected the nine columns';
  end if;
  if (select count(*) from information_schema.columns where table_name = 'individual_scholar_transfer_check') <> 9 then
    raise exception 'VERIFY-970: unexpected extra column';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'individual_scholar_transfer_check'
       and column_name in ('user_id', 'revision_session_id', 'question_id', 'topic', 'outside', 'source', 'context_chunk_ids') and is_nullable = 'YES') then
    raise exception 'VERIFY-970: a required column is nullable';
  end if;
  if not coalesce((select pg_get_constraintdef(oid) like '%other_material%' and pg_get_constraintdef(oid) like '%new_question%'
       and pg_get_constraintdef(oid) like '%generated%' and pg_get_constraintdef(oid) like '%120%' and pg_get_constraintdef(oid) like '%200%'
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
  if to_regclass('public.ux_individual_scholar_transfer_check_session_question') is null then raise exception 'VERIFY-970: unique index missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.individual_scholar_transfer_check'::regclass) then raise exception 'VERIFY-970: RLS off'; end if;
  if (select count(*) from pg_policies where tablename = 'individual_scholar_transfer_check') <> 1
     or not exists (select 1 from pg_policies where tablename = 'individual_scholar_transfer_check' and policyname = 'individual_scholar_transfer_check_read_own' and cmd = 'SELECT') then
    raise exception 'VERIFY-970: expected exactly the read-own policy';
  end if;

  -- behaviour probes
  select i.session_id, i.question_id, i.user_id into it from individual_scholar_revision_session_item i limit 1;
  if it.session_id is null then raise exception 'VERIFY-970: no revision session item to probe with'; end if;
  select q.id into other from individual_scholar_question q
   where q.user_id = it.user_id and not exists (select 1 from individual_scholar_revision_session_item x where x.session_id = it.session_id and x.question_id = q.id) limit 1;

  for probe, ok in
    select v.p, v.o from (values
      ('valid', true), ('valid_two_rows_same_question', false), ('question_not_in_session', false), ('other_owner', false),
      ('bad_outside', false), ('bad_source', false), ('short_topic', false), ('untrimmed_topic', false), ('long_topic', false), ('too_many_sections', false)
    ) v(p, o)
  loop
    if probe = 'question_not_in_session' and other.id is null then continue; end if;
    refused := false;
    begin
      begin
        insert into individual_scholar_transfer_check (user_id, revision_session_id, question_id, topic, outside, source, context_chunk_ids)
        values (
          case when probe = 'other_owner' then (select p.id from profiles p where p.id <> it.user_id limit 1) else it.user_id end,
          it.session_id,
          case when probe = 'question_not_in_session' then other.id else it.question_id end,
          case probe when 'short_topic' then 'x' when 'untrimmed_topic' then ' Oxygen therapy' when 'long_topic' then repeat('a', 121) else 'Oxygen therapy' end,
          case when probe = 'bad_outside' then 'elsewhere' else 'other_section' end,
          case when probe = 'bad_source' then 'ai' else 'saved' end,
          case when probe = 'too_many_sections' then array_fill('11111111-1111-4111-8111-111111111111'::uuid, array[201]) else '{}'::uuid[] end);
        if probe = 'valid_two_rows_same_question' then
          insert into individual_scholar_transfer_check (user_id, revision_session_id, question_id, topic, outside, source)
          values (it.user_id, it.session_id, it.question_id, 'Oxygen therapy', 'library', 'library');
        end if;
      exception when others then
        refused := true;
      end;
      raise exception 'probe-rollback';
    exception when others then
      if sqlerrm <> 'probe-rollback' then raise; end if;
    end;
    if refused = ok then
      raise exception 'VERIFY-970: probe % was %', probe, case when refused then 'refused but should be accepted' else 'accepted but should be refused' end;
    end if;
  end loop;
  if exists (select 1 from individual_scholar_transfer_check where topic = 'Oxygen therapy' and created_at > now() - interval '1 minute' and context_chunk_ids = '{}') then
    raise exception 'VERIFY-970: a probe row was kept';
  end if;
  raise notice 'VERIFY-970 PASS';
end $$;
