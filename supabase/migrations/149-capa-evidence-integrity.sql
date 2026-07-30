-- 149: CAPA-004 Evidence Integrity. The evidence store (029) holds files but has no verification lifecycle, so
-- competency evidence can't be reviewed, verified or traced. This adds a verification state + an immutable
-- integrity-event log (chain-of-custody) so evidence integrity becomes a real assurance signal. Plain idempotent
-- statements only (no PL/pgSQL do-blocks). RLS on the new table = authenticated read; service-role writes.

alter table evidence add column if not exists status text not null default 'pending';
alter table evidence add column if not exists verified boolean not null default false;
alter table evidence add column if not exists verified_by uuid references profiles(id) on delete set null;
alter table evidence add column if not exists verified_at timestamptz;
alter table evidence add column if not exists expiry_date date;

create table if not exists evidence_integrity_events (
  id           uuid primary key default gen_random_uuid(),
  evidence_id  uuid references evidence(id) on delete cascade,
  hospital_id  uuid references hospitals(id) on delete cascade,
  event_type   text not null default 'verified',   -- uploaded / verified / rejected / flagged / unflagged / expired
  actor_id     uuid references profiles(id) on delete set null,
  actor_name   text,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_evidence_integrity_events_ev on evidence_integrity_events(evidence_id);
create index if not exists idx_evidence_integrity_events_hosp on evidence_integrity_events(hospital_id);

alter table evidence_integrity_events enable row level security;
drop policy if exists evidence_integrity_events_read on evidence_integrity_events;
create policy evidence_integrity_events_read on evidence_integrity_events for select to authenticated using (true);

notify pgrst, 'reload schema';
