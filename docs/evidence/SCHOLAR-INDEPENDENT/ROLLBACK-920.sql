-- ROLLBACK-920: restore the 414 action list on individual_scholar_learning_event.
-- Refuses while any 'read' event exists (those rows would violate the restored CHECK). Remove them first by hand if
-- the owner decides to, never here.
do $$
begin
  if exists (select 1 from individual_scholar_learning_event where action = 'read') then
    raise exception 'ROLLBACK-920 refused: read events exist';
  end if;
end $$;
alter table individual_scholar_learning_event drop constraint if exists individual_scholar_learning_event_action_check;
alter table individual_scholar_learning_event add constraint individual_scholar_learning_event_action_check
  check (action in ('teach', 'explain', 'simplify', 'deeper', 'examples', 'summary', 'ask', 'check', 'clarify', 'skip', 'revisit', 'resume')
     and step >= 0
     and (verdict is null or (action = 'clarify' and verdict in ('understood', 'partly', 'not_yet'))));
notify pgrst, 'reload schema';
