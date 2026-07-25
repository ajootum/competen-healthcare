-- 098: Configuration Migration Toolkit (NCP-020) — the transport layer for configuration metadata between
-- environments/tenants. Records export/import/rollback jobs, including the pre-import CHECKPOINT (the versions
-- captured for every object an import touched) so an import can be rolled back deterministically. The bundle
-- itself is a self-contained, dependency-closed JSON with a checksum. Idempotent; RLS service-role only,
-- mirroring 092.

create table if not exists configuration_migration_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null                               -- export | import | rollback
    check (job_type in ('export','import','rollback')),
  status text not null default 'built'                 -- built | validated | applied | rolled_back | failed
    check (status in ('built','validated','applied','rolled_back','failed')),
  object_count int not null default 0,
  summary jsonb not null default '{}',                 -- {new,updated,deps,checksum,errors}
  checkpoint jsonb not null default '[]',              -- import: [{object_key, version}] pre-import snapshots for rollback
  manifest jsonb not null default '{}',                -- bundle manifest (keys/types/checksum) — not the full payload
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  created_by_name text
);
create index if not exists idx_migration_jobs_type on configuration_migration_jobs(job_type, created_at desc);

alter table configuration_migration_jobs enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin client behind super-admin-gated APIs.
