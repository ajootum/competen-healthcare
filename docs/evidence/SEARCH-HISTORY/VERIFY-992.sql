-- VERIFY-992 (SCHOLAR-SEARCH-HISTORY-01, My Search History). APPLY THIS FILE WHOLE (it holds a DO block). STAGING ONLY.
-- Raises on the first failure. Every probe row is written inside a sub-block that is then undone (raise, caught), so
-- nothing is kept. Passing = the runner says Committed. Red before 992 (the table is missing).
do $$
declare
  u uuid;
  u2 uuid;
  m uuid;
  m2 uuid;
  a uuid;
  a2 uuid;
  s uuid;
  probe text;
  ok boolean;
  accepted boolean;
  n bigint;
  before_rows bigint;
  before_art bigint;
  before_sess bigint;
  before_notes bigint;
  before_u2 bigint;
  fn text := 'public.individual_scholar_search_history_list(uuid, text, text, uuid, text, timestamptz, timestamptz, boolean, integer, integer)';
  fc text := 'public.individual_scholar_search_history_clear(uuid)';
begin
  -- ---- objects ----
  if to_regclass('public.individual_scholar_search_history') is null then
    raise exception 'VERIFY-992: table individual_scholar_search_history is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.individual_scholar_search_history'::regclass) then
    raise exception 'VERIFY-992: RLS is not enabled';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.individual_scholar_search_history'::regclass) <> 1
     or not exists (select 1 from pg_policy where polrelid = 'public.individual_scholar_search_history'::regclass
                    and polname = 'individual_scholar_search_history_read_own' and polcmd = 'r'
                    and pg_get_expr(polqual, polrelid) like '%auth.uid()%user_id%') then
    raise exception 'VERIFY-992: expected exactly one policy, read own';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'ux_individual_scholar_search_history_key'
                 and indexdef like 'CREATE UNIQUE INDEX%(user_id, request_key)' ) then
    raise exception 'VERIFY-992: the plain unique index on (user_id, request_key) is missing or partial';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_scholar_search_history'::regclass and contype = 'f') <> 4 then
    raise exception 'VERIFY-992: expected four foreign keys (profiles, material, artefact, session)';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public' and p.proname in ('individual_scholar_search_history_list', 'individual_scholar_search_history_clear') and p.prosecdef) then
    raise exception 'VERIFY-992: a function is security definer';
  end if;
  if not has_function_privilege('service_role', fn, 'execute') or has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute')
     or not has_function_privilege('service_role', fc, 'execute') or has_function_privilege('anon', fc, 'execute') or has_function_privilege('authenticated', fc, 'execute') then
    raise exception 'VERIFY-992: function execute must be service_role only';
  end if;

  -- ---- two learners: u with saved teaching and a lesson, u2 another learner with a material ----
  select x.user_id into u from individual_scholar_artefact x where x.superseded_at is null
    and exists (select 1 from individual_scholar_learning_session y where y.user_id = x.user_id)
   group by x.user_id order by count(*) desc limit 1;
  if u is null then raise exception 'VERIFY-992: no learner with saved teaching and a lesson to probe with'; end if;
  select x.id, x.material_id into a, m from individual_scholar_artefact x where x.user_id = u and x.superseded_at is null order by x.created_at desc limit 1;
  select x.id into s from individual_scholar_learning_session x where x.user_id = u order by x.created_at desc limit 1;
  select x.user_id, x.id into u2, m2 from individual_scholar_material x where x.user_id <> u order by x.created_at limit 1;
  if u2 is null then raise exception 'VERIFY-992: no second learner to probe with'; end if;
  select x.id into a2 from individual_scholar_artefact x where x.user_id <> u limit 1;

  select count(*) into before_rows from individual_scholar_search_history;
  select count(*) into before_art from individual_scholar_artefact;
  select count(*) into before_sess from individual_scholar_learning_session;
  select count(*) into before_notes from individual_scholar_note;
  select coalesce(max(total), 0) into before_u2 from public.individual_scholar_search_history_list(u2, null, null, null, null, null, null, false, 1, 0);

  -- ---- shape probes ----
  for probe, ok in
    select v.p, v.o from (values
      ('captured_search', true), ('captured_ask_with_refs', true), ('captured_library', true), ('captured_duplicate_key', false),
      ('captured_empty', false), ('captured_one_char', false), ('captured_too_long', false), ('captured_control_char', false),
      ('captured_bad_key', false), ('captured_hidden', false), ('captured_unknown_activity', false), ('captured_teaching', false),
      ('captured_other_learner_material', false), ('captured_other_learner_session', false),
      ('recovered_pin', true), ('recovered_hide_lesson', true), ('recovered_no_mark', false), ('recovered_with_query', false),
      ('recovered_key_mismatch', false), ('recovered_other_learner_artefact', false), ('recovered_bad_key', false),
      ('topic_one_char', false), ('step_out_of_range', false), ('result_negative', false)
    ) as v(p, o)
  loop
    accepted := false;
    begin
      case probe
        when 'captured_search' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key, result_count) values (u, 'captured', 'material_search', 'preload and afterload', 'c:probe-aaaaaaaaaaaaaaaa', 3);
        when 'captured_ask_with_refs' then insert into individual_scholar_search_history(user_id, origin, activity, query, topic, material_id, artefact_id, session_id, step, request_key) values (u, 'captured', 'ask', 'Why does preload rise?', 'Cardiac output', m, a, s, 0, 'c:probe-bbbbbbbbbbbbbbbb');
        when 'captured_library' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'library_search', 'sepsis', 'c:probe-cccccccccccccccc');
        when 'captured_duplicate_key' then
          insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'ask', 'first', 'c:probe-dddddddddddddddd');
          insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'ask', 'retry', 'c:probe-dddddddddddddddd');
        when 'captured_empty' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'material_search', '   ', 'c:probe-eeeeeeeeeeeeeeee');
        when 'captured_one_char' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'material_search', 'a', 'c:probe-eeeeeeeeeeeeeeee');
        when 'captured_too_long' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'ask', repeat('a', 301), 'c:probe-eeeeeeeeeeeeeeee');
        when 'captured_control_char' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'ask', 'two' || chr(10) || 'lines', 'c:probe-eeeeeeeeeeeeeeee');
        when 'captured_bad_key' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'ask', 'question', 'short');
        when 'captured_hidden' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key, hidden_at) values (u, 'captured', 'ask', 'question', 'c:probe-ffffffffffffffff', now());
        when 'captured_unknown_activity' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'keystroke', 'question', 'c:probe-ffffffffffffffff');
        when 'captured_teaching' then insert into individual_scholar_search_history(user_id, origin, activity, query, request_key) values (u, 'captured', 'teaching', 'question', 'c:probe-ffffffffffffffff');
        when 'captured_other_learner_material' then insert into individual_scholar_search_history(user_id, origin, activity, query, material_id, request_key) values (u, 'captured', 'ask', 'question', m2, 'c:probe-gggggggggggggggg');
        when 'captured_other_learner_session' then insert into individual_scholar_search_history(user_id, origin, activity, query, session_id, step, request_key) values (u2, 'captured', 'ask', 'question', s, 0, 'c:probe-gggggggggggggggg');
        when 'recovered_pin' then insert into individual_scholar_search_history(user_id, origin, activity, artefact_id, request_key, pinned_at) values (u, 'recovered', 'teaching', a, 'artefact:' || a::text, now());
        when 'recovered_hide_lesson' then insert into individual_scholar_search_history(user_id, origin, activity, session_id, request_key, hidden_at) values (u, 'recovered', 'lesson', s, 'lesson:' || s::text, now());
        when 'recovered_no_mark' then insert into individual_scholar_search_history(user_id, origin, activity, artefact_id, request_key) values (u, 'recovered', 'teaching', a, 'artefact:' || a::text);
        when 'recovered_with_query' then insert into individual_scholar_search_history(user_id, origin, activity, artefact_id, request_key, pinned_at, query) values (u, 'recovered', 'teaching', a, 'artefact:' || a::text, now(), 'words');
        when 'recovered_key_mismatch' then insert into individual_scholar_search_history(user_id, origin, activity, artefact_id, request_key, pinned_at) values (u, 'recovered', 'teaching', a, 'artefact:' || gen_random_uuid()::text, now());
        when 'recovered_other_learner_artefact' then insert into individual_scholar_search_history(user_id, origin, activity, artefact_id, request_key, pinned_at) values (u, 'recovered', 'teaching', coalesce(a2, gen_random_uuid()), 'artefact:' || coalesce(a2, gen_random_uuid())::text, now());
        when 'recovered_bad_key' then insert into individual_scholar_search_history(user_id, origin, activity, session_id, request_key, pinned_at) values (u, 'recovered', 'lesson', s, 'c:probe-hhhhhhhhhhhhhhhh', now());
        when 'topic_one_char' then insert into individual_scholar_search_history(user_id, origin, activity, query, topic, request_key) values (u, 'captured', 'ask', 'question', 'x', 'c:probe-iiiiiiiiiiiiiiii');
        when 'step_out_of_range' then insert into individual_scholar_search_history(user_id, origin, activity, query, step, request_key) values (u, 'captured', 'ask', 'question', 200, 'c:probe-iiiiiiiiiiiiiiii');
        when 'result_negative' then insert into individual_scholar_search_history(user_id, origin, activity, query, result_count, request_key) values (u, 'captured', 'material_search', 'question', -1, 'c:probe-iiiiiiiiiiiiiiii');
      end case;
      accepted := true;
      raise exception 'undo probe';
    exception
      when check_violation or unique_violation or foreign_key_violation then accepted := false;
      when others then if sqlerrm <> 'undo probe' then raise; end if;
    end;
    if accepted is distinct from ok then
      raise exception 'VERIFY-992: probe % was %, expected %', probe, case when accepted then 'accepted' else 'refused' end, case when ok then 'accepted' else 'refused' end;
    end if;
  end loop;

  -- ---- behaviour probes: list, search, filters, isolation, clear (all undone) ----
  begin
    insert into individual_scholar_search_history(user_id, origin, activity, query, topic, material_id, request_key, result_count)
      values (u, 'captured', 'material_search', 'zzprobe fluid balance', 'Fluids probe', m, 'c:probe-jjjjjjjjjjjjjjjj', 2);
    -- one second later: both probes share the transaction clock, and newest first must not depend on a tie
    insert into individual_scholar_search_history(user_id, origin, activity, query, request_key, pinned_at, created_at)
      values (u, 'captured', 'ask', 'zzprobe why is potassium dangerous', 'c:probe-kkkkkkkkkkkkkkkk', now(), now() + interval '1 second');

    -- newest first, and the learner existing saved teaching and lessons are in the list
    select count(*) into n from public.individual_scholar_search_history_list(u, null, null, null, null, null, null, false, 50, 0) x where x.entry_key = 'artefact:' || a::text;
    if n <> 1 then raise exception 'VERIFY-992: the learner current saved teaching is not in the list'; end if;
    select count(*) into n from public.individual_scholar_search_history_list(u, null, 'lesson', null, null, null, null, false, 50, 0) x where x.entry_key = 'lesson:' || s::text;
    if n <> 1 then raise exception 'VERIFY-992: the learner lesson is not in the list'; end if;
    if (select x.query from public.individual_scholar_search_history_list(u, null, null, null, null, null, null, false, 1, 0) x) <> 'zzprobe why is potassium dangerous' then
      raise exception 'VERIFY-992: the list is not newest first';
    end if;
    -- full text, activity, topic, material, pinned, date
    if (select max(total) from public.individual_scholar_search_history_list(u, 'zzprobe', null, null, null, null, null, false, 50, 0)) <> 2 then
      raise exception 'VERIFY-992: full-text search did not find exactly the two probe entries';
    end if;
    if (select string_agg(x.headline, '') from public.individual_scholar_search_history_list(u, 'potassium', 'ask', null, null, null, null, false, 50, 0) x) not like '%{{hl}}%' then
      raise exception 'VERIFY-992: the search headline is not marked';
    end if;
    if exists (select 1 from public.individual_scholar_search_history_list(u, 'zzprobe', 'ask', null, null, null, null, false, 50, 0) x where x.activity <> 'ask') then
      raise exception 'VERIFY-992: the activity filter leaked another activity';
    end if;
    if (select max(total) from public.individual_scholar_search_history_list(u, 'zzprobe', null, null, 'fluids PROBE', null, null, false, 50, 0)) <> 1 then
      raise exception 'VERIFY-992: the topic filter (case-insensitive) did not find exactly one';
    end if;
    if exists (select 1 from public.individual_scholar_search_history_list(u, null, null, m, null, null, null, false, 50, 0) x where x.material_id is distinct from m and x.activity <> 'lesson') then
      raise exception 'VERIFY-992: the material filter leaked another material';
    end if;
    if exists (select 1 from public.individual_scholar_search_history_list(u, null, null, null, null, null, null, true, 50, 0) x where x.pinned_at is null) then
      raise exception 'VERIFY-992: the pinned filter leaked an unpinned entry';
    end if;
    if exists (select 1 from public.individual_scholar_search_history_list(u, 'zzprobe', null, null, null, now() + interval '1 day', null, false, 50, 0)) then
      raise exception 'VERIFY-992: the date filter leaked an earlier entry';
    end if;
    -- isolation: the other learner list never holds u entries or records
    if exists (select 1 from public.individual_scholar_search_history_list(u2, 'zzprobe', null, null, null, null, null, false, 50, 0))
       or exists (select 1 from public.individual_scholar_search_history_list(u2, null, null, null, null, null, null, false, 50, 0) x
                  where x.entry_key in ('artefact:' || a::text, 'lesson:' || s::text)) then
      raise exception 'VERIFY-992: another learner list holds this learner history';
    end if;
    -- a removed record leaves the list, the record stays
    insert into individual_scholar_search_history(user_id, origin, activity, artefact_id, request_key, hidden_at) values (u, 'recovered', 'teaching', a, 'artefact:' || a::text, now());
    if exists (select 1 from public.individual_scholar_search_history_list(u, null, null, null, null, null, null, false, 50, 0) x where x.entry_key = 'artefact:' || a::text) then
      raise exception 'VERIFY-992: a removed saved teaching is still listed';
    end if;
    if not exists (select 1 from individual_scholar_artefact where id = a) then raise exception 'VERIFY-992: removing from history touched the saved teaching'; end if;
    -- clear: nothing left in u list, u2 list unchanged, no other table touched
    perform public.individual_scholar_search_history_clear(u);
    if exists (select 1 from public.individual_scholar_search_history_list(u, null, null, null, null, null, null, false, 50, 0)) then
      raise exception 'VERIFY-992: the list is not empty after clear';
    end if;
    if exists (select 1 from individual_scholar_search_history where user_id = u and origin = 'captured') then
      raise exception 'VERIFY-992: a captured entry survived clear';
    end if;
    if (select coalesce(max(total), 0) from public.individual_scholar_search_history_list(u2, null, null, null, null, null, null, false, 1, 0)) <> before_u2 then
      raise exception 'VERIFY-992: clear changed another learner history';
    end if;
    if (select count(*) from individual_scholar_artefact) <> before_art or (select count(*) from individual_scholar_learning_session) <> before_sess
       or (select count(*) from individual_scholar_note) <> before_notes then
      raise exception 'VERIFY-992: clear touched saved teaching, lessons or notes';
    end if;
    raise exception 'undo behaviour';
  exception
    when others then if sqlerrm <> 'undo behaviour' then raise; end if;
  end;

  if (select count(*) from individual_scholar_search_history) <> before_rows then
    raise exception 'VERIFY-992: a probe row was kept';
  end if;
  raise notice 'VERIFY-992: PASS (objects, privileges, RLS, 24 shape probes, list, search, filters, isolation, remove, clear)';
end $$;
