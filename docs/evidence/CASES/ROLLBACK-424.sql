-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql between dollar quotes. A runner that splits on the
-- statement separator would cut it in half, so paste and run the entire file at once.
-- ====================================================================================================
-- ROLLBACK OF MIGRATION 424 (AI feedback and the debrief on a library case session). STAGING ONLY.
--
-- It restores the session guard of 423 BYTE FOR BYTE (generated from the 423 file), and drops the two columns, their
-- check and the helper 424 added.
--
-- It REFUSES, changing nothing, once any session holds feedback or a debrief. Dropping them would destroy a record
-- of AI evaluation a student was shown.
-- ====================================================================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'case_library_session' and column_name = 'feedback') then
    if exists (select 1 from case_library_session where jsonb_array_length(feedback) > 0 or debrief is not null) then
      raise exception 'ROLLBACK-424 refused: a session holds AI feedback or a debrief';
    end if;
  end if;
end $$;

create or replace function public.case_library_session_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if not case_library_deliverable(new.version_id) then
      raise exception 'case_library_session: only a published case approved for this exact version is delivered';
    end if;
    new.status := 'in_progress'; new.completed_at := null; new.started_at := now();
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.version_id is distinct from old.version_id or new.view_salt is distinct from old.view_salt
     or new.variation is distinct from old.variation or new.started_at is distinct from old.started_at then
    raise exception 'case_library_session: whose session, on which version, with which variation, cannot be rewritten';
  end if;
  if old.status <> 'in_progress' then raise exception 'case_library_session: a % session is closed', old.status; end if;
  if new.status = 'completed' then new.completed_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

alter table case_library_session drop constraint if exists case_library_session_feedback_check;
alter table case_library_session drop column if exists debrief;
alter table case_library_session drop column if exists feedback;
drop function if exists public.case_session_ai_entry_ok(jsonb, boolean);

notify pgrst, 'reload schema';
