-- 086: Patient Operations configuration & rules store (POS-112). The governed, versioned,
-- effective-dated configuration that parameterises patient operations — observation frequency by
-- acuity, escalation PEWS thresholds and response SLAs, and structural lists (bed/ward types).
-- POS-001 §14: "configuration applies prospectively and cannot change historical event meaning" —
-- so this store is APPEND-A-NEW-VERSION, never mutate-in-place:
--
--   • The current effective value of a rule is the active=true row for (hospital_id, domain, rule_key).
--   • Changing a rule marks the old row active=false and inserts a new version (supersedes_id,
--     version+1, effective_from now, reason) — full history retained, audit trail preserved.
--   • Rule DEFAULTS live in code (lib/operations/pos-config-schema.ts); this store holds tenant
--     OVERRIDES. A rule with no override row falls back to its coded default (honest, not blank).
--
-- Idempotent; RLS enabled, service-role only — reads/writes go through the audited, role-gated
-- /api/operations/pos-config API, matching migrations 084 / 085.

create table if not exists op_config_rules (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references hospitals(id) on delete cascade,
  domain         text not null,                       -- 'observation','escalation','bed_type','ward_type'
  rule_key       text not null,                       -- 'obs_freq_critical','pews_escalate',…
  label          text,
  value          jsonb not null,                      -- {minutes:15} / {score:5} / {list:[…]}
  data_type      text,                                -- 'minutes','score','list','text'
  active         boolean not null default true,
  version        integer not null default 1,
  supersedes_id  uuid references op_config_rules(id) on delete set null,
  effective_from timestamptz not null default now(),
  reason         text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_op_config_active on op_config_rules(hospital_id, domain, active);
create index if not exists idx_op_config_rule on op_config_rules(hospital_id, domain, rule_key, active);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_config_rules') then
    execute 'alter table public.op_config_rules enable row level security';
  end if;
end $$;
