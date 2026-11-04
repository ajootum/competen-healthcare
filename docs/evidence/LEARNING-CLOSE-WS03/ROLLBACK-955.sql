-- ROLLBACK for migration 955 (LEARNING-CLOSE-2026-11 WS03 LE-03). APPLY THIS FILE WHOLE.
-- Refuses while any re-cut has left a trace (a detached event or a lesson title), because dropping the columns would
-- silently re-count detached events as lesson progress and lose the learner's lesson names. Clear those first, knowingly.
do $$
begin
  if exists (select 1 from individual_scholar_learning_event where detached_at is not null) then
    raise exception 'ROLLBACK-955 refused: detached learning events exist';
  end if;
  if exists (select 1 from individual_scholar_learning_session where lesson_titles is not null) then
    raise exception 'ROLLBACK-955 refused: lesson titles exist';
  end if;
end $$;
drop function if exists public.individual_scholar_learning_session_recut(uuid, uuid, jsonb, jsonb);
drop index if exists individual_scholar_learning_event_session_step_idx;
alter table individual_scholar_learning_session drop constraint if exists individual_scholar_learning_session_lesson_titles_check;
alter table individual_scholar_learning_session drop column if exists lesson_titles;
alter table individual_scholar_learning_event drop column if exists detached_at;
notify pgrst, 'reload schema';
