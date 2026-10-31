-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one plpgsql function between dollar quotes.
-- ====================================================================================================
-- MIGRATION 790: COMPETEN SCHOLAR -- LEARNING POSITION ACROSS DEVICES (SCHOLAR-CONTINUITY-01, item 1)
--
-- Owner GO 31 Oct 2026, "Scholar Learning Continuity and Assessment Attempt Integrity", items 1 and 2.
--
-- WHAT IT ADDS. One small table, individual_scholar_learning_position, one row per learner and Learn session
-- (primary key user_id, session_id), and one write function that applies the stale-write rule. The 414 session
-- keeps current_step exactly as it is. Nothing existing is altered, no row is written, no backfill.
--
-- THE ROW. step (where the learner stopped, a 414 step number), furthest_step (the furthest lesson reached, a
-- grow-only maximum), card_id (a stable lesson id such as lesson-3 or lesson-3:practice), section_chunk_id (the
-- first section of that lesson, a hint only, no foreign key so removing notes is never blocked), offset_hint (0 to
-- 100, a coarse place within the lesson), last_completed_activity and last_completed_at (the latest learning mark),
-- unfinished (a small object, at most 4000 bytes, for practice state such as which practice panel was open -- NEVER
-- AI output and never notes content), device_id (random per browser), client_seq (a per-device sequence),
-- client_updated_at (the device clock when the move was made), revision (a server counter, one per accepted
-- change) and updated_at (the database clock).
--
-- THE STALE-WRITE RULE (individual_scholar_learning_position_put, mirrored by learn-position.ts decidePositionWrite).
-- A write is ACCEPTED when one of these holds, checked in this order:
--   1. there is no row yet (first)
--   2. the stored row came from the SAME device and the incoming client_seq is greater (same_device). A device own
--      moves arrive in order, so a deliberate jump back on the device in use is recorded, and a late duplicate or an
--      out-of-order retry from that device is not.
--   3. the writer had SEEN the stored row: its base_revision equals the stored revision (informed). A device that has
--      loaded the latest position may move anywhere, back as well as on.
--   4. otherwise the writer is stale, and it is accepted only as PROGRESS: its client_updated_at is later than the
--      stored one AND (its step is greater than the stored step OR its completed activity is newer than the stored
--      one) (progress).
-- Anything else is REJECTED (stale) and changes nothing but furthest_step, which is a grow-only maximum merged from
-- every write. So a stale device can never move the learner back or forget a later completion, while the latest
-- device always can. Device clocks are only ever compared with device clocks, and only in rule 4, where a skewed
-- clock can at most decide whether an ADVANCE is taken, never cause a regression.
--
-- PRIVATE AND ERASABLE. Composite foreign key (session_id, user_id) onto the learner own 414 session, ON DELETE
-- CASCADE, so a position under another learner session is unstorable and goes with the session. RLS read-own. No
-- table grants. The function is SECURITY INVOKER and executable by service_role only: it is called by the Scholar
-- store, keyed on the caller own user id, exactly as every other Scholar write.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 414 only.
-- Re-running it is a no-op. Rollback: ROLLBACK-790.sql (refuses while any position row exists).
--
-- FAIL CLOSED WITHOUT IT. While 790 is absent the store reports the position as not provisioned and Learn keeps the
-- device-only copy it has always kept, with no error to the learner.
--
-- NOT COMPETENCE. A learning position is a bookmark. It is never assessment evidence or a Passport record.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. notify pgrst last.
-- ====================================================================================================

-- ---- 1. THE POSITION ---------------------------------------------------------------------------------

create table if not exists individual_scholar_learning_position (
  user_id                  uuid not null,
  session_id               uuid not null,
  step                     integer not null,
  furthest_step            integer not null,
  card_id                  text not null,
  section_chunk_id         uuid,
  offset_hint              smallint,
  last_completed_activity  text,
  last_completed_at        timestamptz,
  unfinished               jsonb,
  device_id                text not null,
  client_seq               bigint not null,
  client_updated_at        timestamptz not null,
  revision                 bigint not null default 1,
  updated_at               timestamptz not null default now(),
  constraint individual_scholar_learning_position_pk primary key (user_id, session_id),
  constraint individual_scholar_learning_position_session_fk foreign key (session_id, user_id)
    references individual_scholar_learning_session(id, user_id) on delete cascade
);

alter table individual_scholar_learning_position drop constraint if exists individual_scholar_learning_position_shape_check;
alter table individual_scholar_learning_position add constraint individual_scholar_learning_position_shape_check
  check (step between 0 and 10000
     and furthest_step between step and 10000
     and card_id ~ '^[a-z0-9][a-z0-9:_-]{0,59}$'
     and (offset_hint is null or offset_hint between 0 and 100)
     and (last_completed_activity is null or last_completed_activity ~ '^[a-z0-9][a-z0-9:_-]{0,59}$')
     and ((last_completed_activity is null) = (last_completed_at is null))
     and (unfinished is null or (jsonb_typeof(unfinished) = 'object' and octet_length(unfinished::text) <= 4000))
     and device_id ~ '^[A-Za-z0-9_-]{8,64}$'
     and client_seq >= 0
     and revision >= 1);

-- ---- 2. THE WRITE, WITH THE STALE-WRITE RULE -------------------------------------------------------------

