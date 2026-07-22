-- ═══════════════════════════════════════════════════════════════════════════
-- 054 — Background Jobs & Deployment Recording (POS-001F / POS-002)
-- Adds run history for the background-job runner and enriches deployment
-- records. The job CATALOGUE lives in application code (lib/platform/jobs.ts,
-- like the workspace catalogue); this migration adds only the run-history table
-- and two optional deployment columns. RLS-locked (service-role only).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Job run history — one row per execution of a registered job ─────────────
create table if not exists plat_job_runs (
  id          uuid primary key default gen_random_uuid(),
  job_key     text not null,                 -- catalogue key, e.g. 'platform_metrics_snapshot'
  status      text not null default 'running'
                check (status in ('running','success','failed')),
  trigger     text not null default 'manual'
                check (trigger in ('manual','cron','system')),
  detail      text,                          -- human-readable result summary
  error       text,                          -- failure message when status='failed'
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_plat_job_runs_key on plat_job_runs(job_key, started_at desc);

-- ── Release Management enrichment (POS-002 §5) ──────────────────────────────
alter table plat_deployments
  add column if not exists git_commit   text,
  add column if not exists build_number text;

-- ── Lock the new table to the service role (no policies = service-role only) ─
do $$
begin
  execute 'alter table public.plat_job_runs enable row level security';
end $$;
