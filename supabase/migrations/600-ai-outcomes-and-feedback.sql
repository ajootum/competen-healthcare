-- ====================================================================================================
-- MIGRATION 600: AI OUTCOMES AND LEARNER FEEDBACK (COMPETEN-SCHOLAR-AI-OPT-01, Wave 1)
--
-- Owner directive COMPETEN-SCHOLAR-AI-OPT-01, 27 Oct 2026, sections 4 and 7. Build record:
-- docs/COMPETEN-SCHOLAR-AI-OPT-01.md.
--
-- APPLY ON STAGING FIRST. Production only under its own owner GO. LOW: one nullable column on plat_ai_requests,
-- two new tables, no trigger, no function. No existing row is changed. Depends on plat_ai_requests (055).
-- Re-running it is a no-op. Rollback: ROLLBACK-600.sql.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
-- plat_ai_requests (055, 371) already records every model call: operation, tier, provider, model, tokens,
-- status and estimated cost. It cannot say whether the call produced anything a learner kept, because one
-- learner action (write questions, check them blind, retry once) makes several calls and nothing ties them
-- together or to the result. The Scholar audit row records the result but not the calls. So cost per
-- ACCEPTED output could not be measured. This file adds only what is missing:
--
--   plat_ai_requests.action_id  the learner action a call belonged to. Null on every earlier row, which is
--                               honest: those calls were never grouped.
--   plat_ai_outcomes            one row per learner action: what kind of output, accepted or rejected, how
--                               many kept and dropped, the rejection reason CODES, the source-sufficiency
--                               outcome, generation and verification attempts, prompt and config versions,
--                               and a one-way key of the source material (for the identical-retry guard).
--   plat_ai_feedback            optional learner feedback on one output: positive or negative and reason
--                               CODES. One row per learner and output, by a one-way key.
--
-- PRIVACY. No text of any kind: no question, no note, no passage, no generated content, no clinical detail.
-- No user id: material_key and feedback_key are sha256 digests computed by the application over the user id
-- and the content, so a row cannot be read back to a person or a passage. Both tables have RLS on and no
-- policy: service role only, like plat_ai_requests.
-- ====================================================================================================

alter table plat_ai_requests
  add column if not exists action_id uuid;

create index if not exists idx_plat_ai_requests_action on plat_ai_requests(action_id);

create table if not exists plat_ai_outcomes (
  id                  uuid primary key default gen_random_uuid(),
  action_id           uuid not null unique,
  product             text not null check (product in ('scholar', 'professional', 'practice', 'enterprise', 'holdings')),
  activity            text not null check (char_length(activity) between 1 and 60),
  operation           text check (char_length(operation) <= 80),
  output_kind         text not null check (output_kind in ('explanation', 'question', 'case', 'other')),
  outcome             text not null check (outcome in ('accepted', 'partial', 'rejected', 'redirected', 'error')),
  accepted_count      int not null default 0 check (accepted_count >= 0),
  rejected_count      int not null default 0 check (rejected_count >= 0),
  rejection_reasons   text[] not null default '{}' check (cardinality(rejection_reasons) <= 20),
  sufficiency         text not null default 'not_assessed'
                        check (sufficiency in ('sufficient', 'simpler', 'insufficient', 'uncertain', 'not_assessed')),
  generation_attempts int not null default 0 check (generation_attempts between 0 and 10),
  verify_attempts     int not null default 0 check (verify_attempts between 0 and 10),
  prompt_version      text check (char_length(prompt_version) <= 120),
  config_version      text check (char_length(config_version) <= 120),
  material_key        text check (material_key ~ '^[0-9a-f]{64}$'),
  created_at          timestamptz not null default now()
);

create index if not exists idx_plat_ai_outcomes_created on plat_ai_outcomes(created_at desc);
create index if not exists idx_plat_ai_outcomes_material on plat_ai_outcomes(material_key, created_at desc);

alter table plat_ai_outcomes enable row level security;

create table if not exists plat_ai_feedback (
  id             uuid primary key default gen_random_uuid(),
  feedback_key   text not null unique check (feedback_key ~ '^[0-9a-f]{64}$'),
  product        text not null check (product in ('scholar', 'professional', 'practice', 'enterprise', 'holdings')),
  output_kind    text not null check (output_kind in ('explanation', 'question', 'case', 'other')),
  activity       text check (char_length(activity) <= 60),
  rating         text not null check (rating in ('positive', 'negative')),
  reasons        text[] not null default '{}'
                   check (reasons <@ array['inaccurate', 'unclear', 'difficulty', 'relevance', 'evidence']::text[]),
  prompt_version text check (char_length(prompt_version) <= 120),
  action_id      uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_plat_ai_feedback_created on plat_ai_feedback(created_at desc);

alter table plat_ai_feedback enable row level security;

notify pgrst, 'reload schema';
