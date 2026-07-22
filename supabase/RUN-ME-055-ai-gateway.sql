-- ═══════════════════════════════════════════════════════════════════════════
-- 055 — AI Runtime Gateway governance (PFS-000 §15 / POS-001 AI Operations)
-- Usage log for every server-side AI generation. The shared generate() choke
-- point (lib/ai/client.ts) records one row per call: model, tier, tokens,
-- latency, status and estimated cost. This turns the "AI Operations" widget and
-- the AI Gateway console live, and gives central token/cost accounting.
-- RLS-locked (service-role only). Fail-soft: no table → logging is skipped.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists plat_ai_requests (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references profiles(id) on delete set null,
  tenant_id     uuid references tenants(id) on delete set null,
  operation     text,                            -- calling feature, e.g. 'coach','assess','report'
  tier          text,                            -- cheap | reasoning | heavy
  provider      text,                            -- anthropic | openai | gemini
  model         text,
  input_tokens  int,
  output_tokens int,
  total_tokens  int,
  latency_ms    int,
  status        text not null default 'ok'
                  check (status in ('ok','refusal','error','not_configured')),
  error         text,
  cost_usd      numeric,                          -- estimated, from list pricing
  created_at    timestamptz not null default now()
);
create index if not exists idx_plat_ai_requests_created on plat_ai_requests(created_at desc);
create index if not exists idx_plat_ai_requests_model on plat_ai_requests(model, created_at desc);

-- Lock to the service role (no policies = service-role only).
do $$
begin
  execute 'alter table public.plat_ai_requests enable row level security';
end $$;
