-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one plpgsql trigger function between dollar quotes. A runner that
-- splits on semicolons would cut the function body apart. Paste the whole file, or use scripts/apply-migrations.ts.
-- ====================================================================================================
-- MIGRATION 880: COMPETEN SCHOLAR -- CASE CONVERSATION AND HANDOVER NOTES (SCHOLAR-CE-2026, workstream CE-04)
--
-- Owner GO 2 Nov 2026, programme SCHOLAR-CE-2026, CE-04 "Conversational clinical simulation". Build record:
-- docs/evidence/CASE-CONVERSATION/880-build-record.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. ADDITIVE: one new table and one
-- trigger function. No existing table, column, CHECK, policy or row is changed. Re-running it is a no-op.
-- It depends on 435 and 436 (individual_scholar_case_session) and 423 (case_library_session). It contains two plpgsql functions.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT IS FOR.
--
-- individual_scholar_case_conversation. One append-only table for what the AI said around a case, kept beside the
-- attempt so the debrief can show it. Three kinds of entry, all on one session (a private play or a library play):
--
--   turn                 One exchange in "Talk to the patient": the learner question and the reply in the voice of the
--                        patient or caregiver, at the stage the learner was on. screened = the reply was replaced by the
--                        persona own statement that they do not know because it would have voiced something the persona may not know.
--   communication_note   At most one per session, once the case is completed: the short labelled AI note on how the
--                        learner talked with the patient, against the case key questions.
--   handover_note        At most one per handover decision: the optional labelled AI feedback on an SBAR handover. The
--                        handover itself is kept as a written answer exactly as other written answers are (435, 423),
--                        marked by code, and 435 cannot hold AI feedback beside a code mark, so the note sits here.
--
-- Why a table and not the attempt snapshot (810). The snapshot is written once, at completion, and never changed. A
-- conversation happens during play, before there is a snapshot, so it needs a home while the case is in progress. At
-- completion the snapshot builder copies the conversation into the attempt record, so the kept attempt carries it.
--
-- BOUNDED. The per-stage cap the learner meets is policy (scholar_case_conversation_turns, application side). The
-- database keeps a hard ceiling of 400 turns per session as a backstop, and refuses a turn on a completed session, a
-- turn at a stage the session has not reached, a second communication note, and a second note on one decision.
--
-- IMMUTABLE AND ERASABLE. The guard refuses UPDATE, and refuses DELETE except through a cascade (pg_trigger_depth()
-- greater than 1), so deleting a session, a case, a material or the learner still removes everything. The one other
-- way out is the owner erasure of the learner own study data: the function
-- individual_scholar_case_conversation_erase(user) below, callable only by the server role, sets a transaction-local
-- flag the guard honours and deletes that learner rows (this reaches library plays, whose sessions are not material).
--
-- SCOPE (owner ruling 2 Nov 2026, CE-04, ADR-016 D10 exception). Every row belongs to ONE learner attempt (the session)
-- and one STAGE of it (stage_id, required on a turn and checked against the stages the session reached). These are
-- practice records of that attempt, used only to show the debrief and to give feedback on that same attempt. They are
-- never the Personal AI memory and nothing reads them for another activity.
--
-- RLS on, one read-own SELECT policy. No table grants. Writes only from the server through the Scholar store.
--
-- FAIL CLOSED WITHOUT IT. While 880 is absent the panel says "Conversation unavailable" with the reason, the case plays
-- exactly as before, and nothing is kept.
--
-- FORMATIVE. Nothing here is assessment, competence or Passport evidence. The reply is simulated speech, not a fact.
--
-- Rollback: drop table individual_scholar_case_conversation, then drop function individual_scholar_case_conversation_guard
-- and function individual_scholar_case_conversation_erase.
-- It refuses nothing, but it deletes learner practice conversations, so take a copy first.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
-- ====================================================================================================


-- ---- 1. THE TABLE ---------------------------------------------------------------------------------------

create table if not exists individual_scholar_case_conversation (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  session_kind        text not null,
  private_session_id  uuid,
  library_session_id  uuid references case_library_session(id) on delete cascade,
  entry_kind          text not null,
  seq                 int not null default 0,
  stage_id            text,
  decision_point_id   text,
  question            text,
  reply               text not null,
  screened            boolean not null default false,
  model               text,
  prompt_version      text,
  created_at          timestamptz not null default now(),
  constraint individual_scholar_case_conversation_private_fk foreign key (private_session_id, user_id)
    references individual_scholar_case_session(id, user_id) on delete cascade
);

alter table individual_scholar_case_conversation drop constraint if exists individual_scholar_case_conversation_shape_check;
alter table individual_scholar_case_conversation add constraint individual_scholar_case_conversation_shape_check
  check (session_kind in ('private', 'library')
     and ((session_kind = 'private') = (private_session_id is not null))
     and ((session_kind = 'library') = (library_session_id is not null))
     and entry_kind in ('turn', 'communication_note', 'handover_note')
     and (stage_id is null or stage_id ~ '^[a-z][a-z0-9_-]{0,30}$')
     and (decision_point_id is null or decision_point_id ~ '^[a-z][a-z0-9_-]{0,30}$')
     and (model is null or char_length(model) between 1 and 200)
     and (prompt_version is null or char_length(prompt_version) between 1 and 200)
     and ((entry_kind = 'turn'
           and stage_id is not null and decision_point_id is null
           and question is not null and char_length(btrim(question)) between 1 and 400
           and char_length(btrim(reply)) between 1 and 600
           and (screened or model is not null))
       or (entry_kind = 'communication_note'
           and stage_id is null and decision_point_id is null and question is null and screened = false
           and char_length(btrim(reply)) between 20 and 1200 and model is not null)
       or (entry_kind = 'handover_note'
           and stage_id is null and decision_point_id is not null and question is null and screened = false
           and char_length(btrim(reply)) between 1 and 4000 and model is not null)));

