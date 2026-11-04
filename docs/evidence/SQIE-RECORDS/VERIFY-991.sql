-- VERIFY-991 (SQIE WS-D, owner decision 3). APPLY THIS FILE WHOLE (it holds a DO block). Raises on the first failure.
-- Every probe row is written inside a sub-block that is then rolled back (raise, caught), so nothing is kept.
-- Passing = the runner says Committed.
do $$
declare
  a record;
  probe text;
  ok boolean;
  base constant text := '"id":"11111111-1111-4111-8111-111111111111","content_hash":null,"framework_id":null,"framework_version":null';
begin
  if not coalesce((select pg_get_constraintdef(oid) like '%mapping_status%' and pg_get_constraintdef(oid) like '%objective%' and pg_get_constraintdef(oid) like '%4096%'
                   from pg_constraint where conname = 'individual_scholar_attempt_snapshot_provenance_check'), false) then
    raise exception 'VERIFY-991: provenance check does not carry mapping_status, objective and the 4096 budget';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_scholar_attempt_snapshot'::regclass and contype = 'c') <> 2 then
    raise exception 'VERIFY-991: expected exactly two CHECK constraints on the snapshot table';
  end if;
  if not coalesce((select pg_get_constraintdef(oid) like '%unmarked%' from pg_constraint where conname = 'individual_scholar_attempt_snapshot_shape_check'), false) then
    raise exception 'VERIFY-991: the 990 shape check is not in place';
  end if;

  select x.id, x.user_id, x.question_id into a from individual_scholar_attempt x
   where not exists (select 1 from individual_scholar_attempt_snapshot s where s.attempt_id = x.id) limit 1;
  if a.id is null then
    raise exception 'VERIFY-991: no attempt without a snapshot to probe with';
  end if;

  for probe, ok in
    select v.p, v.o from (values
      ('published', true), ('draft', true), ('status_null', true), ('four_keys_990', true), ('objective_text', true), ('objective_null', true),
      ('status_validated', false), ('status_number', false), ('objective_number', false), ('stage_key', false), ('misaligned', false), ('missing_990_key', false)
    ) v(p, o)
  loop
    begin
      insert into individual_scholar_attempt_snapshot (attempt_id, user_id, question_id, question_version, content_hash, presented, response, answer_key,
        score, outcome, marking, competency_ids, competency_provenance, assessed_at)
      values (a.id, a.user_id, a.question_id, 'own:1', '0123456789abcdef', '{"stem":"probe","options":[]}', '{"kind":"text","text":"probe"}', '{"kind":"none"}',
        1, 'correct', 'deterministic', array['11111111-1111-4111-8111-111111111111']::uuid[],
        (case probe
          when 'published' then '[{' || base || ',"mapping_status":"published","objective":"Recognise early sepsis"}]'
          when 'draft' then '[{' || base || ',"mapping_status":"draft"}]'
          when 'status_null' then '[{' || base || ',"mapping_status":null}]'
          when 'four_keys_990' then '[{' || base || '}]'
          when 'objective_text' then '[{' || base || ',"objective":"Explain why lactate is measured"}]'
          when 'objective_null' then '[{' || base || ',"objective":null}]'
          when 'status_validated' then '[{' || base || ',"mapping_status":"validated"}]'
          when 'status_number' then '[{' || base || ',"mapping_status":1}]'
          when 'objective_number' then '[{' || base || ',"objective":5}]'
          when 'stage_key' then '[{' || base || ',"mapping_status":"published","stage":"competent"}]'
          when 'misaligned' then '[{"id":"33333333-1111-4111-8111-111111111111","content_hash":null,"framework_id":null,"framework_version":null,"mapping_status":"published"}]'
          when 'missing_990_key' then '[{"id":"11111111-1111-4111-8111-111111111111","content_hash":null,"framework_id":null,"mapping_status":"draft"}]'
        end)::jsonb,
        now());
      if not ok then
        raise exception 'VERIFY-991: probe % was accepted but must be refused', probe;
      end if;
      raise exception 'probe_rollback';
    exception
      when check_violation then
        if ok then
          raise exception 'VERIFY-991: probe % was refused but must be accepted', probe;
        end if;
      when raise_exception then
        if sqlerrm <> 'probe_rollback' then
          raise;
        end if;
    end;
  end loop;
  if exists (select 1 from individual_scholar_attempt_snapshot where attempt_id = a.id) then
    raise exception 'VERIFY-991: a probe row was kept';
  end if;
end $$;
