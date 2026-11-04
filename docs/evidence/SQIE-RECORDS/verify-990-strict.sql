-- VERIFY 990 (strict): raises on any failure. APPLY THIS FILE WHOLE (it holds a DO block). Read-only: it writes nothing.
do $$
declare
  def text;
  bad_path constant text := '$[*] ? (@.type() != "object" || !exists(@.competency_id) || @.competency_id.type() != "string" || !(@.competency_id like_regex "^[0-9a-f-]{36}$"))';
begin
  -- 1. the shape CHECK allows unmarked, keeps the other three markings and the 791 bounds, and ties unmarked to no score and outcome incorrect
  select pg_get_constraintdef(c.oid) into def from pg_constraint c
   where c.conrelid = 'public.individual_scholar_attempt_snapshot'::regclass and c.conname = 'individual_scholar_attempt_snapshot_shape_check';
  if def is null then raise exception 'VERIFY-990: shape check missing'; end if;
  if position('''unmarked''' in def) = 0 then raise exception 'VERIFY-990: shape check does not allow unmarked'; end if;
  if position('''ai_evaluation''' in def) = 0 or position('''self_graded''' in def) = 0 or position('''deterministic''' in def) = 0 then
    raise exception 'VERIFY-990: shape check lost a 791 marking';
  end if;
  if position('16384' in def) = 0 or position('cardinality(competency_ids) <= 20' in def) = 0 then
    raise exception 'VERIFY-990: shape check lost a 791 bound';
  end if;
  if def !~ 'marking <> ''unmarked''::text\) OR \(\(score IS NULL\) AND \(outcome = ''incorrect''::text\)' then
    raise exception 'VERIFY-990: the unmarked rule (no score, outcome incorrect) is missing: %', def;
  end if;
  -- 2. the provenance column: nullable jsonb, with its CHECK
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'individual_scholar_attempt_snapshot'
                  and column_name = 'competency_provenance' and data_type = 'jsonb' and is_nullable = 'YES') then
    raise exception 'VERIFY-990: competency_provenance column missing, not jsonb, or not nullable';
  end if;
  select pg_get_constraintdef(c.oid) into def from pg_constraint c
   where c.conrelid = 'public.individual_scholar_attempt_snapshot'::regclass and c.conname = 'individual_scholar_attempt_snapshot_provenance_check';
  if def is null then raise exception 'VERIFY-990: provenance check missing'; end if;
  if position('4000' in def) = 0 or position('jsonb_array_length' in def) = 0 or position('like_regex' in def) = 0 then
    raise exception 'VERIFY-990: provenance check is not the 990 rule: %', def;
  end if;
  -- 3. the element rule the CHECK uses: refuses a non-object, a missing id, a non-string id and a malformed id, and accepts a good one
  if not jsonb_path_exists('[1]'::jsonb, bad_path::jsonpath) then raise exception 'VERIFY-990: a non-object element would pass'; end if;
  if not jsonb_path_exists('[{"framework_version": "1.0.0"}]'::jsonb, bad_path::jsonpath) then raise exception 'VERIFY-990: a missing competency_id would pass'; end if;
  if not jsonb_path_exists('[{"competency_id": 7}]'::jsonb, bad_path::jsonpath) then raise exception 'VERIFY-990: a numeric competency_id would pass'; end if;
  if not jsonb_path_exists('[{"competency_id": "not-a-uuid"}]'::jsonb, bad_path::jsonpath) then raise exception 'VERIFY-990: a malformed competency_id would pass'; end if;
  if jsonb_path_exists('[{"competency_id": "11111111-2222-4333-8444-555555555555", "framework_version": "1.2.0", "content_hash": null}]'::jsonb, bad_path::jsonpath) then
    raise exception 'VERIFY-990: a well-formed element would be refused';
  end if;
  -- 4. 791 unchanged around it: the guard trigger, RLS on, and the only policy is read-own (no client write path:
  --    the platform default table grants are answered by RLS with no insert, update or delete policy, as in 791)
  if not exists (select 1 from pg_trigger where tgrelid = 'public.individual_scholar_attempt_snapshot'::regclass and tgname = 'individual_scholar_attempt_snapshot_guard' and not tgisinternal) then
    raise exception 'VERIFY-990: the 791 snapshot guard trigger is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.individual_scholar_attempt_snapshot'::regclass) then
    raise exception 'VERIFY-990: RLS is off on the snapshot table';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'individual_scholar_attempt_snapshot' and cmd <> 'SELECT') then
    raise exception 'VERIFY-990: a write policy exists on the snapshot table';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'individual_scholar_attempt_snapshot' and policyname = 'individual_scholar_attempt_snapshot_read_own' and cmd = 'SELECT') then
    raise exception 'VERIFY-990: the read-own policy is missing';
  end if;
  -- 5. both checks are validated against every existing row
  if exists (select 1 from pg_constraint where conrelid = 'public.individual_scholar_attempt_snapshot'::regclass
              and conname in ('individual_scholar_attempt_snapshot_shape_check', 'individual_scholar_attempt_snapshot_provenance_check') and not convalidated) then
    raise exception 'VERIFY-990: a snapshot check is NOT VALID';
  end if;
  raise notice 'VERIFY-990: PASS';
end $$;
