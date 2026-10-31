-- SCHOLAR-GUIDED-LEARNING-01: guided-learning metrics from EXISTING tables only. READ ONLY: selects, no writes.
-- Sources: audit_log (ai_assistant_query rows for entity individual_scholar_learn = a generation; scholar_learn_served
-- = a lesson served from its saved artefact, no AI; scholar_learn_inflight = dedupe start and end rows),
-- plat_ai_requests (cost and model latency, joined by action_id), plat_ai_outcomes (accepted, partial, rejected),
-- individual_scholar_learning_event and individual_scholar_learning_session (progression).
-- Each query is independent. Change the window in the first CTE of each (default: the last 30 days).
-- timing_ms keys (route stages): auth_policy, passages_outline, related, references, cache, standing_preflight,
-- dedupe_claim or dedupe_wait, context, risk, research, generate (includes ai), ai, save, total.

-- 1. Generations: count, latency (route total and the model call), checks time, and how each ended.
with g as (
  select new_value v, created_at from audit_log
  where action = 'ai_assistant_query' and entity_type = 'individual_scholar_learn' and created_at >= now() - interval '30 days'
    and new_value ? 'timing_ms'
)
select v->>'action' as action, coalesce(v->>'prepared', 'false') as prepared, count(*) as generations,
  percentile_cont(0.5) within group (order by (v->'timing_ms'->>'total')::numeric) as p50_total_ms,
  percentile_cont(0.9) within group (order by (v->'timing_ms'->>'total')::numeric) as p90_total_ms,
  percentile_cont(0.5) within group (order by (v->'timing_ms'->>'ai')::numeric) as p50_ai_ms,
  percentile_cont(0.5) within group (order by ((v->'timing_ms'->>'generate')::numeric - coalesce((v->'timing_ms'->>'ai')::numeric, 0))) as p50_checks_ms,
  percentile_cont(0.5) within group (order by ((v->'timing_ms'->>'total')::numeric - coalesce((v->'timing_ms'->>'generate')::numeric, 0))) as p50_outside_generation_ms,
  count(*) filter (where v->>'outcome' = 'shown' and v->>'salvage_removed' is null) as shown_whole,
  count(*) filter (where v->>'outcome' = 'shown' and v->>'salvage_removed' is not null) as shown_salvaged,
  count(*) filter (where v->>'outcome' like 'withheld:%') as withheld,
  count(*) filter (where v->>'outcome' like 'error:%') as errors
from g group by 1, 2 order by 1, 2;

-- 2. Mean stage breakdown (where the time goes), generations and served lessons apart.
with r as (
  select case when action = 'scholar_learn_served' then 'served' else 'generated' end as kind, new_value->'timing_ms' t
  from audit_log
  where action in ('ai_assistant_query', 'scholar_learn_served') and entity_type = 'individual_scholar_learn'
    and created_at >= now() - interval '30 days' and new_value ? 'timing_ms'
)
select kind, k as stage, round(avg((t->>k)::numeric)) as mean_ms, count(*) as n
from r, jsonb_object_keys(t) k group by kind, k order by kind, mean_ms desc;

-- 3. Time to first content per opened lesson: a served lesson's total, or the generation's total.
with o as (
  select case when action = 'scholar_learn_served' then 'saved' else 'generated' end as path, (new_value->'timing_ms'->>'total')::numeric ms
  from audit_log
  where entity_type = 'individual_scholar_learn' and created_at >= now() - interval '30 days' and new_value ? 'timing_ms'
    and ((action = 'scholar_learn_served' and (new_value->>'cached')::boolean)
      or (action = 'ai_assistant_query' and new_value->>'outcome' = 'shown' and coalesce((new_value->>'prepared')::boolean, false) = false))
)
select path, count(*) n, percentile_cont(0.5) within group (order by ms) p50_ms, percentile_cont(0.9) within group (order by ms) p90_ms from o group by path;

-- 4. Reuse rate: lessons served from saved / all lessons delivered (served + shown generations, prepared excluded).
with w as (select * from audit_log where entity_type = 'individual_scholar_learn' and created_at >= now() - interval '30 days')
select
  count(*) filter (where action = 'scholar_learn_served' and (new_value->>'cached')::boolean) as served_from_saved,
  count(*) filter (where action = 'scholar_learn_served' and (new_value->>'legacy')::boolean) as served_from_earlier_prompt,
  count(*) filter (where action = 'ai_assistant_query' and new_value->>'outcome' = 'shown' and coalesce((new_value->>'prepared')::boolean, false) = false) as generated_shown,
  round(100.0 * count(*) filter (where action = 'scholar_learn_served' and (new_value->>'cached')::boolean)
    / nullif(count(*) filter (where (action = 'scholar_learn_served' and (new_value->>'cached')::boolean)
      or (action = 'ai_assistant_query' and new_value->>'outcome' = 'shown' and coalesce((new_value->>'prepared')::boolean, false) = false)), 0), 1) as reuse_pct
