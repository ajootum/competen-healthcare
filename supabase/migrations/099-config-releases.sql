-- 099: Configuration Publishing Service (NCP-019) — promotes validated configuration through release CHANNELS
-- (dev → qa → uat → pilot → production) with a rollout strategy and optional scheduling. Complements WCE-004
-- governance (per-change review/approval) and NCP-020 migration (cross-environment transport): a RELEASE bundles
-- a set of objects, is gated by schema + dependency validation, and is activated (objects go live) with a
-- pre-activation checkpoint so it is rollback-capable. Idempotent; RLS service-role only, mirroring 092.

create table if not exists configuration_releases (
  id uuid primary key default gen_random_uuid(),
  release_key text not null unique,                    -- e.g. release.2026_q3_ward
  name text not null,
  description text,
  channel text not null default 'dev'
    check (channel in ('dev','qa','uat','pilot','production')),
  rollout text not null default 'immediate'
    check (rollout in ('immediate','scheduled','phased','canary')),
  scheduled_for timestamptz,
  objects jsonb not null default '[]',                 -- array of registry object_keys in the release
  status text not null default 'draft'
    check (status in ('draft','validated','approved','scheduled','published','activated','rolled_back','failed')),
  validation jsonb,                                    -- last validate result {ok, schemaErrors, depReason}
  checkpoint jsonb not null default '[]',              -- pre-activation snapshots [{object_key, version|null}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null
);
create index if not exists idx_releases_status on configuration_releases(status);
create index if not exists idx_releases_channel on configuration_releases(channel);

create table if not exists configuration_release_events (
  id uuid primary key default gen_random_uuid(),
  release_key text not null,
  event text not null,                                 -- created | saved | validated | approved | published | activated | rolled_back
  detail jsonb,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_release_events_key on configuration_release_events(release_key, created_at desc);

alter table configuration_releases enable row level security;
alter table configuration_release_events enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin client behind super-admin-gated APIs.
