-- PW-014 WS4 / P0 — Domain event outbox (transactional). The Supabase/Next equivalent of PW-014's event bus:
-- domain writes append an event here in the same transaction (§14.2 envelope); a dispatcher (P2) fans out via
-- Supabase Realtime for push-freshness and feeds the activity timeline + reconciliation. Append-only, at-least-once
-- + idempotent-by-(subject, aggregate_version). This migration only creates the log; producers/dispatch are P2.
-- Run in Supabase SQL editor. Idempotent (if not exists).

create table if not exists domain_events (
  id                uuid primary key default gen_random_uuid(),
  event_type        text not null,                        -- versioned namespace, e.g. 'assessment.completed'
  occurred_at       timestamptz not null default now(),   -- when the domain change happened
  tenant_id         uuid references tenants(id) on delete set null,
  hospital_id       uuid references hospitals(id) on delete set null,
  actor_id          uuid references profiles(id) on delete set null,
  actor_name        text,
  subject_type      text not null,                        -- aggregate type, e.g. 'competency_decision'
  subject_id        uuid,                                 -- aggregate id (traceability to source record)
  aggregate_version integer,                              -- monotonic per aggregate → event ordering + idempotency
  sensitivity       text not null default 'internal'
                      check (sensitivity in ('public','internal','operational','clinical','restricted')),
  payload           jsonb not null default '{}'::jsonb,   -- minimal event data; avoid unnecessary sensitive content
  trace_id          text,                                 -- distributed tracing correlation
  status            text not null default 'pending'
                      check (status in ('pending','processed','failed','dead_letter')),
  processed_at      timestamptz,
  attempts          integer not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists idx_domain_events_subject  on domain_events(subject_type, subject_id, aggregate_version);
create index if not exists idx_domain_events_created  on domain_events(created_at desc);
create index if not exists idx_domain_events_tenant   on domain_events(tenant_id, created_at desc);
create index if not exists idx_domain_events_type     on domain_events(event_type, created_at desc);
create index if not exists idx_domain_events_pending  on domain_events(status, created_at) where status = 'pending';

-- Idempotency guard: one row per (subject_type, subject_id, aggregate_version) when a version is supplied.
create unique index if not exists uq_domain_events_aggregate
  on domain_events(subject_type, subject_id, aggregate_version)
  where subject_id is not null and aggregate_version is not null;

-- Deny-by-default. Producers + the P0 lib write/read via the service-role client (bypasses RLS). A scoped SELECT
-- policy for authenticated Realtime subscribers is a P2 concern (tenant/hospital-filtered, non-restricted only).
alter table domain_events enable row level security;
