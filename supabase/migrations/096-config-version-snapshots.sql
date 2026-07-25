-- 096: Configuration Versioning & Audit Service (NCP-018) — immutable version snapshots for every configuration
-- object, so every change is comparable and reversible. Complements configuration_registry_audit (which records
-- WHAT action happened) by storing the FULL object STATE at each version, enabling diff + one-click restore +
-- release tagging. Snapshots are append-only + monotonically versioned per object_key. A snapshot is captured
-- automatically when an object's definition is saved (objects PATCH, best-effort) and on explicit capture/restore.
-- Idempotent; RLS service-role only (writes via the admin client behind super-admin-gated APIs), mirroring 092.

create table if not exists configuration_version_snapshots (
  id uuid primary key default gen_random_uuid(),
  object_key text not null,
  version int not null,                                -- monotonic per object_key (1,2,3,…)
  object_type text,
  display_name text,
  state jsonb not null default '{}',                   -- full mutable object state at this version
  definition jsonb not null default '{}',              -- convenience: the definition at this version
  checksum text,                                       -- integrity hash of state
  action text not null default 'captured',             -- captured | defined | published | restored
  change_reason text,
  restored_from int,                                   -- when action=restored, the source version
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now(),
  unique (object_key, version)
);
create index if not exists idx_version_object on configuration_version_snapshots(object_key, version desc);
create index if not exists idx_version_created on configuration_version_snapshots(created_at desc);

create table if not exists configuration_release_tags (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,                            -- e.g. release/2026-q3
  description text,
  members jsonb not null default '[]',                 -- [{object_key, version}]
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  created_by_name text
);

alter table configuration_version_snapshots enable row level security;
alter table configuration_release_tags enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin client behind super-admin-gated APIs.
