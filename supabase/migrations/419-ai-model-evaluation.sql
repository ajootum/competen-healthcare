-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 419: AI MODEL EVALUATION -- RUNS, RESULTS AND PROPOSED ELIGIBILITY (EVIDENCE, NOT DECISIONS)
--
-- COMPETEN IND-007 owner decision D5 (2026-10-24). Coordinator range 419-424. Depends on 410 (ai_price) and 412
-- (the risk tiers).
--
-- APPLY ON STAGING FIRST. ADDITIVE. Three new tables, their guards, no change to any existing object. Re-running it
-- is a no-op. OPS-001 s8: proposed Low (new evidence tables, nothing that moves a balance or grants access), with a
-- rollback rehearsal.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It records what a focused clinical and educational evaluation of a candidate model found -- the model and its
-- exact version, each task, the quality results, the cost -- and what eligibility that evidence would support, so
-- that a human reviewer decides eligibility on recorded evidence rather than on a model's price or reputation.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
--   ai_model_evaluation_run       one evaluation: the evaluation-set version, who ran it, when, and a note.
--   ai_model_evaluation_result    one item answered by one model: task, risk tier, provider, the model requested
--                                 and the version the provider reported, tokens, cost at the price row in force,
--                                 latency, status, the answer, the rubric results and the score.
--   ai_model_evaluation_proposal  what the run's evidence SUPPORTS for one model and activity: the highest risk
--                                 tier proposed, or none, with the rationale. A proposal is not a decision.
--
-- NOTE. NOTHING HERE MAKES A MODEL ELIGIBLE. Eligibility is still and only an ai_model_eligibility row (411, 412), made
-- through the governed HQ page by the owner or an appointed clinical reviewer, citing the run as its evidence. A
-- premium model is never eligible because it is premium: only a recorded decision makes it so.
--
-- NOTE. EVIDENCE IS APPEND-ONLY. Results and proposals refuse UPDATE and DELETE, except a delete cascading from their
-- run (pg_trigger_depth() > 1), so a whole run can still be withdrawn and nothing is undeletable by anybody. A run
-- itself refuses UPDATE.
--
-- RLS: on for all three, no policy. The service role only, as for every AI accounting table.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/AI-EVAL/ROLLBACK-419.sql drops the three tables and their guard functions.
-- ====================================================================================================


create table if not exists ai_model_evaluation_run (
  id                uuid primary key default gen_random_uuid(),
  eval_set_version  text not null,
  label             text,
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);
alter table ai_model_evaluation_run drop constraint if exists ai_model_evaluation_run_check;
alter table ai_model_evaluation_run add constraint ai_model_evaluation_run_check
  check (char_length(btrim(eval_set_version)) between 1 and 80 and (label is null or char_length(label) <= 200) and (note is null or char_length(note) <= 2000));
alter table ai_model_evaluation_run enable row level security;

create table if not exists ai_model_evaluation_result (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references ai_model_evaluation_run(id) on delete cascade,
  item_code       text not null,
  task            text not null,
  risk_tier       text not null,
  provider        text not null,
  model_requested text not null,
  model_returned  text,
  input_tokens    int,
  output_tokens   int,
  cost_usd        numeric(14, 6),
  price_id        uuid references ai_price(id),
  latency_ms      int,
  status          text not null,
  output          text,
  rubric          jsonb not null default '{}'::jsonb,
  score           numeric(5, 4),
  passed          boolean not null default false,
  created_at      timestamptz not null default now()
);
alter table ai_model_evaluation_result drop constraint if exists ai_model_evaluation_result_check;
alter table ai_model_evaluation_result add constraint ai_model_evaluation_result_check
  check (item_code ~ '^[a-z0-9][a-z0-9_.-]{1,60}$' and task ~ '^[a-z][a-z0-9_]{1,40}$'
     and risk_tier in ('standard_educational', 'clinical_educational', 'high_risk_clinical')
     and provider in ('anthropic', 'openai', 'gemini') and btrim(model_requested) <> ''
     and status in ('ok', 'refusal', 'error')
     and (input_tokens is null or input_tokens >= 0) and (output_tokens is null or output_tokens >= 0)
     and (cost_usd is null or cost_usd >= 0) and (latency_ms is null or latency_ms >= 0)
     and (output is null or char_length(output) <= 40000) and (score is null or (score >= 0 and score <= 1)));
create index if not exists idx_ai_model_evaluation_result_run on ai_model_evaluation_result(run_id, provider, model_requested);
alter table ai_model_evaluation_result enable row level security;

create table if not exists ai_model_evaluation_proposal (
  id                     uuid primary key default gen_random_uuid(),
  run_id                 uuid not null references ai_model_evaluation_run(id) on delete cascade,
  product                text not null,
  activity               text not null,
  provider               text not null,
  model_prefix           text not null,
  proposed_max_risk_tier text,
  rationale              text not null,
  created_at             timestamptz not null default now()
);
alter table ai_model_evaluation_proposal drop constraint if exists ai_model_evaluation_proposal_check;
alter table ai_model_evaluation_proposal add constraint ai_model_evaluation_proposal_check
  check (product in ('scholar', 'professional') and activity ~ '^[a-z][a-z0-9_]{1,40}$'
     and provider in ('anthropic', 'openai', 'gemini') and btrim(model_prefix) <> ''
     and (proposed_max_risk_tier is null or proposed_max_risk_tier in ('standard_educational', 'clinical_educational', 'high_risk_clinical'))
     and char_length(btrim(rationale)) between 5 and 2000);
create unique index if not exists ux_ai_model_evaluation_proposal on ai_model_evaluation_proposal(run_id, product, activity, provider, model_prefix);
alter table ai_model_evaluation_proposal enable row level security;


-- The run: written once. A run may be withdrawn whole (delete), which takes its results and proposals with it.
create or replace function public.ai_model_evaluation_run_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  raise exception 'ai_model_evaluation_run is evidence: a run cannot be rewritten. Withdraw it and run again';
end;
$$;
drop trigger if exists ai_model_evaluation_run_guard on ai_model_evaluation_run;
create trigger ai_model_evaluation_run_guard before update on ai_model_evaluation_run for each row execute function public.ai_model_evaluation_run_guard();

-- Results and proposals: append-only, except the cascade from their run.
create or replace function public.ai_model_evaluation_evidence_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception '% is evidence: it cannot be changed or deleted, except by withdrawing its whole run', tg_table_name;
end;
$$;
drop trigger if exists ai_model_evaluation_result_guard on ai_model_evaluation_result;
create trigger ai_model_evaluation_result_guard before update or delete on ai_model_evaluation_result for each row execute function public.ai_model_evaluation_evidence_guard();
drop trigger if exists ai_model_evaluation_proposal_guard on ai_model_evaluation_proposal;
create trigger ai_model_evaluation_proposal_guard before update or delete on ai_model_evaluation_proposal for each row execute function public.ai_model_evaluation_evidence_guard();


-- Verification: three tables, RLS on, no policy.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c where c.relname in ('ai_model_evaluation_run', 'ai_model_evaluation_result', 'ai_model_evaluation_proposal') order by c.relname;

notify pgrst, 'reload schema';
