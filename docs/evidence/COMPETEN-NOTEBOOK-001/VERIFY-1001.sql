-- VERIFY-1001. STAGING ONLY. Shape and behaviour probes. Run by run-staging-sql.mts with --rollback, so every row a probe writes is undone.
do $$
declare
  u uuid; m uuid; n1 uuid; n2 uuid; r integer;
begin
  if (select count(*) from information_schema.columns where table_name = 'individual_scholar_note' and column_name = 'topic') <> 1 then raise exception 'topic column missing'; end if;
  if not public.individual_scholar_notebook_1001() then raise exception 'marker'; end if;
  if has_function_privilege('anon', 'public.individual_scholar_notebook_1001()', 'execute') then raise exception 'marker open to anon'; end if;
  if has_function_privilege('authenticated', 'public.individual_scholar_notebook_search(uuid, text, integer, integer)', 'execute') then raise exception 'search open to authenticated'; end if;
  if (select count(*) from pg_policies where tablename = 'individual_scholar_note') <> 1 then raise exception 'policy count changed'; end if;

  select mm.user_id, mm.id into u, m from individual_scholar_material mm limit 1;
  if u is null then raise exception 'no learner on staging'; end if;

  -- a topic note, optional and on nothing else
  insert into individual_scholar_note (user_id, target_kind, kind, body, client_key, topic)
    values (u, 'topic', 'note', 'Probe topic note', gen_random_uuid(), 'Wombatword milestones') returning id into n1;

  -- no topic on a topic note is refused
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body, client_key) values (u, 'topic', 'note', 'x', gen_random_uuid());
    raise exception 'probe topic_without_words was accepted';
  exception when check_violation then null; end;
  -- a topic on a note that is not on a topic is refused
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body, client_key, topic) values (u, 'free', 'note', 'x', gen_random_uuid(), 'A topic');
    raise exception 'probe free_with_topic was accepted';
  exception when check_violation then null; end;
  -- too short, too long
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body, client_key, topic) values (u, 'topic', 'note', 'x', gen_random_uuid(), 'a');
    raise exception 'probe topic_short was accepted';
  exception when check_violation then null; end;
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body, client_key, topic) values (u, 'topic', 'note', 'x', gen_random_uuid(), repeat('a', 121));
    raise exception 'probe topic_long was accepted';
  exception when check_violation then null; end;
  -- only a note written through the Notebook
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body, topic) values (u, 'topic', 'note', 'x', 'A topic');
    raise exception 'probe topic_no_key was accepted';
  exception when check_violation then null; end;
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, quote, client_key, topic) values (u, 'topic', 'highlight', 'x', gen_random_uuid(), 'A topic');
    raise exception 'probe topic_highlight was accepted';
  exception when check_violation then null; end;
  -- a topic note holds no other target
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body, client_key, topic, material_id) values (u, 'topic', 'note', 'x', gen_random_uuid(), 'A topic', m);
    raise exception 'probe topic_with_material was accepted';
  exception when check_violation then null; end;

  -- found by its topic, by a part-typed word, one learner only. Marked in the snippet.
  if (select count(*) from public.individual_scholar_notebook_search(u, 'wombatw', 10, 0)) <> 1 then raise exception 'topic not found'; end if;
  if (select count(*) from public.individual_scholar_notebook_search(gen_random_uuid(), 'wombatw', 10, 0)) <> 0 then raise exception 'another learner found it'; end if;
  if (select headline from public.individual_scholar_notebook_search(u, 'wombatw', 10, 0)) not like '%{{hl}}%' then raise exception 'headline unmarked'; end if;

  -- moves to free-standing and back, and the revision rises
  select revision into r from individual_scholar_note where id = n1;
  update individual_scholar_note set target_kind = 'free', topic = null where id = n1;
  update individual_scholar_note set target_kind = 'topic', topic = 'Again' where id = n1;
  if (select revision from individual_scholar_note where id = n1) <> r + 2 then raise exception 'revision did not rise'; end if;

  -- the 1000 shapes still work
  insert into individual_scholar_note (user_id, target_kind, kind, body, client_key) values (u, 'free', 'note', 'free still works', gen_random_uuid()) returning id into n2;
  insert into individual_scholar_note (user_id, target_kind, kind, body, material_id) values (u, 'material', 'note', 'an older shape still works', m);

  -- a topic note survives its learner's material going, because it is not on it
  delete from individual_scholar_material where id = m;
  if not exists (select 1 from individual_scholar_note where id = n1 and target_kind = 'topic') then raise exception 'topic note gone with a material'; end if;
  raise notice 'VERIFY-1001 PASS';
end $$;
