-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains one sql function and one DO block between dollar quotes.
-- A runner that splits on the statement separator would cut the function in half, so paste and run the entire
-- file at once.
-- ====================================================================================================
-- MIGRATION 985: SCHOLAR LEARNING-EFFECTIVENESS ANALYTICS FOR HQ -- CONSENTED, COHORT-SUPPRESSED, AGGREGATE ONLY
--
-- SALE-2026-11 release R5 (Optimisation), tracker row SALE-15 (learning-effectiveness analytics), feeding SALE-18 (the
-- pilot evaluation readout). Owner directive SALE-2026-11 s10.1 (outcome measures), s10.2 (evaluation approach), s13
-- (privacy). Build record: docs/evidence/SALE-R5/985-build-record.md.
--
-- WHY A FUNCTION. Every figure below is derived from learner records (414 learning events, 416 attempts, 950 kept
-- understanding checks with the R1 response.adaptive decision, 372 card reviews, 414 sessions). HQ must never read those
-- rows. Exactly as 441 ckri_build_snapshot and 996 ckri_library_item_stats do, the person never leaves the database:
--   * POPULATION. Only people whose collective_analytics permission (440, scope all) is granted when the function runs.
--     A withdrawn person is in no later figure.
--   * FLOOR. A cell describing fewer than greatest(5, p_min) distinct people is SUPPRESSED: its counts, rate and value
--     are null and cell_state is below_floor. A cell describing nobody is cell_state none. The floor is never below 5.
--   * ROUNDING. People, denominators and numerators are rounded to p_round (1, 5 or 10, the CKRI policy). Rates and the
--     efficiency value are computed from the exact counts INSIDE the function and returned rounded.
--   * FIXED COLUMNS. RETURNS TABLE with declared columns: no user id, no session id, no question, no answer, no text.
--   * EXECUTE: service_role only. Revoked from public, anon and authenticated.
--
-- WHAT IT ADDS (no table, no column, no row):
--   ckri_scholar_effectiveness_stats(p_since timestamptz, p_min int, p_round int)
--   one row per (measure, arm), always the full catalogue below, so a measure with no data reads none, never zero:
--     immediate_understanding / all       first kept understanding check of a lesson step, judged understood
--     corrective_followup / adaptive      the next check in the same lesson step after a MISSED check that carried an R1
--                                         adaptive decision (response.adaptive, need not understood): understood
--     corrective_followup / standard      the same, after a missed check WITHOUT an adaptive decision (the standard flow:
--                                         R1 off or before R1). Same item type, same lesson step, same marking: the only
--                                         comparison this function draws between flows
--     misconception_resolution / adaptive the adaptive follow-ups whose decision named a likely misconception
--     delayed_recall / questions          an answer to a question whose previous answer by the same learner was correct
--                                         5 to 10 days earlier (about 7 days): correct again
--     delayed_recall / flashcards         a card review whose previous review was 5 to 10 days earlier: remembered
--                                         (SM-2 quality 3 or more, flashcards.ts recallOf)
--     transfer / all                      first answer to an attempt the retention release marks as a transfer check
--                                         (response.transfer an object or true). None until R2 records them
--     independent_reasoning / all         first answer to an open reasoning format (extended, scenario, structured,
--                                         justification, interpretation, calculation): no key was disclosed before it
--     study_efficiency / all              correct first answers per estimated active hour (value). denominator = active
--                                         minutes: gaps between activity stamps up to 30 minutes each plus 5 minutes per
--                                         burst (the 910 dashboard rule). An estimate, never a measured open tab
--     friction / skips                    skip events per 100 teach events
--     friction / not_yet                  clarify verdicts not yet, of all clarify verdicts
--     friction / simplify                 simplify requests per 100 teach events
--     friction / unmarked_checks          kept checks with no judgement (AI unavailable or refused), of all kept checks
--     friction / reteach_cap              adaptive decisions that reached the re-teach cap, of all adaptive decisions
--     friction / stalled_sessions         Learn sessions started in the window, still active, idle over 7 days
--   Unmarked answers (950) are never answers: excluded from every outcome numerator and denominator except the
--   unmarked_checks signal that counts them.
--
-- FORMATIVE PRACTICE, NOT ASSESSMENT. These are pilot evaluation figures about the learning design. Nothing here is a
-- grade, a competence or a verified outcome, and engagement is not learning. No target is set here: the pilot sets the
-- baselines. Nothing reads a stem, a response text, feedback or an evaluator output (only response.kind, the adaptive
-- need, round, capped flags and the transfer marker).
--
-- FAIL CLOSED WITHOUT IT. The HQ readout calls this function only. Absent, it says not measured and shows no
-- learner-derived figure.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. DEPENDS ON 372, 414, 416, 440, 950.
-- Re-running it is a no-op. OPS-001 s8: proposed Low (one read-only function).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK: docs/evidence/SALE-R5/ROLLBACK-985.sql drops the function. Never refuses (no data depends on it).
-- ====================================================================================================


