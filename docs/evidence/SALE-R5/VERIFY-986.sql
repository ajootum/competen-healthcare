-- VERIFY-986 (strict). Run on STAGING after 985 and 986 (970 must be present: R2 retention). One block that ALWAYS raises, so nothing planted is kept:
--   "VERIFY-986 PASS pass=N"  every check held (reported by the runner as a rolled-back error: nothing changed)
--   "VERIFY-986 FAIL ..."     the first check that did not hold
-- Every other collective_analytics grant is withdrawn INSIDE this transaction only, so existing staging data cannot move
-- a figure. It plants seven learners (six consenting, one not), each with a Learn session, kept understanding checks
-- linked to clarify events (with and without an R1 adaptive decision), a question answered twice seven days apart, an
-- open reasoning answer, teach and skip events and a stalled session. Then it checks the catalogue, consent, the floor
-- of 5, suppression, the none state, the adaptive and standard arms, rounding, withdrawal, privileges and the declared
-- columns. 986 adds: transfer counted from the 970 join (consent, unmarked and non-transfer attempts excluded, score 0.75
-- rule), and not_measured when 970 is absent (the table is renamed INSIDE this transaction only to prove it).
-- It supersedes VERIFY-985 once 986 is applied (985 read a response.transfer marker that R2 never sets).
do $$
declare
  n int := 0;
  p uuid[];
  i int; s int;
  v_mat uuid; v_chunk uuid; v_qc uuid; v_qm uuid; v_qr uuid; v_sess uuid; v_att uuid; v_rs uuid; v_qt uuid; v_qt2 uuid;
  t timestamptz := now() - interval '3 hours';
  r record;
  def text;
  k int;
  ad_mis jsonb := '{"v":1,"need":"misconception","rule":"r","approach":"mistake","reason":"x","misconception":"m","evidence":[],"round":1,"capped":false,"follows":null,"differentQuestion":true}';
  ad_cap jsonb := '{"v":1,"need":"factual_gap","rule":"r","approach":"review","reason":"x","misconception":null,"evidence":[],"round":2,"capped":true,"follows":null,"differentQuestion":false}';
