-- VERIFY-996 (strict). Run on STAGING after 996. One block that ALWAYS raises, so nothing planted is kept:
--   "VERIFY-996 PASS pass=N"  every check held (reported by the runner as a rolled-back error: nothing changed)
--   "VERIFY-996 FAIL ..."     the first check that did not hold
-- It plants seven learners (six consenting, one not), two published library versions (a single best answer and a short
-- answer), a copy of each per learner and one attempt per copy. The library-copy guard (800) and the version guards
-- (442, resource and version) are disabled INSIDE this transaction only, to plant published versions without a review flow; the rollback
-- restores them. Then it checks consent, the floor of 5, suppression, rounding, the discrimination index, the
-- first-attempt choices, per-format correctness, unmarked attempts, privileges and the declared columns.
do $$
declare
  n int := 0;
  p uuid[];
  v_res uuid; v_a uuid; v_b uuid; v_mat uuid; v_chunk uuid; v_q uuid;
  i int;
  r record;
  def text;
  c_mcq jsonb := '{"stem":"Which vein is most used for adult cannulation?","options":["Cephalic","Femoral","Jugular","Saphenous"],"correct_index":0,"rationale":"The cephalic vein is commonly used."}';
  c_short jsonb := '{"format":"short","stem":"What is the normal adult respiratory rate?","options":[],"answerKey":{"accepted":["12 to 20"]},"marking":"deterministic","rationale":"Adults breathe 12 to 20 times a minute at rest."}';
