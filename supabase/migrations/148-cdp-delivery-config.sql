-- 148: CDP-014 Learning Governance & Delivery Configuration. Delivery-specific policy the runtime engines
-- actually CONSUME — the reminder horizon, whether failed assessments auto-remediate, whether orchestration
-- runs, and the default campaign deadline. WCE (076) governs workspace composition; this governs delivery
-- behaviour. MVP = a single global policy row (hospital_id null); per-hospital overrides are additive later.
-- Plain, idempotent statements only. RLS = authenticated read; service-role writes.

create table if not exists cdp_delivery_config (
  id                        uuid primary key default gen_random_uuid(),
  hospital_id               uuid references hospitals(id) on delete cascade,   -- null = global default
  reminder_horizon_days     int not null default 30,     -- how far ahead CDP-011 reminds
  auto_remediation          boolean not null default true, -- CDP-015: failed assessment → remediation
  orchestration_enabled     boolean not null default true, -- CDP-001: run the delivery orchestrator
  campaign_default_due_days int not null default 30,      -- CDP-008 default campaign deadline
  updated_by                uuid references profiles(id) on delete set null,
  updated_by_name           text,
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_cdp_delivery_config_hospital on cdp_delivery_config(hospital_id);

-- Seed the single global policy row so the engines always resolve something.
insert into cdp_delivery_config (hospital_id)
  select null::uuid where not exists (select 1 from cdp_delivery_config where hospital_id is null);

alter table cdp_delivery_config enable row level security;
drop policy if exists cdp_delivery_config_read on cdp_delivery_config;
create policy cdp_delivery_config_read on cdp_delivery_config for select to authenticated using (true);

notify pgrst, 'reload schema';
