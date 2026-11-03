# SCHOLAR-AI-COST-CONFIG-01 — monitoring: the before/after comparison from the existing records (reporting only)

No new engine. Every figure comes from `plat_ai_requests` (one row per AI call: operation, tier, model, tokens, status, cost_usd, action_id), `plat_ai_outcomes` (what each Scholar action produced: outcome, accepted/rejected counts, reasons; written by `recordScholarOutcome`), `audit_log` (learn served/cached, revision started with generated/reused, verify rejects and withheld reasons in `new_value`) and `ai_usage_ledger` (CAU reservations and settlement where metering is on). Run read-only, production through the coordinator's read-only runner. Replace the two dates with the window; the baseline window is the 30 days before the configuration change.

**Baseline (production, 30 days to 3 Nov 2026, measured):** 93 calls, about USD 1.37, `map` 34 % on Sonnet, every row tier `reasoning`, Learn 43/43 served from saved, 3 revision sessions generated 11 and reused 0.

## M1. Cost per successful activity (by operation, model and tier)

```sql
select r.operation, r.tier, r.model,
       count(*) calls,
       count(distinct r.action_id) actions,
       round(sum(r.cost_usd)::numeric, 4) cost_usd,
       round((sum(r.cost_usd) / nullif(count(distinct r.action_id), 0))::numeric, 4) cost_per_action,
       sum(case when r.status = 'ok' then 1 else 0 end) ok_calls,
       sum(case when r.status <> 'ok' then 1 else 0 end) failed_calls
  from plat_ai_requests r
 where r.created_at >= :from and r.created_at < :to
   and r.operation like 'individual_scholar%'
 group by 1, 2, 3
 order by cost_usd desc;
```

## M2. Successful activity = an action whose outcome was accepted/stored (cost per useful output)

```sql
select o.operation,
       count(*) actions,
       sum(case when o.outcome in ('accepted', 'stored') then 1 else 0 end) succeeded,
       sum(coalesce(o.accepted, 0)) items_kept,
       sum(coalesce(o.rejected, 0)) items_rejected,
       round(sum(c.cost)::numeric, 4) cost_usd,
       round((sum(c.cost) / nullif(sum(case when o.outcome in ('accepted', 'stored') then 1 else 0 end), 0))::numeric, 4) cost_per_success
  from plat_ai_outcomes o
  left join (select action_id, sum(cost_usd) cost from plat_ai_requests group by action_id) c on c.action_id = o.action_id
 where o.created_at >= :from and o.created_at < :to
 group by 1
 order by cost_usd desc;
```

## M3. Model escalation rate (how often the cheap or reasoning tier was asked and a heavier model answered)

```sql
select r.operation, r.tier requested_tier, r.model answered_model, count(*) calls, round(sum(r.cost_usd)::numeric, 4) cost_usd
  from plat_ai_requests r
 where r.created_at >= :from and r.created_at < :to
   and r.operation like 'individual_scholar%'
 group by 1, 2, 3
 order by 1, 2, 3;
-- escalation = rows where (tier = 'cheap' and model not like 'claude-haiku%') or (tier = 'reasoning' and model like 'claude-opus%')
```

## M4. Refusals (allowance, eligibility, clarify, quota) — the gate decisions log and the request statuses

```sql
select status, coalesce(left(error, 60), '') reason, count(*) n
  from plat_ai_requests
 where created_at >= :from and created_at < :to and operation like 'individual_scholar%' and status <> 'ok'
 group by 1, 2 order by n desc;

select new_value->>'decision' decision, new_value->>'reason' reason, new_value->>'activity' activity, count(*) n
  from audit_log
 where created_at >= :from and created_at < :to and action = 'ai_gate_decision'
 group by 1, 2, 3 order by n desc;
```

## M5. Quality failures: verify rejects, withheld answers, dropped drafts (per operation and model)

```sql
select o.operation, r.model, o.outcome,
       count(*) actions,
       sum(coalesce(o.rejected, 0)) rejected_items,
       (select string_agg(x, ', ') from (select unnest(o.reasons) x limit 6) t) reasons
  from plat_ai_outcomes o
  left join plat_ai_requests r on r.action_id = o.action_id and r.operation = o.operation
 where o.created_at >= :from and o.created_at < :to
 group by 1, 2, 3, o.reasons
 order by 1, 2, 3;

-- Learn: served from saved vs generated vs withheld / salvaged
select new_value->>'cached' cached, new_value->>'open' opened, coalesce(new_value->>'salvage_removed', '0') salvaged, count(*) n
  from audit_log
 where created_at >= :from and created_at < :to and action = 'scholar_learn_served'
 group by 1, 2, 3;
```

## M6. Learner experience signals (reuse, regeneration, continuity)

```sql
-- revision sessions: generated vs reused, AI calls a session, saved-only notes
select new_value->>'mode' mode, count(*) sessions,
       sum((new_value->>'generated')::int) generated, sum((new_value->>'reused')::int) reused,
       sum((new_value->>'ai_calls')::int) ai_calls, sum((new_value->>'library')::int) library
  from audit_log
 where created_at >= :from and created_at < :to and action = 'individual_scholar_revision_started'
 group by 1;

-- OSCE stations: written vs reused (P3)
select new_value->>'outcome' outcome, count(*) n
  from audit_log
 where created_at >= :from and created_at < :to and action = 'ai_assistant_query' and entity_type = 'individual_scholar_osce_station'
 group by 1;

-- Learn: read marks, lessons opened, resumes (independent path in use)
select action, count(*) n from audit_log
 where created_at >= :from and created_at < :to
   and action in ('individual_scholar_learning_moved', 'individual_scholar_learning_started', 'individual_scholar_learning_resumed', 'scholar_learn_served')
 group by 1;
```

## M7. Allowance accounting (where metering is on)

```sql
select product, activity, tier, count(*) reservations, sum(cau_reserved) reserved, sum(cau_settled) settled
  from ai_usage_ledger
 where created_at >= :from and created_at < :to
 group by 1, 2, 3 order by 1, 2, 3;
```
(Column names as in migration 410; with metering off in production this table stays empty and M1 is the cost record.)

## How to read the comparison

Same window length before and after; compare M1 cost per action by operation (expect `individual_scholar_revision_flashcard` and `individual_scholar_map` to fall, `individual_scholar_learn` unchanged), M3 for escalation (a cheap request answered by Opus means an eligibility or floor decision, not a saving), M5 for quality (rejects and withheld must not rise for the operations moved to a cheaper model; if they do, the eligibility row is reversed), M6 for reuse (OSCE `reused` and revision `reused` rise; `generated` falls).