create or replace function public.individual_scholar_learning_position_put(
  p_user_id uuid, p_session_id uuid, p_device_id text, p_client_seq bigint, p_base_revision bigint,
  p_client_updated_at timestamptz, p_step integer, p_furthest_step integer, p_card_id text, p_section_chunk_id uuid,
  p_offset_hint smallint, p_last_completed_activity text, p_last_completed_at timestamptz, p_unfinished jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  cur individual_scholar_learning_position%rowtype;
  ok boolean;
  why text;
  newer_completion boolean;
begin
  if p_user_id is null or p_session_id is null or p_device_id is null or p_client_seq is null
     or p_client_updated_at is null or p_step is null or p_card_id is null then
    raise exception 'learning_position: user, session, device, sequence, time, step and card are required';
  end if;

  insert into individual_scholar_learning_position (user_id, session_id, step, furthest_step, card_id, section_chunk_id,
      offset_hint, last_completed_activity, last_completed_at, unfinished, device_id, client_seq, client_updated_at,
      revision, updated_at)
    values (p_user_id, p_session_id, p_step, greatest(p_step, coalesce(p_furthest_step, p_step)), p_card_id, p_section_chunk_id,
      p_offset_hint, p_last_completed_activity, p_last_completed_at, p_unfinished, p_device_id, p_client_seq, p_client_updated_at,
      1, now())
    on conflict (user_id, session_id) do nothing;
  if found then
    select * into cur from individual_scholar_learning_position where user_id = p_user_id and session_id = p_session_id;
    return jsonb_build_object('accepted', true, 'reason', 'first', 'position', to_jsonb(cur));
  end if;

  select * into cur from individual_scholar_learning_position
   where user_id = p_user_id and session_id = p_session_id for update;

  newer_completion := p_last_completed_at is not null
    and (cur.last_completed_at is null or p_last_completed_at > cur.last_completed_at);

  if p_device_id = cur.device_id then
    ok := p_client_seq > cur.client_seq;
    why := case when ok then 'same_device' else 'stale' end;
  elsif p_base_revision is not null and p_base_revision = cur.revision then
    ok := true;
    why := 'informed';
  elsif p_client_updated_at > cur.client_updated_at and (p_step > cur.step or newer_completion) then
    ok := true;
    why := 'progress';
  else
    ok := false;
    why := 'stale';
  end if;

  if ok then
    update individual_scholar_learning_position set
        step = p_step,
        furthest_step = greatest(cur.furthest_step, coalesce(p_furthest_step, p_step), p_step),
        card_id = p_card_id,
        section_chunk_id = p_section_chunk_id,
        offset_hint = p_offset_hint,
        last_completed_activity = case when newer_completion then p_last_completed_activity else cur.last_completed_activity end,
        last_completed_at = case when newer_completion then p_last_completed_at else cur.last_completed_at end,
        unfinished = p_unfinished,
        device_id = p_device_id,
        client_seq = p_client_seq,
        client_updated_at = p_client_updated_at,
        revision = cur.revision + 1,
        updated_at = now()
      where user_id = p_user_id and session_id = p_session_id
      returning * into cur;
  elsif greatest(coalesce(p_furthest_step, p_step), p_step) > cur.furthest_step then
    -- A stale write never moves the learner, but the furthest lesson reached only ever grows.
    update individual_scholar_learning_position set
        furthest_step = greatest(coalesce(p_furthest_step, p_step), p_step),
        revision = cur.revision + 1,
        updated_at = now()
      where user_id = p_user_id and session_id = p_session_id
      returning * into cur;
  end if;

  return jsonb_build_object('accepted', ok, 'reason', why, 'position', to_jsonb(cur));
end;
$$;

revoke execute on function public.individual_scholar_learning_position_put(uuid, uuid, text, bigint, bigint, timestamptz, integer, integer, text, uuid, smallint, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.individual_scholar_learning_position_put(uuid, uuid, text, bigint, bigint, timestamptz, integer, integer, text, uuid, smallint, text, timestamptz, jsonb) to service_role;

-- ---- RLS: READ OWN, as 414. Writes come only from the server, through the Scholar store. ------------------

alter table individual_scholar_learning_position enable row level security;

drop policy if exists individual_scholar_learning_position_read_own on individual_scholar_learning_position;
create policy individual_scholar_learning_position_read_own on individual_scholar_learning_position
  for select using (auth.uid() = user_id);

comment on table individual_scholar_learning_position is
  'SCHOLAR-CONTINUITY-01 (790). Where the learner stopped in one Learn session, across devices. Written only through individual_scholar_learning_position_put, which refuses a stale device regression. A bookmark, never assessment evidence.';
comment on column individual_scholar_learning_position.unfinished is
  'SCHOLAR-CONTINUITY-01 (790). Small practice state (at most 4000 bytes), such as which practice panel was open. Never AI output and never notes content.';
comment on column individual_scholar_learning_position.furthest_step is
  'SCHOLAR-CONTINUITY-01 (790). The furthest lesson reached, a grow-only maximum merged from every write, accepted or not.';
comment on function public.individual_scholar_learning_position_put(uuid, uuid, text, bigint, bigint, timestamptz, integer, integer, text, uuid, smallint, text, timestamptz, jsonb) is
  'SCHOLAR-CONTINUITY-01 (790). Upsert one learning position under the stale-write rule (first, same_device, informed, progress, else stale). Returns accepted, reason and the stored position. service_role only.';

notify pgrst, 'reload schema';
