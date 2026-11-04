-- ROLLBACK-975: restore the 840 plan-event CHECK and the 820 note kind CHECK exactly, and drop the 975 marker
-- (SALE-2026-11 R3). APPLY THIS FILE WHOLE (it holds a DO block).
-- Refuses while any next_action event or any summary note exists: the restored rules would refuse those rows, and they
-- are the learner's own records. Removing them is an owner decision made by hand, never here.
do $$
begin
  if exists (select 1 from individual_learning_plan_event where kind = 'next_action') then
    raise exception 'ROLLBACK-975 refused: next_action plan events exist';
  end if;
  if exists (select 1 from individual_scholar_note where kind = 'summary') then
    raise exception 'ROLLBACK-975 refused: summary notes exist';
  end if;
end $$;

alter table individual_learning_plan_event drop constraint if exists individual_learning_plan_event_check;
alter table individual_learning_plan_event add constraint individual_learning_plan_event_check
  check (experience in ('scholar', 'professional')
     and kind in ('proposal', 'topic_postponed', 'recommendation_declined', 'reflection', 'settings_change', 'auto_adjust')
     and char_length(ref) between 1 and 200
     and (status is null or status in ('accepted', 'declined', 'deferred', 'applied', 'undone'))
     and jsonb_typeof(value) = 'object'
     and octet_length(value::text) <= 8000);

alter table individual_scholar_note drop constraint if exists individual_scholar_note_kind_check;
alter table individual_scholar_note add constraint individual_scholar_note_kind_check
  check (kind in ('note', 'bookmark', 'highlight')
     and (kind <> 'note' or (body is not null and char_length(btrim(body)) between 1 and 4000 and quote is null))
     and (kind <> 'bookmark' or (body is null and quote is null))
     and (kind <> 'highlight' or (quote is not null and char_length(btrim(quote)) between 1 and 500
          and (body is null or char_length(btrim(body)) between 1 and 4000))));

drop function if exists public.individual_scholar_workspace_975();

notify pgrst, 'reload schema';