begin
  -- objects, security, privileges, declared columns
  if to_regproc('public.ckri_scholar_effectiveness_stats') is null then raise exception 'VERIFY-986 FAIL function missing'; end if; n := n + 1;
  if to_regclass('public.individual_scholar_transfer_check') is null then raise exception 'VERIFY-986 FAIL needs 970 (individual_scholar_transfer_check) on staging'; end if;
  if not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang where p.proname = 'ckri_scholar_effectiveness_stats' and l.lanname = 'plpgsql') then raise exception 'VERIFY-986 FAIL the 986 function is not installed (still 985)'; end if; n := n + 1;
  if exists (select 1 from pg_proc where proname = 'ckri_scholar_effectiveness_stats' and not prosecdef) then raise exception 'VERIFY-986 FAIL not security definer'; end if; n := n + 1;
  if has_function_privilege('anon', 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)', 'execute') then
    raise exception 'VERIFY-986 FAIL anon or authenticated may execute'; end if; n := n + 1;
  if not has_function_privilege('service_role', 'public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer)', 'execute') then
    raise exception 'VERIFY-986 FAIL service_role may not execute'; end if; n := n + 1;
  select pg_get_function_result(oid) into def from pg_proc where proname = 'ckri_scholar_effectiveness_stats';
  if def ~* '(user_id|session_id|question|stem|response|answer|text |verdict)' then raise exception 'VERIFY-986 FAIL a result column names learner data: %', def; end if; n := n + 1;

  -- isolate: no other consenting learner counts inside this transaction
  update ckri_participation set status = 'withdrawn', withdrawn_at = now() where permission = 'collective_analytics' and status = 'granted';
  select count(*) into k from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1);
  if k <> 15 then raise exception 'VERIFY-986 FAIL catalogue has % rows, want 15', k; end if; n := n + 1;
  if exists (select 1 from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where cell_state <> 'none' or learners is not null) then
    raise exception 'VERIFY-986 FAIL nobody consents but a cell is not none'; end if; n := n + 1;

  -- plant
  select array_agg(id order by created_at, id) into p from (select id, created_at from profiles order by created_at, id limit 7) x;
  if coalesce(array_length(p, 1), 0) < 7 then raise exception 'VERIFY-986 FAIL needs 7 profiles on staging'; end if;
  delete from ckri_participation where user_id = any(p) and permission = 'collective_analytics';
  for i in 1..6 loop
    insert into ckri_participation (user_id, permission, scope_key, status, notice_version) values (p[i], 'collective_analytics', 'all', 'granted', 'verify-985');
  end loop;
  for i in 1..7 loop
    insert into individual_scholar_material (user_id, title, file_name, mime_type, byte_size, sha256, storage_path, chunk_count, char_count, extractor, pii_attested_at)
      values (p[i], 'verify 985', 'v.txt', 'text/plain', 10, 'verify', p[i]::text || '/verify-985', 1, 10, 'verify', now()) returning id into v_mat;
    insert into individual_scholar_chunk (material_id, user_id, ordinal, content) values (v_mat, p[i], 1, 'verify') returning id into v_chunk;
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version, answer)
      values (p[i], v_mat, v_chunk, 'short', 'check', '[]', null, 'r', '', 'verify', 'verify', 'verify', '{"accepted":["x"]}') returning id into v_qc;
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version)
      values (p[i], v_mat, v_chunk, 'mcq', 'mcq', '["a","b","c","d"]', 0, 'r', '', 'verify', 'verify', 'verify') returning id into v_qm;
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version, answer)
      values (p[i], v_mat, v_chunk, 'short', 'reason', '[]', null, 'r', '', 'verify', 'verify', 'verify', '{"accepted":["x"],"format":"extended"}') returning id into v_qr;
    insert into individual_scholar_learning_session (user_id, scope_kind, title, created_at, last_active_at)
      values (p[i], 'document', 'verify 985', t, now()) returning id into v_sess;
    -- a stalled session: started 20 days ago, idle 15 days, still active
    insert into individual_scholar_learning_session (user_id, scope_kind, title, created_at, last_active_at)
      values (p[i], 'document', 'verify 985 stalled', now() - interval '20 days', now() - interval '15 days');
    -- teach events steps 0, 1, 2. A skip for learners 1 and 2.
    for s in 0..2 loop
      insert into individual_scholar_learning_event (session_id, user_id, step, action, created_at) values (v_sess, p[i], s, 'teach', t + (s * 10) * interval '1 minute');
    end loop;
    if i <= 2 then insert into individual_scholar_learning_event (session_id, user_id, step, action, created_at) values (v_sess, p[i], 2, 'skip', t + interval '25 minutes'); end if;

    -- checks: (step, correct, adaptive) in time order
    --   step 0 first: everyone misses, with a misconception decision        (adaptive arm source)
    --   step 0 follow-up: learners 1-4 right, 5-6 miss with a capped decision
    --   step 1 first: everyone misses, no decision                          (standard arm source)
    --   step 1 follow-up: learners 1-3 right, 4-6 miss
    --   step 2 first: everyone right
    --   step 3: learner 1 an unmarked check
    for k in 1..5 loop
      insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at, marking, response)
        values (p[i], v_qc, null,
          case k when 1 then false when 2 then (i <= 4 or i = 7) when 3 then false when 4 then (i <= 3 or i = 7) else true end,
          t + (30 + k) * interval '1 minute', 'self_graded',
          jsonb_build_object('kind', 'check', 'text', 'a', 'question', 'q')
            || case when k = 1 then jsonb_build_object('adaptive', ad_mis)
                    when k = 2 and i in (5, 6) then jsonb_build_object('adaptive', ad_cap) else '{}'::jsonb end)
        returning id into v_att;
      insert into individual_scholar_learning_event (session_id, user_id, step, action, verdict, attempt_id, created_at)
        values (v_sess, p[i], case k when 1 then 0 when 2 then 0 when 3 then 1 when 4 then 1 else 2 end, 'clarify',
          case when (case k when 1 then false when 2 then (i <= 4 or i = 7) when 3 then false when 4 then (i <= 3 or i = 7) else true end) then 'understood' else 'not_yet' end,
          v_att, t + (30 + k) * interval '1 minute');
    end loop;
    if i = 1 then
      insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at, marking, response)
        values (p[i], v_qc, null, false, t + interval '40 minutes', 'unmarked', '{"kind":"check","text":"a","question":"q"}') returning id into v_att;
      insert into individual_scholar_learning_event (session_id, user_id, step, action, attempt_id, created_at) values (v_sess, p[i], 3, 'clarify', v_att, t + interval '40 minutes');
      -- an extended answer carrying a response.transfer marker: 986 must NOT count it as transfer (it is not in 970)
      insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at, marking, response)
        values (p[i], v_qr, null, true, t + interval '50 minutes', 'self_graded', '{"text":"a","transfer":{"v":1}}');
    end if;
    -- transfer (970): a transfer-check revision session with two questions, only the first is a transfer check.
    --   learners 1-3 score 1, 4 score 0.5 marked correct (NOT well: the score rule wins), 5 no score and correct, 6 no score and wrong, 7 no consent.
    --   learner 1 also an UNMARKED answer to it, learner 2 a correct answer to the second (not a transfer check).
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version, answer)
      values (p[i], v_mat, v_chunk, 'short', 'transfer', '[]', null, 'r', '', 'verify', 'verify', 'verify', '{"accepted":["x"]}') returning id into v_qt;
    insert into individual_scholar_question (user_id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, provider, prompt_version, answer)
      values (p[i], v_mat, v_chunk, 'short', 'other', '[]', null, 'r', '', 'verify', 'verify', 'verify', '{"accepted":["x"]}') returning id into v_qt2;
    insert into individual_scholar_revision_session (user_id, mode, total) values (p[i], 'adaptive', 2) returning id into v_rs;
    insert into individual_scholar_revision_session_item (session_id, user_id, ordinal, question_id) values (v_rs, p[i], 1, v_qt), (v_rs, p[i], 2, v_qt2);
    insert into individual_scholar_transfer_check (user_id, revision_session_id, question_id, topic, outside, source) values (p[i], v_rs, v_qt, 'verify topic', 'other_material', 'generated');
    insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at, marking, score, response, revision_session_id)
      values (p[i], v_qt, null, i in (1, 2, 3, 4, 5, 7), t + interval '55 minutes', case when i in (5, 6) then 'deterministic' else 'self_graded' end,
              case when i in (1, 2, 3, 7) then 1 when i = 4 then 0.5 else null end, '{"text":"a"}', v_rs);
    if i = 1 then
      insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at, marking, response, revision_session_id)
        values (p[i], v_qt, null, false, t + interval '56 minutes', 'unmarked', '{"text":"a"}', v_rs);
    end if;
    if i = 2 then
      insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at, marking, score, response, revision_session_id)
        values (p[i], v_qt2, null, true, t + interval '57 minutes', 'self_graded', 1, '{"text":"a"}', v_rs);
    end if;
    -- delayed recall: right 7 days ago, again now (learners 1-5 right, 6 wrong)
    insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at) values (p[i], v_qm, 0, true, t - interval '7 days');
    insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at) values (p[i], v_qm, case when i = 6 then 1 else 0 end, i <> 6, t + interval '45 minutes');
    -- independent reasoning: first answer to an extended question (learners 1-3 right) (learner 1 answered it first as the transfer, so 1 counts that)
    if i > 1 then
      insert into individual_scholar_attempt (user_id, question_id, chosen_index, correct, answered_at, marking, response)
        values (p[i], v_qr, null, i <= 3, t + interval '50 minutes', 'self_graded', '{"text":"a"}');
    end if;
  end loop;
  n := n + 1;

  -- immediate understanding: first checks of steps 0, 1, 2 for six learners = 18, right = 6 (step 2)
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'immediate_understanding';
  if r.cell_state <> 'reported' or r.learners <> 6 or r.denominator <> 18 or r.numerator <> 6 or r.rate <> 33 then raise exception 'VERIFY-986 FAIL immediate: %', row_to_json(r); end if; n := n + 1;
  -- adaptive arm: step 0 follow-ups, 4 of 6 right. standard arm: step 1 follow-ups, 3 of 6 right. learner 7 never counted
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'corrective_followup' and arm = 'adaptive';
  if r.cell_state <> 'reported' or r.learners <> 6 or r.denominator <> 6 or r.numerator <> 4 or r.rate <> 67 then raise exception 'VERIFY-986 FAIL adaptive arm: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'corrective_followup' and arm = 'standard';
  if r.cell_state <> 'reported' or r.denominator <> 6 or r.numerator <> 3 or r.rate <> 50 then raise exception 'VERIFY-986 FAIL standard arm: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'misconception_resolution';
  if r.cell_state <> 'reported' or r.denominator <> 6 or r.numerator <> 4 then raise exception 'VERIFY-986 FAIL misconception resolution: %', row_to_json(r); end if; n := n + 1;
  -- delayed recall: 5 of 6 right after 7 days. flashcards: none planted, state none
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'delayed_recall' and arm = 'questions';
  if r.cell_state <> 'reported' or r.denominator <> 6 or r.numerator <> 5 or r.rate <> 83 then raise exception 'VERIFY-986 FAIL delayed recall: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'delayed_recall' and arm = 'flashcards';
  if r.cell_state <> 'none' or r.learners is not null or r.rate is not null then raise exception 'VERIFY-986 FAIL flashcards not none: %', row_to_json(r); end if; n := n + 1;
  -- transfer (970 join): six consenting answers, well answered = learners 1, 2, 3 (score 1) and 5 (no score, correct)
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'transfer';
  if r.cell_state <> 'reported' or r.learners <> 6 or r.denominator <> 6 or r.numerator <> 4 or r.rate <> 67 then raise exception 'VERIFY-986 FAIL transfer: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 7, 1) where measure = 'transfer';
  if r.cell_state <> 'below_floor' or r.denominator is not null or r.rate is not null then raise exception 'VERIFY-986 FAIL transfer floor: %', row_to_json(r); end if; n := n + 1;
  -- independent reasoning: six first answers (learner 1 via the transfer, right), right = learners 1, 2, 3
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'independent_reasoning';
  if r.cell_state <> 'reported' or r.denominator <> 6 or r.numerator <> 3 or r.rate <> 50 then raise exception 'VERIFY-986 FAIL independent reasoning: %', row_to_json(r); end if; n := n + 1;
  -- study efficiency: a value, active minutes, no rate
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'study_efficiency';
  if r.cell_state <> 'reported' or r.value is null or r.value <= 0 or r.denominator is null or r.denominator <= 0 or r.rate is not null then raise exception 'VERIFY-986 FAIL efficiency: %', row_to_json(r); end if; n := n + 1;
  -- friction: skips 2 per 18 teach, not yet 17 of 30 verdicts, unmarked 1 of 31 checks, cap 2 of 8 decisions, stalled 6 of 12
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'friction' and arm = 'skips';
  if r.cell_state <> 'reported' or r.denominator <> 18 or r.numerator <> 2 or r.rate <> 11 then raise exception 'VERIFY-986 FAIL skips: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'friction' and arm = 'not_yet';
  if r.denominator <> 30 or r.numerator <> 17 then raise exception 'VERIFY-986 FAIL not yet: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'friction' and arm = 'unmarked_checks';
  if r.denominator <> 31 or r.numerator <> 1 then raise exception 'VERIFY-986 FAIL unmarked: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'friction' and arm = 'reteach_cap';
  if r.denominator <> 8 or r.numerator <> 2 or r.rate <> 25 then raise exception 'VERIFY-986 FAIL reteach cap: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'friction' and arm = 'stalled_sessions';
  if r.denominator <> 12 or r.numerator <> 6 or r.rate <> 50 then raise exception 'VERIFY-986 FAIL stalled: %', row_to_json(r); end if; n := n + 1;
  -- rounding to 5 (rates stay exact)
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 5) where measure = 'corrective_followup' and arm = 'adaptive';
  if r.learners <> 5 or r.denominator <> 5 or r.numerator <> 5 or r.rate <> 67 then raise exception 'VERIFY-986 FAIL rounding: %', row_to_json(r); end if; n := n + 1;
  -- a floor above the cohort suppresses every cell
  if exists (select 1 from ckri_scholar_effectiveness_stats(now() - interval '30 days', 7, 1) where cell_state = 'reported' or learners is not null or rate is not null or value is not null) then
    raise exception 'VERIFY-986 FAIL floor 7 left a cell reported'; end if; n := n + 1;
  -- 970 absent (renamed inside this transaction only): transfer is not_measured with every figure null, the rest unchanged
  alter table individual_scholar_transfer_check rename to individual_scholar_transfer_check_v986;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'transfer';
  if r.cell_state <> 'not_measured' or r.learners is not null or r.denominator is not null or r.numerator is not null or r.rate is not null or r.value is not null then
    raise exception 'VERIFY-986 FAIL transfer without 970 is not not_measured: %', row_to_json(r); end if; n := n + 1;
  select * into r from ckri_scholar_effectiveness_stats(now() - interval '30 days', 5, 1) where measure = 'immediate_understanding';
  if r.cell_state <> 'reported' or r.denominator <> 18 then raise exception 'VERIFY-986 FAIL other cells changed without 970: %', row_to_json(r); end if; n := n + 1;
  alter table individual_scholar_transfer_check_v986 rename to individual_scholar_transfer_check;
  -- withdrawal: two learners withdraw, four remain: under the floor of 5 even when 1 is asked
  update ckri_participation set status = 'withdrawn', withdrawn_at = now() where user_id in (p[5], p[6]) and permission = 'collective_analytics';
  if exists (select 1 from ckri_scholar_effectiveness_stats(now() - interval '30 days', 1, 1) where cell_state = 'reported') then
    raise exception 'VERIFY-986 FAIL withdrawn still counted or floor under 5'; end if; n := n + 1;

  raise exception 'VERIFY-986 PASS pass=%', n;
end $$;
