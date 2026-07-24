-- 088: Competency readiness snapshots (CMO-001). The Competency Dashboard's KPI cards show a trend
-- sparkline + "vs yesterday" delta (per the mockup). That needs a retained daily history of the
-- headline metrics — which the live competency spine doesn't keep. This table records ONE row per
-- hospital per day with the six dashboard KPIs, so the sparklines/deltas are real and accumulate.
--
--   • Populated idempotently on dashboard view (upsert on hospital_id + snapshot_date) — today's row
--     tracks the latest reading; prior days stay frozen. A scheduled job can populate it too.
--   • Snapshots are per-hospital; the enterprise (super-admin) view shows no trend until aggregated.
--
-- Idempotent; RLS enabled, service-role only — written by the dashboard loader, matching migration 084/085.

create table if not exists competency_readiness_snapshots (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null references hospitals(id) on delete cascade,
  snapshot_date     date not null,
  readiness_score   integer,
  compliance_score  integer,
  at_risk_units     integer,
  expiring_30       integer,
  assessments_today integer,
  evidence_pending  integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (hospital_id, snapshot_date)
);
create index if not exists idx_comp_readiness_snap on competency_readiness_snapshots(hospital_id, snapshot_date desc);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='competency_readiness_snapshots') then
    execute 'alter table public.competency_readiness_snapshots enable row level security';
  end if;
end $$;