create unique index if not exists ux_individual_scholar_case_conversation_private_seq
  on individual_scholar_case_conversation(private_session_id, seq);
create unique index if not exists ux_individual_scholar_case_conversation_library_seq
  on individual_scholar_case_conversation(library_session_id, seq);
create index if not exists idx_individual_scholar_case_conversation_user
  on individual_scholar_case_conversation(user_id, created_at desc);


-- ---- 2. THE GUARD ---------------------------------------------------------------------------------------

create or replace function public.individual_scholar_case_conversation_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  sess_status text;
  sess_reached jsonb;
  n int;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or coalesce(current_setting('competen.case_conversation_erase', true), '') = 'on' then
      return old;
    end if;
    raise exception 'case_conversation: an entry is never deleted, only removed with its session or by the owner erasure';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'case_conversation: an entry is kept as it was given';
  end if;

  -- The session must be this learner own. The row is locked so that two entries of one session are numbered one after the other.
  if new.session_kind = 'private' then
    select s.status, s.reached_stage_ids into sess_status, sess_reached
      from individual_scholar_case_session s
     where s.id = new.private_session_id and s.user_id = new.user_id and s.private_case_id is not null
       for update;
  else
    select s.status, to_jsonb(s.reached_stage_ids) into sess_status, sess_reached
      from case_library_session s
     where s.id = new.library_session_id and s.user_id = new.user_id
       for update;
  end if;
  if sess_status is null then
    raise exception 'case_conversation: the session is not this learner own';
  end if;

  if new.entry_kind = 'turn' then
    if sess_status = 'completed' then
      raise exception 'case_conversation: the case is finished, so there is no more conversation';
    end if;
    if not (sess_reached @> to_jsonb(new.stage_id)) then
      raise exception 'case_conversation: the session has not reached that stage';
    end if;
    select count(*) into n from individual_scholar_case_conversation c
     where c.entry_kind = 'turn'
       and ((new.session_kind = 'private' and c.private_session_id = new.private_session_id)
         or (new.session_kind = 'library' and c.library_session_id = new.library_session_id));
    if n >= 400 then
      raise exception 'case_conversation: the most turns a session can hold is reached';
    end if;
  elsif new.entry_kind = 'communication_note' then
    if sess_status <> 'completed' then
      raise exception 'case_conversation: the communication note comes when the case is finished';
    end if;
    if exists (select 1 from individual_scholar_case_conversation c
                where c.entry_kind = 'communication_note'
                  and ((new.session_kind = 'private' and c.private_session_id = new.private_session_id)
                    or (new.session_kind = 'library' and c.library_session_id = new.library_session_id))) then
      raise exception 'case_conversation: this session already has its communication note';
    end if;
  else
    if exists (select 1 from individual_scholar_case_conversation c
                where c.entry_kind = 'handover_note' and c.decision_point_id = new.decision_point_id
                  and ((new.session_kind = 'private' and c.private_session_id = new.private_session_id)
                    or (new.session_kind = 'library' and c.library_session_id = new.library_session_id))) then
      raise exception 'case_conversation: this handover already has its note';
    end if;
  end if;

  select coalesce(max(c.seq), 0) + 1 into n from individual_scholar_case_conversation c
   where (new.session_kind = 'private' and c.private_session_id = new.private_session_id)
      or (new.session_kind = 'library' and c.library_session_id = new.library_session_id);
  new.seq := n;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists individual_scholar_case_conversation_guard on individual_scholar_case_conversation;
create trigger individual_scholar_case_conversation_guard
  before insert or update or delete on individual_scholar_case_conversation
  for each row execute function public.individual_scholar_case_conversation_guard();

revoke execute on function public.individual_scholar_case_conversation_guard() from public, anon, authenticated;

-- The owner erasure of one learner conversation entries (the Scholar erase-all route calls it with the server role).
create or replace function public.individual_scholar_case_conversation_erase(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  n int;
begin
  perform set_config('competen.case_conversation_erase', 'on', true);
  delete from individual_scholar_case_conversation where user_id = p_user;
  get diagnostics n = row_count;
  perform set_config('competen.case_conversation_erase', 'off', true);
  return n;
end;
$$;

revoke execute on function public.individual_scholar_case_conversation_erase(uuid) from public, anon, authenticated;
grant execute on function public.individual_scholar_case_conversation_erase(uuid) to service_role;


-- ---- 3. RLS: READ OWN. Writes come only from the server, through the Scholar store. -------------------

alter table individual_scholar_case_conversation enable row level security;

drop policy if exists individual_scholar_case_conversation_read_own on individual_scholar_case_conversation;
create policy individual_scholar_case_conversation_read_own on individual_scholar_case_conversation
  for select using (auth.uid() = user_id);

comment on table individual_scholar_case_conversation is
  'SCHOLAR-CE-2026 CE-04 (880). What the AI said around a case, beside the attempt: Talk to the patient turns, the communication note, and the handover note. Append-only. Simulated and formative, never a fact or evidence.';

notify pgrst, 'reload schema';