create or replace function public.ckri_scholar_effectiveness_stats(p_since timestamptz, p_min integer, p_round integer)
returns table (
  measure text, arm text, cell_state text, learners integer, denominator integer, numerator integer, rate integer, value numeric
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with params as (
    select greatest(5, coalesce(p_min, 10)) as floor_n,
           case when p_round in (1, 5, 10) then p_round else 5 end as round_to,
           coalesce(p_since, now() - interval '90 days') as since
  ),
  pop as (
    select distinct p.user_id from ckri_participation p
     where p.permission = 'collective_analytics' and p.scope_key = 'all' and p.status = 'granted'
  ),
  -- Every attempt of a consenting learner (all time: a delayed recall or a follow-up may build on an earlier answer).
  att_all as (
    select a.id, a.user_id, a.question_id, a.correct, a.answered_at, a.response,
           coalesce(a.marking, 'deterministic') <> 'unmarked' as marked,
           coalesce(jsonb_typeof(a.response) = 'object' and a.response ->> 'kind' = 'check', false) as is_check
      from individual_scholar_attempt a
     where a.user_id in (select user_id from pop)
  ),
  -- Kept understanding checks with their lesson step (the clarify event that judged them, 950).
  chk as (
    select a.*, e.session_id, e.step,
           lag(a.correct) over w as prev_correct,
           lag(a.marked) over w as prev_marked,
           lag(a.response -> 'adaptive') over w as prev_adaptive
      from att_all a
      left join individual_scholar_learning_event e on e.attempt_id = a.id and e.user_id = a.user_id and e.action = 'clarify'
     where a.is_check
    window w as (partition by a.user_id, e.session_id, e.step order by a.answered_at, a.id)
  ),
  chk_w as (select c.* from chk c, params pr where c.answered_at >= pr.since),
  -- The previous answer by the same learner to the same question (any kind), for delayed recall.
  seq as (
    select a.*, lag(a.correct) over w as prev_correct, lag(a.marked) over w as prev_marked, lag(a.answered_at) over w as prev_at,
           row_number() over w as nth
      from att_all a
    window w as (partition by a.user_id, a.question_id order by a.answered_at, a.id)
  ),
  seq_w as (select s.* from seq s, params pr where s.answered_at >= pr.since),
  fmt as (
    select s.user_id, s.correct, s.marked, s.nth, s.answered_at,
           case when q.kind = 'short' and jsonb_typeof(q.answer -> 'format') = 'string' then q.answer ->> 'format' else q.kind end as format,
           coalesce(jsonb_typeof(s.response -> 'transfer') = 'object' or (s.response -> 'transfer') = 'true'::jsonb, false) as is_transfer,
           s.is_check
      from seq_w s join individual_scholar_question q on q.id = s.question_id and q.user_id = s.user_id
  ),
  rev as (
    select r.user_id, r.quality, r.reviewed_at, lag(r.reviewed_at) over (partition by r.user_id, r.card_id order by r.reviewed_at, r.id) as prev_at
      from individual_scholar_review r
     where r.user_id in (select user_id from pop)
  ),
  ev as (
    select e.user_id, e.action, e.verdict, e.created_at
      from individual_scholar_learning_event e, params pr
     where e.user_id in (select user_id from pop) and e.created_at >= pr.since
  ),
  -- Activity stamps for the active-time estimate (the 910 rule: gaps up to 30 minutes, plus 5 minutes per burst).
  stamps as (
    select user_id, created_at as t from ev
    union all select s.user_id, s.answered_at from seq_w s
    union all select r.user_id, r.reviewed_at from rev r, params pr where r.reviewed_at >= pr.since
  ),
  gaps as (
    select user_id, extract(epoch from (t - lag(t) over (partition by user_id order by t))) as g from stamps
  ),
  active as (
    select user_id,
           (sum(case when g is null then 0 else least(g, 1800) end) + 300 * (count(*) filter (where g is null or g > 1800))) / 60.0 as minutes
      from gaps group by user_id
  ),
  cells as (
    -- immediate understanding: the first kept check of a lesson step (or, unlinked, one that followed no corrective step)
    select 'immediate_understanding' as measure, 'all' as arm, count(distinct user_id) as n_people, count(*) as den,
           count(*) filter (where correct) as num, null::numeric as val
      from chk_w
     where marked and ((session_id is not null and prev_correct is null)
                    or (session_id is null and coalesce(jsonb_typeof(response -> 'adaptive' -> 'follows'), 'null') <> 'object'))
    union all
    select 'corrective_followup',
           case when jsonb_typeof(prev_adaptive) = 'object' and coalesce(prev_adaptive ->> 'need', '') <> 'understood' then 'adaptive' else 'standard' end,
           count(distinct user_id), count(*), count(*) filter (where correct), null
      from chk_w
     where marked and session_id is not null and prev_marked is true and prev_correct is false
     group by 2
    union all
    select 'misconception_resolution', 'adaptive', count(distinct user_id), count(*), count(*) filter (where correct), null
      from chk_w
     where marked and session_id is not null and prev_marked is true and prev_correct is false
       and jsonb_typeof(prev_adaptive) = 'object' and prev_adaptive ->> 'need' = 'misconception'
    union all
    select 'delayed_recall', 'questions', count(distinct user_id), count(*), count(*) filter (where correct), null
      from seq_w
     where marked and prev_marked is true and prev_correct is true
       and answered_at - prev_at between interval '5 days' and interval '10 days'
    union all
    select 'delayed_recall', 'flashcards', count(distinct r.user_id), count(*), count(*) filter (where r.quality >= 3), null
      from rev r, params pr
     where r.reviewed_at >= pr.since and r.prev_at is not null
       and r.reviewed_at - r.prev_at between interval '5 days' and interval '10 days'
    union all
    select 'transfer', 'all', count(distinct user_id), count(*), count(*) filter (where correct), null
      from fmt where marked and nth = 1 and is_transfer
    union all
    select 'independent_reasoning', 'all', count(distinct user_id), count(*), count(*) filter (where correct), null
      from fmt
     where marked and nth = 1 and not is_check
       and format in ('extended', 'scenario', 'structured', 'justification', 'interpretation', 'calculation')
    union all
    select 'study_efficiency', 'all', count(*), coalesce(round(sum(a.minutes)), 0)::bigint,
           coalesce(sum(o.ok), 0)::bigint,
           case when sum(a.minutes) > 0 then coalesce(sum(o.ok), 0) / (sum(a.minutes) / 60.0) end
      from active a
      left join (select user_id, count(*) as ok from fmt where marked and nth = 1 and correct group by user_id) o on o.user_id = a.user_id
    union all
    select 'friction', 'skips', count(distinct user_id) filter (where action = 'teach'),
           count(*) filter (where action = 'teach'), count(*) filter (where action = 'skip'), null from ev
    union all
    select 'friction', 'not_yet', count(distinct user_id), count(*), count(*) filter (where verdict = 'not_yet'), null
      from ev where action = 'clarify' and verdict is not null
    union all
    select 'friction', 'simplify', count(distinct user_id) filter (where action = 'teach'),
           count(*) filter (where action = 'teach'), count(*) filter (where action = 'simplify'), null from ev
    union all
    select 'friction', 'unmarked_checks', count(distinct user_id), count(*), count(*) filter (where not marked), null from chk_w
    union all
    select 'friction', 'reteach_cap', count(distinct user_id), count(*),
           count(*) filter (where (response -> 'adaptive' ->> 'capped') = 'true'), null
      from chk_w where jsonb_typeof(response -> 'adaptive') = 'object'
    union all
    select 'friction', 'stalled_sessions', count(distinct s.user_id), count(*),
           count(*) filter (where s.status = 'active' and s.last_active_at < now() - interval '7 days'), null
      from individual_scholar_learning_session s, params pr
     where s.user_id in (select user_id from pop) and s.created_at >= pr.since
  ),
  catalogue (ord, measure, arm) as (
    values (1, 'immediate_understanding', 'all'), (2, 'corrective_followup', 'adaptive'), (3, 'corrective_followup', 'standard'),
           (4, 'misconception_resolution', 'adaptive'), (5, 'delayed_recall', 'questions'), (6, 'delayed_recall', 'flashcards'),
           (7, 'transfer', 'all'), (8, 'independent_reasoning', 'all'), (9, 'study_efficiency', 'all'),
           (10, 'friction', 'skips'), (11, 'friction', 'not_yet'), (12, 'friction', 'simplify'),
           (13, 'friction', 'unmarked_checks'), (14, 'friction', 'reteach_cap'), (15, 'friction', 'stalled_sessions')
  ),
  joined as (
    select k.ord, k.measure, k.arm, coalesce(c.n_people, 0) as n_people, coalesce(c.den, 0) as den, coalesce(c.num, 0) as num, c.val
      from catalogue k left join cells c on c.measure = k.measure and c.arm = k.arm
  )
  select j.measure, j.arm,
         case when j.n_people = 0 then 'none' when j.n_people < pr.floor_n then 'below_floor' else 'reported' end,
         case when j.n_people < pr.floor_n then null else (round(j.n_people::numeric / pr.round_to) * pr.round_to)::int end,
         case when j.n_people < pr.floor_n then null else (round(j.den::numeric / pr.round_to) * pr.round_to)::int end,
         case when j.n_people < pr.floor_n then null else (round(j.num::numeric / pr.round_to) * pr.round_to)::int end,
         case when j.n_people < pr.floor_n or j.den = 0 or j.measure = 'study_efficiency' then null else round(100.0 * j.num / j.den)::int end,
         case when j.n_people < pr.floor_n or j.val is null then null else round(j.val, 1) end
    from joined j cross join params pr
   order by j.ord
$$;


-- ---- who may call it ---------------------------------------------------------------------------------

revoke all on function public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer) from public;
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer) to service_role';
  end if;
end
$grants$;

comment on function public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer) is
  'SALE-2026-11 R5 SALE-15 (985). Learning-effectiveness aggregates per measure and arm, over learners with collective_analytics granted only, suppressed below greatest(5, p_min) learners, counts rounded to p_round. No identity, no content. Service role only.';

notify pgrst, 'reload schema';