begin
  -- objects, security, privileges, declared columns
  if to_regproc('public.ckri_library_item_stats') is null or to_regproc('public.ckri_question_format_correctness') is null then raise exception 'VERIFY-996 FAIL function missing'; end if; n := n + 1;
  if exists (select 1 from pg_proc where proname in ('ckri_library_item_stats', 'ckri_question_format_correctness') and not prosecdef) then raise exception 'VERIFY-996 FAIL not security definer'; end if; n := n + 1;
  if has_function_privilege('anon', 'public.ckri_library_item_stats(uuid[], integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ckri_library_item_stats(uuid[], integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.ckri_question_format_correctness(timestamptz, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ckri_question_format_correctness(timestamptz, integer, integer)', 'execute') then
    raise exception 'VERIFY-996 FAIL anon or authenticated may execute'; end if; n := n + 1;
  if not has_function_privilege('service_role', 'public.ckri_library_item_stats(uuid[], integer, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.ckri_question_format_correctness(timestamptz, integer, integer)', 'execute') then
    raise exception 'VERIFY-996 FAIL service_role may not execute'; end if; n := n + 1;
  select string_agg(pg_get_function_result(oid), ' ') into def from pg_proc where proname in ('ckri_library_item_stats', 'ckri_question_format_correctness');
  if def ~* '(user_id|stem|response|answer|rubric|chosen_index)' then raise exception 'VERIFY-996 FAIL a result column names learner data: %', def; end if; n := n + 1;

  -- plant
  select array_agg(id order by created_at, id) into p from (select id, created_at from profiles order by created_at, id limit 7) x;
  if coalesce(array_length(p, 1), 0) < 7 then raise exception 'VERIFY-996 FAIL needs 7 profiles on staging'; end if;
  delete from ckri_participation where user_id = any(p) and permission = 'collective_analytics';
  for i in 1..6 loop
    insert into ckri_participation (user_id, permission, scope_key, status, notice_version) values (p[i], 'collective_analytics', 'all', 'granted', 'verify-996');
  end loop;
  alter table individual_scholar_question disable trigger individual_scholar_question_library_guard;
  alter table ckri_knowledge_version disable trigger user;
  alter table ckri_knowledge_resource disable trigger ckri_knowledge_resource_guard;
  insert into ckri_knowledge_resource (code, kind, title, created_by) values ('verify-996-a', 'revision_question', 'VERIFY 996 a', p[1]) returning id into v_res;
  insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by, state, published_at, content_hash, educator_reviewed_by, educator_reviewed_hash, educator_reviewed_at, submitted_by, submitted_at, published_by)
    values (v_res, 1, c_mcq, 'educator', array[p[1]], 'published', now(), 'verify', p[1], 'verify', now(), p[1], now(), p[2]) returning id into v_a;
  insert into ckri_knowledge_resource (code, kind, title, created_by) values ('verify-996-b', 'revision_question', 'VERIFY 996 b', p[1]) returning id into v_res;
  insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by, state, published_at, content_hash, educator_reviewed_by, educator_reviewed_hash, educator_reviewed_at, submitted_by, submitted_at, published_by)
    values (v_res, 1, c_short, 'educator', array[p[1]], 'published', now(), 'verify', p[1], 'verify', now(), p[1], now(), p[2]) returning id into v_b;
  for i in 1..7 loop
    insert into individual_scholar_material (user_id, title, file_name, mime_type, byte_size, sha256, storage_path, chunk_count, char_count, extractor, pii_attested_at)
      values (p[i], 'verify 996', 'v.txt', 'text/plain', 10, 'verify', p[i]::text || '/verify-996', 1, 10, 'verify', now()) returning id into v_mat;
    insert into individual_scholar_chunk (material_id, user_id, ordinal, content) values (v_mat, p[i], 1, 'verify') returning id into v_chunk;
    -- a: learners 1-4 right (choice 0), 5-6 wrong (choice 2), 7 (no consent) right
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version,
        review_status, library_resource_id, library_version_id)
      select p[i], v_mat, v_chunk, 'mcq', c_mcq ->> 'stem', c_mcq -> 'options', 0, c_mcq ->> 'rationale', '', 'competen-library', 'competen-library', 'library:v1',
             'library_approved', kv.resource_id, v_a from ckri_knowledge_version kv where kv.id = v_a
      returning id into v_q;
    insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at)
      values (p[i], v_q, case when i in (5, 6) then 2 else 0 end, i not in (5, 6), now() - interval '1 hour');
    -- b: learners 1-3 right, 4-6 wrong, plus an UNMARKED later attempt by learner 4 (never counted)
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version,
        review_status, library_resource_id, library_version_id, answer)
      select p[i], v_mat, v_chunk, 'short', c_short ->> 'stem', '[]'::jsonb, null, c_short ->> 'rationale', '', 'competen-library', 'competen-library', 'library:v1',
             'library_approved', kv.resource_id, v_b, '{"accepted":["12 to 20"],"marking":"deterministic"}'::jsonb from ckri_knowledge_version kv where kv.id = v_b
      returning id into v_q;
    insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at)
      values (p[i], v_q, 0, i <= 3, now() - interval '1 hour');
    if i = 4 then
      insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at, marking)
        values (p[i], v_q, 0, false, now(), 'unmarked');
    end if;
  end loop;
  n := n + 1;

  -- six consenting learners: reported, the seventh (no consent) is not counted
  select * into r from ckri_library_item_stats(array[v_a], 5, 1);
  if r.suppressed or r.learners <> 6 or r.attempts <> 6 or r.percent_correct <> 67 or r.missed_learners <> 2 then
    raise exception 'VERIFY-996 FAIL item a: %', row_to_json(r); end if; n := n + 1;
  -- choice cells under the floor are null (4 chose the key, 2 chose C), never the raw count
  if r.option_counts is null or (r.option_counts -> '0') <> 'null'::jsonb or (r.option_counts -> '2') <> 'null'::jsonb then
    raise exception 'VERIFY-996 FAIL choices not suppressed: %', r.option_counts; end if; n := n + 1;
  -- discrimination: item a against the rest (item b) over 6 learners, positive
  if r.discrimination is null or r.discrimination <= 0 or r.discrimination_n <> 6 then raise exception 'VERIFY-996 FAIL discrimination: % over %', r.discrimination, r.discrimination_n; end if; n := n + 1;
  -- the unmarked attempt is not an answer: item b has 6 attempts, 50 percent
  select * into r from ckri_library_item_stats(array[v_b], 5, 1);
  if r.suppressed or r.attempts <> 6 or r.percent_correct <> 50 then raise exception 'VERIFY-996 FAIL item b (unmarked counted?): %', row_to_json(r); end if; n := n + 1;
  -- rounding to 5
  select * into r from ckri_library_item_stats(array[v_a], 5, 5);
  if r.learners <> 5 or r.percent_correct <> 67 then raise exception 'VERIFY-996 FAIL rounding: %', row_to_json(r); end if; n := n + 1;
  -- a floor above the cohort suppresses everything, and the floor is never below 5 whatever is asked
  select * into r from ckri_library_item_stats(array[v_a], 10, 1);
  if not r.suppressed or r.learners is not null or r.percent_correct is not null or r.option_counts is not null or r.discrimination is not null or r.last_used is not null then
    raise exception 'VERIFY-996 FAIL floor 10 not suppressed: %', row_to_json(r); end if; n := n + 1;
  -- withdrawal: two learners withdraw, four remain, under the floor of 5 even when 1 is asked
  update ckri_participation set status = 'withdrawn', withdrawn_at = now() where user_id in (p[5], p[6]) and permission = 'collective_analytics';
  select * into r from ckri_library_item_stats(array[v_a], 1, 1);
  if not r.suppressed or r.learners is not null then raise exception 'VERIFY-996 FAIL withdrawn still counted or floor under 5: %', row_to_json(r); end if; n := n + 1;
  update ckri_participation set status = 'granted', withdrawn_at = null where user_id in (p[5], p[6]) and permission = 'collective_analytics';
  -- an unknown version is a suppressed row, never an error
  select * into r from ckri_library_item_stats(array[gen_random_uuid()], 5, 1);
  if not r.suppressed then raise exception 'VERIFY-996 FAIL unknown version reported'; end if; n := n + 1;

  -- per format: library mcq and library short, six learners each
  select * into r from ckri_question_format_correctness(now() - interval '1 day', 5, 1) where format = 'mcq' and source = 'library';
  if not found or r.suppressed or r.learners <> 6 or r.attempts <> 6 or r.percent_correct <> 67 then raise exception 'VERIFY-996 FAIL format mcq: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_question_format_correctness(now() - interval '1 day', 5, 1) where format = 'short' and source = 'library';
  if not found or r.suppressed or r.attempts <> 6 or r.percent_correct <> 50 then raise exception 'VERIFY-996 FAIL format short: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_question_format_correctness(now() - interval '1 day', 7, 1) where format = 'mcq' and source = 'library';
  if not found or not r.suppressed or r.attempts is not null then raise exception 'VERIFY-996 FAIL format floor: %', row_to_json(r); end if; n := n + 1;

  raise exception 'VERIFY-996 PASS pass=%', n;
end $$;