from w;

-- 5. Duplicates suppressed (no AI call) and how they ended.
select coalesce(new_value->>'first', case when (new_value->>'cached')::boolean then 'served_saved' end) as how, count(*)
from audit_log
where action = 'scholar_learn_served' and (new_value->>'duplicate_suppressed')::boolean and created_at >= now() - interval '30 days'
group by 1;

-- 6. Refusal, salvage and recovery: withheld reasons and salvage detail (codes and rule words only, never text).
select coalesce(new_value->>'outcome', '?') as outcome, coalesce(new_value->>'salvage_detail', new_value->>'withheld_detail') as detail, count(*)
from audit_log
where action = 'ai_assistant_query' and entity_type = 'individual_scholar_learn' and new_value->>'action' = 'teach' and created_at >= now() - interval '30 days'
  and (new_value->>'outcome' <> 'shown' or new_value->>'salvage_removed' is not null)
group by 1, 2 order by 3 desc;
-- recovery: an evidence-recovery explanation is its own generation (no dedupe_key, recovered in the reply); plat_ai_outcomes
-- reasons carry grounding_salvaged for a salvaged lesson.
select outcome, count(*), count(*) filter (where 'grounding_salvaged' = any(rejection_reasons)) as salvaged
from plat_ai_outcomes where product = 'scholar' and activity like 'learn%:teach' and created_at >= now() - interval '30 days' group by 1;

-- 7. Cost per delivered lesson: AI spend of Teach generations / lessons delivered (served + shown). Join by action_id.
with gen as (
  select (new_value->>'action_id')::uuid action_id, new_value->>'outcome' outcome, coalesce((new_value->>'prepared')::boolean, false) prepared
  from audit_log where action = 'ai_assistant_query' and entity_type = 'individual_scholar_learn' and new_value->>'action' = 'teach'
    and created_at >= now() - interval '30 days' and new_value ? 'action_id'
), spend as (
  select g.action_id, g.outcome, g.prepared, coalesce(sum(r.cost_usd), 0) usd, avg(r.latency_ms) model_ms
  from gen g left join plat_ai_requests r on r.action_id = g.action_id group by 1, 2, 3
), delivered as (
  select count(*) n from audit_log where action = 'scholar_learn_served' and (new_value->>'cached')::boolean and new_value->>'action' = 'teach'
    and created_at >= now() - interval '30 days'
)
select round(sum(usd), 4) teach_spend_usd,
  round(sum(usd) filter (where outcome <> 'shown'), 4) spend_not_shown_usd,
  round(sum(usd) filter (where prepared), 4) spend_prepared_usd,
  count(*) filter (where outcome = 'shown' and not prepared) + (select n from delivered) as lessons_delivered,
  round(sum(usd) / nullif(count(*) filter (where outcome = 'shown' and not prepared) + (select n from delivered), 0), 5) as usd_per_delivered_lesson,
  round(avg(model_ms)) mean_model_latency_ms
from spend;

-- 8. Prepared and viewed: prepared lessons later served from saved, by the same learner and key.
with p as (
  select actor_id, new_value->>'dedupe_key' k, created_at from audit_log
  where action = 'ai_assistant_query' and (new_value->>'prepared')::boolean and new_value->>'saved' = 'ok' and created_at >= now() - interval '30 days'
)
select count(*) prepared, count(*) filter (where exists (
  select 1 from audit_log s where s.action = 'scholar_learn_served' and s.actor_id = p.actor_id and s.new_value->>'dedupe_key' = p.k and s.created_at > p.created_at
)) as prepared_and_viewed
from p;

-- 9. Progression and abandonment: steps reached per session (learning events) against the session's steps.
with s as (
  select ses.id, ses.user_id, ses.status, ses.current_step,
    (select count(distinct st.step) from individual_scholar_learning_step st where st.session_id = ses.id and st.user_id = ses.user_id) steps,
    (select count(distinct e.step) from individual_scholar_learning_event e where e.session_id = ses.id and e.user_id = ses.user_id) steps_learned,
    ses.last_active_at
  from individual_scholar_learning_session ses where ses.created_at >= now() - interval '30 days'
)
select count(*) sessions, round(avg(steps_learned::numeric / nullif(steps, 0)) * 100, 1) mean_pct_steps_learned,
  count(*) filter (where status = 'completed') completed,
  count(*) filter (where status <> 'completed' and last_active_at < now() - interval '7 days') abandoned_7d
from s;
