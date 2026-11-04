-- VERIFY-975 (SALE-2026-11 R3, the learning workspace). APPLY THIS FILE WHOLE (it holds a DO block). STAGING.
-- Raises on the first failure. Every probe row is written inside a sub-block that is then undone (raise, caught), so
-- nothing is kept. Passing = the runner says Committed.
do $$
declare
  u uuid;
  m uuid;
  probe text;
  ok boolean;
  def text;
  accepted boolean;
  before_events bigint;
  before_notes bigint;
begin
  -- objects
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'individual_learning_plan_event_check');
  if def is null or def not like '%next_action%' or def not like '%auto_adjust%' or def not like '%8000%' then
    raise exception 'VERIFY-975: the 840 event CHECK does not carry next_action with the 840 kinds and the 8000 budget';
  end if;
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'individual_scholar_note_kind_check');
  if def is null or def not like '%summary%' or def not like '%highlight%' or def not like '%500%' then
    raise exception 'VERIFY-975: the 820 note kind CHECK does not carry summary with the 820 kinds';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_scholar_note'::regclass and contype = 'c') <> 2 then
    raise exception 'VERIFY-975: expected exactly two CHECK constraints on individual_scholar_note';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.individual_learning_plan_event'::regclass and contype = 'c') <> 1 then
    raise exception 'VERIFY-975: expected exactly one CHECK constraint on individual_learning_plan_event';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'individual_scholar_workspace_975' and not p.prosecdef) then
    raise exception 'VERIFY-975: marker function missing or security definer';
  end if;
  if not has_function_privilege('service_role', 'public.individual_scholar_workspace_975()', 'execute')
     or has_function_privilege('anon', 'public.individual_scholar_workspace_975()', 'execute')
     or has_function_privilege('authenticated', 'public.individual_scholar_workspace_975()', 'execute') then
    raise exception 'VERIFY-975: marker execute must be service_role only';
  end if;
  if public.individual_scholar_workspace_975() is distinct from true then
    raise exception 'VERIFY-975: marker does not return true';
  end if;
  -- RLS posture unchanged
  if not (select relrowsecurity from pg_class where oid = 'public.individual_scholar_note'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.individual_learning_plan_event'::regclass) then
    raise exception 'VERIFY-975: RLS is not enabled on both tables';
  end if;

  select n.user_id, n.material_id into u, m from individual_scholar_note n where n.material_id is not null limit 1;
  if u is null then
    select x.user_id, x.id into u, m from individual_scholar_material x limit 1;
  end if;
  if u is null then
    raise exception 'VERIFY-975: no learner material to probe with';
  end if;
  select count(*) into before_events from individual_learning_plan_event;
  select count(*) into before_notes from individual_scholar_note;

  for probe, ok in
    select v.p, v.o from (values
      ('event_next_action_accepted', true), ('event_next_action_deferred', true), ('event_next_action_declined', true),
      ('event_proposal_still', true), ('event_unknown_kind', false), ('event_next_action_bad_status', false),
      ('event_next_action_array_value', false), ('event_next_action_long_ref', false),
      ('note_summary', true), ('note_summary_empty', false), ('note_summary_with_quote', false), ('note_summary_too_long', false),
      ('note_note_still', true), ('note_bookmark_still', true), ('note_highlight_still', true), ('note_unknown_kind', false)
    ) as v(p, o)
  loop
    accepted := false;
    begin
      case probe
        when 'event_next_action_accepted' then insert into individual_learning_plan_event(user_id, experience, kind, ref, status, value) values (u, 'scholar', 'next_action', 'nba:retrieval:due', 'accepted', '{"fingerprint":"due:3"}');
        when 'event_next_action_deferred' then insert into individual_learning_plan_event(user_id, experience, kind, ref, status, value) values (u, 'scholar', 'next_action', 'nba:retrieval:due', 'deferred', '{"until":"2026-11-05"}');
        when 'event_next_action_declined' then insert into individual_learning_plan_event(user_id, experience, kind, ref, status, value) values (u, 'scholar', 'next_action', 'nba:retrieval:due', 'declined', '{}');
        when 'event_proposal_still' then insert into individual_learning_plan_event(user_id, experience, kind, ref, status, value) values (u, 'scholar', 'proposal', 'probe', 'accepted', '{}');
        when 'event_unknown_kind' then insert into individual_learning_plan_event(user_id, experience, kind, ref, status, value) values (u, 'scholar', 'next_actions', 'probe', 'accepted', '{}');
        when 'event_next_action_bad_status' then insert into individual_learning_plan_event(user_id, experience, kind, ref, status, value) values (u, 'scholar', 'next_action', 'probe', 'snoozed', '{}');
        when 'event_next_action_array_value' then insert into individual_learning_plan_event(user_id, experience, kind, ref, status, value) values (u, 'scholar', 'next_action', 'probe', 'declined', '[]');
        when 'event_next_action_long_ref' then insert into individual_learning_plan_event(user_id, experience, kind, ref, status, value) values (u, 'scholar', 'next_action', repeat('x', 201), 'declined', '{}');
        when 'note_summary' then insert into individual_scholar_note(user_id, target_kind, material_id, kind, body) values (u, 'material', m, 'summary', 'My own summary.');
        when 'note_summary_empty' then insert into individual_scholar_note(user_id, target_kind, material_id, kind, body) values (u, 'material', m, 'summary', '   ');
        when 'note_summary_with_quote' then insert into individual_scholar_note(user_id, target_kind, material_id, kind, body, quote) values (u, 'material', m, 'summary', 'Summary', 'a quote');
        when 'note_summary_too_long' then insert into individual_scholar_note(user_id, target_kind, material_id, kind, body) values (u, 'material', m, 'summary', repeat('a', 4001));
        when 'note_note_still' then insert into individual_scholar_note(user_id, target_kind, material_id, kind, body) values (u, 'material', m, 'note', 'A note.');
        when 'note_bookmark_still' then insert into individual_scholar_note(user_id, target_kind, material_id, kind) values (u, 'material', m, 'bookmark');
        when 'note_highlight_still' then insert into individual_scholar_note(user_id, target_kind, material_id, kind, quote) values (u, 'material', m, 'highlight', 'quoted');
        when 'note_unknown_kind' then insert into individual_scholar_note(user_id, target_kind, material_id, kind, body) values (u, 'material', m, 'summaries', 'x');
      end case;
      accepted := true;
      raise exception 'undo probe';
    exception
      when check_violation then accepted := false;
      when unique_violation then accepted := true;
      when others then if sqlerrm <> 'undo probe' then raise; end if;
    end;
    if accepted is distinct from ok then
      raise exception 'VERIFY-975: probe % was %, expected %', probe, case when accepted then 'accepted' else 'refused' end, case when ok then 'accepted' else 'refused' end;
    end if;
  end loop;

  if (select count(*) from individual_learning_plan_event) <> before_events or (select count(*) from individual_scholar_note) <> before_notes then
    raise exception 'VERIFY-975: a probe row was kept';
  end if;
  raise notice 'VERIFY-975: PASS (objects, privileges, RLS, 16 probes)';
end $$;
