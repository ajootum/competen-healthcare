-- VERIFY-1000. STAGING ONLY. Shape and behaviour probes. Run by run-staging-sql.mts with --rollback, so every row a probe
-- writes or removes is undone. Raises on the first failure.
do $$
declare
  u uuid; m uuid; c uuid; s uuid; n1 uuid; n2 uuid; n3 uuid; k1 uuid := gen_random_uuid(); r integer; t text; w text; v timestamptz;
begin
  -- shape
  if (select count(*) from information_schema.columns where table_name = 'individual_scholar_note' and column_name in ('title','tags','pinned_at','client_key','revision','section_label','section_anchor','captured_in','competency_id','study_id','was_on','search_tsv')) <> 12 then raise exception 'columns missing'; end if;
  if not public.individual_scholar_notebook_1000() then raise exception 'marker'; end if;
  if (select count(*) from pg_trigger where tgname in ('individual_scholar_note_detach_material','individual_scholar_note_detach_session') and not tgisinternal) <> 2 then raise exception 'detach triggers missing'; end if;
  if has_function_privilege('anon', 'public.individual_scholar_notebook_search(uuid, text, integer, integer)', 'execute') then raise exception 'search open to anon'; end if;
  if has_function_privilege('authenticated', 'public.individual_scholar_notebook_1000()', 'execute') then raise exception 'marker open to authenticated'; end if;
  if (select count(*) from pg_policies where tablename = 'individual_scholar_note') <> 1 then raise exception 'policy count changed'; end if;
  if not (select relrowsecurity from pg_class where oid = 'individual_scholar_note'::regclass) then raise exception 'rls off'; end if;

  -- a learner with a material and a chunk, used inside this transaction only
  select mm.user_id, mm.id, ch.id into u, m, c from individual_scholar_material mm join individual_scholar_chunk ch on ch.material_id = mm.id limit 1;
  if u is null then raise exception 'no learner with a chunk on staging'; end if;

  -- free note, with a client key
  insert into individual_scholar_note (user_id, target_kind, kind, body, client_key, title, tags, captured_in)
    values (u, 'free', 'note', 'Probe zxqvcephalo free note', k1, 'Probe title quokkaword', array['probetagzz'], 'home') returning id, revision into n1, r;
  if r <> 1 then raise exception 'revision should start at 1'; end if;

  -- free note with no client key is refused
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body) values (u, 'free', 'note', 'x');
    raise exception 'probe free_no_key was accepted';
  exception when check_violation then null; end;
  -- free highlight is refused
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, quote, client_key) values (u, 'free', 'highlight', 'x', gen_random_uuid());
    raise exception 'probe free_highlight was accepted';
  exception when check_violation then null; end;
  -- free note holding a material is refused
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body, client_key, material_id) values (u, 'free', 'note', 'x', gen_random_uuid(), m);
    raise exception 'probe free_with_material was accepted';
  exception when check_violation then null; end;
  -- same client key is refused (a retry finds the first)
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body, client_key) values (u, 'free', 'note', 'x', k1);
    raise exception 'probe duplicate_client_key was accepted';
  exception when unique_violation then null; end;
  -- 50000 characters are kept on a note, 50001 are not, and a summary keeps its 4000
  insert into individual_scholar_note (user_id, target_kind, kind, body, client_key) values (u, 'free', 'note', repeat('a', 50000), gen_random_uuid()) returning id into n2;
  begin
    update individual_scholar_note set body = repeat('a', 50001) where id = n2;
    raise exception 'probe body_50001 was accepted';
  exception when check_violation then null; end;
  begin
    insert into individual_scholar_note (user_id, target_kind, kind, body, material_id) values (u, 'material', 'summary', repeat('a', 4001), m);
    raise exception 'probe summary_4001 was accepted';
  exception when check_violation then null; end;
  -- tags, title, anchor limits
  begin
    update individual_scholar_note set tags = array['a','b','c','d','e','f','g','h','i','j','k','l','m'] where id = n1;
    raise exception 'probe tags_13 was accepted';
  exception when check_violation then null; end;
  begin
    update individual_scholar_note set title = '   ' where id = n1;
    raise exception 'probe blank_title was accepted';
  exception when check_violation then null; end;
  begin
    update individual_scholar_note set section_anchor = 'Bad Anchor' where id = n1;
    raise exception 'probe bad_anchor was accepted';
  exception when check_violation then null; end;

  -- revision rises, updated_at holds for a pin, client_key cannot change
  select revision, updated_at into r, v from individual_scholar_note where id = n1;
  update individual_scholar_note set pinned_at = now(), client_key = gen_random_uuid() where id = n1;
  if (select revision from individual_scholar_note where id = n1) <> r + 1 then raise exception 'revision did not rise'; end if;
  if (select updated_at from individual_scholar_note where id = n1) <> v then raise exception 'a pin moved updated_at'; end if;
  if (select client_key from individual_scholar_note where id = n1) <> k1 then raise exception 'client key changed'; end if;

  -- old shapes still work: a note on a section with no client key, a bookmark, a highlight
  insert into individual_scholar_note (user_id, target_kind, kind, body, material_id, chunk_id) values (u, 'section', 'note', 'old shape', m, c) returning id into n3;
  insert into individual_scholar_note (user_id, target_kind, kind, material_id, chunk_id) values (u, 'section', 'bookmark', m, c);
  insert into individual_scholar_note (user_id, target_kind, kind, quote, material_id) values (u, 'material', 'highlight', 'quoted', m);

  -- search: title, tag, body, by a part-typed word, one learner only
  if (select count(*) from public.individual_scholar_notebook_search(u, 'quokkaw', 10, 0)) <> 1 then raise exception 'prefix on title not found'; end if;
  if (select count(*) from public.individual_scholar_notebook_search(u, 'probetag', 10, 0)) <> 1 then raise exception 'tag not found'; end if;
  if (select count(*) from public.individual_scholar_notebook_search(u, 'zxqvceph', 10, 0)) <> 1 then raise exception 'prefix on body not found'; end if;
  if (select count(*) from public.individual_scholar_notebook_search(gen_random_uuid(), 'quokkaw', 10, 0)) <> 0 then raise exception 'another learner found it'; end if;
  if (select count(*) from public.individual_scholar_notebook_search(u, '''; drop table x; --', 10, 0)) <> 0 then raise exception 'odd query'; end if;
  if (select count(*) from public.individual_scholar_library_search(u, 'quokkaword', 10, 0) where kind = 'note') <> 1 then raise exception 'library search misses a title'; end if;
  if (select headline from public.individual_scholar_notebook_search(u, 'zxqvceph', 10, 0)) not like '%{{hl}}%' then raise exception 'headline unmarked'; end if;

  -- detach on a session delete: a probe session of this learner
  insert into individual_scholar_learning_session (user_id, title, scope_kind) values (u, 'Probe session', 'document') returning id into s;
  insert into individual_scholar_note (user_id, target_kind, kind, body, client_key, session_id, step, material_id, chunk_id, study_id)
    values (u, 'lesson', 'note', 'Lesson probe', gen_random_uuid(), s, 0, m, c, s) returning id into n2;
  insert into individual_scholar_note (user_id, target_kind, kind, body, session_id, step) values (u, 'lesson', 'note', 'Old lesson note goes', s, 0);
  delete from individual_scholar_learning_session where id = s;
  select target_kind into t from individual_scholar_note where id = n2;
  if t <> 'section' then raise exception 'session delete left target %', t; end if;
  if (select study_id from individual_scholar_note where id = n2) is not null then raise exception 'study_id kept'; end if;
  if exists (select 1 from individual_scholar_note where body = 'Old lesson note goes' and user_id = u) then raise exception 'an old lesson note should cascade as before'; end if;

  -- detach on a material delete: the notebook note stays, free, saying where it was. The old-shape note goes as before.
  delete from individual_scholar_material where id = m;
  select target_kind, was_on into t, w from individual_scholar_note where id = n2;
  if t <> 'free' or w is null then raise exception 'material delete left target % was_on %', t, w; end if;
  if exists (select 1 from individual_scholar_note where id = n3) then raise exception 'old-shape note should cascade'; end if;

  if not exists (select 1 from individual_scholar_note where id = n1) then raise exception 'free note gone'; end if;
  raise notice 'VERIFY-1000 PASS';
end $$;
