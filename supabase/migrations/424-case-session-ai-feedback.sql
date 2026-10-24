-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 424: AI REASONING FEEDBACK AND THE DEBRIEF ON A LIBRARY CASE SESSION
--
-- COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CR4 and COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s10 (C4). Coordinator decision on
-- the Stage 5A session overlap, option (a): ONE session record for a library play. Scholar never keeps a second store
-- of it. Coordinator range 421-424. Depends on 423. Fixes forward: 423 is frozen and its file is not edited.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Two columns on case_library_session, one helper function, and the session guard
-- of 423 REPLACED (everything it froze stays frozen). Re-running it is a no-op. OPS-001 s8: proposed Low-Medium (a
-- replaced guard on an empty-in-production table), with a rollback rehearsal.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets the AI feedback a student asks for on an answered decision, and the end-of-case debrief, live on the one
-- session record of a library play, marked as AI evaluation with the provider, model and request that produced it,
-- appended and never rewritten -- so it can never read as an approval, a mark of competence, or a changed answer.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT MAKES UNREPRESENTABLE.
--
--   Feedback that claims to be anything else.   Every entry has kind ai_evaluation and names its provider, model and
--                                               request (case_session_ai_entry_ok). A debrief likewise.
--   Feedback on a decision not answered.        An entry names a decision point the session has answered.
--   Rewritten or removed feedback.              feedback is append-only: what was there stays, in order.
--   A rewritten debrief.                        Set once, only on a completed session, then fixed.
--   A changed play.                             A closed session still freezes its stages, facts, answers, safety
--                                               events, status and completion. Only feedback and the debrief move.
--
--   No charge is made here. The AI call is charged to the student as their own learning (the workflow case.live_with_stored) and is metered by the ledger.
--
-- RLS: unchanged (on, no policy). Execute on the helper: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CASES/ROLLBACK-424.sql restores the session guard of 423 byte for byte and drops
--   the two columns and the helper. It refuses once any feedback or debrief exists.
-- ====================================================================================================


alter table case_library_session add column if not exists feedback jsonb not null default '[]'::jsonb;
alter table case_library_session add column if not exists debrief jsonb;
alter table case_library_session drop constraint if exists case_library_session_feedback_check;
alter table case_library_session add constraint case_library_session_feedback_check
  check (jsonb_typeof(feedback) = 'array' and (debrief is null or jsonb_typeof(debrief) = 'object'));

-- One AI-evaluation entry: what it is, what produced it, and its text. p_feedback says whether it must name a decision.
create or replace function public.case_session_ai_entry_ok(e jsonb, p_feedback boolean)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_typeof(e) = 'object'
     and e ->> 'kind' = 'ai_evaluation'
     and char_length(coalesce(e ->> 'provider', '')) between 1 and 40
     and char_length(coalesce(e ->> 'model', '')) between 1 and 120
     and char_length(coalesce(e ->> 'requestId', '')) between 8 and 200
     and char_length(coalesce(e ->> 'text', '')) between 1 and 8000
     and char_length(coalesce(e ->> 'at', '')) between 10 and 40
     and (not p_feedback or char_length(coalesce(e ->> 'decisionPointId', '')) between 1 and 31)
$$;

create or replace function public.case_library_session_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_old int;
  v_new int;
  e jsonb;
begin
  if tg_op = 'INSERT' then
    if not case_library_deliverable(new.version_id) then
      raise exception 'case_library_session: only a published case approved for this exact version is delivered';
    end if;
    new.status := 'in_progress'; new.completed_at := null; new.started_at := now();
    new.feedback := '[]'::jsonb; new.debrief := null;
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.version_id is distinct from old.version_id or new.view_salt is distinct from old.view_salt
     or new.variation is distinct from old.variation or new.started_at is distinct from old.started_at then
    raise exception 'case_library_session: whose session, on which version, with which variation, cannot be rewritten';
  end if;

  -- AI feedback (424): append-only, each entry an AI evaluation on a decision this session has answered.
  v_old := jsonb_array_length(old.feedback);
  v_new := jsonb_array_length(new.feedback);
  if v_new < v_old or (v_old > 0 and (select jsonb_agg(x.e order by x.i) from jsonb_array_elements(new.feedback) with ordinality as x(e, i) where x.i <= v_old) is distinct from old.feedback) then
    raise exception 'case_library_session: AI feedback is append-only';
  end if;
  for e in select x.e from jsonb_array_elements(new.feedback) with ordinality as x(e, i) where x.i > v_old loop
    if not case_session_ai_entry_ok(e, true) then
      raise exception 'case_library_session: feedback must be an AI evaluation naming its provider, model and request';
    end if;
    if not exists (select 1 from jsonb_array_elements(new.answers) as a(x) where a.x ->> 'decisionPointId' = e ->> 'decisionPointId') then
      raise exception 'case_library_session: feedback is only on a decision this session has answered';
    end if;
  end loop;

  -- The debrief (424): once, on a completed session, an AI evaluation, then fixed.
  if old.debrief is not null and new.debrief is distinct from old.debrief then
    raise exception 'case_library_session: the debrief is written once';
  end if;
  if old.debrief is null and new.debrief is not null then
    if new.status <> 'completed' then raise exception 'case_library_session: the debrief comes at the end of the case'; end if;
    if not case_session_ai_entry_ok(new.debrief, false) then
      raise exception 'case_library_session: the debrief must be an AI evaluation naming its provider, model and request';
    end if;
  end if;

  if old.status <> 'in_progress' then
    -- A closed session: only feedback and the debrief may move. The play itself is the record.
    if new.status is distinct from old.status or new.completed_at is distinct from old.completed_at or new.reached_stage_ids is distinct from old.reached_stage_ids
       or new.revealed_fact_ids is distinct from old.revealed_fact_ids or new.answers is distinct from old.answers or new.safety_events is distinct from old.safety_events then
      raise exception 'case_library_session: a % session is closed', old.status;
    end if;
    new.updated_at := now();
    return new;
  end if;
  if new.status = 'completed' then new.completed_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.case_session_ai_entry_ok(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.case_session_ai_entry_ok(jsonb, boolean) to service_role;


-- Verification: the columns, and the guard in place.
select column_name, data_type, is_nullable from information_schema.columns
 where table_name = 'case_library_session' and column_name in ('feedback', 'debrief') order by 1;

select tgname from pg_trigger where tgname = 'case_library_session_guard';

notify pgrst, 'reload schema';
