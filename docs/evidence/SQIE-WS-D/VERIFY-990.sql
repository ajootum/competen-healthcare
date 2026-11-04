-- VERIFY-990 (SQIE WS-D). APPLY THIS FILE WHOLE (it holds a DO block). Raises on the first failure.
-- Every probe row is written inside a sub-block that is then rolled back (raise, caught), so nothing is kept.
-- Passing = the runner says Committed.
do $$
declare
  a record;
  probe text;
  ok boolean;
begin
  if not exists (select 1 from information_schema.columns where table_name = 'individual_scholar_attempt_snapshot' and column_name = 'competency_provenance' and data_type = 'jsonb') then
    raise exception 'VERIFY-990: competency_provenance column missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'individual_scholar_attempt_snapshot_provenance_check') then
    raise exception 'VERIFY-990: provenance check missing';
  end if;
  if not coalesce((select pg_get_constraintdef(oid) like '%unmarked%' and pg_get_constraintdef(oid) like '%ai_evaluation%' and pg_get_constraintdef(oid) like '%16384%'
                   from pg_constraint where conname = 'individual_scholar_attempt_snapshot_shape_check'), false) then
    raise exception 'VERIFY-990: shape check does not carry unmarked, ai_evaluation and the 16384 budget';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_scholar_attempt_snapshot'::regclass and contype = 'c') <> 2 then
    raise exception 'VERIFY-990: expected exactly two CHECK constraints on the snapshot table';
  end if;
  -- Nothing was backfilled: no snapshot older than a day carries provenance.
  if exists (select 1 from individual_scholar_attempt_snapshot where competency_provenance is not null and created_at < now() - interval '1 day') then
    raise exception 'VERIFY-990: an older snapshot carries provenance';
  end if;

  select x.id, x.user_id, x.question_id into a from individual_scholar_attempt x
   where not exists (select 1 from individual_scholar_attempt_snapshot s where s.attempt_id = x.id) limit 1;
  if a.id is null then
    raise exception 'VERIFY-990: no attempt without a snapshot to probe with';
  end if;

  for probe, ok in
    select v.p, v.o from (values
      ('unmarked_ok', true), ('unmarked_with_incorrect', false), ('deterministic_with_unmarked', false), ('unmarked_with_score', false),
      ('provenance_ok', true), ('provenance_nulls_ok', true), ('provenance_null_ok', true), ('provenance_misaligned', false),
      ('provenance_extra_key', false), ('provenance_missing_key', false), ('provenance_bad_hash', false), ('provenance_wrong_length', false),
      ('provenance_not_array', false)
    ) v(p, o)
  loop
    begin
      insert into individual_scholar_attempt_snapshot (attempt_id, user_id, question_id, question_version, content_hash, presented, response, answer_key,
        score, outcome, marking, competency_ids, competency_provenance, assessed_at)
      values (a.id, a.user_id, a.question_id, 'own:1', '0123456789abcdef', '{"stem":"probe","options":[]}', '{"kind":"check","text":"probe"}', '{"kind":"none"}',
        case when probe = 'unmarked_with_score' then 0.5 when probe like 'unmarked%' then null else 1 end,
        case when probe = 'unmarked_with_incorrect' then 'incorrect' when probe like 'unmarked%' or probe = 'deterministic_with_unmarked' then 'unmarked' else 'correct' end,
        case when probe like 'unmarked%' then 'unmarked' else 'deterministic' end,
        case when probe like 'provenance%' and probe <> 'provenance_null_ok' then array['11111111-1111-4111-8111-111111111111']::uuid[] else '{}'::uuid[] end,
        case probe
          when 'provenance_ok' then '[{"id":"11111111-1111-4111-8111-111111111111","content_hash":"0123456789abcdef0123456789abcdef","framework_id":"22222222-2222-4222-8222-222222222222","framework_version":"1.0.0"}]'::jsonb
          when 'provenance_nulls_ok' then '[{"id":"11111111-1111-4111-8111-111111111111","content_hash":null,"framework_id":null,"framework_version":null}]'::jsonb
          when 'provenance_misaligned' then '[{"id":"33333333-1111-4111-8111-111111111111","content_hash":null,"framework_id":null,"framework_version":null}]'::jsonb
          when 'provenance_extra_key' then '[{"id":"11111111-1111-4111-8111-111111111111","content_hash":null,"framework_id":null,"framework_version":null,"stage":"x"}]'::jsonb
          when 'provenance_missing_key' then '[{"id":"11111111-1111-4111-8111-111111111111","content_hash":null,"framework_id":null}]'::jsonb
          when 'provenance_bad_hash' then '[{"id":"11111111-1111-4111-8111-111111111111","content_hash":"abc","framework_id":null,"framework_version":null}]'::jsonb
          when 'provenance_wrong_length' then '[]'::jsonb
          when 'provenance_not_array' then '{"id":"11111111-1111-4111-8111-111111111111"}'::jsonb
          when 'unmarked_ok' then '[]'::jsonb
          else null end,
        now());
      if not ok then
        raise exception 'VERIFY-990: probe % was accepted but must be refused', probe;
      end if;
      raise exception 'probe_rollback';
    exception
      when check_violation then
        if ok then
          raise exception 'VERIFY-990: probe % was refused but must be accepted', probe;
        end if;
      when raise_exception then
        if sqlerrm <> 'probe_rollback' then
          raise;
        end if;
    end;
  end loop;
  if exists (select 1 from individual_scholar_attempt_snapshot where attempt_id = a.id) then
    raise exception 'VERIFY-990: a probe row was kept';
  end if;
end $$;
