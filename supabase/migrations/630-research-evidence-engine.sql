-- ====================================================================================================
-- MIGRATION 630: THE RESEARCH AND EVIDENCE ENGINE, ITS HQ RIGHT AND ITS USAGE RECORD
--
-- COMPETEN-RESEARCH-01 ADDENDUM V2 (owner GO 2026-10-28). Reserved number 630.
--
-- APPLY ON STAGING FIRST. It inserts one capability into the existing HQ catalogue and creates one
-- table. It alters and drops nothing, and re-running it is a no-op. No function, no plpgsql.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT IS FOR.
--
--   1. hq.platform.research.manage, the right to edit the Research Sources and Evidence Studio
--      (HQ, AI and Intelligence, Research Sources). It is GRANTED TO NO POSITION. Until the owner
--      grants it, only the platform owners hqApiGate already admits may edit. Approval, activation,
--      retirement and publication are owner-only in code whoever holds this right.
--
--   2. plat_research_requests, research usage and cost, one row per provider call (or cache hit),
--      kept APART from plat_ai_requests so research spend is never read as AI spend. It holds no
--      query text, no person, no learner material and no answer. RLS on with no policy, so the
--      service role only. The engine provider budgets are read from it and FAIL CLOSED while it
--      is absent (src/lib/holdings/research/load.ts).
--
-- WHAT IT DOES NOT DO.
--
--   It activates nothing. Every research source starts Designed or Configured in code, and nothing
--   can be called until the owner approves and activates it in HQ. It writes no configuration.
--
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT.
--   ASCII only. No semicolons inside any comment or string literal. No partial unique index.
--   notify pgrst last.
--
-- ROLLBACK (staging): ROLLBACK-630.sql in the build record. Drop the table, then delete the
--   capability row (it has no grant to delete).
-- ====================================================================================================

insert into hq_capability (code, space, label, description) values
  ('hq.platform.research.manage', 'platform', 'Research sources and evidence',
   'Edit the research source registry, source policies, evidence rules, workflows and budgets. Approval, activation and publication stay with the platform owners')
on conflict (code) do nothing;

create table if not exists plat_research_requests (
  id           uuid primary key default gen_random_uuid(),
  action_id    uuid,
  product      text not null check (product in ('scholar', 'professional', 'enterprise', 'practice')),
  operation    text not null check (char_length(operation) between 1 and 80),
  workflow     text not null check (char_length(workflow) between 1 and 40),
  provider     text not null check (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
  capability   text not null check (capability ~ '^[a-z][a-z0-9_]{1,40}$'),
  requests     integer not null default 0 check (requests between 0 and 100),
  results      integer not null default 0 check (results between 0 and 100),
  outcome      text not null check (outcome in ('ok', 'failed', 'refused', 'budget', 'cache')),
  latency_ms   integer not null default 0 check (latency_ms between 0 and 600000),
  cost_usd     numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at   timestamptz not null default now()
);

create index if not exists idx_plat_research_requests_created on plat_research_requests(created_at);
create index if not exists idx_plat_research_requests_provider on plat_research_requests(provider, created_at);

alter table plat_research_requests enable row level security;

comment on table plat_research_requests is
  'COMPETEN-RESEARCH-01 ADDENDUM V2 (630). Research usage and cost per provider call, apart from AI usage (plat_ai_requests). No query text, no person, no learner material. Service role only (RLS on, no policy).';

-- Verification: the capability with no grant, and the empty table.
select code, space, label from hq_capability where code = 'hq.platform.research.manage';
select count(*) as grants from hq_position_capability where capability_code = 'hq.platform.research.manage';
select count(*) as rows from plat_research_requests;

notify pgrst, 'reload schema';
