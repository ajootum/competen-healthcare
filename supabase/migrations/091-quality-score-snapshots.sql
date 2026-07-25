-- 091: Quality & Safety Command Centre (UMG-QS-001) — the immutable quality-score snapshot history
-- (§26 core entity quality_score_snapshot; §33 "historical score snapshots remain immutable"). The command
-- centre upserts one row per hospital per day with the composite quality health score and the executive KPIs,
-- then reads the history to draw the KPI sparklines, the prior-period deltas and the 12-month quality trend.
-- Idempotent; unique on (hospital_id, snapshot_date) so the daily upsert is safe to re-run. RLS service-role
-- only (writes flow through the audited admin client behind the role-gated dashboard loader).

create table if not exists quality_score_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  snapshot_date      date not null default current_date,
  health_score       int,     -- overall unit quality health score (weighted composite, §6)
  quality_score      int,
  safety_index       int,
  compliance_score   int,     -- audit compliance
  open_capas         int,
  overdue_capas      int,
  critical_incidents int,
  high_risks         int,
  patient_safety_events int,  -- open incidents in the period
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (hospital_id, snapshot_date)
);
create index if not exists idx_quality_snapshots_hospital on quality_score_snapshots(hospital_id, snapshot_date);

alter table quality_score_snapshots enable row level security;
-- No client policies on purpose: the daily snapshot upsert + history read run through the service-role admin
-- client behind the role-gated Quality Command Centre loader.
